import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from 'fast-png';
import { zlibSync } from 'fflate';
import { prepareBoundedPng } from '../worker/png';

function join(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(new TextEncoder().encode(type), 4); result.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

test('bounded PNG preflight preserves pixels while stripping unused compressed metadata', () => {
  const png = encode({ width: 9, height: 17, channels: 4, depth: 8, data: new Uint8Array(9 * 17 * 4).fill(255) });
  const withProfile = join(png.subarray(0, 33), chunk('iCCP', new Uint8Array([0, 0, 1, 2, 3])), png.subarray(33));
  const clean = prepareBoundedPng(withProfile);
  assert.deepEqual(clean, png);
  assert.equal(decode(clean, { checkCrc: true }).data.length, 9 * 17 * 4);
  assert.throws(() => prepareBoundedPng(join(png.subarray(0, 33), png.subarray(8, 33), png.subarray(33))));
});

test('bounded PNG preflight rejects inflation beyond declared dimensions and unsupported interlace', () => {
  const png = encode({ width: 1, height: 1, channels: 3, depth: 8, data: new Uint8Array(3) });
  const inflatedTooFar = join(png.subarray(0, 33), chunk('IDAT', zlibSync(new Uint8Array(200_000))), chunk('IEND', new Uint8Array()));
  assert.throws(() => prepareBoundedPng(inflatedTooFar));
  const interlaced = png.slice(); interlaced[28] = 1;
  assert.throws(() => prepareBoundedPng(interlaced));
});
