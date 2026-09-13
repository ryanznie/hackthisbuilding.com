import { TURN_MS, type Clip, type ProjectKind, type QueueItem, type ShowState } from '../shared/contracts';

export const COUNTDOWN_MS = 5000;
export const QUEUE_LIMIT = 10;
export interface Entry {
  id: string;
  owner: string;
  clip: Clip;
  kind?: ProjectKind;
  durationMs?: number;
  submittedAt: number;
  scheduledAt: number;
  voters: string[];
}
export interface Schedule {
  paused: boolean;
  current: Entry | null;
  queue: Entry[];
  phaseStartedAt: number;
  phaseEndsAt: number;
  completed: { id: string; title: string; finishedAt: number }[];
}
export function initialSchedule(now: number): Schedule {
  return { paused: false, current: null, queue: [], phaseStartedAt: now,
    phaseEndsAt: 0, completed: [] };
}

/** New arrivals receive five seconds of notice while idle art continues. */
export function nextInvitationSlot(_startedAt: number, now: number): number {
  return now + COUNTDOWN_MS;
}

/** Preserve an old active turn's end and a reserved start during deployment. */
export function migrateSchedule(state: Schedule, now: number): void {
  const legacy = !!state.current && (!state.current.kind || !state.current.durationMs)
    || state.queue.some(item => !item.kind || item.durationMs !== TURN_MS);
  if (state.current) {
    state.current.kind ??= 'animation';
    state.current.durationMs ??= Math.max(1, state.phaseEndsAt - state.phaseStartedAt);
  }
  state.queue.forEach(item => { item.kind ??= 'animation'; item.durationMs = TURN_MS; });
  if (legacy) {
    const head = state.queue[0];
    if (head && !(head.scheduledAt >= now && head.scheduledAt - now <= COUNTDOWN_MS)) head.scheduledAt = 0;
    reschedule(state, now);
  } else if (!state.current && !state.queue.length) state.phaseEndsAt = 0;
}

export function reschedule(state: Schedule, now: number): void {
  if (state.paused) {
    state.queue.forEach(item => { item.scheduledAt = 0; });
    state.phaseEndsAt = 0;
    return;
  }
  const promised = state.queue[0]?.scheduledAt ?? 0;
  const available = state.current ? state.phaseEndsAt : now;
  let start = promised > 0 && promised >= now && promised >= available
    ? promised : Math.max(available, now + COUNTDOWN_MS);
  state.queue.forEach(item => {
    item.kind ??= 'animation'; item.durationMs ??= TURN_MS;
    item.scheduledAt = start;
    start += item.durationMs;
  });
  if (!state.current) state.phaseEndsAt = state.queue[0]?.scheduledAt ?? 0;
}

/** Timestamp-driven catch-up is deterministic across alarms, polls and restarts. */
export function advance(state: Schedule, now: number): void {
  if (state.paused) return;
  for (;;) {
    if (state.current) {
      if (now < state.phaseEndsAt) break;
      state.completed.unshift({ id: state.current.id, title: state.current.clip.title, finishedAt: state.phaseEndsAt });
      state.completed = state.completed.slice(0, 20);
      state.current = null;
      state.phaseStartedAt = state.phaseEndsAt;
      state.phaseEndsAt = 0;
    }
    if (!state.queue.length) {
      state.phaseEndsAt = 0;
      break;
    }
    if (now < state.queue[0].scheduledAt) {
      state.phaseEndsAt = state.queue[0].scheduledAt;
      break;
    }
    state.current = state.queue.shift()!;
    state.phaseStartedAt = state.current.scheduledAt;
    state.phaseEndsAt = state.phaseStartedAt + (state.current.durationMs ?? TURN_MS);
  }
}

export function isReserved(state: Schedule, id: string, now: number): boolean {
  const first = state.queue[0];
  return !state.paused && !!first && first.id === id && first.scheduledAt - now <= COUNTDOWN_MS;
}

export function removeWaiting(state: Schedule, id: string, now: number): boolean {
  const index = state.queue.findIndex(item => item.id === id);
  if (index < 0) return false;
  const promisedFirst = state.queue[0]?.scheduledAt;
  state.queue.splice(index, 1);
  if (index === 0 && state.queue[0]) state.queue[0].scheduledAt = promisedFirst && promisedFirst - now >= COUNTDOWN_MS ? promisedFirst : 0;
  reschedule(state, now);
  return true;
}

export function stopCurrent(state: Schedule, now: number): void {
  // An interrupted turn is never silently replayed or marked completed.
  state.current = null;
  state.phaseStartedAt = now;
  state.phaseEndsAt = 0;
  state.queue.forEach(item => { item.scheduledAt = 0; });
  reschedule(state, now);
}

export function showState(state: Schedule, owner: string, now: number, generationAvailable: boolean): ShowState {
  const publicItem = (item: Entry): QueueItem => ({ id: item.id, kind: item.kind ?? 'animation', durationMs: item.durationMs ?? TURN_MS, clip: item.clip,
    submittedAt: item.submittedAt, scheduledAt: item.scheduledAt,
    votes: item.voters.length, voted: item.voters.includes(owner), mine: item.owner === owner });
  return { serverTime: now, mode: 'simulator', paused: state.paused,
    phase: state.current && !state.paused ? 'playing' : 'invitation',
    current: state.current ? publicItem(state.current) : null, queue: state.queue.map(publicItem),
    phaseStartedAt: state.phaseStartedAt, phaseEndsAt: state.phaseEndsAt,
    nextStartAt: state.paused ? null : state.queue[0]?.scheduledAt ?? null,
    completed: state.completed, generationAvailable, queueLimit: QUEUE_LIMIT };
}
