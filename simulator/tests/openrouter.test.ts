import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiFailure, parseModelJson } from '../worker/generation';
import { createOpenRouterAI, requestOpenRouter } from '../worker/openrouter';

test('OpenRouter adapter preserves vision messages and returns parseable JSON without retrying', async () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Check this family-friendly logo.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] }];
  let requests = 0;
  const fetcher: typeof fetch = async (url, init) => {
    requests++;
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-test-credential');
    assert.equal(headers.get('HTTP-Referer'), 'https://www.hackthisbuilding.com');
    assert.equal(headers.get('X-Title'), 'Hack This Building');
    assert.equal(init?.redirect, 'manual');
    assert.deepEqual(JSON.parse(init!.body as string), {
      model: 'google/gemini-2.5-flash', messages, temperature: 0.2, max_tokens: 80,
      response_format: { type: 'json_object' }, stream: false,
    });
    return Response.json({ choices: [{ message: { content: '{"allowed":true}' } }] });
  };
  const ai = createOpenRouterAI('synthetic-test-credential', undefined, { fetcher });
  const result = await ai.run('ignored-worker-model', { messages, temperature: 0.2, max_tokens: 80 });
  assert.deepEqual(parseModelJson(result), { allowed: true });
  assert.equal(requests, 1);
});

test('provider error statuses never expose upstream text or trigger another billable request', async () => {
  for (const [status, expected] of [[401, 503], [403, 503], [402, 503], [429, 503], [500, 502], [400, 502]]) {
    let requests = 0;
    const fetcher: typeof fetch = async () => { requests++; return new Response('sensitive-provider-detail synthetic-test-credential', { status }); };
    await assert.rejects(requestOpenRouter('synthetic-test-credential', '/chat/completions', {}, { fetcher }), (error: unknown) => {
      assert.ok(error instanceof ApiFailure);
      assert.equal(error.status, expected);
      assert.doesNotMatch(error.message, /sensitive-provider-detail|synthetic-test-credential/);
      return true;
    });
    assert.equal(requests, 1);
  }
});

test('response bounds cover declared and streamed sizes, while image requests allow explicit larger limits', async () => {
  for (const headers of [new Headers({ 'Content-Length': '4096' }), new Headers()]) {
    let canceled = false;
    const fetcher: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ output: 'x'.repeat(150) }))); },
      cancel() { canceled = true; },
    }), { headers });
    await assert.rejects(requestOpenRouter('fixture', '/chat/completions', {}, { fetcher, maxBytes: 100 }), (error: unknown) => error instanceof ApiFailure && error.code === 'AI_RESPONSE_TOO_LARGE');
    assert.equal(canceled, true);
  }
  let observedPath: unknown;
  const fetcher: typeof fetch = async url => { observedPath = url; return Response.json({ image: 'x'.repeat(40_000) }); };
  const result = await requestOpenRouter('fixture', '/images', { prompt: 'a logo' }, { fetcher, timeoutMs: 65_000, maxBytes: 8 * 1024 * 1024 }) as { image: string };
  assert.equal(observedPath, 'https://openrouter.ai/api/v1/images');
  assert.equal(result.image.length, 40_000);
  await assert.rejects(requestOpenRouter('fixture', '/chat/completions', {}, { fetcher }), (error: unknown) => error instanceof ApiFailure && error.code === 'AI_RESPONSE_TOO_LARGE');
});

test('timeouts abort the request and malformed or transport responses stay private', async () => {
  let signal: AbortSignal | null | undefined;
  const pending: typeof fetch = async (_url, init) => {
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('private transport detail')), { once: true }));
  };
  await assert.rejects(requestOpenRouter('fixture', '/chat/completions', {}, { fetcher: pending, timeoutMs: 5 }), (error: unknown) => error instanceof ApiFailure && error.code === 'GENERATION_TIMEOUT' && error.status === 503);
  assert.equal(signal?.aborted, true);
  for (const fetcher of [async () => new Response('not-json private upstream detail'), async () => Response.json({ error: { message: 'private upstream detail' } }), async () => { throw new Error('private transport detail'); }]) {
    await assert.rejects(requestOpenRouter('fixture', '/chat/completions', {}, { fetcher }), (error: unknown) => error instanceof ApiFailure && error.status === 502 && !error.message.includes('private'));
  }
});
