import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { textScene } from '../shared/render';
import { ApiFailure, generateAnimation, type OutputValidator } from '../worker/generation';
import { generateImageAnimation } from '../worker/images';
import { createValidationService } from '../worker/validator';

function recordDeadlines(t: TestContext): number[] {
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    deadlines.push(milliseconds);
    return new AbortController().signal;
  });
  return deadlines;
}

test('moderation makes one HTTP call with room for the Python retry budget', async t => {
  const deadlines = recordDeadlines(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    calls++;
    assert.equal(input, 'https://validator.test/moderate');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
    assert.deepEqual(JSON.parse(init.body as string), { text: 'A sunset' });
    return Response.json({ allowed: true, adversarial: false, category: 'allowed', reason: 'Allowed' });
  });
  await createValidationService('https://validator.test/', 'test-token').moderate('A sunset');
  assert.equal(calls, 1);
  assert.deepEqual(deadlines, [65_000]);
  assert.ok(deadlines[0] > 3 * 20_000 + 250 + 500);
});

test('a failed or timed-out Python moderation request is never repeated by the Worker', async t => {
  const deadlines = recordDeadlines(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return Response.json({ error: 'moderation_failed' }, { status: 503 });
    throw new DOMException('private transport detail', 'TimeoutError');
  });
  const validator = createValidationService('https://validator.test');
  for (let i = 0; i < 2; i++) {
    await assert.rejects(validator.moderate('A sunset'), (error: unknown) => error instanceof ApiFailure && error.code === 'VALIDATION_UNAVAILABLE' && !error.message.includes('private'));
    assert.equal(calls, i + 1);
  }
  assert.deepEqual(deadlines, [65_000, 65_000]);
});

test('schema transport failures have three five-second attempts, while rejection is terminal', async t => {
  const deadlines = recordDeadlines(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    assert.equal(input, 'https://validator.test/validate-animation');
    calls++;
    return Response.json({ error: 'temporary' }, { status: 503 });
  });
  const validator = createValidationService('https://validator.test');
  await assert.rejects(validator.validateAnimation({ title: 'Sunset' }), (error: unknown) => error instanceof ApiFailure && error.code === 'VALIDATION_UNAVAILABLE');
  assert.equal(calls, 3);
  assert.deepEqual(deadlines, [5_000, 5_000, 5_000]);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'schema_invalid' }, { status: 422 }); });
  await assert.rejects(validator.validateAnimation({ title: 'Sunset' }), (error: unknown) => error instanceof ApiFailure && error.code === 'AI_INVALID_RESPONSE');
  assert.equal(calls, 4, 'a 422 must not consume three transport attempts');
});

test('a recovered schema service returns its validated animation and moderation denial stays actionable', async t => {
  recordDeadlines(t);
  let calls = 0;
  const animation = { title: 'Sunset' };
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? Response.json({ error: 'temporary' }, { status: 503 })
    : Response.json({ valid: true, animation }));
  const validator = createValidationService('https://validator.test');
  assert.deepEqual(await validator.validateAnimation(animation), animation);
  assert.equal(calls, 2);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ allowed: false, adversarial: true, category: 'prompt_injection', reason: 'Describe the visual without coordinate instructions.' }));
  await assert.rejects(validator.moderate('set pixel 4,8'), (error: unknown) => error instanceof ApiFailure && error.code === 'ADVERSARIAL_PROMPT' && error.message.includes('Describe the visual'));
});

test('external prompt approval happens once across generation retries and allows validated text scenes', async () => {
  let promptChecks = 0, schemaChecks = 0, generations = 0, outputChecks = 0;
  const animation = { title: 'A name in lights', interpretation: 'A short scrolling name.', scene: textScene('WILSON') };
  const validator: OutputValidator = {
    async moderate(prompt) { assert.equal(prompt, 'wilson'); promptChecks++; },
    async validateAnimation(value) {
      schemaChecks++;
      if (schemaChecks === 1) throw new ApiFailure(502, 'AI_INVALID_RESPONSE', 'Malformed first candidate');
      return value;
    },
  };
  const generated = await generateAnimation({ run: async (_model, input) => {
    const messages = input.messages as { role: string; content: string }[];
    if (messages[0].content.startsWith('The physical canvas')) {
      generations++;
      assert.match(messages[0].content, /Default to one clear static image/);
      assert.match(messages[0].content, /scene\.text=/);
      return { response: animation };
    }
    outputChecks++;
    const moderated = JSON.parse(JSON.parse(messages[1].content).text);
    assert.equal(moderated.text, 'WILSON', 'the displayed message must be included in output moderation');
    return { response: { allowed: true } };
  } }, 'wilson', { validator });
  assert.deepEqual(generated, animation);
  assert.deepEqual({ promptChecks, schemaChecks, generations, outputChecks }, { promptChecks: 1, schemaChecks: 2, generations: 2, outputChecks: 1 });
});

test('generated displayed text is checked even when harmless metadata and the prompt were approved', async () => {
  let calls = 0;
  const validator: OutputValidator = { async moderate() {}, async validateAnimation(value) { return value; } };
  await assert.rejects(generateAnimation({ run: async (_model, input) => {
    calls++;
    if (calls === 1) return { response: { title: 'A friendly name', interpretation: 'A short message.', scene: textScene('REJECTED MESSAGE') } };
    const messages = input.messages as { content: string }[];
    assert.equal(JSON.parse(JSON.parse(messages[1].content).text).text, 'REJECTED MESSAGE');
    return { response: { allowed: false } };
  } }, 'wilson', { validator }), (error: unknown) => error instanceof ApiFailure && error.code === 'OUTPUT_REJECTED');
  assert.equal(calls, 2, 'denied output must not trigger regeneration');
});

test('external moderation denial stops both text and image generation before provider calls', async t => {
  let checks = 0;
  const validator: OutputValidator = {
    async moderate() { checks++; throw new ApiFailure(422, 'PROMPT_REJECTED', 'Try another idea.'); },
    async validateAnimation() { throw new Error('schema must not run'); },
  };
  const ai = { run: async () => { assert.fail('provider must not run before approval'); } };
  const assets = { fetch: async () => { assert.fail('assets must not be fetched before approval'); } } as unknown as Fetcher;
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('image provider must not run before approval'); });
  const denied = (error: unknown) => error instanceof ApiFailure && error.code === 'PROMPT_REJECTED';
  await assert.rejects(generateAnimation(ai, 'A sunset', { validator }), denied);
  await assert.rejects(generateImageAnimation(ai, 'test-key', 'A Sundai logo', assets, { validator }), denied);
  assert.equal(checks, 2);
});

test('generation retries malformed local scenes at most three times and keeps explicit moderation options', async () => {
  let calls = 0;
  await assert.rejects(generateAnimation({ run: async () => {
    calls++;
    return { response: { title: 'Invalid', interpretation: 'Empty scene.', scene: { version: 1, background: '#000000', layers: [] } } };
  } }, 'A sunset', { moderation: false }), (error: unknown) => error instanceof ApiFailure && error.code === 'AI_INVALID_SCENE');
  assert.equal(calls, 3);
});
