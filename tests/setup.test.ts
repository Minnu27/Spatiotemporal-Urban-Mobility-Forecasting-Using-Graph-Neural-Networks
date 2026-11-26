import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configurationChecks} from '../lib/private/setup-config';
import {databaseIssue} from '../lib/private/setup-errors';
import {completionBody,generateCompletion,providerFailure,ProviderError} from '../lib/provider';
import {connectionChecks} from '../lib/private/setup-checks';
import {POST as setup} from '../app/api/setup/route';
import {answerFromEvidence} from '../lib/answer';
const env={NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_public-test-value',
 SUPABASE_SERVICE_ROLE_KEY:'sb_secret_private-test-value',MAINTENANCE_TOKEN:'m'.repeat(64),RATE_LIMIT_SALT:'s'.repeat(64),
 QWEN_API_KEY:'private-provider-test-token',QWEN_BASE_URL:'https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32)+'/ai/v1',
 QWEN_MODEL:'@cf/qwen/qwen3.8-27b',EMBEDDING_MODEL:'@cf/qwen/qwen3-embedding-0.6b'};
function installEnv(){const keys=[...Object.keys(env),'EMBEDDING_API_KEY','EMBEDDING_BASE_URL'];const previous=keys.map(key=>process.env[key]);
 for(const key of keys)delete process.env[key];Object.assign(process.env,env);
 return ()=>keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
}
test('setup accepts Cloudflare configuration without exposing credential values',()=>{
 const checks=configurationChecks(env);assert.ok(checks.every(check=>check.status==='pass'));
 const serialized=JSON.stringify(checks);for(const key of ['SUPABASE_SERVICE_ROLE_KEY','QWEN_API_KEY','RATE_LIMIT_SALT','MAINTENANCE_TOKEN'] as const)assert.ok(!serialized.includes(env[key]));
});
test('setup catches dashboard URLs, misspelled variables, public server keys and missing @cf prefixes',()=>{
 const wrong={...env,NEXT_PUBLIC_SUPABASE_URL:'https://supabase.com/dashboard/project/test',SUPABASE_SERVICE_ROLE_KEY:'',UPABASE_SERVICE_ROLE_KEY:'sb_secret_wrong-name',
  QWEN_MODEL:'cf/qwen/qwen3.8-27b',EMBEDDING_MODEL:'cf/qwen/qwen3-embedding-0.6b'};
 const checks=configurationChecks(wrong);
 for(const id of ['supabase_url','supabase_server_key','cloudflare_chat_model','cloudflare_embedding_model'])assert.equal(checks.find(check=>check.id===id)?.status,'fail',id);
 assert.match(checks.find(check=>check.id==='supabase_server_key')!.action!,/Rename/);
 assert.match(configurationChecks({...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_never-public'}).find(check=>check.id==='supabase_public_key')!.action!,/Rotate/);
});
test('database diagnosis maps only safe constant messages',()=>{
 const secret='SECRET-DO-NOT-RETURN';
 for(const [code,category]of [['PGRST202','database_function_missing'],['42501','database_permissions'],['42P01','database_table_missing']]){
  const issue=databaseIssue({code,message:secret});assert.equal(issue.code,category);assert.ok(!JSON.stringify(issue).includes(secret));
 }
 assert.equal(databaseIssue({message:'Invalid API key '+secret},401).code,'database_credentials');
});
test('Cloudflare Qwen 3.8 summarizes evidence without a separate thinking pass',()=>{
 const restore=installEnv();try{
  const body=completionBody([{role:'user',content:'OK'}]);assert.ok('max_completion_tokens'in body);assert.equal(body.max_completion_tokens,1024);
  assert.ok('chat_template_kwargs'in body);assert.equal(body.chat_template_kwargs?.enable_thinking,false);assert.ok(!('max_tokens'in body));
  process.env.QWEN_MODEL='@cf/qwen/another-reasoning-model';
  const reasoning=completionBody([{role:'user',content:'OK'}]);assert.ok('max_completion_tokens'in reasoning);assert.ok('reasoning_effort'in reasoning);assert.equal(reasoning.max_completion_tokens,4096);assert.equal(reasoning.reasoning_effort,'low');
  process.env.QWEN_BASE_URL='https://dashscope-intl.aliyuncs.com/compatible-mode/v1';process.env.QWEN_MODEL='qwen-plus';
  const other=completionBody([{role:'user',content:'OK'}]);assert.ok('max_tokens'in other);assert.equal(other.max_tokens,900);
 }finally{restore();}
});
test('chat distinguishes slow generation from unverified citations without exposing upstream errors',async context=>{
 const restore=installEnv();let outcome='timeout';
 const docs=[{id:'test',title:'Test evidence',text:'Verified source.',url:'https://example.com',kind:'research'}];
 context.mock.method(globalThis,'fetch',async()=>{
  if(outcome==='timeout')throw new DOMException('PRIVATE-UPSTREAM-DETAIL','TimeoutError');
  return Response.json({choices:[{message:{content:outcome==='uncited'?'Uncited answer.':'Verified source [1].'},finish_reason:'stop'}]});
 });
 try{
  const timedOut=await answerFromEvidence('Question?',docs);
  assert.equal(timedOut.mode,'sources');assert.equal(timedOut.generationError,'provider_timeout');assert.match(timedOut.notice!,/took too long/);
  assert.ok(!JSON.stringify(timedOut).includes('PRIVATE-UPSTREAM-DETAIL'));
  outcome='uncited';const uncited=await answerFromEvidence('Question?',docs);assert.equal(uncited.mode,'sources');assert.equal(uncited.generationError,'provider_citations');
  outcome='valid';const valid=await answerFromEvidence('Question?',docs);assert.equal(valid.mode,'qwen');assert.equal(valid.answer,'Verified source [1].');
 }finally{restore();}
});
test('generation rejects empty reasoning-only answers and truncated responses',async context=>{
 const restore=installEnv();let content:string|null='OK',finish='stop';
 context.mock.method(globalThis,'fetch',async()=>Response.json({choices:[{message:{content},finish_reason:finish}]}));
 try{assert.equal(await generateCompletion([{role:'user',content:'OK'}]),'OK');content=null;await assert.rejects(generateCompletion([]),(e:unknown)=>e instanceof ProviderError&&e.code==='provider_empty_answer');content='Partial';finish='length';await assert.rejects(generateCompletion([]),(e:unknown)=>e instanceof ProviderError&&e.code==='provider_incomplete_answer');}
 finally{restore();}
});
test('connection checks use fixed text and return database repair actions without keys',async context=>{
 const restore=installEnv();let providers=0,missingFunction=false;
 context.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.hostname==='api.cloudflare.com'){
   providers++;assert.ok(String(init?.body).includes('connection test')||String(init?.body).includes('connection check'));
   return url.pathname.endsWith('/embeddings')?Response.json({data:[{index:0,embedding:[1,...Array(1023).fill(0)]}]}):Response.json({choices:[{message:{content:'OK'},finish_reason:'stop'}]});
  }
  if(url.pathname==='/auth/v1/settings')return Response.json({disable_signup:true});
  if(url.pathname.includes('/rest/v1/app_members'))return new Response(null,{status:200});
  if(url.pathname.endsWith('/rpc/consume_public_limit'))return missingFunction?Response.json({code:'PGRST202',message:'PRIVATE-DIAGNOSTIC-MESSAGE'},{status:404}):Response.json(false);
  if(url.pathname.endsWith('/bucket/rag-private'))return Response.json({id:'rag-private',name:'rag-private',public:false});
  throw Error('Unexpected test endpoint');
 });
 try{
  const noProviders=await connectionChecks({providers:false});assert.equal(noProviders.ok,true);assert.equal(providers,0);
  const report=await connectionChecks({providers:true});assert.equal(report.ok,true);assert.equal(providers,2);
  for(const value of [env.QWEN_API_KEY,env.SUPABASE_SERVICE_ROLE_KEY])assert.ok(!JSON.stringify(report).includes(value));
  missingFunction=true;const broken=await connectionChecks({providers:false});assert.equal(broken.ok,false);assert.equal(broken.checks.find(check=>check.id==='public_limiter')?.code,'database_function_missing');assert.ok(!JSON.stringify(broken).includes('PRIVATE-DIAGNOSTIC-MESSAGE'));
 }finally{restore();}
});
test('setup endpoint rejects cross-origin provider tests before accessing credentials',async()=>{
 const response=await setup(new Request('https://urbanflow.example/api/setup',{method:'POST',headers:{origin:'https://unrelated.example'},body:'{"providers":true,"consent":true}'}));
 assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
