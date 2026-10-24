import { bindings, sameOrigin, readJSON, errorResponse } from '../../../db/cloud';
import { AppError } from '../../../lib/indicators';
export async function POST(request: Request) {
  if(!sameOrigin(request))return Response.json({error:'Origem não autorizada.'},{status:403});
  try {
    const body=await readJSON(request);
    if(typeof body.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.id))throw new AppError('Sessão inválida.');
    const {DB}=bindings(), now=Date.now(), cutoff=now-15000;
    const results=await DB.batch([
      DB.prepare('INSERT INTO online_visitors (id,last_seen) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen').bind(body.id,now),
      DB.prepare('DELETE FROM online_visitors WHERE last_seen < ?').bind(cutoff),
      DB.prepare('SELECT COUNT(*) AS online FROM online_visitors WHERE last_seen >= ?').bind(cutoff)
    ]);
    const row=results[2].results[0] as {online:number};
    return Response.json({online:row.online},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}
