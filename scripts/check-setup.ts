import {createClient} from '@supabase/supabase-js';
import {embed} from '../lib/private/embeddings';
import {getForecast} from '../lib/forecast';
import {fetchJson,serverUrl} from '../lib/http';
import {readFile} from 'node:fs/promises';
let failures=0;
function check(label:string,ok:boolean){console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failures++;}
async function main(){
 const required=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','MAINTENANCE_TOKEN','RATE_LIMIT_SALT'];
 for(const name of required)check(name+' configured',!!process.env[name]);
 check('Rate-limit salt is at least 32 characters',(process.env.RATE_LIMIT_SALT?.length??0)>=32);
 check('Embedding key configured',!!(process.env.EMBEDDING_API_KEY||process.env.QWEN_API_KEY));
 check('Qwen generation key configured',!!process.env.QWEN_API_KEY);
 for(const name of ['forecast.onnx','metadata.json','preprocessing.json','reference-profile.json']){try{await readFile('model/'+name);check('Model file '+name,true);}catch{check('Model file '+name,false);}}
 if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){try{
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const bucket=await db.storage.getBucket('rag-private');check('Private bucket exists and is not public',!bucket.error&&bucket.data?.public===false);
  for(const [table,column] of [['app_members','user_id'],['rag_documents','id'],['rag_chunks','id'],['conversations','id'],['messages','id'],['incident_archive','fingerprint']]){
   const result=await db.from(table).select(column,{head:true});check('Migrated table '+table,!result.error);
  }
  const limit=await db.rpc('consume_public_limit',{p_hash:'0'.repeat(64)});check('Shared public limiter RPC',!limit.error&&typeof limit.data==='boolean');
 }catch{check('Supabase connection',false);}}
 const forecast=await getForecast();check('Current forecast has 1,315 rows',forecast.mode==='estimate'&&forecast.rows.length===1315||forecast.mode==='live'&&forecast.rows.length===1315);
 console.log('Forecast mode:',forecast.mode,'origin:',forecast.issuedAt);console.log('Current pickup observations connected:',forecast.mode==='live');
 if(process.argv.includes('--providers')){
  // Explicit option: these tiny requests may incur provider charges.
  try{check('Embedding provider request',(await embed(['UrbanFlow setup connection test.']))[0].length===1024);}catch{check('Embedding provider request',false);}
  try{
   const result=await fetchJson(serverUrl(process.env.QWEN_BASE_URL||'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')+'/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${process.env.QWEN_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:process.env.QWEN_MODEL||'qwen-plus',messages:[{role:'user',content:'Reply OK.'}],max_tokens:4})},10000,30000) as {choices?:unknown[]};
   check('Qwen provider request',Array.isArray(result.choices)&&result.choices.length>0);
  }catch{check('Qwen provider request',false);}
 }else console.log('Provider calls skipped. Add -- --providers to test billing-enabled providers.');
 console.log('Browser sign-in, ownership, deletion and deployed credentials still require the acceptance steps in docs/SETUP.md.');
 process.exitCode=failures?1:0;
}
void main().catch(()=>{console.error('Setup verification failed. Check the guide; no secrets have been printed.');process.exitCode=1;});
