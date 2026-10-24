import {readFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
const rl=createInterface({input:process.stdin,output:process.stdout});
try{
 const c=JSON.parse(readFileSync('wrangler.json','utf8'));
 const id=(await rl.question('Cole o database_id retornado ao criar seu banco D1: ')).trim();
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||id==='00000000-0000-4000-8000-000000000000')throw new Error('ID inválido.');
 c.d1_databases[0].database_id=id;
 writeFileSync('wrangler.json',JSON.stringify(c,null,2)+'\n');
 console.log('Banco configurado. Execute npm run deploy quando o bucket R2 também estiver criado.');
}finally{rl.close();}
