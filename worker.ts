import * as entries from './app/api/entries/route';
import * as production from './app/api/production/route';
import * as presence from './app/api/presence/route';
import * as backup from './app/api/import/route';
import * as image from './app/api/images/[key]/route';
type Bindings={ASSETS:Fetcher;DB:D1Database;IMAGES:R2Bucket};
export default {
 async fetch(request:Request,env:Bindings):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
  const method=request.method;
  if(path==='/api/entries'){
   if(method==='GET')return entries.GET(request);
   if(method==='PUT')return entries.PUT(request);
   if(method==='DELETE')return entries.DELETE(request);
  }else if(path==='/api/production'){
   if(method==='GET')return production.GET(request);
   if(method==='PATCH')return production.PATCH(request);
  }else if(path==='/api/presence'&&method==='POST')return presence.POST(request);
  else if(path==='/api/import'&&method==='POST')return backup.POST(request);
  else if(path.startsWith('/api/images/')&&method==='GET')return image.GET(request,{params:Promise.resolve({key:path.slice('/api/images/'.length)})});
  else return Response.json({error:'Rota não encontrada.'},{status:404});
  return Response.json({error:'Método não permitido.'},{status:405});
 }
} satisfies ExportedHandler<Bindings>;
