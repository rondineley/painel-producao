import { bindings, sameOrigin, readJSON, errorResponse } from '../../../db/cloud';
import { activeLines, AppError, validDate } from '../../../lib/indicators';
function monthValue(value: unknown): asserts value is string {
  if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new AppError('Mês inválido.');
}
export async function GET(request: Request) {
  try {
    const month=new URL(request.url).searchParams.get('month');monthValue(month);
    const {DB}=bindings();
    const rows=await DB.prepare('SELECT line, day, production, efficiency FROM daily_production WHERE day >= ? AND day <= ? ORDER BY line, day').bind(month+'-01',month+'-31').all();
    return Response.json(rows.results,{headers:{'Cache-Control':'no-store'}});
  }catch(e){return errorResponse(e);}
}
export async function PATCH(request: Request) {
  if(!sameOrigin(request))return Response.json({error:'Origem não autorizada.'},{status:403});
  try {
    const b=await readJSON(request);monthValue(b.month);
    if(!Array.isArray(b.changes)||!b.changes.length||b.changes.length>806)throw new AppError('Alterações inválidas.');
    const {DB}=bindings();
    const statements=b.changes.map((c: {line:string;day:string;metric:string;value:number|null})=>{
      if(!c||!activeLines.includes(c.line)||!validDate(c.day)||!c.day.startsWith(b.month+'-')||!['production','efficiency'].includes(c.metric)||c.value!==null&&(typeof c.value!=='number'||!Number.isFinite(c.value)||c.value<0||c.value>1e12||c.metric==='production'&&!Number.isInteger(c.value)))throw new AppError('Valor, linha ou data inválida.');
      // Only the changed metric is updated, preserving other cells edited by the team.
      const metric=c.metric==='production'?'production':'efficiency';
      return DB.prepare(`INSERT INTO daily_production (line,day,${metric},updated_at) VALUES (?,?,?,?) ON CONFLICT(line,day) DO UPDATE SET ${metric}=excluded.${metric},updated_at=excluded.updated_at`).bind(c.line,c.day,c.value,new Date().toISOString());
    });
    await DB.batch(statements);return Response.json({saved:true});
  }catch(e){return errorResponse(e);}
}
