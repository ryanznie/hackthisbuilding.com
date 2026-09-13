import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ApiFailure } from '../worker/generation';
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
