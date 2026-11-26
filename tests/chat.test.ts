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
  delete process.env.QWEN_API_KEY;
  // No external feed or generation calls: an unavailable feed must not prevent source retrieval.
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  try {
    const response = await POST(new Request('https://urbanflow.example/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What forecast horizons and observed inputs are used?' }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const body = await response.json();
    assert.equal(body.mode, 'sources');
    assert.match(body.answer, /168 hours/);
    assert.match(body.answer, /1, 3, 6, 12 and 24-hour/);
    assert.match(body.answer, /not a forecast for today/);
    assert.ok(body.citations.some((citation: {id:string}) => citation.id === 'project'));
  } finally {
    if (previousKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = previousKey;
  }
});

test('updated forecast evidence preserves the scope of archived accuracy scores', () => {
  const docs = corpus({ incidents: [], feeds: [], fetchedAt: '' });
  const evidence = retrieve('12 24 hour forecast', docs).find(doc => doc.id === 'project');
  assert.ok(evidence);
  assert.match(evidence.text, /does not validate accuracy/);
});
