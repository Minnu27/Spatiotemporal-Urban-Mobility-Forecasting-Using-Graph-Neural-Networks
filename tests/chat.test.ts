import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/chat/route';
import { corpus, retrieve } from '../lib/rag';

test('chat rejects foreign origins and invalid questions without cacheable errors', async () => {
  for (const [origin, body, status] of [
    ['https://unrelated.example', { question: 'Forecast hours?' }, 403],
    ['https://urbanflow.example', { question: '' }, 400],
  ] as const) {
    const response = await POST(new Request('https://urbanflow.example/api/chat', {
      method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});

test('source answers use current horizon evidence and are never cached', async context => {
  const previousKey = process.env.QWEN_API_KEY;
  const previousUrl=process.env.UPSTASH_REDIS_REST_URL,previousToken=process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.QWEN_API_KEY;
  process.env.UPSTASH_REDIS_REST_URL='https://limits.example';process.env.UPSTASH_REDIS_REST_TOKEN='test-token';
  // No external feed or generation calls: an unavailable feed must not prevent source retrieval.
  context.mock.method(globalThis, 'fetch', async (url:RequestInfo|URL) => String(url).startsWith('https://limits.example')?Response.json({result:1}):new Response('', { status: 503 }));
  try {
    const response = await POST(new Request('https://urbanflow.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json',origin:'https://urbanflow.example' },
      body: JSON.stringify({ question: 'What forecast horizons and observed inputs are used?' }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.mode, 'sources');
    assert.match(body.answer, /168 hours/);
    assert.match(body.answer, /1, 3, 6, 12 and 24-hour/);
    assert.match(body.answer, /current-demand estimate/i);
    assert.match(body.answer, /not observed current pickups/);
    assert.ok(body.citations.some((citation: {id:string}) => citation.id === 'project'));
  } finally {
    if (previousKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = previousKey;
    if(previousUrl===undefined)delete process.env.UPSTASH_REDIS_REST_URL;else process.env.UPSTASH_REDIS_REST_URL=previousUrl;
    if(previousToken===undefined)delete process.env.UPSTASH_REDIS_REST_TOKEN;else process.env.UPSTASH_REDIS_REST_TOKEN=previousToken;
  }
});

test('updated forecast evidence preserves the scope of archived accuracy scores', () => {
  const docs = corpus({ incidents: [], feeds: [], fetchedAt: '' });
  const evidence = retrieve('12 24 hour forecast', docs).find(doc => doc.id === 'project');
  assert.ok(evidence);
  assert.match(evidence.text, /does not validate accuracy/);
});
test('chat retrieves an exact zone and horizon through the structured forecast API',async context=>{
 const names=['QWEN_API_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','MODEL_SERVICE_URL','MODEL_SERVICE_TOKEN'];
 const previous=names.map(name=>process.env[name]);delete process.env.QWEN_API_KEY;
 process.env.UPSTASH_REDIS_REST_URL='https://limits.example';process.env.UPSTASH_REDIS_REST_TOKEN='test';
 process.env.MODEL_SERVICE_URL='https://model.example';process.env.MODEL_SERVICE_TOKEN='test';
 const rows=[1,3,6,12,24].flatMap(horizon=>Array.from({length:263},(_,index)=>({zoneId:index+1,horizon,value:index+1+horizon})));
 const issuedAt=new Date().toISOString();
 context.mock.method(globalThis,'fetch',async (url:RequestInfo|URL)=>String(url).startsWith('https://limits.example')?Response.json({result:1}):String(url).startsWith('https://model.example')?
  Response.json({mode:'live',model:'test-fixture',issuedAt,historySource:'Structured test context',rows,message:'Test fixture.'}):new Response('',{status:503}));
 try{
  const response=await POST(new Request('https://urbanflow.example/api/chat',{method:'POST',headers:{origin:'https://urbanflow.example','Content-Type':'application/json'},body:JSON.stringify({question:'How many pickups at Midtown?',demand:{zoneId:161,horizon:12}})}));
  assert.equal(response.status,200);const reply=await response.json();assert.match(reply.answer,/"pickups":173/);assert.match(reply.answer,/"horizon":12/);assert.match(reply.answer,/Structured test context/);assert.equal(reply.citations[0].id,'demand-context');
 }finally{names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});
