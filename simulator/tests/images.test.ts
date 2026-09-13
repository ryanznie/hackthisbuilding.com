import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { generateImageAnimation, pngToWindows, readGeneratedPng } from '../worker/images';
import { ApiFailure } from '../worker/generation';

test('PNG images map to 153 windows with correct orientation and transparent pixels over black', () => {
  const pixels = new Uint8Array(9 * 17 * 4);
  pixels.set([255, 0, 0, 255], 0);
  pixels.set([0, 255, 0, 255], 8 * 4);
  pixels.set([0, 0, 255, 255], (16 * 9) * 4);
  pixels.set([255, 255, 255, 0], (16 * 9 + 8) * 4);
  const frame = pngToWindows(encode({ width: 9, height: 17, channels: 4, depth: 8, data: pixels }));
  assert.equal(frame.length, 17); assert.equal(frame[0].length, 9);
  assert.deepEqual(frame[0][0], [255, 0, 0]); assert.deepEqual(frame[0][8], [0, 255, 0]);
  assert.deepEqual(frame[16][0], [0, 0, 255]); assert.deepEqual(frame[16][8], [0, 0, 0]);
});

test('image decoding rejects malformed, oversized and remote image payloads', () => {
  assert.throws(() => pngToWindows(new Uint8Array(100)));
  const png = encode({ width: 9, height: 17, channels: 3, depth: 8, data: new Uint8Array(9 * 17 * 3) });
  new DataView(png.buffer, png.byteOffset).setUint32(16, 100_000);
  assert.throws(() => pngToWindows(png));
  for (const value of [null, { data: [] }, { data: [{ url: 'https://example.com/photo.png' }] }, { data: [{ b64_json: 'bad***' }] }, { data: [{ b64_json: 'abcd', media_type: 'image/svg+xml' }] }]) assert.throws(() => readGeneratedPng(value));
});

test('image requests reject unsafe prompts before billing and unsafe generated images before preview', async t => {
  let providerCalls = 0;
  const png = encode({ width: 9, height: 17, channels: 3, depth: 8, data: new Uint8Array(9 * 17 * 3).fill(255) });
  t.mock.method(globalThis, 'fetch', async () => {
    providerCalls++;
    return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64'), media_type: 'image/png' }] });
  });
  const assets = { fetch: async () => { throw new Error('No reference needed'); } } as unknown as Fetcher;
  await assert.rejects(generateImageAnimation({ run: async () => ({ response: { allowed: false } }) }, 'test-key', 'an unsafe image', assets), (error: unknown) => error instanceof ApiFailure && error.code === 'PROMPT_REJECTED');
  assert.equal(providerCalls, 0);
  let moderationCalls = 0;
  await assert.rejects(generateImageAnimation({ run: async () => ({ response: { allowed: ++moderationCalls === 1 } }) }, 'test-key', 'a friendly owl image', assets), (error: unknown) => error instanceof ApiFailure && error.code === 'OUTPUT_REJECTED');
  assert.equal(providerCalls, 1); assert.equal(moderationCalls, 2);
});
