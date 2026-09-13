import type { Frame, RGB } from './contracts';

/** Original, server-simulated pocket platformer; no external game code or assets. */
export interface MarioInput { direction: -1 | 0 | 1; jump: boolean; }
export interface MarioState {
  version: 1;
  seed: number;
  startedAt: number;
  updatedAt: number;
  lastStepAt: number;
  inputUntil: number;
  direction: -1 | 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  lives: number;
  score: number;
  coins: number;
  collectedCoins: number[];
  progress: number;
  won: boolean;
  gameOver: boolean;
  deaths: number;
}

export const MARIO_WORLD_COLS = 56;
export const MARIO_WORLD_ROWS = 17;
export const MARIO_INPUT_MS = 400;
export const MARIO_STEP_MS = 20;
const MAX_STEPS = 100;
const WIDTH = 2, HEIGHT = 3;
const SPEED = 4.5, JUMP_SPEED = 14, GRAVITY = 26;
const FLAG_X = 53;
const EPSILON = 1e-8;
interface Rect { x: number; y: number; width: number; height: number; }

// Coordinates name tile boundaries. Ground and pipes are solid; the thin
// ledges can be jumped through from below and support the hero from above.
const GROUND: Rect[] = [
  { x: 0, y: 15, width: 19, height: 2 },
  { x: 22, y: 15, width: 15, height: 2 },
  { x: 40, y: 15, width: 16, height: 2 },
];
const PLATFORMS: Rect[] = [
  { x: 6, y: 12, width: 3, height: 1 },
  { x: 16, y: 11, width: 3, height: 1 },
  { x: 24, y: 10, width: 3, height: 1 },
  { x: 33, y: 12, width: 3, height: 1 },
  { x: 42, y: 11, width: 3, height: 1 },
];
const PIPES: Rect[] = [
  { x: 11, y: 13, width: 2, height: 2 },
  { x: 28, y: 12, width: 2, height: 3 },
  { x: 46, y: 13, width: 2, height: 2 },
];
const SOLIDS = [...GROUND, ...PIPES];
const HAZARDS: Rect[] = [{ x: 31, y: 14, width: 1, height: 1 }];
const COINS = [
  { x: 4, y: 11 }, { x: 7, y: 9 }, { x: 11, y: 10 },
  { x: 17, y: 8 }, { x: 20, y: 10 }, { x: 25, y: 7 },
  { x: 28, y: 9 }, { x: 34, y: 9 }, { x: 38, y: 10 },
  { x: 43, y: 8 }, { x: 47, y: 10 }, { x: 50, y: 11 },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON
  && a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON;
const body = (state: MarioState): Rect => ({ x: state.x, y: state.y, width: WIDTH, height: HEIGHT });

export function createMario(now: number, seed: number): MarioState {
  if (!Number.isFinite(now) || !Number.isFinite(seed)) throw new Error('Mario needs a finite server time and seed.');
  return {
    version: 1, seed: seed >>> 0, startedAt: now, updatedAt: now, lastStepAt: now,
    inputUntil: now, direction: 0, x: 2, y: 12, vx: 0, vy: 0, grounded: true,
    lives: 3, score: 0, coins: 0, collectedCoins: [], progress: 0,
    won: false, gameOver: false, deaths: 0,
  };
}

function die(state: MarioState): void {
  state.lives = Math.max(0, state.lives - 1);
  state.deaths++;
  state.gameOver = state.lives === 0;
  state.direction = 0;
  state.inputUntil = 0;
  state.x = 2;
  state.y = 12;
  state.vx = state.vy = 0;
  state.grounded = true;
  state.progress = 0;
}

function step(state: MarioState, at: number): void {
  const dt = MARIO_STEP_MS / 1000;
  if (at > state.inputUntil) state.direction = 0;
  state.vx = state.direction * SPEED;
  const dx = state.vx * dt;
  state.x = clamp(state.x + dx, 0, MARIO_WORLD_COLS - WIDTH);
  for (const solid of SOLIDS) {
    if (!overlaps(body(state), solid)) continue;
    if (dx > 0) state.x = solid.x - WIDTH;
    else if (dx < 0) state.x = solid.x + solid.width;
    state.vx = 0;
  }

  state.vy = Math.min(20, state.vy + GRAVITY * dt);
  const dy = state.vy * dt;
  const previousBottom = state.y + HEIGHT;
  state.y += dy;
  state.grounded = false;
  for (const solid of SOLIDS) {
    if (!overlaps(body(state), solid)) continue;
    if (dy > 0) {
      state.y = solid.y - HEIGHT;
      state.grounded = true;
    } else if (dy < 0) state.y = solid.y + solid.height;
    state.vy = 0;
  }
  if (dy > 0) for (const platform of PLATFORMS) {
    if (state.x + WIDTH <= platform.x + EPSILON || state.x >= platform.x + platform.width - EPSILON) continue;
    if (previousBottom <= platform.y + EPSILON && state.y + HEIGHT >= platform.y && state.y < platform.y) {
      state.y = platform.y - HEIGHT;
      state.vy = 0;
      state.grounded = true;
    }
  }
  // Keep the cap inside the display while preserving a normal falling arc.
  if (state.y < 0) { state.y = 0; state.vy = Math.max(0, state.vy); }

  if (state.y >= MARIO_WORLD_ROWS || HAZARDS.some(hazard => overlaps(body(state), hazard))) {
    die(state);
    return;
  }
  COINS.forEach((coin, index) => {
    if (!state.collectedCoins.includes(index) && overlaps(body(state), { ...coin, width: 1, height: 1 })) {
      state.collectedCoins.push(index);
      state.coins++;
      state.score += 10;
    }
  });
  state.progress = clamp((state.x - 2) / (FLAG_X - WIDTH - 2), 0, 1);
  if (state.x + WIDTH >= FLAG_X) {
    state.won = true;
    state.progress = 1;
    state.score += 500;
    state.direction = 0;
    state.vx = state.vy = 0;
  }
}

/** Fixed 20ms steps make normal catch-up independent of rendering/poll cadence. */
export function advanceMario(state: MarioState, now: number): MarioState {
  if (!Number.isFinite(now) || now <= state.updatedAt || state.won || state.gameOver) return state;
  state.updatedAt = now;
  let steps = Math.floor((now - state.lastStepAt) / MARIO_STEP_MS);
  if (steps > MAX_STEPS) {
    // After a long outage, discard excess wall time instead of running thousands
    // of steps or extending stale controls. Normal 30-second turns poll often.
    state.lastStepAt += (steps - MAX_STEPS) * MARIO_STEP_MS;
    steps = MAX_STEPS;
  }
  for (let index = 0; index < steps && !state.won && !state.gameOver; index++) {
    state.lastStepAt += MARIO_STEP_MS;
    step(state, state.lastStepAt);
  }
  return state;
}

/** Each true jump command is consumed immediately, and only while grounded. */
export function applyMarioInput(state: MarioState, input: MarioInput, now: number): MarioState {
  if (![-1, 0, 1].includes(input.direction) || typeof input.jump !== 'boolean' || !Number.isFinite(now)) throw new Error('Invalid Mario input.');
  if (now < state.updatedAt) return state;
  advanceMario(state, now);
  if (state.won || state.gameOver) return state;
  state.direction = input.direction;
  state.inputUntil = now + MARIO_INPUT_MS;
  if (input.jump && state.grounded) {
    state.vy = -JUMP_SPEED;
    state.grounded = false;
  }
  return state;
}

/** Original pixel art painted directly into the 17-row, 9-column RGB contract. */
export function renderMario(state: MarioState): Frame {
  const sky: RGB = state.gameOver ? [33, 49, 77] : [104, 182, 238];
  const frame: Frame = Array.from({ length: MARIO_WORLD_ROWS }, () => Array.from({ length: 9 }, (): RGB => [...sky]));
  const camera = clamp(Math.floor(state.x) - 3, 0, MARIO_WORLD_COLS - 9);
  const paint = (x: number, y: number, color: RGB) => {
    const col = Math.floor(x) - camera, row = Math.floor(y);
    if (row >= 0 && row < MARIO_WORLD_ROWS && col >= 0 && col < 9) frame[row][col] = [...color];
  };
  // Fixed clouds and low hills move with the camera without blinking.
  for (let col = 0; col < 9; col++) {
    const worldX = col + camera;
    if ((worldX + state.seed % 7) % 13 < 4) {
      paint(worldX, 3, [231, 246, 251]);
      if ((worldX + state.seed % 7) % 13 === 1) paint(worldX, 2, [231, 246, 251]);
    }
    const hill = Math.max(0, 3 - Math.abs(worldX % 15 - 7));
    for (let y = 15 - hill; y < 15; y++) paint(worldX, y, [77, 174, 118]);
  }
  for (const ground of GROUND) for (let y = ground.y; y < ground.y + ground.height; y++) for (let x = ground.x; x < ground.x + ground.width; x++) {
    paint(x, y, y === 15 ? [64, 168, 60] : (x % 2 ? [153, 96, 48] : [120, 73, 42]));
  }
  for (const platform of PLATFORMS) for (let x = platform.x; x < platform.x + platform.width; x++) paint(x, platform.y, x % 2 ? [225, 164, 84] : [170, 102, 47]);
  for (const pipe of PIPES) for (let y = pipe.y; y < pipe.y + pipe.height; y++) for (let x = pipe.x; x < pipe.x + pipe.width; x++) paint(x, y, y === pipe.y ? [100, 224, 77] : x === pipe.x ? [36, 166, 63] : [19, 105, 46]);
  HAZARDS.forEach(hazard => paint(hazard.x, hazard.y, [220, 60, 43]));
  COINS.forEach((coin, index) => { if (!state.collectedCoins.includes(index)) paint(coin.x, coin.y, [255, 225, 55]); });
  for (let y = 5; y < 15; y++) paint(FLAG_X, y, [240, 248, 229]);
  paint(FLAG_X - 1, state.won ? 12 : 5, [248, 70, 68]);
  paint(FLAG_X - 2, state.won ? 12 : 5, [248, 70, 68]);
  const x = Math.floor(state.x), y = Math.floor(state.y);
  paint(x, y, [242, 50, 47]); paint(x + 1, y, [242, 50, 47]);
  paint(x, y + 1, [255, 196, 132]); paint(x + 1, y + 1, [116, 57, 36]);
  paint(x, y + 2, [33, 71, 206]); paint(x + 1, y + 2, [33, 71, 206]);
  // Three stable pips expose remaining lives even on the tiny display.
  for (let life = 0; life < 3; life++) frame[0][life * 2] = life < state.lives ? [242, 50, 47] : [59, 82, 105];
  if (state.won) for (let col = 0; col < 9; col++) frame[0][col] = [255, 225, 55];
  return frame;
}
