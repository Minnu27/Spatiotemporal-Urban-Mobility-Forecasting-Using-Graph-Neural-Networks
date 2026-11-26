import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chunkText,embed,textHash} from '../lib/private/embeddings';
import {answerFromEvidence,citationsValid} from '../lib/answer';
import {POST as chat} from '../app/api/chat/route';
import {GET as documents,POST as upload} from '../app/api/documents/route';
import {POST as maintenance} from '../app/api/maintenance/route';
import {POST as setup} from '../app/api/setup/route';
import {boundedText,requireOrigin} from '../lib/private/http';
test('chunks preserve normalized source offsets and reusable hashes',()=>{
 const text='A paragraph.\r\n'.repeat(320),{normalized,chunks}=chunkText(text);
 assert.ok(chunks.length>2);assert.equal(textHash(normalized),textHash(chunkText(text).normalized));
 for(const chunk of chunks){assert.equal(chunk.content,normalized.slice(chunk.start,chunk.end));assert.ok(chunk.content.length<=1800);}
 for(let i=1;i<chunks.length;i++)assert.equal(chunks[i-1].end-chunks[i].start,180);
});
test('embedding vectors are ordered and reject wrong dimensions',async context=>{
 const prior=process.env.EMBEDDING_API_KEY;process.env.EMBEDDING_API_KEY='test';
 const vector=[1,...Array(1023).fill(0)];let bad=false;
 context.mock.method(globalThis,'fetch',async()=>Response.json({data:bad?[{index:0,embedding:[1]}]:[{index:1,embedding:vector},{index:0,embedding:vector.map(x=>x*2)}]}));
 try{assert.equal((await embed(['one','two']))[0][0],2);bad=true;await assert.rejects(embed(['one']));}
 finally{if(prior===undefined)delete process.env.EMBEDDING_API_KEY;else process.env.EMBEDDING_API_KEY=prior;}
});
test('citations must reference available evidence',()=>{
 assert.equal(citationsValid('Supported [1] and [2].',2),true);assert.equal(citationsValid('Guess [3].',2),false);
 assert.equal(citationsValid('No citation.',2),false);assert.equal(citationsValid('[0]',2),false);
});
test('unavailable or invalid generated citations fall back to evidence',async context=>{
 const previous=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='test';let unavailable=false;
 context.mock.method(globalThis,'fetch',async()=>unavailable?new Response('',{status:503}):Response.json({choices:[{message:{content:'Invented answer [99]'}}]}));
 try{for(const failed of [false,true]){unavailable=failed;const result=await answerFromEvidence('A fare?', [{id:'one',title:'Fare evidence',text:'Known fare evidence.',url:'https://example.com',kind:'fare'}]);assert.equal(result.mode,'sources');assert.match(result.answer,/Known fare evidence/);assert.ok(!result.answer.includes('Invented'));}}
 finally{if(previous===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=previous;}
});
test('private operations and public retrieval fail closed without configuration',async()=>{
 const names=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
 const previous=names.map(name=>process.env[name]);names.forEach(name=>delete process.env[name]);
 const request=(body:unknown)=>new Request('https://urbanflow.example/api/chat',{method:'POST',headers:{origin:'https://urbanflow.example','Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  for(const response of [await documents(),await chat(request({question:'Private notes?',scope:'private'})),await chat(request({question:'Public alerts?'})),await upload(request({text:'private'})),await setup(request({providers:true,consent:true}))]){
   assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  }
  assert.equal((await maintenance(new Request('https://urbanflow.example/api/maintenance',{method:'POST'}))).status,401);
 }finally{names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});
test('mutations reject missing Origin and oversized streams',async()=>{
 assert.throws(()=>requireOrigin(new Request('https://urbanflow.example/api/chat')),/same-origin/);
 await assert.rejects(boundedText(new Request('https://urbanflow.example',{method:'POST',body:'a'.repeat(200)}),100),/too large/);
});
