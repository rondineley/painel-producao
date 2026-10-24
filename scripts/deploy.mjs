import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const config=JSON.parse(readFileSync('wrangler.json','utf8'));
if(config.d1_databases[0].database_id==='00000000-0000-4000-8000-000000000000')throw new Error('Configure seu banco antes: npm run configurar');
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
for(const args of [['d1','migrations','apply','DB','--remote'],['deploy']]){
 const r=spawnSync(process.execPath,[cli,...args],{stdio:'inherit'});
 if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);
}
