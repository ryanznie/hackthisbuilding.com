import { Unzlib } from 'fflate';
import { ApiFailure } from './generation';

const reject = () => new ApiFailure(502, 'IMAGE_INVALID', 'The image could not be fitted to the building. Please try a simpler image.');

/** Validate static PNG structure, discard unused metadata, and bound inflation. */
export function prepareBoundedPng(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 45 || bytes.length > 6_000_000 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) throw reject();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keep: Uint8Array[] = [bytes.subarray(0, 8)], compressed: Uint8Array[] = [];
  let offset = 8, count = 0, expected = 0, color = -1, paletteEntries = 0;
  let seenData = false, dataEnded = false, seenTransparency = false, ended = false;
  while (offset + 12 <= bytes.length) {
    if (++count > 4096) throw reject();
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) throw reject();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    if (count === 1 && type !== 'IHDR') throw reject();
    if (type === 'IHDR') {
      if (count !== 1 || length !== 13) throw reject();
      const width = view.getUint32(start), height = view.getUint32(start + 4), depth = bytes[start + 8];
      color = bytes[start + 9];
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
      if (!channels || width < 1 || height < 1 || width > 2048 || height > 2048 || width * height > 2_100_000
        || !(color === 3 ? [1, 2, 4, 8] : [8, 16]).includes(depth)
        || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] !== 0) throw reject();
      expected = height * (1 + Math.ceil(width * channels * depth / 8));
    } else if (type === 'PLTE') {
      if (seenData || paletteEntries || ![2, 3, 6].includes(color) || !length || length % 3 || length > 768) throw reject();
      paletteEntries = length / 3;
    } else if (type === 'tRNS') {
      if (seenData || seenTransparency || !(color === 0 ? length === 2 : color === 2 ? length === 6 : color === 3 && length > 0 && length <= paletteEntries)) throw reject();
      seenTransparency = true;
    } else if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !paletteEntries)) throw reject();
      seenData = true;
      compressed.push(bytes.subarray(start, start + length));
    } else if (type === 'IEND') {
      if (length !== 0 || !seenData || end !== bytes.length) throw reject();
      ended = true;
    } else {
      // Only ancillary metadata may be dropped. Animated PNG is unsupported.
      if (!(bytes[offset + 4] & 32) || ['acTL', 'fcTL', 'fdAT'].includes(type)) throw reject();
    }
    if (seenData && type !== 'IDAT') dataEnded = true;
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) keep.push(bytes.subarray(offset, end));
    offset = end;
    if (ended) break;
  }
  if (!ended || !expected) throw reject();
  try {
    let decodedBytes = 0;
    const inflator = new Unzlib(chunk => {
      decodedBytes += chunk.length;
      if (decodedBytes > expected) throw reject();
    });
    // Small compressed increments bound each transient output allocation even
    // for extreme compression ratios; discard decoded scanlines immediately.
    for (const data of compressed) for (let i = 0; i < data.length; i += 256) inflator.push(data.subarray(i, i + 256), false);
    inflator.push(new Uint8Array(), true);
    if (decodedBytes !== expected) throw reject();
  } catch { throw reject(); }
  const sanitized = new Uint8Array(keep.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0;
  for (const chunk of keep) { sanitized.set(chunk, position); position += chunk.length; }
  return sanitized;
}
