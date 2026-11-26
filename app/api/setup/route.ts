import {z} from 'zod';
import {requireMember,consumeLimit} from '@/lib/private/server';
import {connectionChecks} from '@/lib/private/setup-checks';
import {AppError,boundedText,errorResponse,privateJson,requireOrigin} from '@/lib/private/http';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function POST(request:Request){try{
 requireOrigin(request);
 const {db}=await requireMember();
 let body:unknown;try{body=JSON.parse(await boundedText(request,1000));}catch(error){if(error instanceof AppError)throw error;throw new AppError(400,'Send valid setup-check settings.');}
 const parsed=z.object({providers:z.boolean().default(false),consent:z.boolean().default(false)}).safeParse(body);
 if(!parsed.success||parsed.data.providers&&!parsed.data.consent)throw new AppError(400,'Approve provider testing before sending test text.');
 // Account quotas apply before any provider request; no caller-controlled owner.
 await consumeLimit(db,parsed.data.providers?'chat':'read');
 return privateJson(await connectionChecks({providers:parsed.data.providers},db));
}catch(error){return errorResponse(error);}}
