import { env } from 'cloudflare:workers';
import { AppError, decodeImage, MAX_TOTAL_IMAGE_BYTES, topics, validate, validateLine } from '../lib/indicators';
export { topics, validate } from '../lib/indicators';
export function bindings() {
  const e = env as unknown as { DB: D1Database; IMAGES: R2Bucket };
  if (!e.DB || !e.IMAGES) throw new AppError('Armazenamento temporariamente indisponível. Tente novamente.', 503);
  return e;
}
type Row = { line: string; period: string; topic: string; object_key: string; content_type: string; updated_at: string };
export async function list(line?: string, date?: string) {
  if (line) { validateLine(line); if (date) validate(line, date); }
  const { DB } = bindings();
  const statement = line && date
    ? DB.prepare('SELECT * FROM indicator_images WHERE line=? AND period=? ORDER BY topic').bind(line, date)
    : line ? DB.prepare('SELECT * FROM indicator_images WHERE line=? ORDER BY period DESC, topic').bind(line)
    : DB.prepare('SELECT * FROM indicator_images ORDER BY period DESC, line, topic');
  const result = await statement.all<Row>();
  const grouped = new Map<string, { id: string; line: string; date: string; images: Record<string,string>; updatedAt: string }>();
  for (const r of result.results) {
    if (!topics.includes(r.topic)) continue;
    const id = r.line + ':' + r.period;
    if (!grouped.has(id)) grouped.set(id, { id, line: r.line, date: r.period, images: {}, updatedAt: r.updated_at });
    const entry = grouped.get(id)!;
    entry.images[r.topic] = '/api/images/' + r.object_key;
    if (r.updated_at > entry.updatedAt) entry.updatedAt = r.updated_at;
  }
  return [...grouped.values()];
}
export async function save(line: string, date: string, images: Record<string,string>, selected = topics) {
  validate(line, date);
  if (!images || typeof images !== 'object' || Array.isArray(images) || Object.keys(images).some(t => !topics.includes(t)) || Object.values(images).some(src => typeof src !== 'string') || !Array.isArray(selected) || !selected.length || selected.some(t => !topics.includes(t))) throw new AppError('Indicadores inválidos.');
  const { DB, IMAGES } = bindings();
  const previous = await DB.prepare('SELECT * FROM indicator_images WHERE line=? AND period=?').bind(line, date).all<Row>();
  const changes = [...new Set(selected)].map(topic => {
    const old = previous.results.find(r => r.topic === topic), src = images[topic];
    if (src && old && src === '/api/images/' + old.object_key) return { topic, old, unchanged: true, image: null };
    if (!src) return { topic, old, unchanged: false, image: null };
    return { topic, old, unchanged: false, image: decodeImage(src) };
  });
  if (changes.reduce((sum, c) => sum + (c.image?.bytes.length || 0), 0) > MAX_TOTAL_IMAGE_BYTES) throw new AppError('Este envio está muito grande. Atualize um indicador por vez.', 413);
  const uploaded: string[] = [], removed: string[] = [], statements: D1PreparedStatement[] = [];
  try {
    for (const { topic, old, unchanged, image } of changes) {
      if (unchanged) continue;
      if (image) {
        const key = crypto.randomUUID();
        uploaded.push(key);
        await IMAGES.put(key, image.bytes, { httpMetadata: { contentType: image.contentType } });
        statements.push(DB.prepare('INSERT INTO indicator_images (line,period,topic,object_key,content_type,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(line,period,topic) DO UPDATE SET object_key=excluded.object_key,content_type=excluded.content_type,updated_at=excluded.updated_at').bind(line, date, topic, key, image.contentType, new Date().toISOString()));
      } else if (old) statements.push(DB.prepare('DELETE FROM indicator_images WHERE line=? AND period=? AND topic=?').bind(line, date, topic));
      if (old) removed.push(old.object_key);
    }
    if (statements.length) await DB.batch(statements);
  } catch (error) {
    await Promise.allSettled(uploaded.map(key => IMAGES.delete(key)));
    throw error;
  }
  await Promise.allSettled(removed.map(key => IMAGES.delete(key)));
}
export async function remove(line: string, date: string) {
  validate(line, date);
  const { DB, IMAGES } = bindings();
  const rows = await DB.prepare('SELECT object_key FROM indicator_images WHERE line=? AND period=?').bind(line, date).all<{object_key:string}>();
  await DB.prepare('DELETE FROM indicator_images WHERE line=? AND period=?').bind(line, date).run();
  await Promise.allSettled(rows.results.map(r => IMAGES.delete(r.object_key)));
}
export function errorResponse(error: unknown) {
  console.error(error);
  return Response.json({ error: error instanceof AppError ? error.message : 'Não foi possível concluir o salvamento. Tente novamente.' }, { status: error instanceof AppError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}
export function sameOrigin(request: Request) { return request.headers.get('Origin') === new URL(request.url).origin; }
export async function readJSON(request: Request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new AppError('Envie os dados no formato JSON.', 415);
  if (Number(request.headers.get('Content-Length')) > 18 * 1024 * 1024) throw new AppError('Envio muito grande. Atualize um indicador por vez.', 413);
  const text = await request.text();
  if (text.length > 18 * 1024 * 1024) throw new AppError('Envio muito grande.', 413);
  try { const body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new AppError('Dados inválidos.'); }
}
