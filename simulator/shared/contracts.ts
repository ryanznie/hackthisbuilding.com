export const ROWS = 17;
export const COLS = 9;
export const FPS = 30;
export const CLIP_MS = 5000;
export const URL_PASS_MS = 12000;
export const DOMAIN = 'hackthisbuilding.com';
export type RGB = [number, number, number];
export type Frame = RGB[][];
export type Shape = 'heart' | 'star' | 'circle' | 'ring' | 'rectangle' | 'line' | 'rain' | 'sparkles' | 'wave' | 'rocket' | 'smile' | 'socks';
export type Motion = 'still' | 'pulse' | 'rise' | 'fall' | 'orbit' | 'sway' | 'spin';
export interface Layer { shape: Shape; color: string; x: number; y: number; size: number; motion: Motion; speed: number; phase: number; }
/** Opaque display pixels in top-to-bottom row order, then left-to-right columns. */
export interface Raster { pixels: RGB[][]; motion: 'still' | 'pulse'; }
export interface Scene { version: 1; background: string; layers: Layer[]; raster?: Raster; }
export interface Clip { id: string; title: string; interpretation: string; scene: Scene; createdAt: number; expiresAt: number; source: 'ai' | 'example'; }
export interface QueueItem { id: string; clip: Clip; submittedAt: number; votes: number; voted: boolean; mine: boolean; scheduledAt: number; }
export interface ShowState { serverTime: number; mode: 'simulator' | 'building'; paused: boolean; phase: 'invitation' | 'playing'; current: QueueItem | null; queue: QueueItem[]; phaseStartedAt: number; phaseEndsAt: number; nextStartAt: number | null; completed: {id: string; title: string; finishedAt: number}[]; viewers?: number; generationAvailable: boolean; queueLimit: number; }
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
// No client-supplied scene may be submitted; approved clips are server-stored.
