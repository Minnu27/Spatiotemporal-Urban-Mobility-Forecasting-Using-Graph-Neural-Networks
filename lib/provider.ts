import {z} from 'zod';
import {fetchJson,serverUrl,UpstreamError} from './http';

export class ProviderError extends Error {
 constructor(public code:string,message:string){super(message);}
}
export function providerFailure(error:unknown){
 if(error instanceof ProviderError)return {code:error.code,message:error.message};
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
  // Cloudflare Qwen counts reasoning against its completion budget.
  // The previous 900-token budget could finish before producing an answer.
  ...(settings.reasoning?{max_completion_tokens:4096,reasoning_effort:'low'}:{max_tokens:900})};
}
export async function generateCompletion(messages:{role:string;content:string}[]){
 if(!process.env.QWEN_API_KEY)throw new ProviderError('provider_key_missing','Add QWEN_API_KEY in the deployment environment.');
 const {base}=chatSettings();
 const raw=await fetchJson(base+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.QWEN_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify(completionBody(messages))},150_000,30_000);
 const parsed=z.object({choices:z.array(z.object({message:z.object({content:z.string().nullable()}),finish_reason:z.string().nullable().optional()})).min(1)}).parse(raw);
 const first=parsed.choices[0],answer=first.message.content?.trim();
 if(!answer)throw new ProviderError('provider_empty_answer','The model returned no answer. Its reasoning may have exhausted the completion budget.');
 if(first.finish_reason==='length')throw new ProviderError('provider_incomplete_answer','The model reached its completion limit. Try a shorter question or less conversation context.');
 if(answer.length>12000)throw new ProviderError('provider_answer_too_large','The AI response exceeded the application limit.');
 return answer;
}
