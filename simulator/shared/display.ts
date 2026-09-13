import { CLIP_MS, TURN_MS, type Frame, type PongState, type Scene } from './contracts';
import { advancePong, renderPong } from './pong';
import { advanceMario, renderMario, type MarioState } from './mario';
import { renderScene, urlFrame } from './render';

export const PONG_PREDICTION_MS = 500;

export interface DisplayFrameOptions {
  scene: Scene | null;
  startedAt: number;
  clockOffset: number;
  paused: boolean;
  preview: boolean;
  durationMs?: number;
  pong?: PongState | null;
  mario?: MarioState | null;
}

/**
 * Shared 2D/3D source selection. nowMs is local wall-clock time; clockOffset
 * aligns viewers to the server. Pass frozenElapsedMs when holding a paused frame.
 */
export function displayFrame(options: DisplayFrameOptions, nowMs = Date.now(), frozenElapsedMs?: number): Frame {
  const serverNow = nowMs + options.clockOffset;
  const elapsed = options.paused && frozenElapsedMs !== undefined ? frozenElapsedMs : serverNow - options.startedAt;
  const timelineNow = options.startedAt + elapsed;
  if (options.preview && options.scene) return renderScene(options.scene, Math.max(0, elapsed) % CLIP_MS);
  const duration = Number.isFinite(options.durationMs) ? Math.max(0, options.durationMs!) : TURN_MS;
  if (elapsed >= 0 && elapsed < duration) {
    if (options.mario) {
      const predictionAt = Math.max(options.mario.updatedAt, Math.min(timelineNow, options.mario.updatedAt + 200));
      return renderMario(advanceMario(structuredClone(options.mario), predictionAt));
    }
    if (options.pong) {
      const predictionAt = Math.max(options.pong.tickAt, Math.min(timelineNow, options.pong.tickAt + PONG_PREDICTION_MS));
      return renderPong(advancePong(options.pong, predictionAt));
    }
    if (options.scene) return renderScene(options.scene, elapsed % CLIP_MS);
  }
  // The colored domain is the default building screensaver. Server wall time
  // keeps every viewer and the organizer feed on the same scrolling columns.
  return urlFrame(timelineNow);
}
