import assert from 'node:assert/strict';
import test from 'node:test';
import { COLS, DOMAIN, ROWS, URL_PASS_MS, type Frame, type Layer } from '../shared/contracts';
import { exampleClips, redSoxScoreScene, renderScene, textScene, urlFrame, validateScene } from '../shared/render';

const baseLayer: Layer = { shape: 'heart', color: '#ff3377', x: 4, y: 8, size: 7, motion: 'pulse', speed: 0.8, phase: 0 };
const input = () => ({ version: 1, background: '#02040b', layers: [{ ...baseLayer }] });
function validFrame(frame: Frame) {
  assert.equal(frame.length, ROWS);
  for (const row of frame) {
    assert.equal(row.length, COLS);
    for (const pixel of row) {
      assert.equal(pixel.length, 3);
      for (const channel of pixel) assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255);
    }
  }
}

test('validates data-only scenes and bounds finite numeric parameters', () => {
  const scene = input();
  scene.layers[0] = { ...baseLayer, x: -999, y: 999, size: 999, speed: 999, phase: -999 };
  assert.deepEqual(validateScene(scene).layers[0], { ...baseLayer, x: 0, y: 16, size: 17, speed: 2, phase: -Math.PI * 2 });
  assert.equal(scene.layers[0].x, -999, 'validation must not mutate untrusted input');
  assert.equal(validateScene({ ...input(), background: '#AABBCC' }).background, '#aabbcc');
});

test('rejects malformed, executable, unbounded, and unsupported scene input', () => {
  const invalid: unknown[] = [null, [], {}, { ...input(), version: 2 }, { ...input(), background: 'red' }, { ...input(), background: '#fff' }, { ...input(), layers: [] }, { ...input(), layers: Array(9).fill(baseLayer) }, { ...input(), script: 'alert(1)' }];
  for (const key of ['x', 'y', 'size', 'speed', 'phase']) for (const value of [NaN, Infinity, -Infinity, '1', undefined]) invalid.push({ ...input(), layers: [{ ...baseLayer, [key]: value }] });
  for (const patch of [{ shape: 'script' }, { motion: 'strobe' }, { color: 'url(https://evil.test)' }, { color: '#000000ff' }, { onclick: 'evil' }, { shape: null }, { motion: null }]) invalid.push({ ...input(), layers: [{ ...baseLayer, ...patch }] });
  for (const scene of invalid) assert.throws(() => validateScene(scene));
});

test('every example is stable, visible, deterministic, and preserves its motion', () => {
  const examples = exampleClips();
  assert.ok(examples.length >= 4);
  for (const id of ['example-heart', 'example-rocket', 'example-waves', 'example-stars', 'example-red-sox']) assert.ok(examples.some(clip => clip.id === id));
  assert.deepEqual(examples, exampleClips());
  for (const example of examples) {
    assert.equal(example.source, 'example');
    const scene = validateScene(example.scene);
    const start = renderScene(scene, 0), later = renderScene(scene, 1875);
    validFrame(start);
    validFrame(later);
    assert.deepEqual(later, renderScene(scene, 1875));
    if (scene.raster?.motion === 'still' && !scene.layers.length) assert.deepEqual(start, later, example.title);
    else assert.notDeepEqual(start, later, example.title);
    assert.ok(start.flat().some(pixel => Math.max(...pixel) > 100), `${example.title} must light windows`);
  }
});

test('original Heart, Smile and Arrow presets retain their exact 9-by-17 bitmap masks', () => {
  // Fixed rows from Kalyani:app/page.tsx, independent of the RGB adaptation.
  const expected: Record<string, string[]> = {
    Heart: ['000000000', '000000000', '011000110', '111101111', '111111111', '111111111', '011111110', '011111110', '001111100', '001111100', '000111000', '000111000', '000010000', '000000000', '000000000', '000000000', '000000000'],
    Smile: ['000000000', '000111000', '011000110', '110000011', '100000001', '101101101', '101101101', '100000001', '100000001', '101000101', '100111001', '110000011', '011000110', '000111000', '000000000', '000000000', '000000000'],
    Arrow: ['000010000', '000111000', '001111100', '011111110', '111111111', '000010000', '000010000', '000010000', '000010000', '000010000', '000010000', '000010000', '000010000', '000010000', '000010000', '000000000', '000000000'],
  };
  const examples = exampleClips();
  for (const [title, mask] of Object.entries(expected)) {
    const preset = examples.find(clip => clip.title === title);
    assert.ok(preset, `${title} button must be available`);
    assert.equal(preset.expiresAt, 0);
    assert.deepEqual(renderScene(preset.scene, 0).map(row => row.map(pixel => pixel[0] > 100 ? '1' : '0').join('')), mask);
    assert.deepEqual(renderScene(preset.scene, 0), renderScene(preset.scene, 59_999), 'original static art remains still throughout its turn');
  }
});

test('Red Sox primary-logo adaptation keeps overlapping socks and contrasting seam/toe details', () => {
  const clip = exampleClips().find(example => example.id === 'example-red-sox')!;
  const frame = renderScene(clip.scene, 0);
  assert.equal(clip.scene.raster?.motion, 'still');
  assert.equal(clip.scene.layers.length, 0, 'extra generated sock or cuff layers must not obscure the reference');
  const red = (pixel: number[]) => pixel[0] > 150 && pixel[1] < 100;
  const white = (pixel: number[]) => pixel[0] > 240 && pixel[1] > 240;
  assert.ok(frame[9].slice(1, 8).every(red), 'the overlapping sock body forms a continuous silhouette');
  assert.ok(white(frame[10][4]) && white(frame[11][5]), 'the white diagonal seam distinguishes front and rear socks');
  assert.ok(white(frame[11][8]) && white(frame[13][4]), 'separate toe patches point right and down');
  assert.deepEqual(frame, renderScene(clip.scene, 59_999), 'logo stays readable throughout the turn');
});

test('score raster shows Boston above opponent with correct zero and two-digit glyphs', () => {
  const scene = redSoxScoreScene({ bostonScore: 12, opponentScore: 0 });
  const frame = renderScene(scene, 0);
  validFrame(frame);
  assert.deepEqual(frame.slice(2, 7).map(row => row.slice(1, 8).map(pixel => pixel[0] === 235 ? '1' : '0').join('')), ['0100111', '1100001', '0100111', '0100100', '1110111']);
  assert.deepEqual(frame.slice(10, 15).map(row => row.slice(3, 6).map(pixel => pixel[0] === 245 ? '1' : '0').join('')), ['111', '101', '101', '101', '111']);
  assert.equal(scene.raster?.motion, 'still');
  assert.deepEqual(frame, renderScene(scene, 59_999), 'score snapshots never animate into a different value');
  const largest = renderScene(redSoxScoreScene({ bostonScore: 99, opponentScore: 99 }), 0);
  validFrame(largest);
  assert.deepEqual(frame[8][4], [38, 51, 62]);
});

test('score helper rejects missing, fractional, negative and oversized values', () => {
  for (const value of [undefined, null, '3', NaN, Infinity, -1, 1.5, 100]) {
    assert.throws(() => redSoxScoreScene({ bostonScore: value as number, opponentScore: 0 }));
    assert.throws(() => redSoxScoreScene({ bostonScore: 0, opponentScore: value as number }));
  }
});

test('literal names scroll through a complete five-second loop deterministically', () => {
  const scene = textScene('Wilson');
  assert.equal(scene.text?.value, 'Wilson');
  assert.equal(scene.layers.length, 0);
  const hasInk = (time: number) => renderScene(scene, time).flat().some(pixel => pixel[0] === 236 && pixel[1] === 255 && pixel[2] === 93);
  assert.equal(hasInk(0), false);
  assert.ok(hasInk(500), 'beginning of the name enters from the right');
  assert.ok(hasInk(4750), 'last letter remains visible before the loop ends');
  assert.deepEqual(renderScene(scene, 0), renderScene(scene, 5000));
  assert.deepEqual(renderScene(scene, 1875), renderScene(scene, 1875));
  assert.notDeepEqual(renderScene(scene, 1000), renderScene(scene, 3000));
  assert.deepEqual(renderScene(textScene('WILSON'), 1875), renderScene(scene, 1875));
});

test('every accepted printable non-space character has a visible bounded pixel glyph', () => {
  for (let code = 33; code <= 126; code++) {
    const frame = renderScene(textScene(String.fromCharCode(code)), 2500);
    validFrame(frame);
    assert.ok(frame.flat().some(pixel => pixel[0] === 236), `ASCII ${code} must not become a blank glyph`);
  }
  const scene = textScene('Hello, Wilson! 2026');
  validFrame(renderScene(scene, 2500));
  validFrame(renderScene(textScene('W'.repeat(48)), 4900));
  validFrame(renderScene(textScene('<script>'), 2500));
});

test('text remains structural data with strict length, color, and field validation', () => {
  const base = { version: 1, background: '#02040b', layers: [] };
  for (const text of [null, undefined, {}, { value: '', color: '#ffffff' }, { value: '   ', color: '#ffffff' }, { value: 'a'.repeat(49), color: '#ffffff' }, { value: 'two\nlines', color: '#ffffff' }, { value: 'Jos\u00e9', color: '#ffffff' }, { value: 'Wilson', color: 'yellow' }, { value: 'Wilson', color: '#ffffff', script: 'run()' }]) assert.throws(() => validateScene({ ...base, text }));
  assert.throws(() => validateScene({ ...base, text: { value: 'Wilson', color: '#ffffff' }, layers: Array(9).fill(baseLayer) }));
  assert.equal(textScene('Wilson', '#FFFFFF').text?.color, '#ffffff');
  const layered = validateScene({ ...input(), text: { value: 'Wilson', color: '#ffffff' }, raster: { pixels: rasterPixels(), motion: 'still' } });
  validFrame(renderScene(layered, 2500));
});

test('all supported primitive and motion combinations produce safe frames', () => {
  const shapes = ['heart', 'star', 'circle', 'ring', 'rectangle', 'line', 'rain', 'sparkles', 'wave', 'rocket', 'smile', 'socks'];
  const motions = ['still', 'pulse', 'rise', 'fall', 'orbit', 'sway', 'spin'];
  for (const shape of shapes) for (const motion of motions) {
    const scene = validateScene({ ...input(), layers: [{ ...baseLayer, shape, motion }] });
    for (const time of [0, 1000 / 30, 4999, 1e12]) validFrame(renderScene(scene, time));
  }
  validFrame(renderScene(validateScene(input()), NaN));
});

test('URL repeats after each full pass and includes both ends of the domain', () => {
  assert.equal(DOMAIN, 'hackthisbuilding.com');
  for (const time of [0, 1000, 5555, URL_PASS_MS - 1]) validFrame(urlFrame(time));
  // Letter scroll repeats exactly; subtle rails have a separate continuous cycle.
  const letters = (time: number) => urlFrame(time).slice(6, 11);
  assert.deepEqual(letters(2200), letters(2200 + URL_PASS_MS));
  assert.notDeepEqual(letters(2200), letters(5200));
  const isInk = (pixel: number[]) => pixel[0] > 100;
  assert.ok(letters(650).flat().some(isInk), 'beginning of domain enters the display');
  assert.ok(letters(11400).flat().some(isInk), 'end of domain reaches the display');
  assert.ok(!letters(0).flat().some(isInk), 'pass starts with a clear left-to-right entry');
  for (const [time, color] of [[1800, [250, 202, 76]], [4000, [105, 193, 250]], [7000, [247, 121, 166]], [11400, [245, 243, 230]]] as const) {
    const ink = letters(time).flat().filter(isInk);
    assert.ok(ink.length > 0);
    assert.ok(ink.every(pixel => pixel.every((channel, index) => channel === color[index])), 'hack / this / building / .com retain their respective colors while scrolling');
  }
});

const rasterPixels = (): Frame => Array.from({ length: ROWS }, (_, row) => Array.from({ length: COLS }, (_, col) => [row * 13, col * 27, 255 - row * 9]));
const rasterInput = () => ({ version: 1, background: '#ff0000', layers: [], raster: { pixels: rasterPixels(), motion: 'still' } });

test('raster-only scenes preserve exact image pixels, orientation, and legacy scenes', () => {
  const original = rasterInput();
  const validated = validateScene(original);
  const frame = renderScene(validated, 0);
  validFrame(frame);
  assert.deepEqual(frame, original.raster.pixels, 'opaque raster replaces the background without RGB conversion');
  assert.deepEqual(frame[0][0], [0, 0, 255]);
  assert.deepEqual(frame[16][8], [208, 216, 111]);
  assert.deepEqual(renderScene(validated, 4333), frame, 'still images do not animate');
  frame[0][0][0] = 123;
  assert.equal(validated.raster!.pixels[0][0][0], 0, 'render output must not alias the scene');
  validated.raster!.pixels[0][0][1] = 123;
  assert.equal(original.raster.pixels[0][0][1], 0, 'validation must own a fresh pixel copy');
  assert.deepEqual(validateScene(input()), input(), 'legacy scene shape remains unchanged');
});

test('raster validation rejects malformed grids, unsupported fields, and invalid RGB values', () => {
  const valid = rasterInput().raster;
  const invalidRasters: unknown[] = [null, undefined, {}, { ...valid, motion: 'strobe' }, { ...valid, motion: 'rise' }, { ...valid, url: 'https://example.com/logo.png' }, { ...valid, pixels: [] }, { ...valid, pixels: rasterPixels().slice(1) }, { ...valid, pixels: [...rasterPixels(), rasterPixels()[0]] }, { ...valid, pixels: Array(ROWS) }];
  for (const invalidRow of [null, [], Array(COLS), Array(COLS - 1).fill([0, 0, 0]), Array(COLS + 1).fill([0, 0, 0])]) {
    const pixels: unknown[] = rasterPixels(); pixels[5] = invalidRow;
    invalidRasters.push({ ...valid, pixels });
  }
  for (const invalidPixel of [null, [], [0, 0], [0, 0, 0, 0], Array(3), [NaN, 0, 0], [0, Infinity, 0], [0, 0, -1], [256, 0, 0], [0.5, 0, 0], ['255', 0, 0]]) {
    const pixels: unknown[][] = rasterPixels(); pixels[8][4] = invalidPixel;
    invalidRasters.push({ ...valid, pixels });
  }
  for (const raster of invalidRasters) assert.throws(() => validateScene({ ...rasterInput(), raster }));
  assert.throws(() => validateScene({ ...rasterInput(), layers: Array(9).fill(baseLayer) }), 'raster must not lift the layer budget');
});

test('raster pulse is deterministic, smooth, bounded, and never dims below eighty percent', () => {
  const pixels: Frame = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => [255, 160, 80]));
  const scene = validateScene({ ...rasterInput(), raster: { pixels, motion: 'pulse' } });
  assert.deepEqual(renderScene(scene, 0), pixels);
  assert.deepEqual(renderScene(scene, 2500)[0][0], [204, 128, 64]);
  assert.deepEqual(renderScene(scene, 5000), pixels);
  assert.deepEqual(renderScene(scene, 1789), renderScene(scene, 1789));
  let previous = renderScene(scene, 0)[0][0][0];
  for (let frameNumber = 1; frameNumber <= 150; frameNumber++) {
    const frame = renderScene(scene, frameNumber * 1000 / 30);
    validFrame(frame);
    const red = frame[0][0][0];
    assert.ok(red >= 204 && red <= 255);
    assert.ok(Math.abs(red - previous) <= 2, 'adjacent frames must never flash');
    previous = red;
  }
});

test('legacy shapes can composite over a raster without changing untouched pixels', () => {
  const pixels: Frame = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => [0, 0, 40]));
  const scene = validateScene({ ...rasterInput(), raster: { pixels, motion: 'still' }, layers: [{ ...baseLayer, shape: 'circle', color: '#ff0000', size: 4, motion: 'still', speed: 0 }] });
  const frame = renderScene(scene, 0);
  assert.deepEqual(frame[8][4], [255, 0, 40]);
  assert.deepEqual(frame[0][0], [0, 0, 40]);
});
