import { z } from 'zod';
import { requireMember,consumeLimit } from '@/lib/private/server';
import { AppError,errorResponse,privateJson,requireOrigin } from '@/lib/private/http';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{
  const {db,user}=await requireMember();await consumeLimit(db,'read');const {id}=await context.params;
  if(!z.uuid().safeParse(id).success)throw new AppError(404,'Conversation unavailable.');
  const conversation=await db.from('conversations').select('id,title').eq('id',id).eq('owner_id',user.id).gt('expires_at',new Date().toISOString()).maybeSingle();
  if(conversation.error)throw conversation.error;if(!conversation.data)throw new AppError(404,'Conversation unavailable.');
  const {data,error}=await db.from('messages').select('id,role,body,citations,created_at').eq('owner_id',user.id).eq('conversation_id',id).order('id',{ascending:true}).limit(200);
  if(error)throw error;return privateJson({...conversation.data,messages:data});
}catch(error){return errorResponse(error);}}
export async function DELETE(request:Request,context:Context){try{
  requireOrigin(request);const {db,user}=await requireMember();await consumeLimit(db,'read');const {id}=await context.params;
  if(!z.uuid().safeParse(id).success)throw new AppError(404,'Conversation unavailable.');
  const {error}=await db.from('conversations').delete().eq('id',id).eq('owner_id',user.id);if(error)throw error;
  return privateJson({deleted:true});
}catch(error){return errorResponse(error);}}
