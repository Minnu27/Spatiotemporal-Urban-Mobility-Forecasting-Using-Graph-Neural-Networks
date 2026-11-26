import {adminClient,type userClient} from './server';
import {configurationChecks,type SetupCheck} from './setup-config';
import {databaseIssue} from './setup-errors';
import {embed} from './embeddings';
import {generateCompletion,providerFailure} from '../provider';
import {fetchJson,serverUrl} from '../http';
async function databaseChecks():Promise<SetupCheck[]>{
 const checks:SetupCheck[]=[];const add=(check:SetupCheck)=>checks.push(check);
 if(configurationChecks().some(check=>['supabase_url','supabase_server_key'].includes(check.id)&&check.status==='fail'))return [{id:'database',label:'Database connection',status:'skip',message:'Correct the project API URL and server-key format before the database connection can be tested.'}];
 const db=adminClient();
 if(!db)add({id:'database',label:'Database connection',status:'fail',message:'Server database credentials are missing.',action:'Configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then redeploy.'});
 else try{
  const tables=await db.from('app_members').select('user_id',{head:true}).limit(1);
  if(tables.error){const issue=databaseIssue(tables.error,tables.status);add({id:'database',label:'Database connection',status:'fail',...issue});}
  else{
   add({id:'database',label:'Database connection',status:'pass',message:'Server credentials can reach the workspace schema.'});
   const [rpc,bucket]=await Promise.all([db.rpc('consume_public_limit',{p_hash:'0'.repeat(64)}),db.storage.getBucket('rag-private')]);
   if(rpc.error){const issue=databaseIssue(rpc.error,rpc.status);add({id:'public_limiter',label:'Shared public limiter',status:'fail',...issue});}
   else add({id:'public_limiter',label:'Shared public limiter',status:typeof rpc.data==='boolean'?'pass':'fail',message:typeof rpc.data==='boolean'?'The limiter function is reachable.':'The limiter function returned an unexpected result.'});
   add({id:'private_storage',label:'Private document bucket',status:!bucket.error&&bucket.data?.public===false?'pass':'fail',message:!bucket.error&&bucket.data?.public===false?'rag-private exists and is private.':'Private storage is missing, public or inaccessible.',action:bucket.error||bucket.data?.public!==false?'Apply the workspace migrations and verify the rag-private bucket is private.':undefined});
  }
 }catch{add({id:'database_network',label:'Database connection',status:'fail',message:'The server could not reach Supabase.',action:'Check the Supabase URL, service key and project availability.'});}
 return checks;
}
async function authSettingsChecks():Promise<SetupCheck[]>{
 if(configurationChecks().some(check=>['supabase_url','supabase_public_key'].includes(check.id)&&check.status==='fail'))return [{id:'auth_settings',label:'Personal-use signup settings',status:'skip',message:'Correct the project URL and publishable key before testing Auth settings.'}];
 try{
  const raw=await fetchJson(serverUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!)+'/auth/v1/settings',{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!}},20000,8000) as {disable_signup?:boolean};
  return [{id:'auth_settings',label:'Personal-use signup settings',status:raw.disable_signup===true?'pass':'fail',message:raw.disable_signup===true?'Public signup is disabled.':'Public signup is enabled or could not be confirmed as disabled.',action:raw.disable_signup===true?undefined:'In Supabase Authentication settings, disable Allow new users to sign up. Create and approve intended accounts as an administrator.'}];
 }catch{return [{id:'auth_settings',label:'Personal-use signup settings',status:'fail',message:'The Supabase Auth settings request failed.',action:'Check the Project URL and publishable key. They must belong to the same project.'}];}
}
async function userChecks(userDb:Awaited<ReturnType<typeof userClient>>):Promise<SetupCheck[]>{
 return Promise.all(['rag_documents','conversations'].map(async table=>{
  try{
   const result=await userDb.from(table).select('id',{head:true}).limit(1);
   return {id:'user_'+table,label:'Authenticated '+table+' access',status:result.error?'fail':'pass',message:result.error?'Authenticated workspace access failed.':'The signed-in account can reach its owner-scoped table.',action:result.error?'Apply the access-grant migration and confirm app_members approval.':undefined} as SetupCheck;
  }catch{return {id:'user_'+table,label:'Authenticated '+table+' access',status:'fail',message:'The account database request failed.'} as SetupCheck;}
 }));
}
async function providerChecks():Promise<SetupCheck[]>{
 // Independent bounded requests run together so the 60s route budget is respected.
 const [embedding,generation]=await Promise.allSettled([
  embed(['UrbanFlow provider connection check. No personal information.']),
  generateCompletion([{role:'user',content:'Reply with exactly OK. This is a connection test.'}]),
 ]);
 const checks:SetupCheck[]=[];
 if(embedding.status==='fulfilled')checks.push({id:'embeddings',label:'Embedding connection',status:embedding.value[0].length===1024?'pass':'fail',message:'Provider returned a valid nonzero 1,024-dimensional embedding.'});
 else checks.push({id:'embeddings',label:'Embedding connection',status:'fail',message:providerFailure(embedding.reason).message,action:'Check EMBEDDING_MODEL, provider URL, key permissions and daily allowance. Re-index documents after changing the embedding model.'});
 if(generation.status==='fulfilled')checks.push({id:'generation',label:'Chat connection',status:/\bOK\b/i.test(generation.value)?'pass':'fail',message:/\bOK\b/i.test(generation.value)?'Provider returned the requested test answer.':'The provider responded but did not return the expected test answer.'});
 else checks.push({id:'generation',label:'Chat connection',status:'fail',message:providerFailure(generation.reason).message,action:'Check QWEN_API_KEY, QWEN_BASE_URL, QWEN_MODEL and provider usage. No key value is shown here.'});
 return checks;
}
export async function connectionChecks(options:{providers:boolean},userDb?:Awaited<ReturnType<typeof userClient>>){
 const checks=configurationChecks();
 const groups=await Promise.all([databaseChecks(),authSettingsChecks(),userDb?userChecks(userDb):Promise.resolve([]),options.providers?providerChecks():Promise.resolve<SetupCheck[]>([{id:'providers',label:'AI provider calls',status:'skip',message:'Not requested. Enable provider testing to send fixed non-personal test text.'}])]);
 checks.push(...groups.flat());
 return {ok:checks.every(check=>check.status!=='fail'),checks,checkedAt:new Date().toISOString(),note:'A connection test does not prove answer accuracy or cross-account isolation. Complete the two-account acceptance checks.'};
}
