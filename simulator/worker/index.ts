import type { Clip } from '../shared/contracts';
import { exampleClips } from '../shared/render';
import { ApiFailure, checkPrompt, generateAnimation, PREVIEW_TTL_MS, validateRenderedScene, type AIBinding } from './generation';
import { createOpenRouterAI } from './openrouter';
import { createValidationService } from './validator';
import { advance, initialSchedule, isReserved, QUEUE_LIMIT, removeWaiting, reschedule, showState, stopCurrent, type Schedule } from './schedule';

export interface Env {
  SHOW: DurableObjectNamespace;
  ASSETS: Fetcher;
  AI?: AIBinding;
  OPENROUTER_API_KEY?: string;
  VALIDATOR_URL?: string;
  VALIDATOR_TOKEN?: string;
  ADMIN_TOKEN?: string;
}
interface StoredClip { clip: Clip; owner: string | null; catalogId?: string; }
interface Receipt { id: string; clipId: string; at: number; }
interface Data {
  version: 1;
  schedule: Schedule;
  clips: Record<string, StoredClip>;
  examples: string[];
  receipts: Record<string, Receipt>;
  limits: Record<string, number[]>;
}
const COOKIE = 'htb_visitor';
const BODY_LIMIT = 4096;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;

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
  const operatorTool = new URL(request.url).pathname === '/api/admin' && !origin && request.headers.get('authorization')?.startsWith('Bearer ');
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
  constructor(private ctx: DurableObjectState, private env: Env) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.data = await ctx.storage.get<Data>('show') ?? { version: 1, schedule: initialSchedule(Date.now()), clips: {}, examples: [], receipts: {}, limits: {} };
    });
  }
  private async state<T>(action: (now: number) => T): Promise<T> {
    await this.ready;
    const operation = this.lock.then(async () => {
      const before = JSON.stringify(this.data);
      const now = Date.now();
      advance(this.data.schedule, now);
      this.prune(now);
      try { return action(now); }
      finally {
        if (JSON.stringify(this.data) !== before) {
          try { await this.ctx.storage.put('show', this.data); }
          catch (error) { this.data = JSON.parse(before) as Data; throw error; }
        }
        const schedule = this.data.schedule;
        if (!schedule.paused && (schedule.current || schedule.queue.length)) await this.ctx.storage.setAlarm(Math.max(now + 1, schedule.phaseEndsAt));
        else await this.ctx.storage.deleteAlarm();
      }
    });
    this.lock = operation.catch(() => undefined);
    return operation;
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
      const window = key === 'global-day' ? 86_400_000 : key.startsWith('session-hour:') ? 3_600_000 : key.startsWith('ip:') ? 600_000 : 60_000;
      this.data.limits[key] = timestamps.filter(time => time > now - window);
      if (!this.data.limits[key].length) delete this.data.limits[key];
    }
  }
  private publicState(owner: string, now: number) { return showState(this.data.schedule, owner, now, !!(this.env.OPENROUTER_API_KEY || this.env.AI)); }

  async alarm(): Promise<void> { await this.state(() => undefined); }

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      const owner = request.headers.get('x-htb-visitor') ?? '';
      const ipHash = request.headers.get('x-htb-ip') ?? '';
      if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-f0-9]{64}$/.test(ipHash)) throw new ApiFailure(403, 'INVALID_SESSION', 'Reload the website to start a session.');
      if (request.method === 'GET') {
        if (path === '/api/health') return json({ ok: true, generationAvailable: !!(this.env.OPENROUTER_API_KEY || this.env.AI), imageGenerationAvailable: false, generationProvider: this.env.OPENROUTER_API_KEY ? 'openrouter-text' : 'workers-ai', mode: 'simulator' });
        if (path === '/api/state') return json(await this.state(now => this.publicState(owner, now)));
        if (path === '/api/examples') return json(await this.state(now => ({ clips: this.reconcileExamples(now) })));
        throw new ApiFailure(404, 'NOT_FOUND', 'This endpoint does not exist.');
      }
      if (request.method !== 'POST') throw new ApiFailure(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.');
      const body = await readBody(request);
      if (path === '/api/preview') {
        const prompt = checkPrompt(body.prompt);
        const ai = this.env.OPENROUTER_API_KEY ? createOpenRouterAI(this.env.OPENROUTER_API_KEY) : this.env.AI;
        if (!ai) throw new ApiFailure(503, 'GENERATION_UNAVAILABLE', 'AI generation is unavailable right now. You can still try a curated example.');
        await this.state(now => {
          // Avoid paid inference when a preview cannot be stored; check again after it completes.
          if (Object.keys(this.data.clips).length >= 250) throw new ApiFailure(503, 'PREVIEW_CAPACITY', 'The preview gallery is busy. Please try again shortly.');
          consumeGenerationLimits(this.data.limits, owner, ipHash, now);
        });
        // Network inference does not hold the scheduler lock or delay other visitors.
        const validator = this.env.VALIDATOR_URL ? createValidationService(this.env.VALIDATOR_URL, this.env.VALIDATOR_TOKEN) : undefined;
        const generated = await generateAnimation(ai, prompt, validator);
        return json(await this.state(now => {
          if (Object.keys(this.data.clips).length >= 250) throw new ApiFailure(503, 'PREVIEW_CAPACITY', 'The preview gallery is busy. Please try again shortly.');
          const clip: Clip = { ...generated, id: crypto.randomUUID(), source: 'ai', createdAt: now, expiresAt: now + PREVIEW_TTL_MS };
          this.data.clips[clip.id] = { clip, owner };
          return { clip };
        }));
      }
      return json(await this.state(now => {
        const schedule = this.data.schedule;
        if (['/api/submit', '/api/cancel', '/api/vote'].includes(path)) consumeMutationLimits(this.data.limits, owner, ipHash, now);
        if (path === '/api/submit') {
          const clipId = assertId(body.clipId, 'clip ID');
          const requestId = assertId(body.requestId, 'request ID');
          const key = `${owner}:${requestId}`;
          const receipt = this.data.receipts[key];
          if (receipt) {
            if (receipt.clipId !== clipId) throw new ApiFailure(409, 'REQUEST_ID_CONFLICT', 'Use a new request ID for a different preview.');
            return { id: receipt.id, state: this.publicState(owner, now) };
          }
          if (schedule.paused) throw new ApiFailure(503, 'SHOW_PAUSED', 'The show is paused. Keep your preview and try again when it resumes.');
          if (schedule.current?.owner === owner || schedule.queue.some(item => item.owner === owner)) throw new ApiFailure(409, 'ALREADY_QUEUED', 'You already have an animation in the show.');
          if (schedule.queue.length >= QUEUE_LIMIT) throw new ApiFailure(409, 'QUEUE_FULL', 'The queue is full. Keep your preview and try again after a turn finishes.');
          const stored = Object.hasOwn(this.data.clips, clipId) ? this.data.clips[clipId] : undefined;
          const timelessExample = stored && stored.clip.expiresAt === 0 && this.isCuratedExample(clipId, stored);
          if (!stored || (!timelessExample && !(stored.clip.expiresAt > now)) || (stored.owner !== null && stored.owner !== owner)) throw new ApiFailure(404, 'PREVIEW_EXPIRED', 'This preview has expired or belongs to another visitor. Create a new preview.');
          const id = crypto.randomUUID();
          schedule.queue.push({ id, owner, clip: structuredClone(stored.clip), submittedAt: now, scheduledAt: 0, voters: [] });
          reschedule(schedule, now);
          this.data.receipts[key] = { id, clipId, at: now };
          boundReceipts(this.data.receipts, new Set([...schedule.queue.map(item => item.id), ...(schedule.current ? [schedule.current.id] : [])]));
          return { id, state: this.publicState(owner, now) };
        }
        if (path === '/api/cancel') {
          const id = assertId(body.id, 'submission ID');
          const item = schedule.queue.find(entry => entry.id === id && entry.owner === owner);
          if (!item) throw new ApiFailure(404, 'NOT_WAITING', 'Your animation is no longer waiting in the queue.');
          if (isReserved(schedule, id, now)) throw new ApiFailure(409, 'TURN_RESERVED', 'Your turn is starting. It can no longer be canceled.');
          removeWaiting(schedule, id, now);
          return this.publicState(owner, now);
        }
        if (path === '/api/vote') {
          const id = assertId(body.id, 'submission ID');
          const item = schedule.queue.find(entry => entry.id === id);
          if (!item) throw new ApiFailure(404, 'NOT_WAITING', 'That animation is no longer waiting in the queue.');
          const index = item.voters.indexOf(owner);
          if (index >= 0) item.voters.splice(index, 1);
          else {
            if (item.voters.length >= 500) throw new ApiFailure(429, 'REACTION_LIMIT', 'This animation has reached the reaction limit.');
            item.voters.push(owner);
          }
          return this.publicState(owner, now);
        }
        if (path === '/api/admin') {
          if (!this.env.ADMIN_TOKEN) throw new ApiFailure(503, 'ADMIN_UNAVAILABLE', 'Operator controls are not configured.');
          const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
          if (!tokenMatches(token, this.env.ADMIN_TOKEN)) throw new ApiFailure(401, 'UNAUTHORIZED', 'Operator authorization is required.');
          if (body.action === 'pause') { schedule.paused = true; stopCurrent(schedule, now); }
          else if (body.action === 'resume') { if (schedule.paused) { schedule.paused = false; stopCurrent(schedule, now); } }
          else if (body.action === 'skip') {
            if (schedule.current) stopCurrent(schedule, now);
            else if (schedule.queue[0]) removeWaiting(schedule, schedule.queue[0].id, now);
          } else if (body.action === 'remove') {
            if (!removeWaiting(schedule, assertId(body.id, 'submission ID'), now)) throw new ApiFailure(404, 'NOT_WAITING', 'That animation is no longer waiting in the queue.');
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
