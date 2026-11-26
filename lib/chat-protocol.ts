export type ChatHistory={role:'user'|'assistant';body:string}[];
export type ChatReply={answer:string;mode:string;citations:{index:number;title:string;url:string}[];notice?:string;generationError?:string};
export type ChatEvent={type:'status';message:string}|{type:'delta';text:string}|{type:'done';reply:ChatReply}|{type:'error';message:string};
// Only recent context is transmitted. Public chat has no durable browser storage.
export function recentHistory(messages:{role:string;body:string}[]):ChatHistory{
 const kept:ChatHistory=[];let remaining=8000;
 for(const message of messages.slice(-8).reverse()){
  if(message.role!=='user'&&message.role!=='assistant')continue;
  const body=message.body.slice(0,Math.min(2000,remaining));if(!body)break;
  kept.unshift({role:message.role,body});remaining-=body.length;if(!remaining)break;
 }
 return kept;
}
export async function* streamLines(body:ReadableStream<Uint8Array>,maxBytes=1_000_000){
 const reader=body.getReader(),decoder=new TextDecoder();let buffer='',size=0;
 try{for(;;){const {done,value}=await reader.read();if(done){buffer+=decoder.decode();break;}
  size+=value.byteLength;if(size>maxBytes)throw Error('Response exceeded the chat limit.');
  buffer+=decoder.decode(value,{stream:true});let end:number;
  while((end=buffer.indexOf('\n'))>=0){yield buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);}
 }if(buffer)yield buffer.replace(/\r$/,'');}finally{await reader.cancel().catch(()=>{});}
}
