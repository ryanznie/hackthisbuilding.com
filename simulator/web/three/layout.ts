import { COLS, ROWS } from '../../shared/contracts';

/** One window is one physical display pixel. Row zero is the top floor. */
export const TOWER = {
  width: 27.8,
  depth: 14.8,
  roof: 76,
  firstWindowY: 68.7,
  columnPitch: 2.8,
  floorPitch: 3.35,
  windowWidth: 2.34,
  windowHeight: 2.82,
  windowZ: 7.29,
} as const;

export const WINDOW_COUNT = ROWS * COLS;

export function windowPosition(row: number, column: number): [number, number, number] {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= ROWS || column < 0 || column >= COLS) throw new RangeError('Window coordinates are outside the 17 by 9 facade.');
  return [(column - (COLS - 1) / 2) * TOWER.columnPitch, TOWER.firstWindowY - row * TOWER.floorPitch, TOWER.windowZ];
}

export type CameraView = 'full' | 'windows' | 'river';
export interface CameraPreset { target: [number, number, number]; position: [number, number, number]; fov: number; minDistance: number; maxDistance: number; }

export function cameraPreset(view: CameraView, aspect: number): CameraPreset {
  // Vertical framing remains stable on desktop. Portrait screens pull back just
  // enough to preserve both architectural edges, without stretching the tower.
  const portrait = Math.max(1, 0.73 / Math.max(0.35, aspect));
  if (view === 'windows') return { target: [0, 42, 7], position: [2.8 * portrait, 44, 113 * portrait], fov: 35, minDistance: 62, maxDistance: 185 };
  if (view === 'river') return { target: [0, 34, 0], position: [77 * portrait, 44, 179 * portrait], fov: 39, minDistance: 120, maxDistance: 255 };
  return { target: [0, 38, 0], position: [62 * portrait, 50, 137 * portrait], fov: 35, minDistance: 95, maxDistance: 225 };
}
