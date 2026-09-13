import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiFailure } from '../worker/generation';
import { BuildingShow, type Env } from '../worker/index';
import { bostonDate, fetchRedSoxScore, RedSoxScoreService, scoreDescription, selectRedSoxGame } from '../worker/scores';
import type { Clip, ShowState } from '../shared/contracts';

const NOW = Date.parse('2026-09-13T18:00:00Z');
function game(date = '2026-09-12', state = 'Final', bostonHome = true, score = 5) {
  const bos = { team: { id: 111, name: 'Boston Red Sox', abbreviation: 'BOS' }, score };
  const kc = { team: { id: 118, name: 'Kansas City Royals', abbreviation: 'KC' }, score: 1 };
  return { gamePk: 824712, officialDate: date, gameDate: `${date}T16:00:00Z`,
    status: { abstractGameState: state, codedGameState: state === 'Final' ? 'F' : state === 'Live' ? 'I' : 'P', detailedState: state === 'Live' ? 'In Progress' : state },
    teams: { away: bostonHome ? kc : bos, home: bostonHome ? bos : kc }, linescore: { currentInning: 5, inningState: 'Bottom' } };
}
const schedule = (...games: unknown[]) => ({ dates: [{ date: '2026-09-13', games }] });

test('MLB selection ignores pre-game placeholders and picks live play or latest completed game', () => {
  const old = game('2026-09-11'), final = game(), pregame = game('2026-09-13', 'Preview');
  const selected = selectRedSoxGame(schedule(old, pregame, final), NOW)!;
  assert.equal(selected.date, '2026-09-12');
  assert.equal(selected.boston.score, 5);
  assert.equal(selected.opponent.score, 1);
  const live = selectRedSoxGame(schedule(final, game('2026-09-13', 'Live', false, 2)), NOW)!;
  assert.equal(live.status, 'live');
  assert.equal(live.boston.abbreviation, 'BOS');
  assert.equal(live.boston.score, 2, 'Boston stays the top/red score even away from home');
  assert.equal(live.detail, 'In Progress, Bottom 5');
  const second = { ...game(), gameDate: '2026-09-12T22:00:00Z', gamePk: 824713 };
  assert.equal(selectRedSoxGame(schedule(final, second), NOW)!.gamePk, second.gamePk, 'later doubleheader game wins');
  assert.equal(selectRedSoxGame(schedule(game('2026-09-01', 'Live'), final), NOW)!.status, 'final', 'stale in-progress records must not masquerade as current play');
});

test('MLB warmup, suspended, postponed and cancelled states retain the previous completed score', () => {
  // Exact abstract/coded state pairs from https://statsapi.mlb.com/api/v1/gameStatus.
  const inactive = [
    ['Live', 'P', 'Warmup'], ['Live', 'T', 'Suspended'], ['Live', 'U', 'Suspended: Rain'],
    ['Final', 'D', 'Postponed: Rain'], ['Final', 'C', 'Cancelled'], ['Preview', 'P', 'Pre-Game'],
  ];
  for (const [abstractGameState, codedGameState, detailedState] of inactive) {
    const current = game('2026-09-13', 'Live', true, 0);
    current.status = { abstractGameState, codedGameState, detailedState };
    assert.equal(selectRedSoxGame(schedule(game(), current), NOW)!.date, '2026-09-12', detailedState);
    assert.equal(selectRedSoxGame(schedule(current), NOW), undefined, detailedState);
  }
  for (const code of ['I', 'M', 'N']) {
    const current = game('2026-09-13', 'Live'); current.status.codedGameState = code;
    assert.equal(selectRedSoxGame(schedule(game(), current), NOW)!.status, 'live', code);
  }
  for (const code of ['O', 'F', 'Q', 'R']) {
    const current = game('2026-09-13'); current.status.codedGameState = code;
    assert.equal(selectRedSoxGame(schedule(game(), current), NOW)!.date, '2026-09-13', code);
  }
});

test('resumed games use their actual resumption date and can outrank a newer original game date', () => {
  // Observed 2024-08-26 schedule: game 746942 resumed the 2024-06-26 TOR–BOS game.
  const resumed = { ...game('2024-06-26', 'Live'), gamePk: 746942,
    gameDate: '2024-08-26T18:05:00Z', resumedFrom: '2024-06-26T23:10:00Z' };
  const now = Date.parse('2024-08-26T20:00:00Z');
  const selected = selectRedSoxGame(schedule(game('2024-08-25'), resumed), now)!;
  assert.equal(selected.gamePk, 746942);
  assert.equal(selected.date, '2024-08-26');
  resumed.status = { abstractGameState: 'Final', codedGameState: 'F', detailedState: 'Final' };
  assert.equal(selectRedSoxGame(schedule(game('2024-08-25'), resumed), now)!.gamePk, 746942);
  assert.equal(selectRedSoxGame(schedule(resumed), Date.parse('2024-08-26T17:00:00Z')), undefined, 'future resumption cannot supply a score');
});

test('real off-day and postseason fixtures retain the latest completed game', () => {
  // Condensed first-party responses captured 2026-09-13. These are final scores,
  // not synthetic Live fixtures; URLs and capture hashes are in the research report.
  const angels = { ...game('2026-09-09', 'Final', true, 4), gamePk: 824713, gameDate: '2026-09-09T22:45:00Z' };
  angels.teams.away = { team: { id: 108, name: 'Los Angeles Angels', abbreviation: 'LAA' }, score: 6 };
  const offDay = selectRedSoxGame({ dates: [{ date: '2026-09-09', games: [angels] }] }, Date.parse('2026-09-10T23:00:00Z'))!;
  assert.deepEqual([offDay.date, offDay.boston.score, offDay.opponent.score], ['2026-09-09', 4, 6]);
  const postseason = { ...game('2025-10-02', 'Final', false, 0), gamePk: 813065, gameDate: '2025-10-03T00:08:00Z' };
  postseason.teams.home = { team: { id: 147, name: 'New York Yankees', abbreviation: 'NYY' }, score: 4 };
  const offseason = selectRedSoxGame({ dates: [{ date: '2025-10-02', games: [postseason] }] }, Date.parse('2026-01-12T23:00:00Z'))!;
  assert.deepEqual([offseason.date, offseason.boston.score, offseason.opponent.score], ['2025-10-02', 0, 4]);
});

test('Boston date and score metadata are explicit; absent or invalid scores never become zero', () => {
  assert.equal(bostonDate(Date.parse('2026-09-14T01:00:00Z')), '2026-09-13');
  const description = scoreDescription(selectRedSoxGame(schedule(game()), NOW)!);
  assert.match(description.title, /BOS 5.*KC 1.*Final.*2026-09-12/);
  assert.match(description.interpretation, /Red\/top: Boston Red Sox 5.*White\/bottom: Kansas City Royals 1/);
  assert.match(description.interpretation, /MLB snapshot.*stays fixed/);
  for (const score of [undefined, NaN, -1, 100, '5']) {
    const bad = game() as any; bad.teams.home.score = score;
    assert.throws(() => selectRedSoxGame(schedule(bad), NOW), ApiFailure);
  }
  assert.throws(() => selectRedSoxGame({ dates: 'invalid' }, NOW), ApiFailure);
});

test('lookups use fixed MLB endpoints and at most one off-season fallback', async () => {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.origin, 'https://statsapi.mlb.com');
    assert.equal(url.pathname, '/api/v1/schedule');
    assert.equal(url.searchParams.get('teamId'), '111');
    assert.equal(url.searchParams.get('hydrate'), 'team,linescore');
    assert.equal(init?.redirect, 'manual');
    return Response.json(calls.length === 1 ? { dates: [] } : schedule(game('2025-09-30')));
  };
  const now = Date.parse('2026-01-12T18:00:00Z');
  const result = await fetchRedSoxScore(now, { fetcher });
  assert.equal(result.date, '2025-09-30');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get('startDate'), '2025-12-13');
  assert.equal(calls[1].searchParams.get('startDate'), '2025-01-01');
  let emptyCalls = 0;
  await assert.rejects(fetchRedSoxScore(NOW, { fetcher: async () => { emptyCalls++; return Response.json({ dates: [] }); } }), (error: unknown) => error instanceof ApiFailure && error.code === 'NO_RED_SOX_SCORE');
  assert.equal(emptyCalls, 2);
});

test('shared cache coalesces clicks, refreshes live at 30 seconds and final at five minutes', async () => {
  for (const [state, ttl] of [['Live', 30_000], ['Final', 300_000]] as const) {
    let calls = 0;
    const service = new RedSoxScoreService({ fetcher: async () => { calls++; return Response.json(schedule(game('2026-09-13', state))); } });
    const [a, b] = await Promise.all([service.get(NOW), service.get(NOW)]);
    assert.equal(calls, 1);
    a.boston.score = 99;
    assert.equal(b.boston.score, 5, 'callers cannot mutate cached scores');
    await service.get(NOW + ttl - 1);
    assert.equal(calls, 1);
    await service.get(NOW + ttl);
    assert.equal(calls, 2);
  }
});

test('transport, body bounds and deadline failures remain sanitized without stale fallback or retries', async () => {
  for (const fetcher of [
    async () => new Response('private upstream details', { status: 500 }),
    async () => new Response('private upstream details', { status: 302, headers: { Location: 'https://other.test' } }),
    async () => new Response('not-json private upstream details'),
    async () => new Response('tiny', { headers: { 'Content-Length': String(600_000) } }),
    async () => new Response('x'.repeat(600_000)),
  ]) await assert.rejects(fetchRedSoxScore(NOW, { fetcher }), (error: unknown) => error instanceof ApiFailure && error.code === 'SCORE_UNAVAILABLE' && !error.message.includes('private'));
  let aborted = false;
  await assert.rejects(fetchRedSoxScore(NOW, { timeoutMs: 5, fetcher: async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('private')); })) }), ApiFailure);
  assert.equal(aborted, true);
  let calls = 0;
  const service = new RedSoxScoreService({ fetcher: async () => ++calls === 1 ? Response.json(schedule(game('2026-09-13', 'Live'))) : new Response('unavailable', { status: 503 }) });
  await service.get(NOW);
  await assert.rejects(service.get(NOW + 30_000), ApiFailure);
  await assert.rejects(service.get(NOW + 30_001), ApiFailure);
  assert.equal(calls, 2, 'short failure cooldown protects MLB without serving a stale score');
});

test('score previews are owner-only, expire in five minutes, and queued snapshots retain exact pixels', async t => {
  let now = NOW, calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(schedule(game())); });
  const values = new Map<string, unknown>();
  const storage = { get: async (key: string) => structuredClone(values.get(key)), put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); }, setAlarm: async () => undefined, deleteAlarm: async () => undefined };
  const ctx = { storage, blockConcurrencyWhile: <T>(action: () => Promise<T>) => action() } as unknown as DurableObjectState;
  const show = new BuildingShow(ctx, {} as Env), owner = 'a'.repeat(64), other = 'b'.repeat(64);
  const request = (path: string, visitor = owner, body?: unknown) => show.fetch(new Request(`https://hackthisbuilding.com/api/${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-htb-visitor': visitor, 'x-htb-ip': 'c'.repeat(64), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const first = await request('red-sox', owner, {});
  assert.equal(first.status, 200);
  const { clip } = await first.json() as { clip: Clip };
  assert.match(clip.id, /^score_/);
  assert.equal(clip.source, 'example');
  assert.equal(clip.expiresAt, now + 300_000);
  const { clip: same } = await (await request('red-sox', owner, {})).json() as { clip: Clip };
  assert.equal(same.id, clip.id);
  assert.equal(calls, 1);
  assert.equal((await request('submit', other, { clipId: clip.id, requestId: 'other' })).status, 404);
  const submission = await request('submit', owner, { clipId: clip.id, requestId: 'mine', scene: {} });
  const queued = await submission.json() as { state: ShowState };
  assert.deepEqual(queued.state.queue[0].clip, clip, 'the accepted score is a frozen server-approved snapshot');
  const catalog = await (await request('examples')).json() as { clips: Clip[] };
  assert.ok(!catalog.clips.some(example => example.id === clip.id));
  now += 300_001;
  assert.equal((await request('submit', owner, { clipId: clip.id, requestId: 'expired' })).status, 404);
});
