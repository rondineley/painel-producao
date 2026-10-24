import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),deps=createRequire(require.resolve('wrangler/package.json'));
const {build}=deps('esbuild'),{Miniflare}=deps('miniflare');
const output=await build({entryPoints:['worker.ts'],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:workers']});
const mf=new Miniflare({modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['IMAGES'],serviceBindings:{ASSETS:()=>new Response('assets-ok')}});
const request=(path,method='GET',body)=>mf.dispatchFetch('https://panel.test'+path,{method,headers:{Origin:'https://panel.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const json=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();};
try{
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('drizzle/'+file,'utf8').replace(/\n/g,' '));
 assert.equal(await (await request('/')).text(),'assets-ok');
 await json(await request('/api/production','PATCH',{month:'2026-10',changes:[{line:'7011',day:'2026-10-01',metric:'production',value:123},{line:'7011',day:'2026-10-01',metric:'efficiency',value:98.5}]}));
 const rows=await json(await request('/api/production?month=2026-10'));assert.equal(rows[0].production,123);assert.equal(rows[0].efficiency,98.5);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFo4AAAAASUVORK5CYII=';
 const saved=await json(await request('/api/entries','PUT',{line:'7011',date:'2026-10-01',images:{tpm:png}}));assert.equal((await request(saved.entry.images.tpm)).headers.get('Content-Type'),'image/png');
 assert.equal((await json(await request('/api/presence','POST',{id:'11111111-1111-4111-8111-111111111111'}))).online,1);
 assert.equal((await request('/api/invalid')).status,404);
 console.log('OK: migrações, arquivos, produção, eficiência, imagens e contador online.');
}finally{await mf.dispose();}
