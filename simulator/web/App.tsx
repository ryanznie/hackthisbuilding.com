import { MarioControls } from './MarioControls';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type BuildingView } from './Building';
import { BuildingExperience, type RenderingMode } from './BuildingExperience';
import { CLIP_MS, TURN_MS, type Clip, type ShowState, type QueueItem } from '../shared/contracts';

type IconName = 'arrow' | 'spark' | 'play' | 'pause' | 'heart' | 'close' | 'check' | 'external' | 'queue';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    spark: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" /><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5L20 2Z" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    heart: <path d="M20.5 5.5a5 5 0 0 0-7 0L12 7l-1.5-1.5a5 5 0 0 0-7 7L12 21l8.5-8.5a5 5 0 0 0 0-7Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    external: <><path d="M14 4h6v6M20 4 10 14" /><path d="M10 4H4v16h16v-6" /></>,
    queue: <><path d="M8 5h12M8 12h12M8 19h12M3 5h.01M3 12h.01M3 19h.01" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

async function api<T>(path: string, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', signal: AbortSignal.timeout(path === '/api/preview' ? 130000 : 15000) });
  } catch {
    throw new Error(path === '/api/preview' ? 'The preview took too long to respond. Please try again, or choose an example.' : 'The shared show could not be reached. Please try again.');
  }
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('The simulator could not be reached. Please try again.'); }
  if (!response.ok) throw new Error(typeof data === 'object' && data && 'error' in data && typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.');
  return data as T;
}

function remaining(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function exampleSymbol(title: string) {
  const name = title.toLowerCase();
  if (name.includes('heart')) return '♡';
  if (name.includes('smile')) return '☺';
  if (name.includes('arrow') || name.includes('rocket')) return '↗';
  if (name.includes('wave') || name.includes('ocean')) return '≈';
  if (name.includes('star')) return '✧';
  return '◇';
}

function turnDuration(item: QueueItem) {
  return item.durationMs > 0 ? item.durationMs : TURN_MS;
}

function MiniWindows({ seed = 0 }: { seed?: number }) {
  return <span className="mini-windows" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => <i key={i} className={(i + seed) % 4 === 0 || i % 3 === 1 ? 'on' : ''} />)}</span>;
}

function QueueRow({ item, index, now, onVote, onCancel, busy, connected, paused }: { item: QueueItem; index: number; now: number; onVote: (id: string) => void; onCancel: (id: string) => void; busy: string | null; connected: boolean; paused: boolean }) {
  return <li className={`queue-row ${item.mine ? 'queue-row--mine' : ''}`}>
    <span className="queue-position mono">{String(index + 1).padStart(2, '0')}</span>
    <MiniWindows seed={index} />
    <div className="queue-item-main"><span className="queue-title">{item.clip.title}{item.mine && <span className="your-tag">YOURS</span>}</span><span className="queue-item-meta">{item.kind === 'pong' ? 'Pong' : item.kind === 'mario' ? 'Super Mario' : 'Light animation'} · {Math.round(turnDuration(item) / 1000)} seconds</span></div>
    <span className="queue-wait mono">{paused ? 'Paused' : <><span>IN</span> {remaining(item.scheduledAt - now)}</>}</span>
    <button className={`vote-button ${item.voted ? 'is-voted' : ''}`} aria-label={`${item.voted ? 'Remove your vote for' : 'Vote for'} ${item.clip.title}, ${item.votes} votes`} aria-pressed={item.voted} onClick={() => onVote(item.id)} disabled={busy === item.id || !connected}><Icon name="heart" size={16} /><span>{item.votes}</span></button>
    {item.mine && <button className="icon-button cancel-button" onClick={() => onCancel(item.id)} disabled={busy === item.id || !connected} aria-label={`Cancel your queued turn ${item.clip.title}`}><Icon name="close" size={17} /></button>}
  </li>;
}

export default function App() {
  const [state, setState] = useState<ShowState | null>(null);
  const [connected, setConnected] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [prompt, setPrompt] = useState('');
  const [examples, setExamples] = useState<Clip[]>([]);
  const quickExamples = useMemo(() => {
    const priority = ['heart', 'smile', 'arrow'];
    const rank = (clip: Clip) => { const index = priority.indexOf(clip.title.trim().toLowerCase()); return index < 0 ? priority.length : index; };
    return [...examples].sort((a, b) => rank(a) - rank(b));
  }, [examples]);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [preview, setPreview] = useState<Clip | null>(null);
  const [previewStartedAt, setPreviewStartedAt] = useState(Date.now());
  const [screen, setScreen] = useState<'preview' | 'live'>('live');
  const [activity, setActivity] = useState<'lights' | 'pong' | 'mario'>('lights');
  const [joiningPong, setJoiningPong] = useState(false);
  const [pongError, setPongError] = useState('');
  const [paddleX, setPaddleX] = useState(3);
  const [view, setView] = useState<BuildingView>('full');
  const [cameraRevision, setCameraRevision] = useState(0);
  const [renderingMode, setRenderingMode] = useState<RenderingMode>('loading');
  const [showFacadeInfo, setShowFacadeInfo] = useState(false);
  const [animationPaused, setAnimationPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [generating, setGenerating] = useState(false);
  const [loadingScore, setLoadingScore] = useState(false);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyQueueId, setBusyQueueId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [queueError, setQueueError] = useState('');
  const [notice, setNotice] = useState<{ type: 'submission'; id: string } | { type: 'cancel' } | null>(null);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);
  const [showHow, setShowHow] = useState(false);
  const [examplesError, setExamplesError] = useState(false);
  const activityRef = useRef(activity); activityRef.current = activity;
  const syncing = useRef(false);
  const stateRef = useRef<ShowState | null>(null);
  const lastPollAt = useRef(0);
  const pongJoinRequest = useRef<string | null>(null);
  const pongControl = useRef<{ allowed: boolean; id: string | null; endsAt: number; offset: number }>({ allowed: false, id: null, endsAt: 0, offset: 0 });
  const paddleInput = useRef<{ id: string | null; x: number | null; sequence: number; sentAt: number; busy: boolean }>({ id: null, x: null, sequence: 0, sentAt: 0, busy: false });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const focusEditorPending = useRef(false);
  const facadeButtonRef = useRef<HTMLButtonElement>(null);
  const requestId = useRef<{ clipId: string; id: string } | null>(null);

  const applyState = useCallback((next: ShowState, started: number) => {
    if (stateRef.current && next.serverTime < stateRef.current.serverTime) return;
    stateRef.current = next;
    setState(next); setClockOffset(next.serverTime - (started + Date.now()) / 2);
  }, []);

  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    const started = Date.now(); lastPollAt.current = started;
    try {
      const next = await api<ShowState>('/api/state');
      applyState(next, started); setConnected(true);
    } catch { setConnected(false); }
    finally { syncing.current = false; }
  }, [applyState]);

  useEffect(() => {
    void sync();
    const poll = window.setInterval(() => {
      const current = stateRef.current;
      const cadence = (current?.current?.kind === 'pong' || current?.current?.kind === 'mario') && !current.paused ? 200 : 1000;
      if (!document.hidden && Date.now() - lastPollAt.current >= cadence) void sync();
    }, 100);
    const timer = window.setInterval(() => setTick(Date.now()), 100);
    const visibility = () => { if (!document.hidden) void sync(); };
    const offline = () => setConnected(false);
    const online = () => { void sync(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    return () => { window.clearInterval(poll); window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, [sync]);

  useEffect(() => {
    let active = true;
    api<{ clips: Clip[] }>('/api/examples').then(({ clips }) => {
      if (!active) return;
      setExamples(clips);
    }).catch(() => { if (active) setExamplesError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!focusEditorPending.current || activity !== 'lights' || !editor || editor.disabled) return;
    focusEditorPending.current = false;
    editor.focus({ preventScroll: true });
    editor.scrollIntoView({ behavior: animationPaused ? 'instant' : 'smooth', block: 'center' });
  }, [activity, editorFocusRequest, generating, animationPaused]);

  function makeSomething() {
    focusEditorPending.current = true;
    setActivity('lights'); setEditorFocusRequest(value => value + 1);
  }

  const closeFacadeInfo = useCallback(() => {
    setShowFacadeInfo(false); facadeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showFacadeInfo) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeFacadeInfo(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showFacadeInfo, closeFacadeInfo]);

  function selectView(next: BuildingView) {
    setView(next); setCameraRevision(value => value + 1);
  }

  const now = tick + clockOffset;
  const scheduledItems = [state?.current, ...(state?.queue || [])].filter((item): item is QueueItem => !!item);
  const liveItem = state?.paused ? undefined : scheduledItems.find(item => item.scheduledAt > 0 && item.scheduledAt <= now && now < item.scheduledAt + turnDuration(item));
  const liveClip = liveItem?.clip || null;
  const livePlaying = !!liveItem;
  const mostRecentEnd = scheduledItems.reduce((end, item) => item.scheduledAt > 0 && item.scheduledAt + turnDuration(item) <= now ? Math.max(end, item.scheduledAt + turnDuration(item)) : end, 0);
  const liveStartedAt = liveItem?.scheduledAt || Math.max(state?.phaseStartedAt || now, mostRecentEnd);
  const waitingQueue = (state?.queue || []).filter(item => state?.paused || item.scheduledAt > now);
  const showingPreview = screen === 'preview' && !!preview;
  const shownClip = showingPreview ? preview : liveClip;
  const myQueue = waitingQueue.find(item => item.mine);
  const myPlaying = liveItem?.mine;
  const myTurnsAhead = myQueue ? Math.max(0, waitingQueue.findIndex(item => item.id === myQueue.id)) + (liveItem ? 1 : 0) : 0;
  const pongState = liveItem?.kind === 'pong' && state?.pong?.entryId === liveItem.id ? state.pong.state : null;
  const marioState = liveItem?.kind === 'mario' && state?.mario?.entryId === liveItem.id ? state.mario.state : null;
  const myPongTurn = !!liveItem?.mine && liveItem.kind === 'pong';
  const canControlPong = myPongTurn && !!pongState && connected && !state?.paused && !animationPaused && activity === 'pong' && screen === 'live';
  pongControl.current = { allowed: canControlPong, id: myPongTurn ? liveItem.id : null, endsAt: liveItem ? liveItem.scheduledAt + turnDuration(liveItem) : 0, offset: clockOffset };
  const completedMine = state?.completed.find(item => submittedIds.includes(item.id));
  const noticeText = notice?.type === 'cancel'
    ? 'Your turn was removed from the queue.'
    : notice?.type === 'submission'
      ? liveItem?.id === notice.id
        ? 'Your turn is live on the shared simulator.'
        : waitingQueue.some(item => item.id === notice.id)
          ? state?.paused ? 'Your turn is queued. The shared show is paused.' : 'You’re in. Your countdown is live below.'
          : state?.completed.some(item => item.id === notice.id)
            ? 'Your turn is complete. Thanks for lighting up the building.'
            : ''
      : '';
  const phaseRemaining = Math.max(0, (liveItem ? liveItem.scheduledAt + turnDuration(liveItem) : state?.phaseEndsAt || now) - now);
  const previewProgress = ((tick - previewStartedAt) % CLIP_MS) / CLIP_MS;
  const liveProgress = liveItem ? 1 - phaseRemaining / turnDuration(liveItem) : 0;
  const ready = !!state && connected;
  const alreadySubmitted = preview ? state?.queue.some(item => item.mine && item.clip.id === preview.id) || (state?.current?.mine && state.current.clip.id === preview.id) : false;
  const expired = preview ? preview.expiresAt > 0 && preview.expiresAt <= now : false;


  useEffect(() => {
    const id = myPongTurn ? liveItem.id : null;
    if (paddleInput.current.id !== id) {
      paddleInput.current = { id, x: null, sequence: 0, sentAt: 0, busy: false };
      setPaddleX(Math.round(pongState?.bottomX ?? 3)); setPongError('');
    }
    if (id && activity === 'pong') setScreen('live');
  }, [myPongTurn, liveItem?.id, activity]);

  useEffect(() => {
    if (myPongTurn && pongState && !paddleInput.current.busy && paddleInput.current.x === null) setPaddleX(Math.max(0, Math.min(6, Math.round(pongState.bottomX))));
  }, [myPongTurn, pongState?.bottomX]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const control = pongControl.current;
      const pending = paddleInput.current;
      if (!control.allowed || !control.id || document.hidden || Date.now() + control.offset >= control.endsAt) { pending.x = null; return; }
      if (document.hidden || pending.busy || pending.x === null || Date.now() - pending.sentAt < 125) return;
      const x = pending.x; const id = control.id;
      pending.x = null; pending.busy = true; pending.sentAt = Date.now();
      pending.sequence = Math.max(Date.now(), pending.sequence + 1);
      const started = Date.now();
      void api<ShowState>('/api/pong/input', { id, x, sequence: pending.sequence }).then(next => {
        applyState(next, started);
        if (pongControl.current.id === id) setPongError('');
      }).catch(err => {
        if (pongControl.current.id === id && pongControl.current.allowed) setPongError(err instanceof Error ? err.message : 'Paddle connection interrupted. Try again.');
      }).finally(() => { if (paddleInput.current === pending) pending.busy = false; });
    }, 25);
    return () => window.clearInterval(timer);
  }, [applyState]);

  function movePaddle(value: number) {
    if (!pongControl.current.allowed || Date.now() + pongControl.current.offset >= pongControl.current.endsAt) return;
    const x = Math.max(0, Math.min(6, Math.round(value)));
    setPaddleX(x); paddleInput.current.x = x;
  }

  function selectActivity(next: 'lights' | 'pong' | 'mario') {
    setActivity(next);
    if (next !== 'lights') { setScreen('live'); selectView('windows'); }
  }

  async function joinPong() {
    if (joiningPong || myQueue || myPlaying || !ready || state?.paused) return;
    setJoiningPong(true); setPongError(''); setNotice(null);
    pongJoinRequest.current ||= crypto.randomUUID();
    try {
      const started = Date.now();
      const result = await api<{ id: string; state: ShowState }>('/api/pong/join', { requestId: pongJoinRequest.current });
      applyState(result.state, started); setSubmittedIds(ids => [...ids, result.id]);
      pongJoinRequest.current = null; setScreen('live'); setNotice({ type: 'submission', id: result.id });
    } catch (err) { setPongError(err instanceof Error ? err.message : 'We could not add your Pong turn. Try again.'); }
    finally { setJoiningPong(false); }
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (prompt.trim().length < 1 || generating || loadingScore || loadingWeather) return;
    setGenerating(true); setError(''); setNotice(null);
    try {
      const { clip } = await api<{ clip: Clip }>('/api/preview', { prompt: prompt.trim() });
      setPreview(clip); setPreviewStartedAt(Date.now()); if (activityRef.current === 'lights') setScreen('preview'); requestId.current = null;
    } catch (err) { setError(err instanceof Error ? err.message : 'Your preview could not be created. Please try again.'); }
    finally { setGenerating(false); }
  }

  function selectExample(clip: Clip) {
    setPreview(clip); setPreviewStartedAt(Date.now()); setScreen('preview'); setPrompt(''); setError(''); setNotice(null); requestId.current = null;
  }

  async function loadRedSoxScore() {
    if (loadingScore || loadingWeather || generating) return;
    setLoadingScore(true); setError(''); setNotice(null);
    try {
      const { clip } = await api<{ clip: Clip }>('/api/red-sox', {});
      setPreview(clip); setPreviewStartedAt(Date.now()); setPrompt(''); requestId.current = null;
      if (activityRef.current === 'lights') setScreen('preview');
    } catch (err) { setError(err instanceof Error ? err.message : 'The latest score is unavailable. Try again shortly.'); }
    finally { setLoadingScore(false); }
  }

  async function loadWeather() {
    if (loadingWeather || loadingScore || generating) return;
    setLoadingWeather(true); setError(''); setNotice(null);
    try {
      const { clip } = await api<{ clip: Clip }>('/api/weather', {});
      setPreview(clip); setPreviewStartedAt(Date.now()); setPrompt(''); requestId.current = null;
      if (activityRef.current === 'lights') setScreen('preview');
    } catch (err) { setError(err instanceof Error ? err.message : 'The current weather is unavailable. Try again shortly.'); }
    finally { setLoadingWeather(false); }
  }

  function exampleButton(clip: Clip, index: number) {
    return <button key={clip.id} className={preview?.id === clip.id ? 'selected' : ''} onClick={() => selectExample(clip)} disabled={generating || loadingScore || loadingWeather}><span className={`example-symbol example-symbol--${index}`} aria-hidden="true">{exampleSymbol(clip.title)}</span>{clip.title === 'Neon rain' ? 'Make it rain' : clip.title}</button>;
  }

  async function submit() {
    if (!preview || submitting) return;
    setSubmitting(true); setError(''); setNotice(null);
    if (requestId.current?.clipId !== preview.id) requestId.current = { clipId: preview.id, id: crypto.randomUUID() };
    try {
      const started = Date.now();
      const result = await api<{ id: string; state: ShowState }>('/api/submit', { clipId: preview.id, requestId: requestId.current.id });
      applyState(result.state, started); setSubmittedIds(ids => [...ids, result.id]); requestId.current = null;
      setScreen('live'); setNotice({ type: 'submission', id: result.id });
    } catch (err) { setError(err instanceof Error ? err.message : 'We could not add your animation. Please try again.'); }
    finally { setSubmitting(false); }
  }

  async function queueAction(action: 'vote' | 'cancel', id: string) {
    setBusyQueueId(id); setQueueError('');
    try {
      const started = Date.now();
      const result = await api<ShowState>(`/api/${action}`, { id });
      applyState(result, started);
      if (action === 'cancel') { setNotice({ type: 'cancel' }); requestId.current = null; }
    } catch (err) { setQueueError(err instanceof Error ? err.message : 'Please try again.'); }
    finally { setBusyQueueId(null); }
  }

  return <>
    <a href="#create-controls" className="skip-link">Skip to creation controls</a>
    <header className="site-header">
      <a className="brand" href="/" aria-label="Hack This Building home"><span className="brand-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span><span><span className="domain-hack">hack</span><span className="domain-this">this</span><span className="domain-building">building</span><span className="domain-com">.com</span></span></a>
      <span className="header-middle">A public light experiment.</span><div className="header-right"><span className="event-label mono">SUNDAI HACK 140 <span>↗</span></span><a href="https://github.com/ryanznie/hackthisbuilding.com" target="_blank" rel="noreferrer" className="source-link">Open source <Icon name="external" size={14} /></a></div>
    </header>

    <main>
      <section className="intro" aria-labelledby="main-title"><div><p className="eyebrow mono"><span className="tiny-cross">+</span> MIT GREEN BUILDING / CAMBRIDGE, MA</p><h1 id="main-title"><span className="desktop-intro-title">Give this building <span>an idea.</span></span><span className="mobile-intro-title">Light up the building.</span></h1><p className="mobile-flow">{activity === 'lights' ? <>Describe <span aria-hidden="true">→</span> Preview <span aria-hidden="true">→</span> Submit</> : <>Join the queue <span aria-hidden="true">→</span> Play for 30 seconds</>}</p></div><p className="intro-description">Explore the building. Imagine something.<br /><span>153 windows are waiting for your idea.</span></p></section>

      <section className="workspace" aria-label="Building animation studio">
        <div className={`simulator-panel ${!showingPreview && liveItem?.kind === 'pong' ? 'is-pong-display' : ''}`}>
          <div className="simulator-toolbar"><div className="screen-tabs" role="group" aria-label="Display source"><button aria-pressed={screen === 'preview'} className={screen === 'preview' ? 'active' : ''} onClick={() => setScreen('preview')} disabled={!preview}>Your preview</button><button aria-pressed={screen === 'live'} className={screen === 'live' ? 'active' : ''} onClick={() => setScreen('live')}><span className={`status-dot ${connected ? '' : 'status-dot--offline'}`} />Shared show</button></div><span className={`renderer-status renderer-status--${renderingMode}`}><span className="renderer-cube" aria-hidden="true">◇</span>{renderingMode === '3d' ? 'Interactive 3D' : renderingMode === '2d' ? '2D fallback' : 'Loading 3D'}</span></div>
          <p className="display-connection mono" role="status">{state?.display?.configured ? state.display.connected ? 'Sundai simulator connected' : 'Sundai simulator disconnected · show paused' : 'Web simulator'}</p><div className="building-stage">
            <BuildingExperience onModeChange={setRenderingMode} cameraRevision={cameraRevision} durationMs={showingPreview ? CLIP_MS : liveItem ? turnDuration(liveItem) : TURN_MS} pong={showingPreview ? null : pongState} mario={showingPreview ? null : marioState} scene={shownClip?.scene || null} startedAt={showingPreview ? previewStartedAt : liveStartedAt} clockOffset={showingPreview ? 0 : clockOffset} view={view} paused={animationPaused || !!state?.paused && !showingPreview} preview={showingPreview} title={shownClip?.title || 'hackthisbuilding.com'} />
            <div className="scene-topline"><span className="scene-coordinate">MIT Green Building<span className="mono">42°21′38.5″N / 71°05′23.5″W</span></span><span className="frame-spec mono">09 × 17<span>WINDOWS</span></span></div>
            <div className="scene-caption"><span className="mono">{showingPreview ? preview?.source === 'example' ? 'EXAMPLE PREVIEW' : 'YOUR PREVIEW' : state?.paused ? 'SHOW PAUSED' : livePlaying ? 'NOW PLAYING' : 'WEBSITE LOOP'}</span><h2>{shownClip?.title || 'hackthisbuilding.com'}</h2><p>{showingPreview ? 'Loops here. Goes public only when you submit.' : livePlaying ? `${myPlaying ? 'Your turn' : 'Community turn'} · ${remaining(phaseRemaining)} remaining` : 'The website scrolls while the next turn gets ready.'}</p></div>
            <div className="scene-bottomline"><div className="view-controls" role="group" aria-label="Building camera view">{(['full', 'windows', 'river'] as const).map(mode => <button key={mode} aria-pressed={view === mode} onClick={() => selectView(mode)} className={view === mode ? 'active' : ''} title={mode === 'full' ? 'Reset to street view' : mode === 'windows' ? 'Look at the light facade' : 'View from across the river'}>{mode === 'full' ? 'Street' : mode === 'windows' ? 'Facade' : 'River'}</button>)}</div><div className="stage-actions"><button ref={facadeButtonRef} className={`facade-hotspot ${showFacadeInfo ? 'is-open' : ''}`} onClick={() => { setShowFacadeInfo(value => !value); if (!showFacadeInfo) selectView('windows'); }} aria-expanded={showFacadeInfo} aria-controls="facade-detail" aria-label={showFacadeInfo ? 'Close explanation of the 153 windows' : 'Explore the 153-window light facade'}><span className="hotspot-disc" aria-hidden="true">{showFacadeInfo ? '−' : '+'}</span><span className="hotspot-label">153 windows</span></button><button className="playback-button" onClick={() => setAnimationPaused(v => !v)} aria-label={animationPaused ? 'Resume animation' : 'Pause animation'} title={animationPaused ? 'Resume animation' : 'Pause animation'}><Icon name={animationPaused ? 'play' : 'pause'} size={16} /></button></div></div>
          </div>
          <div className="playback-progress" role="progressbar" aria-label={showingPreview ? 'Preview playback' : 'Shared show playback'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(1, showingPreview ? previewProgress : liveProgress)) * 100)}><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, showingPreview ? previewProgress : liveProgress))})` }} /></div>
          <div className="simulator-footnote"><span>{renderingMode === '3d' ? <><span className="orbit-symbol" aria-hidden="true">↔</span><span className="desktop-orbit-tip">Drag to orbit · scroll to zoom</span><span className="mobile-orbit-tip">Drag to orbit · pinch to zoom</span></> : renderingMode === '2d' ? '3D unavailable on this browser · 2D preview active' : 'The interactive scene is loading…'}</span><span className="mono">BROWSER SIMULATOR <span className="footnote-separator">/</span> {showingPreview ? '5 SEC PREVIEW' : livePlaying ? `${remaining(phaseRemaining)} LEFT` : 'WEBSITE LOOP'}</span></div>
          {showFacadeInfo && <div className="facade-detail" id="facade-detail"><span className="facade-detail-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span><div><h3>One window. One pixel.</h3><p>Nine columns and seventeen rows turn this facade into a canvas. Bold shapes and simple movement read best at building scale. Your five-second preview loops for 30 seconds in the shared show.</p></div><button className="icon-button" onClick={closeFacadeInfo} aria-label="Close facade explanation"><Icon name="close" size={18} /></button></div>}
        </div>

        <aside className="prompt-panel" id="create-controls" aria-label="Create lights, play Pong or Super Mario">
          <div className="activity-tabs" role="group" aria-label="Choose your activity"><button aria-pressed={activity === 'lights'} className={activity === 'lights' ? 'active' : ''} onClick={() => selectActivity('lights')}>Create lights</button><button aria-pressed={activity === 'pong'} className={activity === 'pong' ? 'active' : ''} onClick={() => selectActivity('pong')}>Play Pong</button><button aria-pressed={activity === 'mario'} className={activity === 'mario' ? 'active' : ''} onClick={() => selectActivity('mario')}>Super Mario</button><span>30 SEC / TURN</span></div>
          {(myQueue || myPlaying) && <div className="inline-turn-status" aria-label="Your turn status"><span className="status-dot" /><span>{myPlaying ? <>Your turn · <strong>{remaining(phaseRemaining)} left</strong></> : state?.paused ? 'Your turn is queued · show paused' : <><strong>{myTurnsAhead} {myTurnsAhead === 1 ? 'turn' : 'turns'} ahead</strong> · ETA {remaining(myQueue!.scheduledAt - now)}</>}</span><button className="text-button" onClick={() => setScreen('live')}>Watch <Icon name="arrow" size={12} /></button></div>}
          {activity === 'mario' ? <MarioControls state={state} connected={connected} paused={animationPaused || screen !== 'live'} clockOffset={clockOffset} onState={applyState} onJoined={id => { setSubmittedIds(ids => [...ids, id]); setNotice({ type: 'submission', id }); setScreen('live'); }} /> : activity === 'lights' ? <div className="lights-pane">
          <div className="panel-heading"><span className="step-number mono">01</span><h2>Make a little spectacle.</h2><Icon name="spark" size={20} /></div>
          <p className="panel-description">A beating heart. A rocket in the night.<br />What would you put on the skyline?</p>
          <form onSubmit={generate} className="prompt-form"><label htmlFor="prompt">YOUR IDEA <span className="mono">{prompt.length}/280</span></label><div className={`textarea-wrap ${generating ? 'is-generating' : ''}`}><textarea ref={editorRef} id="prompt" value={prompt} maxLength={280} minLength={1} placeholder="Show the Sundai logo…" onChange={event => { setPrompt(event.target.value); setError(''); }} aria-describedby="prompt-help prompt-error" disabled={generating} /><span className="prompt-corner" aria-hidden="true">↵</span></div><p id="prompt-help" className="input-hint">Preview your idea, then submit for a 30-second turn.</p><button className="generate-button" type="submit" disabled={prompt.trim().length < 1 || generating || loadingScore || loadingWeather}>{generating ? <><span className="spinner" />Creating your preview…</> : <><Icon name="spark" />Create preview<Icon name="arrow" /></>}</button></form>
          <div id="prompt-error" role={error ? 'alert' : undefined}>{error && <p className="form-message form-message--error">{error}</p>}</div>
          {state && !state.generationAvailable && !error && <p className="service-note">Custom prompts are temporarily unavailable. You can still preview and submit an example below.</p>}
          <div className="examples"><p className="section-label mono">TRY AN EXAMPLE</p><div className="example-buttons">{quickExamples.slice(0, 3).map(exampleButton)}<button className={preview?.id.startsWith('score_') ? 'selected' : ''} onClick={() => void loadRedSoxScore()} disabled={generating || loadingScore || loadingWeather}><span className="example-symbol" aria-hidden="true">{loadingScore ? '…' : '⚾'}</span>{loadingScore ? 'Loading score…' : 'Red Sox score'}</button><button className={preview?.id.startsWith('weather_') ? 'selected' : ''} onClick={() => void loadWeather()} disabled={generating || loadingScore || loadingWeather}><span className="example-symbol" aria-hidden="true">{loadingWeather ? '…' : '☀'}</span>{loadingWeather ? 'Loading weather…' : 'Weather'}</button>{quickExamples.slice(3).map(exampleButton)}</div>{examplesError && <p className="input-hint">Examples could not be loaded. Refresh to try again.</p>}{!examples.length && !examplesError && <p className="input-hint">Loading examples…</p>}</div>
          <div className="submit-section"><div className="preview-heading"><span className="step-number mono">02</span><h2>{preview ? 'Like what you see?' : 'Preview it. Make it yours.'}</h2><span className="duration-tag mono">30 SEC TURN</span></div>{preview ? <><p className={`preview-description ${/^(score|weather)_/.test(preview.id) ? 'score-description' : ''}`}>{preview.interpretation}</p>{preview.id.startsWith('weather_') && <p className="input-hint">Weather data: <a href="https://www.weather.gov/" target="_blank" rel="noreferrer">NOAA / NWS</a> · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>. Current conditions, separate from Make it rain.</p>}<div className="preview-meta"><span className="mono">{preview.source === 'example' ? 'READY-MADE EXAMPLE' : 'PREVIEW READY'}</span><button className="text-button" onClick={() => { setScreen('preview'); setPreviewStartedAt(Date.now()); }}><Icon name="play" size={12} />Replay</button></div></> : <p className="preview-description">Your animation will play on the building preview. Submit when you’re ready for your 30-second turn.</p>}<button className="submit-button" onClick={submit} disabled={!preview || submitting || loadingScore || loadingWeather || !ready || alreadySubmitted || expired || !!state?.paused}>{submitting ? <><span className="spinner" />Joining queue…</> : alreadySubmitted ? <><Icon name="check" />In the shared queue</> : state?.paused ? 'The shared show is paused' : expired ? 'Preview expired · create a new one' : <><span>Submit to shared show</span><Icon name="arrow" /></>}</button><p className="submit-hint">30 seconds per turn. {state?.queue.length ? `Join ${state.queue.length} ${state.queue.length === 1 ? 'idea' : 'ideas'} in the queue.` : 'Be the next idea on the building.'}</p></div>
          </div> : <div className="pong-pane">
            {myPongTurn ? <>
              <div className="pong-scoreboard" aria-label={`Pong score: AI ${pongState?.topScore ?? 0}, you ${pongState?.bottomScore ?? 0}`}><div><span>AI / TOP</span><strong>{pongState?.topScore ?? '—'}</strong></div><span className="pong-clock mono">{remaining(phaseRemaining)}</span><div><span>YOU / BOTTOM</span><strong>{pongState?.bottomScore ?? '—'}</strong></div></div>
              <label className="paddle-label" htmlFor="pong-paddle">Move your paddle<span>LEFT ↔ RIGHT</span></label>
              <fieldset className="paddle-controls" disabled={!canControlPong}><legend className="sr-only">Your Pong paddle</legend><button onClick={() => movePaddle(paddleX - 1)} aria-label="Move paddle left" disabled={!canControlPong || paddleX === 0}>←</button><input id="pong-paddle" type="range" min="0" max="6" step="1" value={paddleX} onChange={event => movePaddle(Number(event.target.value))} aria-label="Paddle position" aria-valuetext={`Position ${paddleX + 1} of 7`} /><button onClick={() => movePaddle(paddleX + 1)} aria-label="Move paddle right" disabled={!canControlPong || paddleX === 6}>→</button></fieldset>
              <p className="pong-hint">{!connected ? 'Reconnecting. Controls will return when connected.' : screen !== 'live' ? 'Switch to Shared show to see and control your game.' : animationPaused ? 'Resume the animation above to play your turn.' : 'You control the bottom paddle. Beat the AI above.'}</p>
            </> : <>
              <div className="pong-intro"><span className="pong-mini-court" aria-hidden="true"><i /><i /><i /></span><div><h2>Your phone. One giant game.</h2><p>Play the AI for 30 seconds. Your paddle controls appear when it’s your turn.</p></div></div>
              {liveItem?.kind === 'pong' && pongState && <div className="pong-spectator-score"><span>Now playing</span><strong>AI {pongState.topScore} — {pongState.bottomScore} Player</strong><span>{remaining(phaseRemaining)} left</span></div>}
              <button className="submit-button pong-join-button" onClick={joinPong} disabled={joiningPong || !ready || !!state?.paused || !!myQueue || !!myPlaying}>{joiningPong ? <><span className="spinner" />Joining queue…</> : myQueue ? 'Your turn is queued' : myPlaying ? 'Finish your current turn first' : state?.paused ? 'The shared show is paused' : <><span>Join Pong queue</span><Icon name="arrow" /></>}</button>
              <p className="pong-hint">{myQueue ? myQueue.kind === 'pong' ? 'Keep this page open. Your controls will appear automatically.' : 'Your light animation is queued. Join Pong after that turn.' : 'Same building. Same queue. Everyone gets a turn.'}</p>
            </>}
            {pongError && <p className="form-message form-message--error" role="alert">{pongError}</p>}
            <a className="pong-credit" href="https://github.com/XanderCogan/pong-hack-sundai140" target="_blank" rel="noreferrer">Pong by Xander <Icon name="external" size={11} /></a>
          </div>}
          {noticeText && <p className="form-message form-message--success" role="status"><Icon name="check" size={16} />{noticeText}</p>}
        </aside>
      </section>

      {(myQueue || myPlaying || completedMine) && <section className="personal-status" aria-label="Your turn status"><span className="personal-status-icon"><Icon name={myPlaying ? 'play' : completedMine && !myQueue ? 'check' : 'queue'} size={22} /></span><div><p className="mono">{myPlaying ? 'THIS IS YOUR MOMENT' : myQueue ? 'YOUR TURN IS ON ITS WAY' : 'YOU LIT UP THE SIMULATOR'}</p><h2>{myPlaying ? liveItem?.clip.title : myQueue?.clip.title || completedMine?.title}</h2></div><div className="personal-countdown"><strong>{myPlaying ? remaining(phaseRemaining) : myQueue ? state?.paused ? '—' : remaining(myQueue.scheduledAt - now) : '✓'}</strong><span>{myPlaying ? 'LEFT ON THE BUILDING' : myQueue ? state?.paused ? 'SHOW PAUSED' : 'UNTIL YOUR TURN' : 'PLAYED'}</span></div><button className="text-button" onClick={() => setScreen('live')}>Watch shared show <Icon name="arrow" size={16} /></button></section>}

      <section className="queue-section" id="queue" aria-labelledby="queue-heading"><div className="queue-heading"><div><p className="eyebrow mono"><span className="tiny-cross">+</span> EVERYONE GETS A TURN</p><h2 id="queue-heading">Next on the building<span className="queue-count mono">{state ? waitingQueue.length : '—'}</span></h2></div><div className="queue-rules"><span className={`status-dot ${connected ? '' : 'status-dot--offline'}`} />{connected ? 'Shared queue · updates live' : 'Connecting to shared queue'}</div></div>
        <div className="show-timeline"><div className="timeline-step timeline-step--now"><span className="mono">{livePlaying ? 'ON THE BUILDING' : 'BETWEEN IDEAS'}</span><strong>{livePlaying ? liveItem?.clip.title : 'hackthisbuilding.com'}</strong><span>{state?.paused ? 'Show paused' : livePlaying ? `${remaining(phaseRemaining)} remaining` : 'The website scrolls between community turns'}</span></div><Icon name="arrow" size={20} /><div className="timeline-step"><span className="mono">THE RHYTHM</span><strong>Your turn. 30 seconds.</strong><span>Lights, Pong and Super Mario share one queue.</span></div><span className="timeline-seconds mono">30<span>SEC</span></span></div>
        {queueError && <p className="form-message form-message--error" role="alert">{queueError}</p>}
        {waitingQueue.length ? <ol className="queue-list">{waitingQueue.map((item, index) => <QueueRow key={item.id} item={item} index={index} now={now} onVote={id => void queueAction('vote', id)} onCancel={id => void queueAction('cancel', id)} busy={busyQueueId} connected={connected} paused={!!state?.paused} />)}</ol> : <div className="queue-empty"><span className="empty-grid" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span><div><h3>{!state ? 'Finding the shared show…' : 'You’re up next. Make it yours.'}</h3><p>{!state ? 'The public queue will appear here when connected.' : 'No turns waiting. Create lights or choose a game.'}</p></div><button className="text-button" onClick={makeSomething}>Make something <Icon name="arrow" size={16} /></button></div>}
        <div className="queue-footer"><span><Icon name="heart" size={14} />Give ideas some love. Votes are reactions; the queue stays first come, first served.</span><button className="text-button" onClick={() => setShowHow(v => !v)} aria-expanded={showHow} aria-controls="how-it-works">How it works <span>{showHow ? '−' : '+'}</span></button></div>
        {showHow && <div id="how-it-works" className="how-it-works"><p><strong>1. Prompt & preview.</strong> Describe a simple animation. Your idea becomes a five-second preview across 9 columns and 17 rows. Your approved preview loops for 30 seconds when its public turn begins.</p><p><strong>2. Submit & wait your turn.</strong> Your lights or game join the same first-come queue. Everyone sees the same show, and your personal countdown tells you when to look.</p><p><strong>3. Pass the building on.</strong> Every turn lasts 30 seconds. The four-color website scroll returns between turns. This is a browser simulator for the Sundai hack.</p></div>}
      </section>
      <footer className="site-footer"><div><span className="footer-cross" aria-hidden="true">✳</span><span>Built together at <a href="https://www.sundai.club/events/boston/beyond-tetris-building-scale-physical-ai-for-mit-green-building" target="_blank" rel="noreferrer">Sundai Hack 140</a>.</span></div><span className="footer-baseline-note">Explore the architecture. Light up the city.</span></footer>
    </main>
  </>;
}
