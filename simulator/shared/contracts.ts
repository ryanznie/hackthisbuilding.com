import type { MarioState } from './mario';

export const ROWS = 17;
export const COLS = 9;
export const FPS = 30;
export const CLIP_MS = 5000;
export const TURN_MS = 30000;
export const URL_PASS_MS = 12000;
export const DOMAIN = 'hackthisbuilding.com';
export type RGB = [number, number, number];
export type Frame = RGB[][];
export type Shape = 'heart' | 'star' | 'circle' | 'ring' | 'rectangle' | 'line' | 'rain' | 'sparkles' | 'wave' | 'rocket' | 'smile' | 'socks';
export type Motion = 'still' | 'pulse' | 'rise' | 'fall' | 'orbit' | 'sway' | 'spin';
export interface Layer { shape: Shape; color: string; x: number; y: number; size: number; motion: Motion; speed: number; phase: number; }
/** Opaque display pixels in top-to-bottom row order, then left-to-right columns. */
export interface Raster { pixels: RGB[][]; motion: 'still' | 'pulse'; }
export interface TextOverlay { value: string; color: string; }
export interface Scene { version: 1; background: string; layers: Layer[]; raster?: Raster; text?: TextOverlay; }
export interface Clip { id: string; title: string; interpretation: string; scene: Scene; createdAt: number; expiresAt: number; source: 'ai' | 'example'; }
export type ProjectKind = 'animation' | 'pong' | 'mario';
export interface PongState { tickAt: number; topX: number; bottomX: number; ballX: number; ballY: number; dx: number; dy: number; topScore: number; bottomScore: number; seed: number; }
export interface QueueItem { id: string; kind: ProjectKind; durationMs: number; clip: Clip; submittedAt: number; votes: number; voted: boolean; mine: boolean; scheduledAt: number; }
export interface ShowState { serverTime: number; mode: 'simulator' | 'building'; paused: boolean; phase: 'invitation' | 'playing'; current: QueueItem | null; queue: QueueItem[]; phaseStartedAt: number; phaseEndsAt: number; nextStartAt: number | null; completed: {id: string; title: string; finishedAt: number}[]; pong?: { entryId: string; state: PongState } | null; mario?: { entryId: string; state: MarioState } | null; display?: { configured: boolean; connected: boolean; lastSeenAt: number | null }; viewers?: number; generationAvailable: boolean; queueLimit: number; }
export interface PreviewResponse { clip: Clip; }
export interface ApiError { error: string; code?: string; retryAfter?: number; }
// API: all requests same-origin; server-issued HttpOnly visitor cookie.
// GET /api/state -> ShowState (personalized mine/voted); poll at 1s.
// POST /api/preview {prompt:string} -> PreviewResponse. Strictly real LLM, errors if unavailable.
// GET /api/examples -> {clips:Clip[]} (curated, explicitly example source).
// POST /api/submit {clipId:string,requestId:string} -> {id:string,state:ShowState}.
// POST /api/vote {id:string} -> ShowState (toggle own reaction; no reorder).
// POST /api/cancel {id:string} -> ShowState (own queued item only).
// GET /api/health -> {ok:boolean,generationAvailable:boolean,mode:string}.
// POST /api/admin {action:'pause'|'resume'|'skip'|'remove',id?:string}, Bearer ADMIN_TOKEN.
// POST /api/pong/join {requestId:string} -> {id:string,state:ShowState}.
// POST /api/pong/input {id:string,x:integer0to6,sequence:safeInteger} -> ShowState; current owner only.
// No client-supplied scene may be submitted; approved clips are server-stored.
