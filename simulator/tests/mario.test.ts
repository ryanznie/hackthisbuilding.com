import test from 'node:test';
import assert from 'node:assert/strict';
import { TURN_MS } from '../shared/contracts';
import { advanceMario, applyMarioInput, createMario, MARIO_INPUT_MS, renderMario, type MarioState } from '../shared/mario';

function hold(state: MarioState, direction: -1 | 0 | 1, duration: number): void {
  const until = state.updatedAt + duration;
  while (state.updatedAt < until && !state.won && !state.gameOver) {
    const now = state.updatedAt;
    applyMarioInput(state, { direction, jump: false }, now);
    advanceMario(state, Math.min(until, now + 200));
  }
}

test('Mario starts grounded with three lives and advances deterministic horizontal movement', () => {
  const state = createMario(1000, 7);
  assert.equal(state.lives, 3);
  assert.equal(state.grounded, true);
  applyMarioInput(state, { direction: 1, jump: false }, 1000);
  advanceMario(state, 1200);
  assert.ok(Math.abs(state.x - 2.9) < 1e-9);
  assert.equal(state.y, 12);
  hold(state, -1, 1000);
  assert.equal(state.x, 0);
});

test('lost movement input expires after 400ms and fresh input resumes it', () => {
  const state = createMario(0, 1);
  applyMarioInput(state, { direction: 1, jump: false }, 0);
  advanceMario(state, 1500);
  assert.ok(Math.abs(state.x - (2 + 4.5 * MARIO_INPUT_MS / 1000)) < 1e-9);
  assert.equal(state.direction, 0);
  assert.equal(state.vx, 0);
  applyMarioInput(state, { direction: -1, jump: false }, 1500);
  advanceMario(state, 1700);
  assert.ok(state.x < 3);
});

test('jump launches once, rejects a midair jump, and lands on the ground', () => {
  const state = createMario(0, 1);
  applyMarioInput(state, { direction: 0, jump: true }, 0);
  advanceMario(state, 200);
  assert.ok(state.y < 12);
  assert.equal(state.grounded, false);
  const velocity = state.vy;
  applyMarioInput(state, { direction: 0, jump: true }, 200);
  assert.equal(state.vy, velocity);
  advanceMario(state, 1400);
  assert.equal(state.y, 12);
  assert.equal(state.vy, 0);
  assert.equal(state.grounded, true);
});

test('pipes block horizontal movement without tunneling and permit landing on top', () => {
  const state = createMario(0, 1);
  state.x = 9;
  hold(state, 1, 800);
  assert.equal(state.x, 9, 'two-column hero stops at the pipe beginning at column 11');
  assert.equal(state.y, 12);
  applyMarioInput(state, { direction: 1, jump: true }, state.updatedAt);
  hold(state, 1, 400);
  applyMarioInput(state, { direction: 0, jump: false }, state.updatedAt);
  advanceMario(state, state.updatedAt + 1000);
  assert.equal(state.y, 10, 'feet land on the pipe top at row 13');
  assert.equal(state.grounded, true);
});

test('raised platform catches a falling hero and can be jumped through from below', () => {
  const falling = createMario(0, 1);
  falling.x = 6; falling.y = 7; falling.grounded = false;
  advanceMario(falling, 600);
  assert.equal(falling.y, 9);
  assert.equal(falling.grounded, true);
  const jumping = createMario(0, 1);
  jumping.x = 6;
  applyMarioInput(jumping, { direction: 0, jump: true }, 0);
  advanceMario(jumping, 400);
  assert.ok(jumping.y < 9, 'head and feet pass through the thin ledge while rising');
  advanceMario(jumping, 1000);
  assert.equal(jumping.y, 9, 'the descending hero lands on the ledge');
  assert.equal(jumping.vy, 0);
});

test('coins increase score once and remain collected across later visits', () => {
  const state = createMario(0, 1);
  state.x = 4; state.y = 10; state.grounded = false;
  advanceMario(state, 20);
  assert.equal(state.coins, 1);
  assert.equal(state.score, 10);
  advanceMario(state, 40);
  assert.equal(state.coins, 1);
  assert.deepEqual(state.collectedCoins, [0]);
});

test('pits and hazards remove one life, reset controls, and persist game over', () => {
  const state = createMario(0, 1);
  state.x = 20; state.y = 14; state.grounded = false;
  advanceMario(state, 800);
  assert.equal(state.lives, 2);
  assert.equal(state.x, 2);
  assert.equal(state.y, 12);
  assert.equal(state.direction, 0);
  for (let remaining = 1; remaining >= 0; remaining--) {
    state.x = 31; state.y = 12;
    advanceMario(state, state.updatedAt + 20);
    assert.equal(state.lives, remaining);
  }
  assert.equal(state.gameOver, true);
  assert.equal(state.deaths, 3);
  const ended = structuredClone(state);
  applyMarioInput(state, { direction: 1, jump: true }, 10000);
  advanceMario(state, 20000);
  assert.deepEqual(state, ended);
});

test('reaching the flag awards one win bonus and freezes until the turn ends', () => {
  const state = createMario(0, 1);
  state.x = 50.95;
  applyMarioInput(state, { direction: 1, jump: false }, 0);
  advanceMario(state, 20);
  assert.equal(state.won, true);
  assert.equal(state.progress, 1);
  assert.equal(state.score, 500);
  const ended = structuredClone(state);
  advanceMario(state, 10000);
  applyMarioInput(state, { direction: -1, jump: true }, 10000);
  assert.deepEqual(state, ended);
});

test('partitioned fixed-step simulation agrees and repeated or old times are no-ops', () => {
  const once = createMario(1000, 23), partitioned = createMario(1000, 23);
  for (const state of [once, partitioned]) applyMarioInput(state, { direction: 1, jump: true }, 1000);
  advanceMario(once, 2200);
  for (let at = 1017; at < 2200; at += 17) advanceMario(partitioned, at);
  advanceMario(partitioned, 2200);
  assert.deepEqual(partitioned, once);
  const prior = structuredClone(once);
  advanceMario(once, 2200);
  advanceMario(once, 2190);
  applyMarioInput(once, { direction: -1, jump: true }, 2100);
  assert.deepEqual(once, prior);
});

test('long catch-up is bounded, cancels expired controls, and keeps finite state', () => {
  const state = createMario(0, 1);
  applyMarioInput(state, { direction: 1, jump: true }, 0);
  advanceMario(state, 1e12);
  assert.equal(state.direction, 0);
  assert.equal(state.x, 2);
  assert.equal(state.y, 12);
  assert.equal(state.lastStepAt, 1e12);
  assert.ok(Object.values(state).filter(value => typeof value === 'number').every(Number.isFinite));
});

test('the complete course can be won with normal movement and grounded jumps within one turn', () => {
  const state = createMario(0, 1);
  for (let at = 0; at < TURN_MS && !state.won && !state.gameOver; at += 20) {
    applyMarioInput(state, { direction: 1, jump: state.grounded }, at);
    advanceMario(state, at + 20);
  }
  assert.equal(state.won, true);
  assert.equal(state.lives, 3);
  assert.ok(state.updatedAt < TURN_MS);
  assert.ok(state.coins > 0);
  assert.equal(state.score, 500 + state.coins * 10);
});

test('renderer is pure, deterministic, bounded RGB and follows the scrolling camera', () => {
  const initial = createMario(0, 17);
  const previous = structuredClone(initial);
  const first = renderMario(initial);
  assert.deepEqual(initial, previous);
  assert.deepEqual(first, renderMario(initial));
  const frames = [first];
  for (let x = 0; x <= 54; x += 0.5) frames.push(renderMario({ ...initial, x, y: Math.max(0, 12 - x % 8) }));
  frames.push(renderMario({ ...initial, gameOver: true, lives: 0 }));
  frames.push(renderMario({ ...initial, x: 52, won: true }));
  for (const frame of frames) {
    assert.equal(frame.length, 17);
    assert.ok(frame.every(row => row.length === 9));
    assert.ok(frame.flat().every(pixel => pixel.length === 3 && pixel.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)));
    assert.equal(frame.flat(2).length, 459);
  }
  assert.notDeepEqual(frames[0], renderMario({ ...initial, x: 30 }));
  first[0][0][0] = 0;
  assert.notDeepEqual(first, renderMario(initial));
});
