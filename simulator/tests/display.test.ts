import assert from 'node:assert/strict';
import test from 'node:test';
import { displayFrame, type DisplayFrameOptions } from '../shared/display';
import { createPong, advancePong, renderPong } from '../shared/pong';
import { exampleClips, renderScene, urlFrame } from '../shared/render';
import { TURN_MS } from '../shared/contracts';

const examples = exampleClips();
const scene = examples.find(clip => clip.id === 'example-heart')!.scene;
const options = (changes: Partial<DisplayFrameOptions> = {}): DisplayFrameOptions => ({ scene, startedAt: 1000, clockOffset: 0, paused: false, preview: false, ...changes });

test('shared animations loop past five seconds throughout their thirty-second turn', () => {
  assert.deepEqual(displayFrame(options(), 7750), renderScene(scene, 1750));
  assert.deepEqual(displayFrame(options(), 30_999), renderScene(scene, 4999));
  assert.deepEqual(displayFrame(options(), 31_000), urlFrame(31_000), 'expired shared item returns to the colored domain even before the next state poll');
  assert.deepEqual(displayFrame(options({ preview: true }), TURN_MS * 3 + 2750), renderScene(scene, 1750), 'private preview keeps looping');
});

test('display timing honors clock offset, explicit slot duration, and paused elapsed time', () => {
  assert.deepEqual(displayFrame(options({ clockOffset: 250 }), 2500), renderScene(scene, 1750));
  assert.deepEqual(displayFrame(options({ paused: true }), 50_000, 1750), renderScene(scene, 1750));
  assert.notDeepEqual(displayFrame(options({ durationMs: 2000 }), 3000), renderScene(scene, 2000));
});

test('idle defaults to the colored domain scroll, globally synchronized across viewers', () => {
  const idle = options({ scene: null });
  for (const time of [0, 750, 1800, 4000, 7000, 11400, 12000, 42_750]) {
    assert.deepEqual(displayFrame(idle, time), urlFrame(time));
  }
  assert.deepEqual(displayFrame(idle, 42_750), displayFrame({ ...idle, startedAt: 40_000 }, 42_750));
  assert.deepEqual(displayFrame({ ...idle, clockOffset: 250 }, 42_500), urlFrame(42_750));
  assert.deepEqual(displayFrame(options({ startedAt: 50_000 }), 42_750), urlFrame(42_750), 'a future reserved turn must not replace the screensaver early');
});

test('Pong displays the authoritative snapshot with no more than 500ms prediction', () => {
  const pong = createPong(1000, 140), active = options({ pong });
  assert.deepEqual(displayFrame(active, 1250), renderPong(advancePong(pong, 1250)));
  assert.deepEqual(displayFrame(active, 10_000), renderPong(advancePong(pong, 1500)), 'stale state cannot continue guessing indefinitely');
  assert.deepEqual(displayFrame(options({ pong, paused: true }), 10_000, 250), renderPong(advancePong(pong, 1250)));
  assert.deepEqual(displayFrame(active, 31_000), urlFrame(31_000), 'Pong hands the facade back to the screensaver when its queue slot ends');
});
