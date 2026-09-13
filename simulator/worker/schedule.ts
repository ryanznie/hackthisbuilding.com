import { CLIP_MS, URL_PASS_MS, type Clip, type QueueItem, type ShowState } from '../shared/contracts';

export const COUNTDOWN_MS = 5000;
export const QUEUE_LIMIT = 10;
export interface Entry {
  id: string;
  owner: string;
  clip: Clip;
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
    phaseEndsAt: now + 2 * URL_PASS_MS, completed: [] };
}

/** Keep complete URL passes and give the next participant at least five seconds. */
export function nextInvitationSlot(startedAt: number, now: number): number {
  const earliest = Math.max(startedAt + 2 * URL_PASS_MS, now + COUNTDOWN_MS);
  return startedAt + Math.ceil((earliest - startedAt) / URL_PASS_MS) * URL_PASS_MS;
}

export function reschedule(state: Schedule, now: number): void {
  if (state.paused) {
    state.queue.forEach(item => { item.scheduledAt = 0; });
    state.phaseEndsAt = 0;
    return;
  }
  let first: number;
  if (state.current) {
    first = state.phaseEndsAt + 2 * URL_PASS_MS;
  } else {
    // Preserve a promised slot when the line changes. Call advance() first.
    first = state.queue[0]?.scheduledAt || nextInvitationSlot(state.phaseStartedAt, now);
    if (first < now) first = nextInvitationSlot(state.phaseStartedAt, now);
    if (state.queue.length) state.phaseEndsAt = first;
  }
  state.queue.forEach((item, index) => { item.scheduledAt = first + index * (CLIP_MS + 2 * URL_PASS_MS); });
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
      state.phaseEndsAt = state.phaseStartedAt + 2 * URL_PASS_MS;
    }
    if (!state.queue.length) {
      state.phaseEndsAt = Math.max(state.phaseStartedAt + 2 * URL_PASS_MS,
        state.phaseStartedAt + (Math.floor((now - state.phaseStartedAt) / URL_PASS_MS) + 1) * URL_PASS_MS);
      break;
    }
    if (now < state.queue[0].scheduledAt) {
      state.phaseEndsAt = state.queue[0].scheduledAt;
      break;
    }
    state.current = state.queue.shift()!;
    state.phaseStartedAt = state.current.scheduledAt;
    state.phaseEndsAt = state.phaseStartedAt + CLIP_MS;
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
  if (state.queue[0] && promisedFirst && promisedFirst - now >= COUNTDOWN_MS) state.queue[0].scheduledAt = promisedFirst;
  reschedule(state, now);
  return true;
}

export function stopCurrent(state: Schedule, now: number): void {
  // An interrupted animation is never silently replayed or marked completed.
  state.current = null;
  state.phaseStartedAt = now;
  state.phaseEndsAt = now + 2 * URL_PASS_MS;
  state.queue.forEach(item => { item.scheduledAt = 0; });
  reschedule(state, now);
}

export function showState(state: Schedule, owner: string, now: number, generationAvailable: boolean): ShowState {
  const publicItem = (item: Entry): QueueItem => ({ id: item.id, clip: item.clip,
    submittedAt: item.submittedAt, scheduledAt: item.scheduledAt,
    votes: item.voters.length, voted: item.voters.includes(owner), mine: item.owner === owner });
  return { serverTime: now, mode: 'simulator', paused: state.paused,
    phase: state.current && !state.paused ? 'playing' : 'invitation',
    current: state.current ? publicItem(state.current) : null, queue: state.queue.map(publicItem),
    phaseStartedAt: state.phaseStartedAt, phaseEndsAt: state.phaseEndsAt,
    nextStartAt: state.paused ? null : state.queue[0]?.scheduledAt ?? null,
    completed: state.completed, generationAvailable, queueLimit: QUEUE_LIMIT };
}
