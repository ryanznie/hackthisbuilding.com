import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShowState } from '../shared/contracts';

interface Props {
  state: ShowState | null;
  connected: boolean;
  paused: boolean;
  clockOffset: number;
  onState: (next: ShowState, started: number) => void;
  onJoined: (id: string) => void;
}
type Action = 'left' | 'right' | 'jump';
type Direction = -1 | 0 | 1;
const MIN_DIRECTION_PRESS_MS = 175;
const MAX_QUEUED_TAP_MS = 1000;

async function post<T>(path: string, body: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
  } catch { throw new Error('The shared show could not be reached. Please try again.'); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('The simulator could not be reached. Please try again.'); }
  if (!response.ok) throw new Error(typeof data === 'object' && data && 'error' in data && typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.');
  return data as T;
}

const keyboardAction = (key: string): Action | undefined => {
  if (key === 'ArrowLeft' || key.toLowerCase() === 'a') return 'left';
  if (key === 'ArrowRight' || key.toLowerCase() === 'd') return 'right';
  if (key === ' ' || key === 'ArrowUp' || key.toLowerCase() === 'w') return 'jump';
};
const isEditing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Controls stay within this focused panel; camera and text-editor shortcuts remain independent. */
export function MarioControls(props: Props) {
  const { state, connected, paused, clockOffset } = props;
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [held, setHeld] = useState({ left: false, right: false, jump: false });
  const mounted = useRef(false);
  const latest = useRef(props); latest.current = props;
  const joinRequest = useRef<string | null>(null);
  const pressed = useRef(new Map<string, Action>());
  const pressedAt = useRef(new Map<string, number>());
  const releaseTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const input = useRef<{ direction: Direction; jump: boolean }>({ direction: 0, jump: false });
  const queuedTap = useRef<{ direction: Direction; expiresAt: number } | null>(null);
  const sent = useRef<{ id: string | null; direction: Direction; sequence: number; busy: boolean }>({ id: null, direction: 0, sequence: 0, busy: false });
  const current = state?.current?.kind === 'mario' ? state.current : null;
  const game = current && state?.mario?.entryId === current.id ? state.mario.state : null;
  const ownWaiting = state?.queue.find(item => item.kind === 'mario' && item.mine);
  const personalTurn = state?.current?.mine || state?.queue.some(item => item.mine);
  const canControl = !!(connected && !paused && !state?.paused && state?.phase === 'playing' && current?.mine && game && !game.won && !game.gameOver && Date.now() + clockOffset < state.phaseEndsAt);

  const refreshHeld = useCallback(() => {
    const actions = [...pressed.current.values()];
    const next = { left: actions.includes('left'), right: actions.includes('right'), jump: actions.includes('jump') };
    input.current.direction = next.left === next.right ? 0 : next.left ? -1 : 1;
    if (mounted.current) setHeld(previous => previous.left === next.left && previous.right === next.right && previous.jump === next.jump ? previous : next);
  }, []);
  const clearInputs = useCallback(() => {
    pressed.current.clear();
    pressedAt.current.clear();
    input.current = { direction: 0, jump: false };
    queuedTap.current = null;
    for (const timer of releaseTimers.current.values()) clearTimeout(timer);
    releaseTimers.current.clear();
    refreshHeld();
  }, [refreshHeld]);
  const release = useCallback((source: string) => {
    const action = pressed.current.get(source);
    if (!action || releaseTimers.current.has(source)) return;
    const finish = () => {
      pressed.current.delete(source);
      pressedAt.current.delete(source);
      releaseTimers.current.delete(source);
      refreshHeld();
    };
    // Preserve a short tap across the 125 ms input poll. Long holds stop on
    // release; pointer capture loss after pointerup must not shorten the pulse.
    const remaining = action === 'jump' ? 0 : MIN_DIRECTION_PRESS_MS - (performance.now() - (pressedAt.current.get(source) ?? 0));
    if (remaining <= 0) finish();
    else {
      const timer = setTimeout(() => {
        if (releaseTimers.current.get(source) === timer) finish();
      }, remaining);
      releaseTimers.current.set(source, timer);
    }
  }, [refreshHeld]);
  const press = (source: string, action: Action) => {
    if (!canControl || document.hidden) return;
    const pendingRelease = releaseTimers.current.get(source);
    if (pressed.current.has(source) && pendingRelease === undefined) return;
    // A genuine re-press supersedes that source's old release timer.
    if (pendingRelease !== undefined) { clearTimeout(pendingRelease); releaseTimers.current.delete(source); }
    // A second physical jump key while jump is already held is not a new edge.
    if (action === 'jump' && ![...pressed.current.values()].includes('jump')) input.current.jump = true;
    pressed.current.set(source, action);
    pressedAt.current.set(source, performance.now());
    refreshHeld();
    if (action !== 'jump') queuedTap.current = input.current.direction
      ? { direction: input.current.direction, expiresAt: performance.now() + MAX_QUEUED_TAP_MS } : null;
  };

  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden) clearInputs(); };
    window.addEventListener('blur', clearInputs);
    document.addEventListener('visibilitychange', hidden);
    const poll = window.setInterval(() => {
      const snapshot = latest.current, show = snapshot.state, item = show?.current;
      const mario = show?.mario?.entryId === item?.id ? show?.mario?.state : undefined;
      const allowed = snapshot.connected && !snapshot.paused && !show?.paused && show?.phase === 'playing' && item?.kind === 'mario' && item.mine
        && mario && !mario.won && !mario.gameOver && Date.now() + snapshot.clockOffset < show.phaseEndsAt;
      if (!allowed || !item) { clearInputs(); return; }
      if (document.hidden) clearInputs();
      const previous = sent.current;
      if (previous.id !== item.id) { previous.id = item.id; previous.direction = 0; }
      if (queuedTap.current && queuedTap.current.expiresAt <= performance.now()) queuedTap.current = null;
      // A tap can finish while the preceding request is in flight. Dispatch it
      // once afterward, but discard old taps instead of replaying a long backlog.
      const direction = input.current.direction || queuedTap.current?.direction || 0;
      if (previous.busy || (!input.current.jump && direction === 0 && previous.direction === 0)) return;
      const jump = input.current.jump;
      queuedTap.current = null;
      // Consume the jump edge once. A response of uncertain delivery must not replay it.
      input.current.jump = false;
      previous.busy = true;
      previous.direction = direction;
      previous.sequence = Math.max(Date.now(), previous.sequence + 1);
      const started = Date.now(), id = item.id;
      void post<ShowState>('/api/mario/input', { id, direction, jump, sequence: previous.sequence }).then(next => {
        if (!mounted.current) return;
        if (next.serverTime >= (latest.current.state?.serverTime ?? 0)) latest.current.onState(next, started);
        if (latest.current.state?.current?.id === id) setError('');
      }).catch(caught => {
        if (!mounted.current || latest.current.state?.current?.id !== id) return;
        clearInputs();
        setError(caught instanceof Error ? caught.message : 'Your control could not reach the game. Please try again.');
      }).finally(() => { previous.busy = false; });
    }, 125);
    return () => {
      mounted.current = false;
      window.clearInterval(poll);
      window.removeEventListener('blur', clearInputs);
      document.removeEventListener('visibilitychange', hidden);
      clearInputs();
      // The authoritative game expires held directions after 400 ms, including
      // unmount/navigation while an input request is still in flight.
    };
  }, [clearInputs]);

  useEffect(() => { clearInputs(); }, [canControl, current?.id, clearInputs]);

  async function join() {
    if (joining || !connected || state?.paused || personalTurn) return;
    setJoining(true); setError('');
    joinRequest.current ??= crypto.randomUUID();
    const started = Date.now();
    try {
      const result = await post<{ id: string; state: ShowState }>('/api/mario/join', { requestId: joinRequest.current });
      if (!mounted.current) return;
      joinRequest.current = null;
      if (result.state.serverTime >= (latest.current.state?.serverTime ?? 0)) latest.current.onState(result.state, started);
      latest.current.onJoined(result.id);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : 'Your Mario turn could not be queued. Please try again.');
    } finally { if (mounted.current) setJoining(false); }
  }

  const controlButton = (action: Action, label: string, symbol: string) => <button
    type="button" className={`mario-control-button ${held[action] ? 'is-held' : ''}`} aria-label={label} aria-pressed={held[action]}
    style={{ minWidth: 64, minHeight: 48, touchAction: 'none', userSelect: 'none', font: 'inherit' }}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); press(`pointer:${event.pointerId}`, action); }}
    onPointerUp={event => release(`pointer:${event.pointerId}`)} onPointerCancel={clearInputs} onLostPointerCapture={event => release(`pointer:${event.pointerId}`)}
    onClick={event => {
      // Assistive-technology activation has no pointer lifecycle: supply a short
      // movement pulse or one jump without leaving an indefinitely held button.
      if (event.detail !== 0 || !canControl) return;
      const source = `activate:${action}`;
      press(source, action);
      release(source);
    }}><span aria-hidden="true">{symbol}</span> {action === 'jump' ? 'Jump' : action === 'left' ? 'Left' : 'Right'}</button>;

  const status = !connected ? 'Reconnecting to the shared show…' : state?.paused ? 'The shared show is paused.'
    : current?.mine ? !game ? 'Loading your game…' : Date.now() + clockOffset >= state!.phaseEndsAt ? 'Your turn has ended. Updating the shared show…'
      : game.won ? 'Flag reached! Your score stays on the building until the turn ends.' : game.gameOver ? 'Game over. Your score stays on the building until the turn ends.'
      : paused ? 'Resume the building view to use your controls.' : 'Your turn — use the controls below.'
      : ownWaiting ? 'Your Mario turn is in the shared queue. Controls unlock when it starts.'
        : current ? 'Someone else is playing. You can watch their progress on the building.'
          : personalTurn ? 'You already have a turn in the shared queue.' : 'Join the queue to play on the building.';

  return <section className="mario-panel" aria-labelledby="mario-title">
    <div className="panel-heading"><h2 id="mario-title">Super Mario</h2><p className="panel-description">A tiny platformer for 153 windows. Jump across platforms, collect coins, and reach the flag.</p></div>
    <p className="input-hint" role="status">{status}</p>
    {game && <dl className="mario-stats" aria-label="Current Mario game" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, margin: '20px 0' }}>
      <div><dt>Score</dt><dd style={{ margin: 0 }}>{game.score}</dd></div>
      <div><dt>Coins</dt><dd style={{ margin: 0 }}>{game.coins}</dd></div>
      <div><dt>Lives</dt><dd style={{ margin: 0 }}>{game.lives}</dd></div>
      <div><dt>Progress</dt><dd style={{ margin: 0 }}>{Math.round(game.progress * 100)}%</dd></div>
    </dl>}
    <fieldset className="mario-controls" disabled={!canControl} tabIndex={canControl ? 0 : -1} aria-describedby="mario-instructions" style={{ border: 0, padding: 0, margin: '20px 0' }}
      onBlur={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) clearInputs(); }}
      onKeyDown={event => {
        if (isEditing(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
        const action = keyboardAction(event.key);
        if (!action || !canControl) return;
        event.preventDefault();
        if (!event.repeat) press(`key:${event.code || event.key}`, action);
      }}
      onKeyUp={event => {
        if (isEditing(event.target) || !keyboardAction(event.key)) return;
        event.preventDefault(); release(`key:${event.code || event.key}`);
      }}>
      <legend className="section-label">Game controls</legend>
      <p id="mario-instructions" className="input-hint">Hold Left / Right or A / D to move. Press Space, Up, or W to jump. Focus this control panel to use the keyboard.</p>
      <div className="mario-direction-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {controlButton('left', 'Move left', '←')}{controlButton('right', 'Move right', '→')}{controlButton('jump', 'Jump', '↑')}
      </div>
    </fieldset>
    {!current?.mine && !ownWaiting && <button type="button" className="submit-button" onClick={() => { void join(); }} disabled={joining || !connected || !!state?.paused || !!personalTurn} style={{ minHeight: 44 }}>{joining ? 'Joining the queue…' : 'Join Mario queue'}</button>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

export default MarioControls;
