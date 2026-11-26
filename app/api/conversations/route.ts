import { requireMember,consumeLimit } from '@/lib/private/server';
import { errorResponse,privateJson } from '@/lib/private/http';
export const dynamic='force-dynamic';
export async function GET(){try{
  const {db,user}=await requireMember();await consumeLimit(db,'read');
  const {data,error}=await db.from('conversations').select('id,title,updated_at,expires_at').eq('owner_id',user.id).gt('expires_at',new Date().toISOString()).order('updated_at',{ascending:false}).limit(100);
  if(error)throw error;return privateJson({conversations:data});
}catch(error){return errorResponse(error);}}
