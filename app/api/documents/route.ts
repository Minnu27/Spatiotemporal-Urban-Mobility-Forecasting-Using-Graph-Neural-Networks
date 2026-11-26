import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireMember,consumeLimit } from '@/lib/private/server';
import { AppError,boundedText,errorResponse,privateJson,requireOrigin } from '@/lib/private/http';
import { chunkText,embed,embeddingModel,textHash } from '@/lib/private/embeddings';
export const dynamic='force-dynamic';
export const maxDuration=60;
const input=z.object({filename:z.string().trim().min(1).max(180).regex(/\.(txt|md)$/i),title:z.string().trim().min(1).max(180),
  text:z.string().trim().min(2).max(16000),consent:z.literal(true)});
export async function GET(){try{
  const {db,user}=await requireMember();await consumeLimit(db,'read');
  const {data,error}=await db.from('rag_documents').select('id,title,filename,status,embedding_model,created_at,expires_at').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(100);
  if(error)throw error;return privateJson({documents:data});
}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{
  requireOrigin(request);const {db,user}=await requireMember();await consumeLimit(db,'upload');
  let body:unknown;try{body=JSON.parse(await boundedText(request,100_000));}catch(error){if(error instanceof AppError)throw error;throw new AppError(400,'Send a valid JSON document.');}
  const parsed=input.safeParse(body);
  if(!parsed.success)throw new AppError(400,'Use a .txt or .md document up to 16,000 characters and approve embedding processing.');
  const {normalized,chunks}=chunkText(parsed.data.text);const hash=textHash(normalized),model=embeddingModel();
  if(normalized.length<2)throw new AppError(400,'The document must contain readable text.');
  const existing=await db.from('rag_documents').select('id,status,expires_at').eq('owner_id',user.id).eq('sha256',hash).eq('embedding_model',model).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data){
    if(existing.data.status==='ready'&&Date.parse(existing.data.expires_at)>Date.now())return privateJson({id:existing.data.id,reused:true});
    throw new AppError(409,'This document already exists but is unfinished or expired. Delete it before retrying.');
  }
  const count=await db.from('rag_documents').select('id',{count:'exact',head:true}).eq('owner_id',user.id);
  if(count.error)throw count.error;if((count.count??0)>=100)throw new AppError(409,'Delete an old document before adding another. The limit is 100 documents.');
  const id=randomUUID(),path=`${user.id}/${id}/${hash}.txt`;
  const created=await db.from('rag_documents').insert({id,owner_id:user.id,title:parsed.data.title,filename:parsed.data.filename,sha256:hash,storage_path:path,embedding_model:model});
  if(created.error)throw created.error;
  try{
    const uploaded=await db.storage.from('rag-private').upload(path,Buffer.from(normalized),{contentType:'text/plain',upsert:false});
    if(uploaded.error)throw uploaded.error;
    const vectors=await embed(chunks.map(chunk=>chunk.content));
    const committed=await db.rpc('commit_document',{p_id:id,p_chunks:chunks.map((chunk,index)=>({...chunk,embedding:JSON.stringify(vectors[index])}))});
    if(committed.error)throw committed.error;
  }catch(error){
    await db.from('rag_documents').update({status:'deleting'}).eq('id',id).eq('owner_id',user.id);
    const removed=await db.storage.from('rag-private').remove([path]);
    if(!removed.error)await db.from('rag_documents').delete().eq('id',id).eq('owner_id',user.id);
    throw error;
  }
  return privateJson({id,chunks:chunks.length,reused:false},201);
}catch(error){return errorResponse(error);}}
