import { list, save, remove, errorResponse, sameOrigin, readJSON } from '../../../db/cloud';
import { AppError } from '../../../lib/indicators';
export async function GET(request: Request) {
  try {
    const u = new URL(request.url), line = u.searchParams.get('line'), date = u.searchParams.get('date');
    if (date && !line) throw new AppError('Informe a linha para consultar o período.');
    const entries = await list(line || undefined, date || undefined);
    return Response.json(line && date ? entries[0] || null : entries, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Origem do envio não autorizada.' }, { status: 403 });
  try {
    const b = await readJSON(request);
    await save(b.line, b.date, b.images, b.topics);
    return Response.json({ saved: true, entry: (await list(b.line, b.date))[0] || null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Origem do envio não autorizada.' }, { status: 403 });
  try { const b = await readJSON(request); await remove(b.line, b.date); return new Response(null, { status: 204 }); }
  catch (e) { return errorResponse(e); }
}
