import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { contextualQuery,extractiveAnswer } from '@/lib/rag';
import { consumePublicLimit } from '@/lib/private/public-limit';
import { answerFromEvidence } from '@/lib/answer';
import { requireMember,consumeLimit } from '@/lib/private/server';
import { retrievePrivate } from '@/lib/private/retrieval';
import { retrieveArchive } from '@/lib/private/archive';
import { AppError,boundedText,errorResponse,privateJson,requireOrigin } from '@/lib/private/http';
import {chatContext} from '@/lib/chat-context';
import {recentHistory,type ChatEvent} from '@/lib/chat-protocol';
export const dynamic='force-dynamic';
export const maxDuration=180;
const schema=z.object({question:z.string().trim().min(1).max(1200),scope:z.enum(['public','private']).default('public'),stream:z.boolean().default(false),
  history:z.array(z.object({role:z.enum(['user','assistant']),body:z.string().min(1).max(2000)})).max(8).default([]),
  remember:z.boolean().default(false),conversationId:z.uuid().optional(),archive:z.boolean().default(false),
  demand:z.object({zoneId:z.number().int().min(1).max(263),horizon:z.literal([1,3,6,12,24])}).optional()});
export async function POST(request:Request){try{
  requireOrigin(request);
  let body:unknown;try{body=JSON.parse(await boundedText(request,40000));}catch(error){if(error instanceof AppError)throw error;throw new AppError(400,'Send a valid JSON question.');}
  const parsed=schema.safeParse(body);if(!parsed.success)throw new AppError(400,'Enter a question of up to 1,200 characters and valid chat settings.');
  const input=parsed.data;
  if(input.scope==='public'&&(input.remember||input.conversationId||input.archive))throw new AppError(400,'Sign in to save conversations or retrieve archived alerts.');
  const member=input.scope==='private'?await requireMember():null;
  if(member)await consumeLimit(member.db,'chat');else await consumePublicLimit(request);
  let history:{role:string;body:string}[]=recentHistory(input.history);
  if(member&&input.conversationId){
    history=[]; // Verify ownership before loading any saved conversation context.
    const owned=await member.db.from('conversations').select('id').eq('id',input.conversationId).eq('owner_id',member.user.id).gt('expires_at',new Date().toISOString()).maybeSingle();
    if(owned.error)throw owned.error;if(!owned.data)throw new AppError(404,'Conversation unavailable.');
    const messages=await member.db.from('messages').select('role,body').eq('conversation_id',input.conversationId).eq('owner_id',member.user.id).order('id',{ascending:false}).limit(12);
    if(messages.error)throw messages.error;
    let length=0;for(const message of (messages.data||[]).reverse()){if(length+message.body.length>12000)continue;history.push(message);length+=message.body.length;}
    // The browser also knows unsaved exchanges after the last database write.
    // Both kinds of history remain untrusted context, never retrieval evidence.
    if(input.history.length)history=recentHistory([...history,...input.history]);
  }
  const cancelled=new AbortController();
  const signal=AbortSignal.any([request.signal,cancelled.signal]);
  async function respond(emit?:(event:ChatEvent)=>void){
  emit?.({type:'status',message:'Finding relevant sources…'});
  if(signal.aborted)throw new DOMException('Request stopped.','AbortError');
  const query=contextualQuery(input.question,history);
  const [context,personal,archived]=await Promise.all([chatContext(input.question,history,input.demand),member?retrievePrivate(query,member.db,member.user.id):[],member&&input.archive?retrieveArchive(query,member.db):[]]);
  if(signal.aborted)throw new DOMException('Request stopped.','AbortError');
  const docs=[...context.structured,...personal.slice(0,4),...archived.slice(0,2),...context.publicDocs].slice(0,10);
  emit?.({type:'status',message:'Writing your answer…'});
  const allowGeneration=!!process.env.QWEN_API_KEY;
  const result=allowGeneration?await answerFromEvidence(input.question,docs,history,{signal,onDelta:emit?text=>emit({type:'delta',text}):undefined}):
    {answer:extractiveAnswer(docs,process.env.QWEN_API_KEY?'Sign in for AI answers.':'Qwen is not configured.'),mode:'sources' as const};
  const citations=result.mode==='general'?[]:docs.map((doc,index)=>({index:index+1,id:doc.id,title:doc.title,url:doc.url}));
  let conversationId:string|undefined,historySaved=false;
  if(signal.aborted)throw new DOMException('Request stopped.','AbortError');
  if(member&&input.remember){
    conversationId=input.conversationId||randomUUID();
    const saved=await member.db.rpc('save_chat_turn',{p_id:conversationId,p_question:input.question,p_answer:result.answer,p_citations:citations});
    if(saved.error)throw new AppError(503,'The answer could not be saved. Retry with Save conversation disabled.');
    historySaved=true;
  }
  return {...result,citations,fetchedAt:context.fetchedAt,conversationId,historySaved};
  }
  if(!input.stream)return privateJson(await respond());
  const encoder=new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller){
      const emit=(event:ChatEvent)=>{if(!signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
      void respond(emit).then(reply=>emit({type:'done',reply})).catch(async error=>{
        if(signal.aborted)return;
        const safe=await errorResponse(error).json();emit({type:'error',message:safe.error});
      }).finally(()=>{try{controller.close();}catch{/* Consumer already stopped. */}});
    },cancel(){cancelled.abort();},
  }),{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'private, no-store','X-Accel-Buffering':'no'}});
}catch(error){return errorResponse(error);}}
