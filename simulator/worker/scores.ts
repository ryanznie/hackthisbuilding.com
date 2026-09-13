import { ApiFailure } from './generation';

const MLB_ORIGIN = 'https://statsapi.mlb.com';
const BOSTON = 111;
const DAY_MS = 86_400_000;
const MAX_BYTES = 512 * 1024;
const FIELDS = 'dates,date,games,gamePk,gameDate,officialDate,resumedFrom,status,abstractGameState,codedGameState,detailedState,teams,away,home,team,id,name,abbreviation,score,linescore,currentInning,inningState,currentInningOrdinal';
export const SCORE_PREVIEW_TTL_MS = 5 * 60_000;
export interface ScoreTeam { name: string; abbreviation: string; score: number; }
export interface RedSoxScore {
  gamePk: number;
  gameDate: string;
  date: string;
  status: 'live' | 'final';
  detail: string;
  boston: ScoreTeam;
  opponent: ScoreTeam;
  fetchedAt: number;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const unavailable = () => new ApiFailure(503, 'SCORE_UNAVAILABLE', 'The Red Sox score could not be verified right now. Please try again shortly.');
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`));

export function bostonDate(now: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
const daysBefore = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

function teamScore(value: unknown): ScoreTeam {
  const side = object(value), team = object(side?.team);
  if (!team || typeof team.name !== 'string' || !/^[A-Za-z0-9 .'-]{1,60}$/.test(team.name)
    || typeof team.abbreviation !== 'string' || !/^[A-Z]{2,3}$/.test(team.abbreviation)
    || typeof side?.score !== 'number' || !Number.isInteger(side.score) || side.score < 0 || side.score > 99) throw unavailable();
  return { name: team.name, abbreviation: team.abbreviation, score: side.score };
}

/** Select actual live play first, then the latest final. Pre-game 0–0 is not a score. */
export function selectRedSoxGame(input: unknown, now: number): RedSoxScore | undefined {
  const data = object(input);
  if (!Array.isArray(data?.dates) || data.dates.length > 730) throw unavailable();
  const today = bostonDate(now), scores: RedSoxScore[] = [];
  let count = 0;
  for (const day of data.dates) {
    const games = object(day)?.games;
    if (!Array.isArray(games)) throw unavailable();
    for (const value of games) {
      if (++count > 500) throw unavailable();
      const game = object(value), status = object(game?.status), teams = object(game?.teams);
      const away = object(teams?.away), home = object(teams?.home);
      const isHome = object(home?.team)?.id === BOSTON, isAway = object(away?.team)?.id === BOSTON;
      if (isHome === isAway || !game || !status) continue;
      // MLB's abstract Live also includes warmup (P) and suspension (T/U).
      // I includes in-game delays; M/N are replay challenges during an active game.
      // https://statsapi.mlb.com/api/v1/gameStatus
      const live = status.abstractGameState === 'Live' && ['I', 'M', 'N'].includes(String(status.codedGameState));
      const final = status.abstractGameState === 'Final' && ['F', 'O', 'Q', 'R'].includes(String(status.codedGameState));
      if (!live && !final) continue;
      if (!isoDate(game.officialDate) || game.officialDate > today || typeof game.gameDate !== 'string' || !Number.isFinite(Date.parse(game.gameDate))
        || typeof game.gamePk !== 'number' || !Number.isSafeInteger(game.gamePk) || game.gamePk <= 0) throw unavailable();
      if (Date.parse(game.gameDate) > now) continue;
      // Resumed games keep the original officialDate but receive a new gameDate.
      // Check when play started/resumed, permitting games that run past midnight.
      const playDate = bostonDate(Date.parse(game.gameDate));
      if (live && playDate < daysBefore(today, 1)) continue;
      const line = object(game.linescore);
      let detail = final ? (['Q', 'R'].includes(String(status.codedGameState)) ? 'Final, forfeit' : 'Final') : 'In progress';
      if (live && typeof status.detailedState === 'string' && /^[A-Za-z :,-]{1,50}$/.test(status.detailedState)) detail = status.detailedState;
      if (live && ['Top', 'Bottom', 'Middle', 'End'].includes(String(line?.inningState)) && typeof line?.currentInning === 'number' && Number.isInteger(line.currentInning) && line.currentInning > 0 && line.currentInning < 100) detail += `, ${line.inningState} ${line.currentInning}`;
      scores.push({ gamePk: game.gamePk, gameDate: game.gameDate, date: typeof game.resumedFrom === 'string' ? playDate : game.officialDate, status: live ? 'live' : 'final', detail,
        boston: teamScore(isHome ? home : away), opponent: teamScore(isHome ? away : home), fetchedAt: now });
    }
  }
  scores.sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || Date.parse(b.gameDate) - Date.parse(a.gameDate) || b.gamePk - a.gamePk);
  return scores[0];
}

async function schedule(start: string, end: string, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown> {
  const url = new URL('/api/v1/schedule', MLB_ORIGIN);
  url.search = new URLSearchParams({ sportId: '1', teamId: String(BOSTON), startDate: start, endDate: end, hydrate: 'team,linescore', fields: FIELDS }).toString();
  const response = await fetcher(url.toString(), { headers: { Accept: 'application/json' }, redirect: 'manual', signal });
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > MAX_BYTES) { await response.body?.cancel(); throw unavailable(); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw unavailable(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** Fixed MLB endpoints, at most two requests, one shared deadline and no retries. */
export async function fetchRedSoxScore(now: number, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<RedSoxScore> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const today = bostonDate(now), start = daysBefore(today, 30), fetcher = options.fetcher ?? fetch;
        const recent = selectRedSoxGame(await schedule(start, today, fetcher, controller.signal), now);
        if (recent) return recent;
        // Off-season fallback spans this and the previous season without unbounded scans.
        const earlier = selectRedSoxGame(await schedule(`${Number(today.slice(0, 4)) - 1}-01-01`, daysBefore(start, 1), fetcher, controller.signal), now);
        if (!earlier) throw new ApiFailure(404, 'NO_RED_SOX_SCORE', 'No completed Red Sox game was found in the current or previous season.');
        return earlier;
      })(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(unavailable()); }, options.timeoutMs ?? 9000); }),
    ]);
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw unavailable();
  } finally { if (timeout) clearTimeout(timeout); }
}

/** One cache and in-flight lookup for the shared show, never stale-on-error. */
export class RedSoxScoreService {
  private cached?: { value: RedSoxScore; expiresAt: number };
  private pending?: Promise<RedSoxScore>;
  private retryAt = 0;
  constructor(private options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}
  async get(now: number): Promise<RedSoxScore> {
    if (this.cached && this.cached.expiresAt > now) return structuredClone(this.cached.value);
    if (this.retryAt > now) throw unavailable();
    if (!this.pending) this.pending = fetchRedSoxScore(now, this.options).then(value => {
      this.cached = { value, expiresAt: now + (value.status === 'live' ? 30_000 : 300_000) };
      return value;
    }).catch(error => { this.retryAt = now + 10_000; throw error; }).finally(() => { this.pending = undefined; });
    return structuredClone(await this.pending);
  }
}

export function scoreDescription(score: RedSoxScore): { title: string; interpretation: string } {
  const captured = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(score.fetchedAt);
  return {
    title: `${score.boston.abbreviation} ${score.boston.score} · ${score.opponent.abbreviation} ${score.opponent.score} · ${score.status === 'live' ? 'Live' : 'Final'} · ${score.date}`,
    interpretation: `Red/top: ${score.boston.name} ${score.boston.score}. White/bottom: ${score.opponent.name} ${score.opponent.score}. ${score.date} · ${score.detail}. MLB snapshot at ${captured}; score stays fixed for this turn.`,
  };
}
