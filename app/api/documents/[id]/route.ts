import { z } from 'zod';
import { requireMember,consumeLimit } from '@/lib/private/server';
import { AppError,errorResponse,privateJson,requireOrigin } from '@/lib/private/http';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{
  const {db,user}=await requireMember();await consumeLimit(db,'read');const {id}=await context.params;
  if(!z.uuid().safeParse(id).success)throw new AppError(404,'Document unavailable.');
  const result=await db.from('rag_documents').select('storage_path,status,expires_at').eq('id',id).eq('owner_id',user.id).maybeSingle();
  if(result.error)throw result.error;
  if(!result.data||result.data.status!=='ready'||Date.parse(result.data.expires_at)<=Date.now())throw new AppError(404,'Document unavailable.');
  const file=await db.storage.from('rag-private').download(result.data.storage_path);if(file.error||!file.data)throw new AppError(503,'Document download failed.');
  return new Response(await file.data.arrayBuffer(),{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="document-${id}.txt"`,
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
}catch(error){return errorResponse(error);}}
export async function DELETE(request:Request,context:Context){try{
  requireOrigin(request);const {db,user}=await requireMember();await consumeLimit(db,'read');const {id}=await context.params;
  if(!z.uuid().safeParse(id).success)throw new AppError(404,'Document unavailable.');
  const result=await db.from('rag_documents').select('storage_path').eq('id',id).eq('owner_id',user.id).maybeSingle();
  if(result.error)throw result.error;if(!result.data)throw new AppError(404,'Document unavailable.');
  const hidden=await db.from('rag_documents').update({status:'deleting'}).eq('id',id).eq('owner_id',user.id);if(hidden.error)throw hidden.error;
  const removed=await db.storage.from('rag-private').remove([result.data.storage_path]);
  if(removed.error)throw new AppError(503,'Search access was removed, but file deletion failed. Retry Delete to finish.');
  const deleted=await db.from('rag_documents').delete().eq('id',id).eq('owner_id',user.id);if(deleted.error)throw deleted.error;
  return privateJson({deleted:true});
}catch(error){return errorResponse(error);}}
