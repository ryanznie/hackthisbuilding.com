import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import worker, { BuildingShow, type Env } from '../worker/index';
import { COLS, ROWS, TURN_MS, type Clip, type Frame, type Scene, type ShowState } from '../shared/contracts';
import { displayFrame } from '../shared/display';
import { exampleClips } from '../shared/render';
import { initialSchedule, type Entry } from '../worker/schedule';

const ORIGIN = 'https://hackthisbuilding.com';
const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const RUNNER_TOKEN = 'test-display-secret-never-public';
const ADMIN_TOKEN = 'test-admin-secret-never-public';
const NOW = Date.parse('2026-09-13T20:00:00Z');
const stillScene: Scene = { version: 1, background: '#030711', layers: [
  { shape: 'heart', color: '#ff386f', x: 4, y: 8, size: 5, motion: 'still', speed: 0.7, phase: 0 },
] };
interface Feed { frame: Frame; static: boolean; sequence: number; displayId: string; mode: string; generatedAt: number; }

function makeEntry(id: string, scene = stillScene, owner = OWNER, start = NOW - 1000): Entry {
  const clip: Clip = { id: `clip-${id}`, title: id, interpretation: 'Approved display art.', scene: structuredClone(scene), source: 'example', createdAt: NOW - 2000, expiresAt: 0 };
  return { id, owner, kind: 'animation', durationMs: TURN_MS, clip, submittedAt: NOW - 2000, scheduledAt: start, voters: [OTHER] };
}

function setup(t: TestContext, options: { scene?: Scene; idle?: boolean; configured?: boolean } = {}) {
  let now = NOW;
  t.mock.method(Date, 'now', () => now);
  const schedule = initialSchedule(NOW - 1000);
  if (!options.idle) {
    schedule.current = makeEntry('active', options.scene);
    schedule.phaseEndsAt = schedule.current.scheduledAt + TURN_MS;
    schedule.queue = [makeEntry('waiting', stillScene, OTHER, schedule.phaseEndsAt)];
  }
  const initial = { version: 1, schedule, clips: {}, examples: [], receipts: { privateReceipt: { id: 'active', clipId: 'clip-active', at: NOW } },
    limits: { [`write-session:${OWNER}`]: [NOW] }, display: { connected: true, lastSeenAt: NOW } };
  const values = new Map<string, unknown>([['show', structuredClone(initial)]]);
  let alarmAt: number | null = null;
  const storage = {
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    setAlarm: async (when: number) => { alarmAt = when; }, deleteAlarm: async () => { alarmAt = null; },
  };
  const ctx = { storage, blockConcurrencyWhile: <T>(action: () => Promise<T>) => action() } as unknown as DurableObjectState;
  const env = { ADMIN_TOKEN, ...(options.configured === false ? {} : { DISPLAY_RUNNER_TOKEN: RUNNER_TOKEN }) } as Env;
  const show = new BuildingShow(ctx, env);
  env.SHOW = { idFromName: () => 'test-show', get: () => ({ fetch: (request: Request) => show.fetch(request) }) } as unknown as DurableObjectNamespace;
  const request = (path: string, options: { body?: unknown; raw?: string; method?: string; authorization?: string | null; origin?: string | null; headers?: Record<string, string> } = {}) => {
    const hasBody = options.body !== undefined || options.raw !== undefined;
    const headers = new Headers({ Cookie: `htb_visitor=${OWNER}`, 'CF-Connecting-IP': '192.0.2.5', ...options.headers });
    if (hasBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (options.authorization !== null) headers.set('Authorization', options.authorization ?? `Bearer ${RUNNER_TOKEN}`);
    if (options.origin !== undefined && options.origin !== null) headers.set('Origin', options.origin);
    return worker.fetch(new Request(`${ORIGIN}/api/${path}`, { method: options.method ?? (hasBody ? 'POST' : 'GET'), headers,
      ...(hasBody ? { body: options.raw ?? JSON.stringify(options.body) } : {}) }), env);
  };
  const state = async () => await (await request('state', { authorization: null })).json() as ShowState;
  const frame = async () => {
    const response = await request('display/frame'); assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return await response.json() as Feed;
  };
  return { request, frame, state, show, values, setNow: (value: number) => { now = value; }, getAlarm: () => alarmAt };
}

test('display endpoints require the configured runner Bearer token and reject foreign writes', async t => {
  const h = setup(t);
  for (const authorization of [null, 'Bearer incorrect', RUNNER_TOKEN, `Basic ${RUNNER_TOKEN}`, `Bearer ${RUNNER_TOKEN}x`]) {
    assert.equal((await h.request('display/frame', { authorization })).status, 401, String(authorization));
    // A same-origin request reaches the auth check even when authorization is absent.
    assert.equal((await h.request('display/status', { body: { connected: false }, authorization, origin: ORIGIN })).status, 401, String(authorization));
  }
  assert.equal((await h.request('display/status', { body: { connected: true }, origin: 'https://attacker.test' })).status, 403);
  assert.equal((await h.request('display/status', { body: { connected: true }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await h.request('display/status', { body: { connected: true } })).status, 200, 'native runner can omit Origin with valid Bearer auth');
  assert.equal((await h.state()).paused, false, 'denied requests do not disconnect the active show');
});

test('unconfigured display endpoints fail without revealing private configuration', async t => {
  const h = setup(t, { configured: false });
  for (const [path, options] of [['display/frame', {}], ['display/status', { body: { connected: true } }]] as const) {
    const response = await h.request(path, options);
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.match(text, /DISPLAY_FEED_UNAVAILABLE/);
    assert.ok(!text.includes(RUNNER_TOKEN) && !text.includes(ADMIN_TOKEN));
  }
});

test('display status validates bounded JSON and cannot accept forged connection timestamps', async t => {
  const h = setup(t);
  for (const body of [{}, { connected: 'true' }, { connected: 1 }]) assert.equal((await h.request('display/status', { body })).status, 400);
  assert.equal((await h.request('display/status', { raw: '{broken' })).status, 400);
  assert.equal((await h.request('display/status', { raw: '[]' })).status, 400);
  assert.equal((await h.request('display/status', { body: { connected: true }, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await h.request('display/status', { body: { connected: true, padding: 'x'.repeat(5000) } })).status, 413);
  assert.equal((await h.request('display/status', { body: { connected: true }, headers: { 'Content-Length': '5000' } })).status, 413);
  assert.equal((await h.request('display/status', { body: { connected: true, lastSeenAt: NOW + 999999 } })).status, 200);
  assert.equal((await h.state()).display?.lastSeenAt, NOW);
  assert.equal((await h.request('display/status', { method: 'PUT', body: {}, origin: ORIGIN })).status, 405);
});

test('display frame matches the shared renderer with 17 rows, 9 columns and 459 byte channels', async t => {
  const h = setup(t);
  const result = await h.frame();
  assert.equal(result.frame.length, ROWS);
  assert.ok(result.frame.every(row => row.length === COLS && row.every(pixel => pixel.length === 3)));
  const channels = result.frame.flat(2);
  assert.equal(channels.length, 459);
  assert.ok(channels.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
  assert.deepEqual(result.frame, displayFrame({ scene: stillScene, startedAt: NOW - 1000, clockOffset: 0, paused: false, preview: false, durationMs: TURN_MS }, NOW));
  assert.equal(result.mode, 'animation'); assert.equal(result.displayId, 'turn:active'); assert.equal(result.generatedAt, NOW);
  assert.equal(result.static, true); assert.equal(result.sequence, 0);
  h.setNow(NOW + 1500);
  assert.deepEqual((await h.frame()).frame, result.frame, 'a declared static scene must have identical pixels at another time');
});

test('intrinsic waves, rain, sparkles and rocket flame remain dynamic even with still layer motion', async t => {
  for (const shape of ['wave', 'rain', 'sparkles', 'rocket'] as const) {
    const scene: Scene = { ...stillScene, layers: [{ ...stillScene.layers[0], shape, size: shape === 'rocket' ? 7 : 10, speed: 0.8 }] };
    const h = setup(t, { scene });
    const first = await h.frame();
    assert.equal(first.static, false, shape);
    const observed = [JSON.stringify(first.frame)];
    for (const elapsed of [250, 750, 1500, 2500]) {
      h.setNow(NOW + elapsed);
      const next = await h.frame();
      assert.equal(next.static, false, shape);
      assert.ok(next.sequence > first.sequence, shape);
      assert.deepEqual(next.frame, displayFrame({ scene, startedAt: NOW - 1000, clockOffset: 0, paused: false, preview: false, durationMs: TURN_MS }, NOW + elapsed));
      observed.push(JSON.stringify(next.frame));
    }
    assert.ok(new Set(observed).size > 1, `${shape} actually changes pixels`);
    t.mock.restoreAll();
  }
});

test('still raster is static while pulsing raster, scrolling text and idle art remain dynamic', async t => {
  const raster = exampleClips().find(clip => clip.id === 'example-red-sox')!.scene;
  const variants: [Scene, boolean][] = [
    [raster, true], [{ ...raster, raster: { ...raster.raster!, motion: 'pulse' } }, false],
    [{ ...stillScene, text: { value: 'BOSTON', color: '#ffffff' } }, false],
  ];
  for (const [scene, isStatic] of variants) {
    const h = setup(t, { scene });
    assert.equal((await h.frame()).static, isStatic);
    t.mock.restoreAll();
  }
  const idle = setup(t, { idle: true });
  const result = await idle.frame();
  assert.equal(result.static, false); assert.equal(result.displayId, 'house-lights'); assert.equal(result.mode, 'invitation');
  assert.deepEqual(result.frame, displayFrame({ scene: null, startedAt: NOW - 1000, clockOffset: 0, paused: false, preview: false }, NOW));
});

test('runner disconnect pauses, blacks out output and retains waiting turns without completing interrupted play', async t => {
  const h = setup(t);
  const response = await h.request('display/status', { body: { connected: false } });
  assert.deepEqual(await response.json(), { ok: true, paused: true });
  const state = await h.state();
  assert.equal(state.paused, true); assert.equal(state.current, null); assert.equal(state.nextStartAt, null);
  assert.deepEqual(state.queue.map(item => [item.id, item.scheduledAt]), [['waiting', 0]]);
  assert.deepEqual(state.completed, []); assert.equal(state.display?.connected, false); assert.equal(h.getAlarm(), null);
  const feed = await h.frame();
  assert.ok(feed.frame.flat(2).every(channel => channel === 0));
  assert.equal(feed.static, true); assert.equal(feed.displayId, 'paused'); assert.equal(feed.mode, 'paused');
});

test('expired heartbeat pauses before catch-up can consume queued turns or mark interrupted playback complete', async t => {
  const h = setup(t);
  await h.frame();
  assert.ok(h.getAlarm()! <= NOW + 1000, 'active shows check runner liveness frequently');
  h.setNow(NOW + 3 * TURN_MS);
  await h.show.alarm();
  const state = await h.state();
  assert.equal(state.paused, true); assert.equal(state.current, null);
  assert.deepEqual(state.queue.map(item => item.id), ['waiting']);
  assert.deepEqual(state.completed, []); assert.equal(state.display?.connected, false);
  assert.equal(h.getAlarm(), null);
});

test('heartbeat expiry is enforced at its boundary; reconnect needs an explicit operator resume', async t => {
  const h = setup(t);
  h.setNow(NOW + 3499); assert.equal((await h.state()).paused, false);
  h.setNow(NOW + 3500); assert.equal((await h.state()).paused, true);
  const connected = await h.request('display/status', { body: { connected: true } });
  assert.deepEqual(await connected.json(), { ok: true, paused: true });
  const reconnected = await h.state();
  assert.equal(reconnected.display?.connected, true); assert.equal(reconnected.paused, true);
  assert.equal((await h.frame()).displayId, 'paused');
  const resumed = await h.request('admin', { body: { action: 'resume' }, authorization: `Bearer ${ADMIN_TOKEN}` });
  assert.equal(resumed.status, 200);
  const state = await resumed.json() as ShowState;
  assert.equal(state.paused, false); assert.equal(state.current, null);
  assert.equal(state.queue[0].scheduledAt, NOW + 3500 + 5000, 'waiting player receives a new five-second countdown');
});

test('public state and authorized frames omit runner secrets and private schedule ownership', async t => {
  const h = setup(t);
  const stateResponse = await h.request('state', { authorization: null });
  const text = await stateResponse.text();
  for (const privateValue of [RUNNER_TOKEN, ADMIN_TOKEN, OWNER, OTHER, 'privateReceipt', 'write-session:', '192.0.2.5']) assert.ok(!text.includes(privateValue), privateValue);
  const state = JSON.parse(text) as ShowState;
  assert.equal(state.current?.mine, true); assert.equal(state.queue[0].mine, false);
  assert.equal(state.current?.votes, 1);
  assert.deepEqual(Object.keys(state.display!).sort(), ['configured', 'connected', 'lastSeenAt']);
  const feed = await h.frame();
  assert.deepEqual(Object.keys(feed).sort(), ['displayId', 'frame', 'generatedAt', 'mode', 'sequence', 'static']);
});
