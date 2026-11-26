import { embed,embeddingModel } from './embeddings';
import { AppError } from './http';
import type { userClient } from './server';
import type { Document } from '../types';
export async function retrievePrivate(query:string,db:Awaited<ReturnType<typeof userClient>>,owner:string):Promise<Document[]> {
  const available=await db.from('rag_documents').select('id',{count:'exact',head:true}).eq('owner_id',owner).eq('status','ready').gt('expires_at',new Date().toISOString());
  if(available.error)throw new AppError(503,'Personal document search is unavailable.');
  if(!available.count)return [];
  const [vector]=await embed([query]);
  const {data,error}=await db.rpc('search_private_chunks',{p_query:query,p_vector:JSON.stringify(vector),p_model:embeddingModel(),p_limit:5});
  if(error)throw new AppError(503,'Personal document search is unavailable. Check the migration and embedding configuration.');
  return (data||[]).map((row:{document_id:string;ordinal:number;title:string;content:string})=>({
    id:`personal:${row.document_id}:${row.ordinal}`,title:`${row.title} · excerpt ${row.ordinal+1}`,
    text:row.content,url:`/api/documents/${row.document_id}`,kind:'personal',
  }));
}
