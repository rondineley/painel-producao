import { save, validate, topics, errorResponse, sameOrigin, readJSON } from '../../../db/cloud';
import { AppError, decodeImage } from '../../../lib/indicators';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Origem do envio não autorizada.' }, { status: 403 });
  try {
    const data = await readJSON(request);
    if (data.version !== 2 || !Array.isArray(data.entries) || !data.entries.length || data.entries.length > 100) throw new AppError('Backup inválido.');
    const seen = new Set<string>();
    for (const e of data.entries) {
      if (!e || typeof e !== 'object') throw new AppError('Lançamento de backup inválido.');
      validate(e.line, e.date);
      if (e.id !== e.line + ':' + e.date || seen.has(e.id) || !e.images || typeof e.images !== 'object' || Array.isArray(e.images) || !Object.keys(e.images).length || Object.keys(e.images).some(t => !topics.includes(t))) throw new AppError('Indicadores de backup inválidos.');
      seen.add(e.id);
      for (const src of Object.values(e.images)) decodeImage(src);
    }
    let count = 0;
    try { for (const e of data.entries) { await save(e.line, e.date, e.images); count++; } }
    catch (e) { throw new AppError(`Importação interrompida após ${count} lançamento(s). Importe novamente para continuar.`, e instanceof AppError ? e.status : 500); }
    return Response.json({ imported: count });
  } catch (e) { return errorResponse(e); }
}
