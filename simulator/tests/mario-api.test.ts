import assert from 'node:assert/strict';
import test from 'node:test';
import { BuildingShow, type Env } from '../worker/index';
import { TURN_MS, type Clip, type Frame, type ShowState } from '../shared/contracts';
import { renderMario } from '../shared/mario';

const OWNER = 'a'.repeat(64), OTHER = 'b'.repeat(64);
class MemoryStorage {
  value = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.value.get(key)) as T | undefined; }
  async put(key: string, value: unknown) { this.value.set(key, structuredClone(value)); }
  async setAlarm(time: number) { this.alarm = time; }
  async deleteAlarm() { this.alarm = null; }
}
function setup(extra: Partial<Env> = {}) {
  const storage = new MemoryStorage();
  const ctx = { storage, blockConcurrencyWhile: <T>(action: () => Promise<T>) => action() } as unknown as DurableObjectState;
  const env = { ADMIN_TOKEN: 'mario-test-admin', ...extra } as Env;
  return { show: new BuildingShow(ctx, env), storage, ctx, env };
}
function api(show: BuildingShow, path: string, visitor = OWNER, body?: unknown, token?: string) {
  return show.fetch(new Request(`https://hackthisbuilding.com/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-htb-visitor': visitor, 'x-htb-ip': 'c'.repeat(64), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
async function response<T>(request: Promise<Response>): Promise<T> {
  const result = await request;
  assert.equal(result.status, 200, await result.clone().text());
  return result.json() as Promise<T>;
}
type Joined = { id: string; state: ShowState };
const controls = (id: string, sequence: number, direction = 1, jump = false) => ({ id, sequence, direction, jump });

test('Mario admission is atomic and idempotent, shares FIFO and rejects a second owner slot', async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const { show, ctx, env } = setup();
  const { clips } = await response<{ clips: Clip[] }>(api(show, 'examples'));
  const body = { requestId: 'mario-double-tap' };
  const [first, duplicate] = await Promise.all([
    response<Joined>(api(show, 'mario/join', OWNER, body)),
    response<Joined>(api(show, 'mario/join', OWNER, body)),
  ]);
  assert.equal(first.id, duplicate.id);
  assert.equal(duplicate.state.queue.length, 1);
  assert.equal(first.state.queue[0].kind, 'mario');
  assert.equal(first.state.queue[0].durationMs, TURN_MS);
  assert.equal(first.state.queue[0].scheduledAt, now + 5000);
  assert.equal('owner' in first.state.queue[0], false);
  const restarted = new BuildingShow(ctx, env);
  assert.equal((await response<Joined>(api(restarted, 'mario/join', OWNER, body))).id, first.id);
  assert.equal((await api(restarted, 'mario/join', OWNER, { requestId: 'second-mario' })).status, 409);
  assert.equal((await api(restarted, 'pong/join', OWNER, { requestId: 'other-kind' })).status, 409);
  assert.equal((await api(restarted, 'submit', OWNER, { clipId: clips[0].id, requestId: 'lights' })).status, 409);
  const conflicting = await api(restarted, 'pong/join', OWNER, body);
  assert.equal((await conflicting.json() as { code: string }).code, 'REQUEST_ID_CONFLICT');
  const pong = await response<Joined>(api(restarted, 'pong/join', OTHER, { requestId: 'pong-next' }));
  const animation = await response<Joined>(api(restarted, 'submit', 'd'.repeat(64), { clipId: clips[0].id, requestId: 'lights-next' }));
  assert.deepEqual(animation.state.queue.map(item => item.kind), ['mario', 'pong', 'animation']);
  assert.equal(animation.state.queue[1].scheduledAt, now + 5000 + TURN_MS);
  assert.equal(animation.state.queue[2].scheduledAt, now + 5000 + 2 * TURN_MS);
  now += 5000;
  const active = await response<ShowState>(api(restarted, 'state'));
  assert.equal(active.current?.id, first.id);
  assert.equal(active.mario?.entryId, first.id);
  assert.equal((await api(restarted, 'mario/join', OWNER, { requestId: 'while-playing' })).status, 409);
  now += TURN_MS;
  const next = await response<ShowState>(api(restarted, 'state'));
  assert.equal(next.current?.id, pong.id);
  assert.equal(next.mario, null);
  assert.equal((await api(restarted, 'mario/input', OWNER, controls(first.id, now))).status, 409);
});

test('Mario respects the shared ten-waiter capacity and rejects admission while paused', async t => {
  t.mock.method(Date, 'now', () => 1_800_050_000_000);
  const { show } = setup();
  for (let index = 1; index <= 10; index++) {
    const visitor = index.toString(16).padStart(64, '0');
    assert.equal((await api(show, 'mario/join', visitor, { requestId: `turn-${index}` })).status, 200);
  }
  const full = await api(show, 'mario/join', OWNER, { requestId: 'overflow' });
  assert.equal(full.status, 409);
  assert.equal((await full.json() as { code: string }).code, 'QUEUE_FULL');
  await response<ShowState>(api(show, 'admin', OWNER, { action: 'pause' }, 'mario-test-admin'));
  const paused = await api(show, 'mario/join', OTHER, { requestId: 'paused' });
  assert.equal(paused.status, 503);
  assert.equal((await paused.json() as { code: string }).code, 'SHOW_PAUSED');
});

test('Mario controls require the active owner and reject malformed movement, jump and sequence', async t => {
  let now = 1_800_100_000_000;
  t.mock.method(Date, 'now', () => now);
  const { show } = setup();
  const joined = await response<Joined>(api(show, 'mario/join', OWNER, { requestId: 'play' }));
  assert.equal((await api(show, 'mario/input', OWNER, controls(joined.id, now))).status, 409);
  now += 5000;
  const initial = await response<ShowState>(api(show, 'state'));
  assert.equal(initial.mario?.state.x, 2);
  assert.equal((await api(show, 'mario/input', OTHER, controls(joined.id, now))).status, 403);
  assert.equal((await api(show, 'mario/input', OWNER, controls('old-turn', now))).status, 409);
  for (const patch of [
    { direction: -2 }, { direction: 2 }, { direction: 0.5 }, { direction: '1' }, { direction: null },
    { jump: null }, { jump: 1 }, { jump: 'true' },
    { sequence: -1 }, { sequence: 1.5 }, { sequence: Number.MAX_SAFE_INTEGER + 1 }, { sequence: '1' },
  ]) {
    const invalid = await api(show, 'mario/input', OWNER, { ...controls(joined.id, now), ...patch });
    assert.equal(invalid.status, 400, JSON.stringify(patch));
    assert.equal((await invalid.json() as { code: string }).code, 'INVALID_MARIO_INPUT');
  }
  const accepted = await response<ShowState>(api(show, 'mario/input', OWNER, controls(joined.id, now, 1, true)));
  assert.equal(accepted.mario?.state.direction, 1);
  assert.equal(accepted.mario?.state.grounded, false);
  assert.ok(accepted.mario!.state.vy < 0);
  assert.equal('lastSequence' in accepted.mario!, false);
});

test('restart retains Mario input ordering and ownership; pause discards interrupted play', async t => {
  let now = 1_800_200_000_000;
  t.mock.method(Date, 'now', () => now);
  const { show, ctx, env } = setup();
  const joined = await response<Joined>(api(show, 'mario/join', OWNER, { requestId: 'first' }));
  const waiting = await response<Joined>(api(show, 'mario/join', OTHER, { requestId: 'second' }));
  now += 5000;
  const accepted = await response<ShowState>(api(show, 'mario/input', OWNER, controls(joined.id, now, 1, true)));
  const restored = new BuildingShow(ctx, env);
  const duplicate = await response<ShowState>(api(restored, 'mario/input', OWNER, controls(joined.id, now, -1, true)));
  assert.deepEqual(duplicate.mario, accepted.mario, 'same sequence must not replay a jump or reverse movement after restart');
  const older = await response<ShowState>(api(restored, 'mario/input', OWNER, controls(joined.id, now - 1, -1)));
  assert.equal(older.mario?.state.direction, 1);
  assert.equal((await api(restored, 'mario/input', OTHER, controls(joined.id, now + 1, -1))).status, 403);
  const fresh = await response<ShowState>(api(restored, 'mario/input', OWNER, controls(joined.id, now + 1, -1)));
  assert.equal(fresh.mario?.state.direction, -1);
  const paused = await response<ShowState>(api(restored, 'admin', OWNER, { action: 'pause' }, 'mario-test-admin'));
  assert.equal(paused.paused, true);
  assert.equal(paused.current, null);
  assert.equal(paused.mario, null);
  assert.equal(paused.queue[0].id, waiting.id);
  assert.equal((await api(restored, 'mario/input', OWNER, controls(joined.id, now + 2))).status, 409);
  const restartedPaused = new BuildingShow(ctx, env);
  assert.equal((await response<ShowState>(api(restartedPaused, 'state'))).paused, true);
  const resumed = await response<ShowState>(api(restartedPaused, 'admin', OWNER, { action: 'resume' }, 'mario-test-admin'));
  assert.equal(resumed.paused, false);
  assert.equal(resumed.current, null);
  assert.equal((await api(restartedPaused, 'mario/input', OWNER, controls(joined.id, now + 3))).status, 409);
  now += 5000;
  const next = await response<ShowState>(api(restartedPaused, 'state', OTHER));
  assert.equal(next.current?.id, waiting.id);
  assert.equal(next.current?.mine, true);
  assert.equal(next.mario?.state.lives, 3);
  assert.equal((await api(restartedPaused, 'mario/input', OWNER, controls(waiting.id, now))).status, 403);
  assert.equal((await api(restartedPaused, 'mario/input', OTHER, controls(waiting.id, now))).status, 200);
});

test('accepted Mario input changes the authenticated display frame and expires if updates stop', async t => {
  let now = 1_800_300_000_000;
  t.mock.method(Date, 'now', () => now);
  const token = 'mario-display-runner';
  const { show } = setup({ DISPLAY_RUNNER_TOKEN: token });
  await response(api(show, 'display/status', OWNER, { connected: true }, token));
  await response<ShowState>(api(show, 'admin', OWNER, { action: 'resume' }, 'mario-test-admin'));
  const joined = await response<Joined>(api(show, 'mario/join', OWNER, { requestId: 'physical' }));
  now += 2500;
  await response(api(show, 'display/status', OWNER, { connected: true }, token));
  now += 2500;
  type Feed = { frame: Frame; mode: string; displayId: string; static: boolean };
  const initial = await response<Feed>(api(show, 'display/frame', OWNER, undefined, token));
  assert.equal(initial.mode, 'mario');
  assert.equal(initial.static, false);
  assert.equal(initial.displayId, `turn:${joined.id}`);
  await response<ShowState>(api(show, 'mario/input', OWNER, controls(joined.id, now, 1, true)));
  now += 200;
  const moved = await response<Feed>(api(show, 'display/frame', OWNER, undefined, token));
  const publicState = await response<ShowState>(api(show, 'state', OTHER));
  assert.ok(publicState.mario!.state.x > 2);
  assert.ok(publicState.mario!.state.y < 12);
  assert.notDeepEqual(moved.frame, initial.frame);
  assert.deepEqual(moved.frame, renderMario(publicState.mario!.state), 'runner and spectator use the authoritative game state');
  assert.equal(publicState.current?.mine, false);
  now += 400;
  const stopped = await response<ShowState>(api(show, 'state'));
  assert.equal(stopped.mario?.state.direction, 0);
  const x = stopped.mario!.state.x;
  now += 200;
  assert.equal((await response<ShowState>(api(show, 'state'))).mario!.state.x, x, 'lost controls cannot keep the hero walking');
});
