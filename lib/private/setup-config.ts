import {projectApiUrl} from '../supabase-config';
export type SetupCheck={id:string;label:string;status:'pass'|'fail'|'skip';message:string;action?:string;code?:string};
function jwtRole(key:string){try{return JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString('utf8')).role;}catch{return null;}}
export function configurationChecks(env:Record<string,string|undefined>=process.env):SetupCheck[]{
 const checks:SetupCheck[]=[];
 const add=(id:string,label:string,pass:boolean,message:string,action?:string)=>checks.push({id,label,status:pass?'pass':'fail',message,action:pass?undefined:action});
 const projectUrl=!!projectApiUrl(env.NEXT_PUBLIC_SUPABASE_URL);
 add('supabase_url','Supabase project URL',projectUrl,projectUrl?'HTTPS project URL is configured.':'A valid Supabase project API URL is required.','Copy Project URL from Supabase Connect: https://YOUR_PROJECT_REF.supabase.co. A dashboard address containing /dashboard/project/ is not an API endpoint.');
 const browserKey=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';
 const publishable=browserKey.startsWith('sb_publishable_')&&browserKey.length>25||jwtRole(browserKey)==='anon';
 add('supabase_public_key','Browser publishable key',publishable,publishable?'Publishable key format is valid.':'The browser key is missing or has the wrong type.',browserKey.startsWith('sb_secret_')||jwtRole(browserKey)==='service_role'?'A server secret has been placed in public configuration. Rotate that key and replace this variable with a publishable key.':'Use sb_publishable_ or the legacy anon key from the same project.');
 const serverKey=env.SUPABASE_SERVICE_ROLE_KEY||'';
 const privileged=serverKey.startsWith('sb_secret_')&&serverKey.length>20||jwtRole(serverKey)==='service_role';
 add('supabase_server_key','Supabase server key',privileged,privileged?'Server key format is valid; the connection test must verify it.':'The server key is missing or has the wrong type.',env.UPABASE_SERVICE_ROLE_KEY?'Rename UPABASE_SERVICE_ROLE_KEY to SUPABASE_SERVICE_ROLE_KEY, preserving its value.':'Set SUPABASE_SERVICE_ROLE_KEY to the same project’s sb_secret_ or legacy service_role key.');
 for(const [id,label] of [['MAINTENANCE_TOKEN','Maintenance token'],['RATE_LIMIT_SALT','Rate-limit salt']])add(id,label,(env[id]?.length??0)>=32,(env[id]?.length??0)>=32?'A value of at least 32 characters is configured.':'A random value of at least 32 characters is required.','Generate a separate secret for this variable and save it in Vercel; never paste it into a PR.');
 const key=!!env.QWEN_API_KEY;
 add('chat_key','Chat provider key',key,key?'A server key is configured.':'Chat provider key is missing.','Paste the Cloudflare Workers AI API token into QWEN_API_KEY in Vercel.');
 let base:URL|undefined;try{base=new URL(env.QWEN_BASE_URL||'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');}catch{}
 const validBase=!!base&&base.protocol==='https:'&&!base.username&&!base.password&&!base.search&&!base.hash;
 add('chat_url','Chat provider base URL',validBase,validBase?'HTTPS provider URL is configured.':'Provider base URL is invalid.','Set QWEN_BASE_URL to the full HTTPS base URL without credentials.');
 if(base?.hostname==='api.cloudflare.com'){
  const path=/^\/client\/v4\/accounts\/[0-9a-f]{32}\/ai\/v1\/?$/i.test(base.pathname);
  add('cloudflare_account','Cloudflare account path',path,path?'Cloudflare account path is valid.':'Cloudflare account URL is incomplete.','Replace YOUR_ACCOUNT_ID with the 32-character Account ID; end the URL with /ai/v1.');
  const model=env.QWEN_MODEL||'qwen-plus';
  add('cloudflare_chat_model','Cloudflare chat model',model.startsWith('@cf/'),model.startsWith('@cf/')?'Cloudflare model prefix is present.':'Cloudflare model IDs must include the @cf/ prefix.','Use @cf/qwen/qwen3.8-27b for this setup.');
 }
 const embeddingBase=env.EMBEDDING_BASE_URL||env.QWEN_BASE_URL||'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
 let embeddingUrl:URL|undefined;try{embeddingUrl=new URL(embeddingBase);}catch{}
 const validEmbeddingUrl=!!embeddingUrl&&embeddingUrl.protocol==='https:'&&!embeddingUrl.username&&!embeddingUrl.password&&!embeddingUrl.search&&!embeddingUrl.hash;
 add('embedding_url','Embedding provider URL',validEmbeddingUrl,validEmbeddingUrl?'HTTPS embedding URL is configured.':'Embedding URL is invalid.','Use an HTTPS EMBEDDING_BASE_URL or leave it empty to reuse QWEN_BASE_URL.');
 const embeddingKey=!!(env.EMBEDDING_API_KEY||env.QWEN_API_KEY);
 add('embedding_key','Embedding provider key',embeddingKey,embeddingKey?'An embedding key is configured or inherited from chat.':'Embedding provider key is missing.','Use QWEN_API_KEY for the shared Cloudflare token, or set EMBEDDING_API_KEY separately.');
 if(embeddingUrl?.hostname==='api.cloudflare.com'){
  const model=env.EMBEDDING_MODEL||'text-embedding-v4';
  add('cloudflare_embedding_model','Cloudflare embedding model',model==='@cf/qwen/qwen3-embedding-0.6b',model==='@cf/qwen/qwen3-embedding-0.6b'?'Selected model produces the required 1,024 dimensions.':'The embedding model must match this setup’s 1,024-dimensional index.','Set EMBEDDING_MODEL=@cf/qwen/qwen3-embedding-0.6b, then re-index old documents if their model changed.');
 }
 return checks;
}
