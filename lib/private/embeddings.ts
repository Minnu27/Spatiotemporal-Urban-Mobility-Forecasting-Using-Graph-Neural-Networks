import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fetchJson,serverUrl } from '../http';
import { AppError } from './http';
export const embeddingModel=()=>process.env.EMBEDDING_MODEL||'text-embedding-v4';
export const embeddingDimensions=1024;
export const textHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function chunkText(text:string){
  const normalized=text.replace(/\r\n?/g,'\n').replace(/\u0000/g,'').trim();
  const chunks:{ordinal:number;content:string;start:number;end:number}[]=[];
  let start=0;
  while(start<normalized.length){
    let end=Math.min(start+1800,normalized.length);
    if(end<normalized.length){const boundary=normalized.lastIndexOf('\n',end);if(boundary>start+900)end=boundary;}
    chunks.push({ordinal:chunks.length,content:normalized.slice(start,end),start,end});
    if(end===normalized.length)break;start=end-180;
  }
  return {normalized,chunks};
}
const vector=z.array(z.number().finite()).length(embeddingDimensions).refine(values=>values.some(value=>value!==0));
export async function embed(texts:string[]){
  const key=process.env.EMBEDDING_API_KEY||process.env.QWEN_API_KEY;
  if(!key)throw new AppError(503,'Configure the embedding provider key before uploading or searching personal documents.');
  const base=serverUrl(process.env.EMBEDDING_BASE_URL||process.env.QWEN_BASE_URL||'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  const vectors:number[][]=[];
  for(let offset=0;offset<texts.length;offset+=10){
    const input=texts.slice(offset,offset+10);
    const raw=await fetchJson(base+'/embeddings',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:embeddingModel(),input,dimensions:embeddingDimensions,encoding_format:'float'})},2_000_000,20_000);
    const result=z.object({data:z.array(z.object({index:z.number().int().nonnegative(),embedding:vector}))}).parse(raw);
    if(result.data.length!==input.length||new Set(result.data.map(row=>row.index)).size!==input.length)throw new AppError(503,'Embedding response had invalid dimensions or order.');
    const ordered=result.data.sort((a,b)=>a.index-b.index);
    if(ordered.some((row,index)=>row.index!==index))throw new AppError(503,'Embedding response had invalid order.');
    vectors.push(...ordered.map(row=>row.embedding));
  }
  return vectors;
}
