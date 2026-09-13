import { COLS, ROWS, type Frame, type PongState } from './contracts';

/**
 * Pong for the 9 × 17 facade, inspired by Xander Cogan's Sundai Hack 140 game.
 * https://github.com/XanderCogan/pong-hack-sundai140
 * Fresh deterministic engine: no upstream DOM, timers, leases, or frame writes.
 */
export const PONG_STEP_MS = 125;
export const PADDLE_WIDTH = 3;
const MAX_STEPS = 480;
const LAST_COLUMN = COLS - 1;
const LAST_ROW = ROWS - 1;

function randomBit(state: PongState): number {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed >>> 31;
}

function serve(state: PongState, vertical: number) {
  state.ballX = Math.floor(COLS / 2);
  state.ballY = Math.floor(ROWS / 2);
  state.dx = randomBit(state) === 0 ? -1 : 1;
  state.dy = vertical;
}

export function createPong(startedAt: number, seed: number): PongState {
  const state: PongState = {
    tickAt: Number.isFinite(startedAt) ? startedAt : 0,
    topX: 3, bottomX: 3, ballX: 4, ballY: 8,
    dx: 1, dy: 1, topScore: 0, bottomScore: 0,
    seed: Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 140,
  };
  const direction = randomBit(state) === 0 ? -1 : 1;
  serve(state, direction);
  return state;
}

function touchesPaddle(previousX: number, nextX: number, paddleX: number): boolean {
  const inPaddle = (x: number) => x >= paddleX && x < paddleX + PADDLE_WIDTH;
  // Treat a diagonal step as a swept contact, so it cannot skip an edge cell.
  return inPaddle(previousX) || inPaddle(nextX);
}

function tick(state: PongState) {
  const wanted = Math.sign(state.ballX - (state.topX + 1));
  // A predictable reaction pause every third tick gives the human a real
  // chance to beat the computer, while retaining deterministic prediction.
  if (Math.floor(state.tickAt / PONG_STEP_MS) % 3 !== 2) state.topX = Math.max(0, Math.min(COLS - PADDLE_WIDTH, state.topX + wanted));
  let nextX = state.ballX + state.dx;
  const nextY = state.ballY + state.dy;
  if (nextX < 0 || nextX > LAST_COLUMN) {
    state.dx = -state.dx;
    nextX = state.ballX + state.dx;
  }
  if (nextY > 0 && nextY < LAST_ROW) {
    state.ballX = nextX;
    state.ballY = nextY;
    return;
  }
  const hitsTop = nextY <= 0;
  const paddleX = hitsTop ? state.topX : state.bottomX;
  if (touchesPaddle(state.ballX, nextX, paddleX)) {
    const impactX = Math.max(paddleX, Math.min(paddleX + PADDLE_WIDTH - 1, nextX));
    state.ballX = impactX;
    state.ballY = hitsTop ? 1 : LAST_ROW - 1;
    state.dy = hitsTop ? 1 : -1;
    state.dx = Math.sign(impactX - (paddleX + 1)) || state.dx;
    return;
  }
  if (hitsTop) state.bottomScore++;
  else state.topScore++;
  serve(state, hitsTop ? 1 : -1);
}

/** Advances whole 125 ms ticks; inputs and the supplied snapshot stay untouched. */
export function advancePong(state: PongState, now: number): PongState {
  const next = { ...state };
  if (!Number.isFinite(now)) return next;
  const ticks = Math.min(MAX_STEPS, Math.max(0, Math.floor((now - state.tickAt) / PONG_STEP_MS)));
  for (let index = 0; index < ticks; index++) {
    tick(next);
    next.tickAt += PONG_STEP_MS;
  }
  return next;
}

export function renderPong(state: PongState): Frame {
  const frame: Frame = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => [0, 0, 0]));
  for (let offset = 0; offset < PADDLE_WIDTH; offset++) {
    frame[0][state.topX + offset] = [0, 170, 255];
    frame[LAST_ROW][state.bottomX + offset] = [255, 120, 0];
  }
  frame[state.ballY][state.ballX] = [255, 255, 255];
  return frame;
}
