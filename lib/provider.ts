import {z} from 'zod';
import {fetchJson,serverUrl,UpstreamError} from './http';
import {streamLines} from './chat-protocol';

export class ProviderError extends Error {
 constructor(public code:string,message:string){super(message);}
}
export function providerFailure(error:unknown){
 if(error instanceof ProviderError)return {code:error.code,message:error.message};
 if(error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError'))return {code:'provider_timeout',message:'The AI provider took too long to answer. Please try again.'};
 if(error instanceof UpstreamError){
  if(error.status===401||error.status===403)return {code:'provider_access',message:'The AI provider rejected the key or its permissions. Check the token, account, region and model access in Vercel.'};
  if(error.status===429)return {code:'provider_quota',message:'The AI provider quota or rate limit was reached. Check its usage dashboard and retry after the limit resets.'};
  if(error.status===404||error.status===410)return {code:'provider_model',message:'The AI endpoint or model is unavailable. Check the base URL and exact model ID, including @cf/ for Cloudflare.'};
  if(error.status===400||error.status===422)return {code:'provider_request',message:'The provider rejected the request format or model settings. Check the configured model and provider compatibility.'};
 }
 return {code:'provider_unavailable',message:'The AI provider did not return a valid response. Check the connection and retry.'};
}
export function chatSettings(){
 const base=serverUrl(process.env.QWEN_BASE_URL||'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
 const model=process.env.QWEN_MODEL||'qwen-plus';
 const cloudflare=new URL(base).hostname==='api.cloudflare.com';
 return {base,model,cloudflare,reasoning:cloudflare&&model.startsWith('@cf/qwen/')};
}
export function completionBody(messages:{role:string;content:string}[]){
 const settings=chatSettings();
 return {model:settings.model,temperature:0.1,messages,
  // Evidence summarization does not need a separate reasoning pass. Qwen's
  // default thinking mode regularly exhausted the old 30-second timeout.
  ...(settings.cloudflare&&settings.model==='@cf/qwen/qwen3.8-27b'
   ?{max_completion_tokens:1024,chat_template_kwargs:{enable_thinking:false}}
   :settings.reasoning?{max_completion_tokens:4096,reasoning_effort:'low'}:{max_tokens:900})};
}
export async function generateCompletion(messages:{role:string;content:string}[],onDelta?:(text:string)=>void,signal?:AbortSignal){
 if(!process.env.QWEN_API_KEY)throw new ProviderError('provider_key_missing','Add QWEN_API_KEY in the deployment environment.');
 const {base}=chatSettings();
 if(onDelta)return streamedCompletion(base,messages,onDelta,signal);
 const raw=await fetchJson(base+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.QWEN_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify(completionBody(messages))},150_000,60_000);
 const parsed=z.object({choices:z.array(z.object({message:z.object({content:z.string().nullable()}),finish_reason:z.string().nullable().optional()})).min(1)}).parse(raw);
 const first=parsed.choices[0],answer=first.message.content?.trim();
 if(!answer)throw new ProviderError('provider_empty_answer','The model returned no answer. Its reasoning may have exhausted the completion budget.');
 if(first.finish_reason==='length')throw new ProviderError('provider_incomplete_answer','The model reached its completion limit. Try a shorter question or less conversation context.');
 if(answer.length>12000)throw new ProviderError('provider_answer_too_large','The AI response exceeded the application limit.');
 return answer;
}

async function streamedCompletion(base:string,messages:{role:string;content:string}[],onDelta:(text:string)=>void,signal?:AbortSignal){
 const timeout=AbortSignal.timeout(60_000);
 const response=await fetch(base+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.QWEN_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({...completionBody(messages),stream:true}),signal:signal?AbortSignal.any([signal,timeout]):timeout,cache:'no-store',redirect:'error'});
 if(!response.ok)throw new UpstreamError(response.status);
 if(!response.body)throw new ProviderError('provider_empty_answer','The model returned no answer. Please try again.');
 let answer='',finish:string|null=null,done=false;
 const chunkSchema=z.object({choices:z.array(z.object({delta:z.object({content:z.string().nullable().optional()}),finish_reason:z.string().nullable().optional()}))});
 for await(const line of streamLines(response.body,2_000_000)){
  if(!line.startsWith('data:'))continue;
  const data=line.slice(5).trim();if(data==='[DONE]'){done=true;break;}if(!data)continue;
  const chunk=chunkSchema.parse(JSON.parse(data)).choices[0];if(!chunk)continue;
  // Internal reasoning fields never leave the server.
  const text=chunk.delta.content;if(text){answer+=text;if(answer.length>12000)throw new ProviderError('provider_answer_too_large','The AI response exceeded the application limit.');onDelta(text);}
  if(chunk.finish_reason)finish=chunk.finish_reason;
 }
 if(finish==='length')throw new ProviderError('provider_incomplete_answer','The model reached its completion limit. Try a shorter question or less conversation context.');
 if(!answer.trim())throw new ProviderError('provider_empty_answer','The model returned no answer. Please try again.');
 if(!done&&finish!=='stop')throw new ProviderError('provider_incomplete_answer','The AI connection ended before the answer finished. Please try again.');
 return answer.trim();
}
