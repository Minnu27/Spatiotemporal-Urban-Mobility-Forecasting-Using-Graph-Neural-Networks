import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getAlerts } from '@/lib/feeds';
import { corpus,retrieve,extractiveAnswer } from '@/lib/rag';
import { consumePublicLimit } from '@/lib/private/public-limit';
import { answerFromEvidence } from '@/lib/answer';
import { requireMember,consumeLimit } from '@/lib/private/server';
import { retrievePrivate } from '@/lib/private/retrieval';
import { retrieveArchive } from '@/lib/private/archive';
import { AppError,boundedText,errorResponse,privateJson,requireOrigin } from '@/lib/private/http';
import { getForecast } from '@/lib/forecast';
import zones from '@/data/zones.json';
import type { Document } from '@/lib/types';
export const dynamic='force-dynamic';
const schema=z.object({question:z.string().trim().min(2).max(1200),scope:z.enum(['public','private']).default('public'),
  remember:z.boolean().default(false),conversationId:z.uuid().optional(),archive:z.boolean().default(false),
  demand:z.object({zoneId:z.number().int().min(1).max(263),horizon:z.literal([1,3,6,12,24])}).optional()});
export async function POST(request:Request){try{
  requireOrigin(request);
  let body:unknown;try{body=JSON.parse(await boundedText(request,6000));}catch(error){if(error instanceof AppError)throw error;throw new AppError(400,'Send a valid JSON question.');}
  const parsed=schema.safeParse(body);if(!parsed.success)throw new AppError(400,'Enter a question between 2 and 1,200 characters and valid chat settings.');
  const input=parsed.data;
  if(input.scope==='public'&&(input.remember||input.conversationId||input.archive))throw new AppError(400,'Sign in to save conversations or retrieve archived alerts.');
  const member=input.scope==='private'?await requireMember():null;
  if(member)await consumeLimit(member.db,'chat');else await consumePublicLimit(request);
  const history:{role:string;body:string}[]=[];
  if(member&&input.conversationId){
    const owned=await member.db.from('conversations').select('id').eq('id',input.conversationId).eq('owner_id',member.user.id).gt('expires_at',new Date().toISOString()).maybeSingle();
    if(owned.error)throw owned.error;if(!owned.data)throw new AppError(404,'Conversation unavailable.');
    const messages=await member.db.from('messages').select('role,body').eq('conversation_id',input.conversationId).eq('owner_id',member.user.id).order('id',{ascending:false}).limit(12);
    if(messages.error)throw messages.error;
    let length=0;for(const message of (messages.data||[]).reverse()){if(length+message.body.length>12000)continue;history.push(message);length+=message.body.length;}
  }
  const alerts=await getAlerts();
  const personal=member?await retrievePrivate(input.question,member.db,member.user.id):[];
  const archived=member&&input.archive?await retrieveArchive(input.question,member.db):[];
  const structured:Document[]=[];
  if(input.demand){
    const forecast=await getForecast();const row=forecast.rows.find(row=>row.zoneId===input.demand!.zoneId&&row.horizon===input.demand!.horizon);
    structured.push({id:'demand-context',title:'Current structured demand context',kind:'forecast',url:'/api/forecast',
      text:JSON.stringify({zone:zones.find(zone=>zone.id===input.demand!.zoneId)?.name,horizon:input.demand.horizon,mode:forecast.mode,
        origin:forecast.issuedAt,target:new Date(Date.parse(forecast.issuedAt)+input.demand.horizon*3600000).toISOString(),pickups:row?.value??null,source:forecast.historySource,message:forecast.message})});
  }
  const docs=[...structured,...personal.slice(0,4),...archived.slice(0,2),...retrieve(input.question,corpus(alerts))].slice(0,10);
  const allowGeneration=!!process.env.QWEN_API_KEY;
  const result=allowGeneration?await answerFromEvidence(input.question,docs,history):
    {answer:extractiveAnswer(docs,process.env.QWEN_API_KEY?'Sign in for AI answers.':'Qwen is not configured.'),mode:'sources' as const};
  const citations=docs.map((doc,index)=>({index:index+1,id:doc.id,title:doc.title,url:doc.url}));
  let conversationId:string|undefined,historySaved=false;
  if(member&&input.remember){
    conversationId=input.conversationId||randomUUID();
    const saved=await member.db.rpc('save_chat_turn',{p_id:conversationId,p_question:input.question,p_answer:result.answer,p_citations:citations});
    if(saved.error)throw new AppError(503,'The answer could not be saved. Retry with Save conversation disabled.');
    historySaved=true;
  }
  return privateJson({...result,citations,fetchedAt:alerts.fetchedAt,conversationId,historySaved});
}catch(error){return errorResponse(error);}}
