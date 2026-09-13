import assert from 'node:assert/strict';
import test from 'node:test';
import { COLS, DOMAIN, ROWS, URL_PASS_MS, type Frame, type Layer } from '../shared/contracts';
import { exampleClips, renderScene, urlFrame, validateScene } from '../shared/render';

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

test('every example is stable, visible, deterministic, and animated', () => {
  const examples = exampleClips();
  assert.ok(examples.length >= 4);
  for (const id of ['example-heart', 'example-rocket', 'example-waves', 'example-stars']) assert.ok(examples.some(clip => clip.id === id));
  assert.deepEqual(examples, exampleClips());
  for (const example of examples) {
    assert.equal(example.source, 'example');
    const scene = validateScene(example.scene);
    const start = renderScene(scene, 0), later = renderScene(scene, 1875);
    validFrame(start);
    validFrame(later);
    assert.deepEqual(later, renderScene(scene, 1875));
    assert.notDeepEqual(start, later, example.title);
    assert.ok(start.flat().some(pixel => Math.max(...pixel) > 100), `${example.title} must light windows`);
  }
});

test('all supported primitive and motion combinations produce safe frames', () => {
  const shapes = ['heart', 'star', 'circle', 'ring', 'rectangle', 'line', 'rain', 'sparkles', 'wave', 'rocket', 'smile'];
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
  const isInk = (pixel: number[]) => pixel[0] === 156;
  assert.ok(letters(650).flat().some(isInk), 'beginning of domain enters the display');
  assert.ok(letters(11400).flat().some(isInk), 'end of domain reaches the display');
  assert.ok(!letters(0).flat().some(isInk), 'pass starts with a clear left-to-right entry');
});
