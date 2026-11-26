import { requireMember,storageConfigured } from '@/lib/private/server';
import { AppError,errorResponse,privateJson } from '@/lib/private/http';
export const dynamic='force-dynamic';
export async function GET(){try{
  if(!storageConfigured())return privateJson({configured:false,authenticated:false});
  const {user}=await requireMember();
  return privateJson({configured:true,authenticated:true,email:user.email,
    generationConfigured:!!process.env.QWEN_API_KEY,embeddingsConfigured:!!(process.env.EMBEDDING_API_KEY||process.env.QWEN_API_KEY)});
}catch(error){if(error instanceof AppError&&error.status===401)return privateJson({configured:true,authenticated:false});return errorResponse(error);}}
