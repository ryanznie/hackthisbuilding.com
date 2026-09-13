import assert from 'node:assert/strict';
import test from 'node:test';
import { advancePong, createPong, PONG_STEP_MS, renderPong } from '../shared/pong';

test('Pong is deterministic and advances only whole ticks without mutating input', () => {
  const initial = createPong(1000, 140);
  const copy = structuredClone(initial);
  assert.deepEqual(createPong(1000, 140), initial);
  assert.deepEqual(advancePong(initial, 1124), initial);
  assert.equal(advancePong(initial, 1125).tickAt, 1125);
  assert.equal(advancePong(initial, 1249).tickAt, 1125);
  assert.deepEqual(advancePong(initial, 20_000), advancePong(initial, 20_000));
  assert.deepEqual(initial, copy);
  assert.deepEqual(advancePong(initial, 999), initial);
  assert.notEqual(advancePong(initial, 1000), initial);
});

test('wall and swept paddle contacts bounce without awarding a score', () => {
  const initial = createPong(0, 12);
  const wall = advancePong({ ...initial, ballX: 8, ballY: 8, dx: 1, dy: 1 }, PONG_STEP_MS);
  assert.equal(wall.ballX, 7);
  assert.equal(wall.dx, -1);
  const paddle = advancePong({ ...initial, bottomX: 3, ballX: 3, ballY: 15, dx: -1, dy: 1 }, PONG_STEP_MS);
  assert.equal(paddle.ballX, 3, 'the diagonal step contacts the paddle edge even though next X is outside');
  assert.equal(paddle.ballY, 15);
  assert.equal(paddle.dy, -1);
  assert.equal(paddle.topScore + paddle.bottomScore, 0);
});

test('a missed paddle awards exactly one point and serves a fresh centered ball', () => {
  const initial = createPong(0, 140);
  const missed = advancePong({ ...initial, bottomX: 0, ballX: 7, ballY: 15, dx: 1, dy: 1 }, PONG_STEP_MS);
  assert.equal(missed.topScore, 1);
  assert.equal(missed.bottomScore, 0);
  assert.equal(missed.ballX, 4);
  assert.equal(missed.ballY, 8);
  assert.notEqual(missed.seed, initial.seed);
  assert.equal(advancePong(missed, PONG_STEP_MS * 2).topScore, 1);
});

test('computer reaction pauses are deterministic and allow the human to score', () => {
  const initial = { ...createPong(250, 140), topX: 0, ballX: 4, ballY: 1, dx: -1, dy: -1 };
  const next = advancePong(initial, 375);
  assert.equal(next.topX, 0, 'AI takes one reaction pause every third tick');
  assert.equal(next.bottomScore, 1, 'a ball beyond the delayed AI paddle awards the human a point');
  assert.equal(next.topScore, 0);
  assert.deepEqual(advancePong(initial, 375), next);
});

test('human bottom paddle stays put, AI tracks, and sixty-second catchup stays bounded', () => {
  const initial = { ...createPong(0, 5), bottomX: 0, topX: 0, ballX: 7 };
  const one = advancePong(initial, PONG_STEP_MS);
  assert.equal(one.topX, 1);
  assert.equal(one.bottomX, 0);
  assert.equal(advancePong(initial, 1_000_000_000).tickAt, 60_000);
  for (let seed = 0; seed < 10; seed++) {
    let state = createPong(0, seed);
    for (let tick = 1; tick <= 480; tick++) {
      state = advancePong(state, tick * PONG_STEP_MS);
      assert.ok(state.ballX >= 0 && state.ballX < 9 && Number.isInteger(state.ballX));
      assert.ok(state.ballY >= 1 && state.ballY < 16 && Number.isInteger(state.ballY));
      assert.ok(state.topX >= 0 && state.topX <= 6);
      assert.equal(state.bottomX, 3);
      assert.ok(Math.abs(state.dx) === 1 && Math.abs(state.dy) === 1);
    }
  }
});

test('Pong frame uses the real 17-row by 9-column building orientation', () => {
  const state = createPong(0, 140), frame = renderPong(state);
  assert.equal(frame.length, 17);
  assert.ok(frame.every(row => row.length === 9));
  assert.deepEqual(frame[0][3], [0, 170, 255]);
  assert.deepEqual(frame[16][5], [255, 120, 0]);
  assert.deepEqual(frame[8][4], [255, 255, 255]);
  assert.equal(frame.flat().filter(pixel => pixel.some(value => value > 0)).length, 7);
});
