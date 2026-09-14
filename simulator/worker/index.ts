import { FPS, ROWS, COLS, TURN_MS, type Clip, type PongState, type ProjectKind } from '../shared/contracts';
import { displayFrame } from '../shared/display';
import { weatherScene } from '../shared/weather';
import { exampleClips, redSoxScoreScene } from '../shared/render';
import { advancePong, createPong } from '../shared/pong';
import { advanceMario, applyMarioInput, createMario, renderMario, type MarioState } from '../shared/mario';
import { ApiFailure, checkPrompt, generateAnimation, PREVIEW_TTL_MS, validateRenderedScene, type AIBinding } from './generation';
import { createOpenRouterAI } from './openrouter';
import { createValidationService } from './validator';
import { generateImageAnimation, wantsImage } from './images';
import { RedSoxScoreService, SCORE_PREVIEW_TTL_MS, scoreDescription } from './scores';
import { WeatherService, WEATHER_PREVIEW_TTL_MS, weatherDescription } from './weather';
import { advance, initialSchedule, isReserved, migrateSchedule, QUEUE_LIMIT, removeWaiting, reschedule, showState, stopCurrent, type Schedule } from './schedule';

export interface Env {
  SHOW: DurableObjectNamespace;
  ASSETS: Fetcher;
  AI?: AIBinding;
  OPENROUTER_API_KEY?: string;
  VALIDATOR_URL?: string;
  VALIDATOR_TOKEN?: string;
  ADMIN_TOKEN?: string;
  DISPLAY_RUNNER_TOKEN?: string;
}
interface StoredClip { clip: Clip; owner: string | null; catalogId?: string; }
interface Receipt { id: string; clipId: string; kind?: ProjectKind; at: number; }
interface Data {
  version: 1;
  schedule: Schedule;
  clips: Record<string, StoredClip>;
  examples: string[];
  receipts: Record<string, Receipt>;
  limits: Record<string, number[]>;
  pong?: { entryId: string; state: PongState; lastSequence: number };
  mario?: { entryId: string; state: MarioState; lastSequence: number };
  display?: { connected: boolean; lastSeenAt: number };
}
const COOKIE = 'htb_visitor';
const BODY_LIMIT = 4096;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const PONG_CLIP_ID = 'project-pong';
const MARIO_CLIP_ID = 'project-mario';

function marioClip(now: number): Clip {
  return { id: MARIO_CLIP_ID, title: 'Super Mario', interpretation: 'A tiny platform adventure: run, jump, collect coins and reach the flag in your 30-second turn.', source: 'example', createdAt: now, expiresAt: 0,
    scene: { version: 1, background: '#030711', layers: [], raster: { motion: 'still', pixels: renderMario(createMario(now, 1)) } } };
}

function pongClip(now: number): Clip {
  return { id: PONG_CLIP_ID, title: 'Pong', interpretation: 'Play the bottom paddle against the computer for a 30-second turn.', source: 'example', createdAt: now, expiresAt: 0,
    scene: { version: 1, background: '#030711', layers: [
      { shape: 'line', color: '#56cfff', x: 4, y: 1, size: 3, motion: 'still', speed: 0, phase: 0 },
      { shape: 'line', color: '#fb709a', x: 4, y: 15, size: 3, motion: 'still', speed: 0, phase: 0 },
      { shape: 'circle', color: '#ffffff', x: 4, y: 8, size: 0.8, motion: 'still', speed: 0, phase: 0 },
    ] } };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function errorResponse(error: unknown): Response {
  const failure = error instanceof ApiFailure ? error : new ApiFailure(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  const response = json({ error: failure.message, code: failure.code, ...(failure.retryAfter ? { retryAfter: failure.retryAfter } : {}) }, failure.status);
  if (failure.retryAfter) response.headers.set('Retry-After', String(failure.retryAfter));
  return response;
}
function assertId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new ApiFailure(400, 'INVALID_REQUEST', `A valid ${field} is required.`);
  return value;
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiFailure(415, 'INVALID_CONTENT_TYPE', 'Send this request as JSON.');
  if (Number(request.headers.get('content-length')) > BODY_LIMIT) throw new ApiFailure(413, 'BODY_TOO_LARGE', 'The request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiFailure(400, 'INVALID_JSON', 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > BODY_LIMIT) { await reader.cancel(); throw new ApiFailure(413, 'BODY_TOO_LARGE', 'The request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  try {
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body as Record<string, unknown>;
  } catch { throw new ApiFailure(400, 'INVALID_JSON', 'The request body must be a JSON object.'); }
}

export function checkOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('origin');
  const sameOrigin = origin === new URL(request.url).origin;
  // Authenticated operator tools can omit Origin, but never send a foreign one.
  const operatorTool = ['/api/admin', '/api/display/status'].includes(new URL(request.url).pathname) && !origin && request.headers.get('authorization')?.startsWith('Bearer ');
  if ((!sameOrigin && !operatorTool) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiFailure(403, 'CROSS_ORIGIN', 'Use this website to send your request.');
}

/** Account for all buckets atomically; cookie rotation cannot reset IP/global limits. */
export function consumeGenerationLimits(limits: Record<string, number[]>, owner: string, ipHash: string, now: number): void {
  const buckets: [string, number, number][] = [
    [`session-minute:${owner}`, 60_000, 4], [`session-hour:${owner}`, 3_600_000, 12],
    // A hackathon crowd may share one Wi-Fi public address.
    [`ip:${ipHash}`, 600_000, 120], ['global-minute', 60_000, 30], ['global-day', 86_400_000, 1200],
  ];
  const next = buckets.map(([key, window, max]) => {
    const existing = (limits[key] ?? []).filter(time => time > now - window);
    if (existing.length >= max) throw new ApiFailure(429, 'RATE_LIMITED', 'A few too many previews at once. Please wait before trying again.', Math.max(1, Math.ceil((existing[0] + window - now) / 1000)));
    return { key, values: [...existing, now] };
  });
  next.forEach(({ key, values }) => { limits[key] = values; });
}

export function consumeMutationLimits(limits: Record<string, number[]>, owner: string, ipHash: string, now: number): void {
  const buckets: [string, number][] = [[`write-session:${owner}`, 40], [`write-ip:${ipHash}`, 300], ['write-global', 600]];
  const updates = buckets.map(([key, maximum]) => {
    const values = (limits[key] ?? []).filter(time => time > now - 60_000);
    if (values.length >= maximum) throw new ApiFailure(429, 'RATE_LIMITED', 'Please wait a moment before making another change.', Math.max(1, Math.ceil((values[0] + 60_000 - now) / 1000)));
    return { key, values: [...values, now] };
  });
  updates.forEach(({ key, values }) => { limits[key] = values; });
}

export function consumePongInputLimits(limits: Record<string, number[]>, owner: string, now: number): void {
  const updates = ([['pong-second', 1000, 20], ['pong-minute', 60_000, 1200]] as const).map(([prefix, window, maximum]) => {
    const key = `${prefix}:${owner}`, values = (limits[key] ?? []).filter(time => time > now - window);
    if (values.length >= maximum) throw new ApiFailure(429, 'INPUT_RATE_LIMITED', 'Paddle updates are arriving too quickly. Please slow down.', 1);
    return { key, values: [...values, now] };
  });
  updates.forEach(({ key, values }) => { limits[key] = values; });
}

export function boundReceipts(receipts: Record<string, Receipt>, activeIds: Set<string>): void {
  const ordered = Object.entries(receipts).sort((a, b) => a[1].at - b[1].at);
  let remaining = ordered.length;
  for (const [key, receipt] of ordered) {
    if (remaining <= 2000) break;
    if (!activeIds.has(receipt.id)) { delete receipts[key]; remaining--; }
  }
}

function tokenMatches(received: string, expected: string): boolean {
  if (!expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

export class BuildingShow {
  private data!: Data;
  private ready: Promise<void>;
  private lock: Promise<unknown> = Promise.resolve();
  private scores = new RedSoxScoreService();
  private weather = new WeatherService();
  constructor(private ctx: DurableObjectState, private env: Env) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.data = await ctx.storage.get<Data>('show') ?? { version: 1, schedule: initialSchedule(Date.now()), clips: {}, examples: [], receipts: {}, limits: {} };
      const before = JSON.stringify(this.data.schedule);
      migrateSchedule(this.data.schedule, Date.now());
      if (JSON.stringify(this.data.schedule) !== before) await ctx.storage.put('show', this.data);
    });
  }
  private async state<T>(action: (now: number) => T): Promise<T> {
    await this.ready;
    const operation = this.lock.then(async () => {
      const before = JSON.stringify(this.data);
      const now = Date.now();
      // A missing runner heartbeat must stop the schedule before it consumes turns.
      if (this.env.DISPLAY_RUNNER_TOKEN && !this.displayConnected(now) && !this.data.schedule.paused) {
        this.data.schedule.paused = true;
        stopCurrent(this.data.schedule, now);
      }
      advance(this.data.schedule, now);
      this.syncPong(now);
      this.syncMario(now);
      this.prune(now);
      try { return action(now); }
      finally {
        if (JSON.stringify(this.data) !== before) {
          try { await this.ctx.storage.put('show', this.data); }
          catch (error) { this.data = JSON.parse(before) as Data; throw error; }
        }
        const schedule = this.data.schedule;
        if (!schedule.paused && (schedule.current || schedule.queue.length)) await this.ctx.storage.setAlarm(Math.max(now + 1, Math.min(schedule.phaseEndsAt, this.env.DISPLAY_RUNNER_TOKEN ? now + 1000 : Infinity)));
        else await this.ctx.storage.deleteAlarm();
      }
    });
    this.lock = operation.catch(() => undefined);
    return operation;
  }
  private syncPong(now: number): void {
    const current = this.data.schedule.current;
    if (this.data.schedule.paused || current?.kind !== 'pong') { delete this.data.pong; return; }
    if (this.data.pong?.entryId !== current.id) {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
      this.data.pong = { entryId: current.id, state: createPong(current.scheduledAt, seed), lastSequence: -1 };
    }
    if (now - this.data.pong.state.tickAt >= 125) this.data.pong.state = advancePong(this.data.pong.state, now);
  }
  private syncMario(now: number): void {
    const current = this.data.schedule.current;
    if (this.data.schedule.paused || current?.kind !== 'mario') { delete this.data.mario; return; }
    if (this.data.mario?.entryId !== current.id) this.data.mario = { entryId: current.id, state: createMario(current.scheduledAt, crypto.getRandomValues(new Uint32Array(1))[0] || 1), lastSequence: -1 };
    this.data.mario.state = advanceMario(this.data.mario.state, now);
  }
  private isCuratedExample(id: string, stored: StoredClip): boolean {
    return stored.owner === null && stored.clip.source === 'example' && this.data.examples.includes(id);
  }
  private reconcileExamples(now: number): Clip[] {
    return exampleClips().map(example => {
      const existingId = this.data.examples.find(id => {
        const stored = this.data.clips[id];
        return stored && this.isCuratedExample(id, stored)
          && (!stored.catalogId || stored.catalogId === example.id)
          && stored.clip.title === example.title
          && stored.clip.interpretation === example.interpretation
          && JSON.stringify(stored.clip.scene) === JSON.stringify(example.scene);
      });
      if (existingId) {
        const stored = this.data.clips[existingId];
        stored.catalogId = example.id;
        return stored.clip;
      }
      const clip: Clip = { ...example, id: `example_${crypto.randomUUID()}`, scene: validateRenderedScene(example.scene), source: 'example', createdAt: now, expiresAt: 0 };
      this.data.clips[clip.id] = { clip, owner: null, catalogId: example.id };
      // Retain previous versions for visitors with an already-approved preview.
      // The response contains the current catalog; this registry records trust.
      this.data.examples.push(clip.id);
      return clip;
    });
  }
  private prune(now: number): void {
    for (const [id, stored] of Object.entries(this.data.clips)) {
      // Migrate existing server-owned examples without invalidating open-page IDs.
      if (this.isCuratedExample(id, stored)) stored.clip.expiresAt = 0;
      else if (stored.clip.expiresAt > 0 && stored.clip.expiresAt <= now) delete this.data.clips[id];
    }
    for (const [key, receipt] of Object.entries(this.data.receipts)) if (receipt.at < now - 86_400_000) delete this.data.receipts[key];
    for (const [key, timestamps] of Object.entries(this.data.limits)) {
      const window = key === 'global-day' ? 86_400_000 : key.startsWith('session-hour:') ? 3_600_000 : key.startsWith('ip:') ? 600_000 : key.startsWith('pong-second:') ? 1000 : 60_000;
      this.data.limits[key] = timestamps.filter(time => time > now - window);
      if (!this.data.limits[key].length) delete this.data.limits[key];
    }
  }
  private publicState(owner: string, now: number) {
    this.syncPong(now);
    this.syncMario(now);
    return { ...showState(this.data.schedule, owner, now, !!(this.env.OPENROUTER_API_KEY || this.env.AI)),
      pong: this.data.pong ? { entryId: this.data.pong.entryId, state: { ...this.data.pong.state } } : null,
      mario: this.data.mario ? { entryId: this.data.mario.entryId, state: structuredClone(this.data.mario.state) } : null,
      display: { configured: !!this.env.DISPLAY_RUNNER_TOKEN, connected: this.displayConnected(now), lastSeenAt: this.data.display?.lastSeenAt ?? null } };
  }

  private displayConnected(now: number): boolean {
    return !!this.data.display?.connected && now - this.data.display.lastSeenAt < 3500;
  }

  private authorizeDisplay(request: Request): void {
    if (!this.env.DISPLAY_RUNNER_TOKEN) throw new ApiFailure(503, 'DISPLAY_FEED_UNAVAILABLE', 'The display runner is not configured.');
    const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
    if (!tokenMatches(token, this.env.DISPLAY_RUNNER_TOKEN)) throw new ApiFailure(401, 'UNAUTHORIZED', 'Display runner authorization is required.');
  }

  async alarm(): Promise<void> { await this.state(() => undefined); }

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      const owner = request.headers.get('x-htb-visitor') ?? '';
      const ipHash = request.headers.get('x-htb-ip') ?? '';
      if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-f0-9]{64}$/.test(ipHash)) throw new ApiFailure(403, 'INVALID_SESSION', 'Reload the website to start a session.');
      if (request.method === 'GET') {
        if (path === '/api/health') return json({ ok: true, generationAvailable: !!(this.env.OPENROUTER_API_KEY || this.env.AI), imageGenerationAvailable: !!this.env.OPENROUTER_API_KEY, generationProvider: this.env.OPENROUTER_API_KEY ? 'openrouter' : 'workers-ai', mode: 'simulator' });
        if (path === '/api/state') return json(await this.state(now => this.publicState(owner, now)));
        if (path === '/api/examples') return json(await this.state(now => ({ clips: this.reconcileExamples(now) })));
        if (path === '/api/display/frame') {
          this.authorizeDisplay(request);
          return json(await this.state(now => {
            const schedule = this.data.schedule;
            const current = schedule.paused ? null : schedule.current;
            const scene = current?.kind === 'animation' ? current.clip.scene : null;
            const intrinsicMotion = new Set(['wave', 'rain', 'sparkles', 'rocket']);
            const isStatic = schedule.paused || !!scene && !scene.text && scene.layers.every(layer => layer.motion === 'still' && !intrinsicMotion.has(layer.shape)) && (!scene.raster || scene.raster.motion === 'still');
            const frame = schedule.paused
              ? Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => [0, 0, 0]))
              : displayFrame({ scene, startedAt: current?.scheduledAt ?? schedule.phaseStartedAt, clockOffset: 0, paused: false, preview: false, durationMs: current?.durationMs, pong: current?.kind === 'pong' ? this.data.pong?.state : null, mario: current?.kind === 'mario' ? this.data.mario?.state : null }, now);
            return { frame, static: isStatic, sequence: isStatic ? 0 : Math.floor(now * FPS / 1000),
              displayId: schedule.paused ? 'paused' : current ? `turn:${current.id}` : 'house-lights',
              mode: schedule.paused ? 'paused' : current?.kind ?? 'invitation', generatedAt: now };
          }));
        }
        throw new ApiFailure(404, 'NOT_FOUND', 'This endpoint does not exist.');
      }
      if (request.method !== 'POST') throw new ApiFailure(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.');
      const body = await readBody(request);
      if (path === '/api/display/status') {
        this.authorizeDisplay(request);
        if (typeof body.connected !== 'boolean') throw new ApiFailure(400, 'INVALID_REQUEST', 'A display connection state is required.');
        return json(await this.state(now => {
          this.data.display = { connected: body.connected as boolean, lastSeenAt: now };
          if (!body.connected) { this.data.schedule.paused = true; stopCurrent(this.data.schedule, now); }
          return { ok: true, paused: this.data.schedule.paused };
        }));
      }
      if (path === '/api/weather') {
        await this.state(now => {
          if (Object.keys(this.data.clips).length >= 250) throw new ApiFailure(503, 'PREVIEW_CAPACITY', 'The preview gallery is busy. Please try again shortly.');
          consumeMutationLimits(this.data.limits, owner, ipHash, now);
        });
        const weather = await this.weather.get(Date.now());
        const description = weatherDescription(weather);
        return json(await this.state(now => {
          const existing = Object.values(this.data.clips).find(stored => stored.owner === owner && stored.clip.id.startsWith('weather_') && stored.clip.interpretation === description.interpretation && stored.clip.expiresAt > now);
          if (existing) return { clip: existing.clip };
          if (Object.keys(this.data.clips).length >= 250) throw new ApiFailure(503, 'PREVIEW_CAPACITY', 'The preview gallery is busy. Please try again shortly.');
          const clip: Clip = { ...description, id: `weather_${crypto.randomUUID()}`, source: 'example', createdAt: now, expiresAt: now + WEATHER_PREVIEW_TTL_MS, scene: validateRenderedScene(weatherScene(weather)) };
          this.data.clips[clip.id] = { clip, owner };
          return { clip };
        }));
      }
      if (path === '/api/red-sox') {
        await this.state(now => {
          if (Object.keys(this.data.clips).length >= 250) throw new ApiFailure(503, 'PREVIEW_CAPACITY', 'The preview gallery is busy. Please try again shortly.');
          consumeMutationLimits(this.data.limits, owner, ipHash, now);
        });
        // MLB requests never block the shared queue or authoritative Pong physics.
        const score = await this.scores.get(Date.now());
        const description = scoreDescription(score);
        return json(await this.state(now => {
          const existing = Object.values(this.data.clips).find(stored => stored.owner === owner && stored.clip.id.startsWith('score_') && stored.clip.interpretation === description.interpretation && stored.clip.expiresAt > now);
          if (existing) return { clip: existing.clip };
          if (Object.keys(this.data.clips).length >= 250) throw new ApiFailure(503, 'PREVIEW_CAPACITY', 'The preview gallery is busy. Please try again shortly.');
          const clip: Clip = { ...description, id: `score_${crypto.randomUUID()}`, source: 'example', createdAt: now, expiresAt: now + SCORE_PREVIEW_TTL_MS,
            scene: validateRenderedScene(redSoxScoreScene({ bostonScore: score.boston.score, opponentScore: score.opponent.score })) };
          // Time-sensitive snapshots belong to one visitor and never enter the timeless catalog.
          this.data.clips[clip.id] = { clip, owner };
          return { clip };
        }));
      }
      if (path === '/api/preview') {
        const prompt = checkPrompt(body.prompt);
        const ai = this.env.OPENROUTER_API_KEY ? createOpenRouterAI(this.env.OPENROUTER_API_KEY) : this.env.AI;
        if (!ai) throw new ApiFailure(503, 'GENERATION_UNAVAILABLE', 'AI generation is unavailable right now. You can still try a curated example.');
        await this.state(now => {
          // Avoid paid inference when a preview cannot be stored; check again after it completes.
          if (Object.keys(this.data.clips).length >= 250) throw new ApiFailure(503, 'PREVIEW_CAPACITY', 'The preview gallery is busy. Please try again shortly.');
          consumeGenerationLimits(this.data.limits, owner, ipHash, now);
        });
        const validator = this.env.VALIDATOR_URL ? createValidationService(this.env.VALIDATOR_URL, this.env.VALIDATOR_TOKEN) : undefined;
        // Network inference does not hold the scheduler lock or delay other visitors.
        const generated = this.env.OPENROUTER_API_KEY && wantsImage(prompt)
          ? await generateImageAnimation(ai, this.env.OPENROUTER_API_KEY, prompt, this.env.ASSETS, { validator })
          : await generateAnimation(ai, prompt, { validator });
        return json(await this.state(now => {
          if (Object.keys(this.data.clips).length >= 250) throw new ApiFailure(503, 'PREVIEW_CAPACITY', 'The preview gallery is busy. Please try again shortly.');
          const clip: Clip = { ...generated, id: crypto.randomUUID(), source: 'ai', createdAt: now, expiresAt: now + PREVIEW_TTL_MS };
          this.data.clips[clip.id] = { clip, owner };
          return { clip };
        }));
      }
      return json(await this.state(now => {
        const schedule = this.data.schedule;
        if (['/api/submit', '/api/pong/join', '/api/mario/join', '/api/cancel', '/api/vote'].includes(path)) consumeMutationLimits(this.data.limits, owner, ipHash, now);
        if (path === '/api/submit' || path === '/api/pong/join' || path === '/api/mario/join') {
          const kind: ProjectKind = path === '/api/pong/join' ? 'pong' : path === '/api/mario/join' ? 'mario' : 'animation';
          const clipId = kind === 'pong' ? PONG_CLIP_ID : kind === 'mario' ? MARIO_CLIP_ID : assertId(body.clipId, 'clip ID');
          const requestId = assertId(body.requestId, 'request ID');
          const key = `${owner}:${requestId}`;
          const receipt = this.data.receipts[key];
          if (receipt) {
            if (receipt.clipId !== clipId || (receipt.kind ?? 'animation') !== kind) throw new ApiFailure(409, 'REQUEST_ID_CONFLICT', 'Use a new request ID for a different project or preview.');
            return { id: receipt.id, state: this.publicState(owner, now) };
          }
          if (schedule.paused) throw new ApiFailure(503, 'SHOW_PAUSED', 'The show is paused. Keep your preview and try again when it resumes.');
          if (schedule.current?.owner === owner || schedule.queue.some(item => item.owner === owner)) throw new ApiFailure(409, 'ALREADY_QUEUED', 'You already have a turn in the show.');
          if (schedule.queue.length >= QUEUE_LIMIT) throw new ApiFailure(409, 'QUEUE_FULL', 'The queue is full. Keep your preview and try again after a turn finishes.');
          let clip: Clip;
          if (kind === 'pong') clip = pongClip(now);
          else if (kind === 'mario') clip = marioClip(now);
          else {
            const stored = Object.hasOwn(this.data.clips, clipId) ? this.data.clips[clipId] : undefined;
            const timelessExample = stored && stored.clip.expiresAt === 0 && this.isCuratedExample(clipId, stored);
            if (!stored || (!timelessExample && !(stored.clip.expiresAt > now)) || (stored.owner !== null && stored.owner !== owner)) throw new ApiFailure(404, 'PREVIEW_EXPIRED', 'This preview has expired or belongs to another visitor. Create a new preview.');
            clip = structuredClone(stored.clip);
          }
          const id = crypto.randomUUID();
          schedule.queue.push({ id, owner, kind, durationMs: TURN_MS, clip, submittedAt: now, scheduledAt: 0, voters: [] });
          reschedule(schedule, now);
          this.data.receipts[key] = { id, clipId, kind, at: now };
          boundReceipts(this.data.receipts, new Set([...schedule.queue.map(item => item.id), ...(schedule.current ? [schedule.current.id] : [])]));
          return { id, state: this.publicState(owner, now) };
        }
        if (path === '/api/mario/input') {
          const id = assertId(body.id, 'turn ID'), current = schedule.current;
          if (schedule.paused || current?.kind !== 'mario' || current.id !== id || this.data.mario?.entryId !== id) throw new ApiFailure(409, 'MARIO_NOT_ACTIVE', 'That Super Mario turn is not active.');
          if (current.owner !== owner) throw new ApiFailure(403, 'MARIO_NOT_OWNER', 'Only the active player can control this game.');
          if ((body.direction !== -1 && body.direction !== 0 && body.direction !== 1) || typeof body.jump !== 'boolean' || typeof body.sequence !== 'number' || !Number.isSafeInteger(body.sequence) || body.sequence < 0) throw new ApiFailure(400, 'INVALID_MARIO_INPUT', 'Send a valid direction, jump and sequence number.');
          consumePongInputLimits(this.data.limits, owner, now);
          if (body.sequence <= this.data.mario.lastSequence) return this.publicState(owner, now);
          this.data.mario.state = applyMarioInput(this.data.mario.state, { direction: body.direction, jump: body.jump }, now);
          this.data.mario.lastSequence = body.sequence;
          return this.publicState(owner, now);
        }
        if (path === '/api/pong/input') {
          const id = assertId(body.id, 'turn ID');
          const current = schedule.current;
          if (schedule.paused || current?.kind !== 'pong' || current.id !== id || this.data.pong?.entryId !== id) throw new ApiFailure(409, 'PONG_NOT_ACTIVE', 'That Pong turn is not active.');
          if (current.owner !== owner) throw new ApiFailure(403, 'PONG_NOT_OWNER', 'Only the player whose turn is active can move this paddle.');
          if (typeof body.x !== 'number' || !Number.isInteger(body.x) || body.x < 0 || body.x > 6 || typeof body.sequence !== 'number' || !Number.isSafeInteger(body.sequence) || body.sequence < 0) throw new ApiFailure(400, 'INVALID_PONG_INPUT', 'Send a paddle position from 0 to 6 and a valid sequence number.');
          consumePongInputLimits(this.data.limits, owner, now);
          if (body.sequence <= this.data.pong.lastSequence) return this.publicState(owner, now);
          this.data.pong.state = advancePong(this.data.pong.state, now);
          this.data.pong.state.bottomX = body.x;
          this.data.pong.lastSequence = body.sequence;
          return this.publicState(owner, now);
        }
        if (path === '/api/cancel') {
          const id = assertId(body.id, 'submission ID');
          const item = schedule.queue.find(entry => entry.id === id && entry.owner === owner);
          if (!item) throw new ApiFailure(404, 'NOT_WAITING', 'Your turn is no longer waiting in the queue.');
          if (isReserved(schedule, id, now)) throw new ApiFailure(409, 'TURN_RESERVED', 'Your turn is starting. It can no longer be canceled.');
          removeWaiting(schedule, id, now);
          return this.publicState(owner, now);
        }
        if (path === '/api/vote') {
          const id = assertId(body.id, 'submission ID');
          const item = schedule.queue.find(entry => entry.id === id);
          if (!item) throw new ApiFailure(404, 'NOT_WAITING', 'That turn is no longer waiting in the queue.');
          const index = item.voters.indexOf(owner);
          if (index >= 0) item.voters.splice(index, 1);
          else {
            if (item.voters.length >= 500) throw new ApiFailure(429, 'REACTION_LIMIT', 'This turn has reached the reaction limit.');
            item.voters.push(owner);
          }
          return this.publicState(owner, now);
        }
        if (path === '/api/admin') {
          if (!this.env.ADMIN_TOKEN) throw new ApiFailure(503, 'ADMIN_UNAVAILABLE', 'Operator controls are not configured.');
          const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
          if (!tokenMatches(token, this.env.ADMIN_TOKEN)) throw new ApiFailure(401, 'UNAUTHORIZED', 'Operator authorization is required.');
          if (body.action === 'pause') { schedule.paused = true; stopCurrent(schedule, now); }
          else if (body.action === 'resume') {
            if (this.env.DISPLAY_RUNNER_TOKEN && !this.displayConnected(now)) throw new ApiFailure(503, 'DISPLAY_DISCONNECTED', 'Reconnect the Sundai simulator before resuming the show.');
            if (schedule.paused) { schedule.paused = false; stopCurrent(schedule, now); }
          }
          else if (body.action === 'skip') {
            if (schedule.current) stopCurrent(schedule, now);
            else if (schedule.queue[0]) removeWaiting(schedule, schedule.queue[0].id, now);
          } else if (body.action === 'remove') {
            if (!removeWaiting(schedule, assertId(body.id, 'submission ID'), now)) throw new ApiFailure(404, 'NOT_WAITING', 'That turn is no longer waiting in the queue.');
          } else throw new ApiFailure(400, 'INVALID_ACTION', 'Choose pause, resume, skip, or remove.');
          return this.publicState(owner, now);
        }
        throw new ApiFailure(404, 'NOT_FOUND', 'This endpoint does not exist.');
      }));
    } catch (error) { return errorResponse(error); }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let cookie: string | undefined;
    let response: Response;
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      checkOrigin(request);
      const existing = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      const owner = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (owner !== existing) cookie = `${COOKIE}=${owner}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${url.protocol === 'https:' ? '; Secure' : ''}`;
      const ipHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`htb-rate-v1:${request.headers.get('cf-connecting-ip') ?? 'local-shared'}`))), byte => byte.toString(16).padStart(2, '0')).join('');
      const headers = new Headers(request.headers);
      headers.set('x-htb-visitor', owner);
      headers.set('x-htb-ip', ipHash);
      headers.delete('cookie');
      headers.delete('cf-connecting-ip');
      const stub = env.SHOW.get(env.SHOW.idFromName('public-show-v1'));
      response = await stub.fetch(new Request(request, { headers }));
    } catch (error) { response = errorResponse(error); }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (cookie) headers.append('Set-Cookie', cookie);
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
