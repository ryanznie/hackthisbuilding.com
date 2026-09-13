import { useCallback, useEffect, useRef, useState } from 'react';
import { type BuildingView } from './Building';
import { BuildingExperience, type RenderingMode } from './BuildingExperience';
import { CLIP_MS, URL_PASS_MS, type Clip, type ShowState, type QueueItem } from '../shared/contracts';

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

function MiniWindows({ seed = 0 }: { seed?: number }) {
  return <span className="mini-windows" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => <i key={i} className={(i + seed) % 4 === 0 || i % 3 === 1 ? 'on' : ''} />)}</span>;
}

function QueueRow({ item, index, now, onVote, onCancel, busy, connected, paused }: { item: QueueItem; index: number; now: number; onVote: (id: string) => void; onCancel: (id: string) => void; busy: string | null; connected: boolean; paused: boolean }) {
  return <li className={`queue-row ${item.mine ? 'queue-row--mine' : ''}`}>
    <span className="queue-position mono">{String(index + 1).padStart(2, '0')}</span>
    <MiniWindows seed={index} />
    <div className="queue-item-main"><span className="queue-title">{item.clip.title}{item.mine && <span className="your-tag">YOURS</span>}</span><span className="queue-item-meta">{item.clip.source === 'example' ? 'Ready-made example' : 'Community prompt'} · 5 second animation</span></div>
    <span className="queue-wait mono">{paused ? 'Paused' : <><span>IN</span> {remaining(item.scheduledAt - now)}</>}</span>
    <button className={`vote-button ${item.voted ? 'is-voted' : ''}`} aria-label={`${item.voted ? 'Remove your vote for' : 'Vote for'} ${item.clip.title}, ${item.votes} votes`} aria-pressed={item.voted} onClick={() => onVote(item.id)} disabled={busy === item.id || !connected}><Icon name="heart" size={16} /><span>{item.votes}</span></button>
    {item.mine && <button className="icon-button cancel-button" onClick={() => onCancel(item.id)} disabled={busy === item.id || !connected} aria-label={`Cancel your queued animation ${item.clip.title}`}><Icon name="close" size={17} /></button>}
  </li>;
}

export default function App() {
  const [state, setState] = useState<ShowState | null>(null);
  const [connected, setConnected] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [prompt, setPrompt] = useState('');
  const [examples, setExamples] = useState<Clip[]>([]);
  const [preview, setPreview] = useState<Clip | null>(null);
  const [previewStartedAt, setPreviewStartedAt] = useState(Date.now());
  const [screen, setScreen] = useState<'preview' | 'live'>('preview');
  const [view, setView] = useState<BuildingView>('full');
  const [cameraRevision, setCameraRevision] = useState(0);
  const [renderingMode, setRenderingMode] = useState<RenderingMode>('loading');
  const [showFacadeInfo, setShowFacadeInfo] = useState(false);
  const [animationPaused, setAnimationPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyQueueId, setBusyQueueId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [queueError, setQueueError] = useState('');
  const [notice, setNotice] = useState<{ type: 'submission'; id: string } | { type: 'cancel' } | null>(null);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);
  const [showHow, setShowHow] = useState(false);
  const [examplesError, setExamplesError] = useState(false);
  const syncing = useRef(false);
  const exampleInitialized = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const facadeButtonRef = useRef<HTMLButtonElement>(null);
  const requestId = useRef<{ clipId: string; id: string } | null>(null);

  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    const started = Date.now();
    try {
      const next = await api<ShowState>('/api/state');
      setClockOffset(next.serverTime - (started + Date.now()) / 2);
      setState(next); setConnected(true);
    } catch { setConnected(false); }
    finally { syncing.current = false; }
  }, []);

  useEffect(() => {
    void sync();
    const poll = window.setInterval(() => { if (!document.hidden) void sync(); }, 1000);
    const timer = window.setInterval(() => setTick(Date.now()), 100);
    const visibility = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(poll); window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [sync]);

  useEffect(() => {
    let active = true;
    api<{ clips: Clip[] }>('/api/examples').then(({ clips }) => {
      if (!active) return;
      setExamples(clips);
      if (!exampleInitialized.current && clips.length) { setPreview(clips[0]); setPreviewStartedAt(Date.now()); exampleInitialized.current = true; }
    }).catch(() => { if (active) setExamplesError(true); });
    return () => { active = false; };
  }, []);

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
  const liveItem = state?.paused ? undefined : scheduledItems.find(item => item.scheduledAt > 0 && item.scheduledAt <= now && now < item.scheduledAt + CLIP_MS);
  const liveClip = liveItem?.clip || null;
  const livePlaying = !!liveItem;
  const mostRecentEnd = scheduledItems.reduce((end, item) => item.scheduledAt > 0 && item.scheduledAt + CLIP_MS <= now ? Math.max(end, item.scheduledAt + CLIP_MS) : end, 0);
  const liveStartedAt = liveItem?.scheduledAt || Math.max(state?.phaseStartedAt || now, mostRecentEnd);
  const waitingQueue = (state?.queue || []).filter(item => state?.paused || item.scheduledAt > now);
  const showingPreview = screen === 'preview' && !!preview;
  const shownClip = showingPreview ? preview : liveClip;
  const myQueue = waitingQueue.find(item => item.mine);
  const myPlaying = liveItem?.mine;
  const completedMine = state?.completed.find(item => submittedIds.includes(item.id));
  const noticeText = notice?.type === 'cancel'
    ? 'Your animation was removed from the queue.'
    : notice?.type === 'submission'
      ? liveItem?.id === notice.id
        ? 'Your animation is playing on the shared simulator.'
        : waitingQueue.some(item => item.id === notice.id)
          ? state?.paused ? 'Your animation is queued. The shared show is paused.' : 'You’re in the queue. Your countdown is live below.'
          : state?.completed.some(item => item.id === notice.id)
            ? 'Your animation played on the shared simulator. Make another idea when you’re ready.'
            : ''
      : '';
  const phaseRemaining = Math.max(0, (liveItem ? liveItem.scheduledAt + CLIP_MS : state?.phaseEndsAt || now) - now);
  const previewProgress = ((tick - previewStartedAt) % CLIP_MS) / CLIP_MS;
  const liveProgress = livePlaying ? 1 - phaseRemaining / CLIP_MS : ((now - liveStartedAt) % URL_PASS_MS) / URL_PASS_MS;
  const urlPass = state ? Math.floor(Math.max(0, now - liveStartedAt) / URL_PASS_MS) % 2 + 1 : 1;
  const ready = !!state && connected;
  const alreadySubmitted = preview ? state?.queue.some(item => item.mine && item.clip.id === preview.id) || (state?.current?.mine && state.current.clip.id === preview.id) : false;
  const expired = preview ? preview.expiresAt > 0 && preview.expiresAt <= now : false;

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (prompt.trim().length < 3 || generating) return;
    setGenerating(true); setError(''); setNotice(null);
    try {
      const { clip } = await api<{ clip: Clip }>('/api/preview', { prompt: prompt.trim() });
      setPreview(clip); setPreviewStartedAt(Date.now()); setScreen('preview'); requestId.current = null;
    } catch (err) { setError(err instanceof Error ? err.message : 'Your preview could not be created. Please try again.'); }
    finally { setGenerating(false); }
  }

  function selectExample(clip: Clip) {
    setPreview(clip); setPreviewStartedAt(Date.now()); setScreen('preview'); setPrompt(''); setError(''); setNotice(null); requestId.current = null;
  }

  async function submit() {
    if (!preview || submitting) return;
    setSubmitting(true); setError(''); setNotice(null);
    if (requestId.current?.clipId !== preview.id) requestId.current = { clipId: preview.id, id: crypto.randomUUID() };
    try {
      const started = Date.now();
      const result = await api<{ id: string; state: ShowState }>('/api/submit', { clipId: preview.id, requestId: requestId.current.id });
      setState(result.state); setClockOffset(result.state.serverTime - (started + Date.now()) / 2); setSubmittedIds(ids => [...ids, result.id]); requestId.current = null;
      setScreen('live'); setNotice({ type: 'submission', id: result.id });
    } catch (err) { setError(err instanceof Error ? err.message : 'We could not add your animation. Please try again.'); }
    finally { setSubmitting(false); }
  }

  async function queueAction(action: 'vote' | 'cancel', id: string) {
    setBusyQueueId(id); setQueueError('');
    try {
      const started = Date.now();
      const result = await api<ShowState>(`/api/${action}`, { id });
      setState(result); setClockOffset(result.serverTime - (started + Date.now()) / 2);
      if (action === 'cancel') { setNotice({ type: 'cancel' }); requestId.current = null; }
    } catch (err) { setQueueError(err instanceof Error ? err.message : 'Please try again.'); }
    finally { setBusyQueueId(null); }
  }

  return <>
    <a href="#prompt" className="skip-link">Skip to prompt editor</a>
    <header className="site-header">
      <a className="brand" href="/" aria-label="Hack This Building home"><span className="brand-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span><span>hack<span className="brand-light">this</span>building<span className="brand-dot">.</span></span></a>
      <span className="header-middle">A public light experiment.</span><div className="header-right"><span className="event-label mono">SUNDAI HACK 140 <span>↗</span></span><a href="https://github.com/ryanznie/hackthisbuilding.com" target="_blank" rel="noreferrer" className="source-link">Open source <Icon name="external" size={14} /></a></div>
    </header>

    <main>
      <section className="intro" aria-labelledby="main-title"><div><p className="eyebrow mono"><span className="tiny-cross">+</span> MIT GREEN BUILDING / CAMBRIDGE, MA</p><h1 id="main-title"><span className="desktop-intro-title">Give this building <span>an idea.</span></span><span className="mobile-intro-title">Light up the building.</span></h1><p className="mobile-flow">Describe <span aria-hidden="true">→</span> Preview <span aria-hidden="true">→</span> Submit</p></div><p className="intro-description">Explore the building. Imagine something.<br /><span>153 windows are waiting for your idea.</span></p></section>

      <section className="workspace" aria-label="Building animation studio">
        <div className="simulator-panel">
          <div className="simulator-toolbar"><div className="screen-tabs" role="group" aria-label="Display source"><button aria-pressed={screen === 'preview'} className={screen === 'preview' ? 'active' : ''} onClick={() => setScreen('preview')} disabled={!preview}>Your preview</button><button aria-pressed={screen === 'live'} className={screen === 'live' ? 'active' : ''} onClick={() => setScreen('live')}><span className={`status-dot ${connected ? '' : 'status-dot--offline'}`} />Shared show</button></div><span className={`renderer-status renderer-status--${renderingMode}`}><span className="renderer-cube" aria-hidden="true">◇</span>{renderingMode === '3d' ? 'Interactive 3D' : renderingMode === '2d' ? '2D fallback' : 'Loading 3D'}</span></div>
          <div className="building-stage">
            <BuildingExperience onModeChange={setRenderingMode} cameraRevision={cameraRevision} scene={shownClip?.scene || null} startedAt={showingPreview ? previewStartedAt : liveStartedAt} clockOffset={showingPreview ? 0 : clockOffset} view={view} paused={animationPaused || !!state?.paused && !showingPreview} preview={showingPreview} title={shownClip?.title || 'hackthisbuilding.com invitation'} />
            <div className="scene-topline"><span className="scene-coordinate">MIT Green Building<span className="mono">42°21′38.5″N / 71°05′23.5″W</span></span><span className="frame-spec mono">09 × 17<span>WINDOWS</span></span></div>
            <div className="scene-caption"><span className="mono">{showingPreview ? preview?.source === 'example' ? 'EXAMPLE PREVIEW' : 'YOUR PREVIEW' : state?.paused ? 'SHOW PAUSED' : livePlaying ? 'NOW PLAYING' : 'OPEN INVITATION'}</span><h2>{shownClip?.title || 'Your idea could be here.'}</h2><p>{showingPreview ? 'Loops here. Goes public only when you submit.' : livePlaying ? `${myPlaying ? 'Your animation' : 'Community animation'} · ${remaining(phaseRemaining)} remaining` : 'hackthisbuilding.com · Come make something.'}</p></div>
            <div className="scene-bottomline"><div className="view-controls" role="group" aria-label="Building camera view">{(['full', 'windows', 'river'] as const).map(mode => <button key={mode} aria-pressed={view === mode} onClick={() => selectView(mode)} className={view === mode ? 'active' : ''} title={mode === 'full' ? 'Reset to street view' : mode === 'windows' ? 'Look at the light facade' : 'View from across the river'}>{mode === 'full' ? 'Street' : mode === 'windows' ? 'Facade' : 'River'}</button>)}</div><div className="stage-actions"><button ref={facadeButtonRef} className={`facade-hotspot ${showFacadeInfo ? 'is-open' : ''}`} onClick={() => { setShowFacadeInfo(value => !value); if (!showFacadeInfo) selectView('windows'); }} aria-expanded={showFacadeInfo} aria-controls="facade-detail" aria-label={showFacadeInfo ? 'Close explanation of the 153 windows' : 'Explore the 153-window light facade'}><span className="hotspot-disc" aria-hidden="true">{showFacadeInfo ? '−' : '+'}</span><span className="hotspot-label">153 windows</span></button><button className="playback-button" onClick={() => setAnimationPaused(v => !v)} aria-label={animationPaused ? 'Resume animation' : 'Pause animation'} title={animationPaused ? 'Resume animation' : 'Pause animation'}><Icon name={animationPaused ? 'play' : 'pause'} size={16} /></button></div></div>
          </div>
          <div className="playback-progress" role="progressbar" aria-label={showingPreview ? 'Preview playback' : 'Shared show playback'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(1, showingPreview ? previewProgress : liveProgress)) * 100)}><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, showingPreview ? previewProgress : liveProgress))})` }} /></div>
          <div className="simulator-footnote"><span>{renderingMode === '3d' ? <><span className="orbit-symbol" aria-hidden="true">↔</span><span className="desktop-orbit-tip">Drag to orbit · scroll to zoom</span><span className="mobile-orbit-tip">Drag to orbit · pinch to zoom</span></> : renderingMode === '2d' ? '3D unavailable on this browser · 2D preview active' : 'The interactive scene is loading…'}</span><span className="mono">BROWSER SIMULATOR <span className="footnote-separator">/</span> {showingPreview ? '5 SEC LOOP' : livePlaying ? '5 SEC LIVE' : `URL ${urlPass}/2`}</span></div>
          {showFacadeInfo && <div className="facade-detail" id="facade-detail"><span className="facade-detail-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span><div><h3>One window. One pixel.</h3><p>Nine columns and seventeen rows turn this facade into a canvas. Bold shapes and simple movement read best at building scale. Your five-second preview uses the same 153-window grid as the shared show.</p></div><button className="icon-button" onClick={closeFacadeInfo} aria-label="Close facade explanation"><Icon name="close" size={18} /></button></div>}
        </div>

        <aside className="prompt-panel" aria-label="Create your animation">
          <div className="panel-heading"><span className="step-number mono">01</span><h2>Make a little spectacle.</h2><Icon name="spark" size={20} /></div>
          <p className="panel-description">A beating heart. A rocket in the night.<br />What would you put on the skyline?</p>
          <form onSubmit={generate} className="prompt-form"><label htmlFor="prompt">YOUR IDEA <span className="mono">{prompt.length}/280</span></label><div className={`textarea-wrap ${generating ? 'is-generating' : ''}`}><textarea ref={editorRef} id="prompt" value={prompt} maxLength={280} minLength={3} placeholder="Show the Sundai logo…" onChange={event => { setPrompt(event.target.value); setError(''); }} aria-describedby="prompt-help prompt-error" disabled={generating} /><span className="prompt-corner" aria-hidden="true">↵</span></div><p id="prompt-help" className="input-hint">Every prompt is checked. Preview before you submit.</p><button className="generate-button" type="submit" disabled={prompt.trim().length < 3 || generating}>{generating ? <><span className="spinner" />Creating your preview…</> : <><Icon name="spark" />Create preview<Icon name="arrow" /></>}</button></form>
          <div id="prompt-error" role={error ? 'alert' : undefined}>{error && <p className="form-message form-message--error">{error}</p>}</div>
          {state && !state.generationAvailable && !error && <p className="service-note">Custom prompts are temporarily unavailable. You can still preview and submit an example below.</p>}
          <div className="examples"><p className="section-label mono">TRY AN EXAMPLE</p><div className="example-buttons">{examples.map((clip, index) => <button key={clip.id} className={preview?.id === clip.id ? 'selected' : ''} onClick={() => selectExample(clip)} disabled={generating}><span className={`example-symbol example-symbol--${index}`} aria-hidden="true">{['♡', '↗', '≈', '✧'][index % 4]}</span>{clip.title}</button>)}</div>{examplesError && <p className="input-hint">Examples could not be loaded. Refresh to try again.</p>}{!examples.length && !examplesError && <p className="input-hint">Loading examples…</p>}</div>
          <div className="submit-section"><div className="preview-heading"><span className="step-number mono">02</span><h2>{preview ? 'Like what you see?' : 'Preview it. Make it yours.'}</h2><span className="duration-tag mono">5 SEC</span></div>{preview ? <><p className="preview-description">{preview.interpretation}</p><div className="preview-meta"><span className="mono">{preview.source === 'example' ? 'READY-MADE EXAMPLE' : 'PROMPT CHECKED'}</span><button className="text-button" onClick={() => { setScreen('preview'); setPreviewStartedAt(Date.now()); }}><Icon name="play" size={12} />Replay</button></div></> : <p className="preview-description">Your animation will play on the building preview. Nothing joins the public show until you submit.</p>}<button className="submit-button" onClick={submit} disabled={!preview || submitting || !ready || alreadySubmitted || expired || !!state?.paused}>{submitting ? <><span className="spinner" />Joining queue…</> : alreadySubmitted ? <><Icon name="check" />In the shared queue</> : state?.paused ? 'The shared show is paused' : expired ? 'Preview expired · create a new one' : <><span>Submit to shared show</span><Icon name="arrow" /></>}</button><p className="submit-hint">First come, first shown. {state?.queue.length ? `Join ${state.queue.length} ${state.queue.length === 1 ? 'idea' : 'ideas'} in the queue.` : 'Be the next idea on the building.'}</p></div>
          {noticeText && <p className="form-message form-message--success" role="status"><Icon name="check" size={16} />{noticeText}</p>}
        </aside>
      </section>

      {(myQueue || myPlaying || completedMine) && <section className="personal-status" aria-label="Your animation status"><span className="personal-status-icon"><Icon name={myPlaying ? 'play' : completedMine && !myQueue ? 'check' : 'queue'} size={22} /></span><div><p className="mono">{myPlaying ? 'THIS IS YOUR MOMENT' : myQueue ? 'YOUR IDEA IS ON ITS WAY' : 'YOU LIT UP THE SIMULATOR'}</p><h2>{myPlaying ? liveItem?.clip.title : myQueue?.clip.title || completedMine?.title}</h2></div><div className="personal-countdown"><strong>{myPlaying ? remaining(phaseRemaining) : myQueue ? state?.paused ? '—' : remaining(myQueue.scheduledAt - now) : '✓'}</strong><span>{myPlaying ? 'LEFT ON THE BUILDING' : myQueue ? state?.paused ? 'SHOW PAUSED' : 'UNTIL YOUR TURN' : 'PLAYED'}</span></div><button className="text-button" onClick={() => setScreen('live')}>Watch shared show <Icon name="arrow" size={16} /></button></section>}

      <section className="queue-section" id="queue" aria-labelledby="queue-heading"><div className="queue-heading"><div><p className="eyebrow mono"><span className="tiny-cross">+</span> EVERYONE GETS A TURN</p><h2 id="queue-heading">Next on the building<span className="queue-count mono">{state ? waitingQueue.length : '—'}</span></h2></div><div className="queue-rules"><span className={`status-dot ${connected ? '' : 'status-dot--offline'}`} />{connected ? 'Shared queue · updates live' : 'Connecting to shared queue'}</div></div>
        <div className="show-timeline"><div className="timeline-step timeline-step--now"><span className="mono">{livePlaying ? 'ON THE BUILDING' : 'BETWEEN IDEAS'}</span><strong>{livePlaying ? liveItem?.clip.title : 'hackthisbuilding.com'}</strong><span>{state?.paused ? 'Show paused' : livePlaying ? `${remaining(phaseRemaining)} remaining` : 'URL scrolls twice to invite the next person'}</span></div><Icon name="arrow" size={20} /><div className="timeline-step"><span className="mono">THE RHYTHM</span><strong>One idea. Five seconds.</strong><span>Then two passes of the URL. Repeat.</span></div><span className="timeline-seconds mono">05<span>SEC</span></span></div>
        {queueError && <p className="form-message form-message--error" role="alert">{queueError}</p>}
        {waitingQueue.length ? <ol className="queue-list">{waitingQueue.map((item, index) => <QueueRow key={item.id} item={item} index={index} now={now} onVote={id => void queueAction('vote', id)} onCancel={id => void queueAction('cancel', id)} busy={busyQueueId} connected={connected} paused={!!state?.paused} />)}</ol> : <div className="queue-empty"><span className="empty-grid" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span><div><h3>{!state ? 'Finding the shared show…' : 'An open canvas. Your move.'}</h3><p>{!state ? 'The public queue will appear here when connected.' : 'The queue is empty. Preview an idea and send it up.'}</p></div><button className="text-button" onClick={() => { editorRef.current?.focus(); editorRef.current?.scrollIntoView({ behavior: animationPaused ? 'instant' : 'smooth', block: 'center' }); }}>Make something <Icon name="arrow" size={16} /></button></div>}
        <div className="queue-footer"><span><Icon name="heart" size={14} />Give ideas some love. Votes are reactions; the queue stays first come, first served.</span><button className="text-button" onClick={() => setShowHow(v => !v)} aria-expanded={showHow} aria-controls="how-it-works">How it works <span>{showHow ? '−' : '+'}</span></button></div>
        {showHow && <div id="how-it-works" className="how-it-works"><p><strong>1. Prompt & preview.</strong> Describe a simple animation. The prompt is checked, then turned into a five-second light sequence across 9 columns and 17 rows.</p><p><strong>2. Submit & wait your turn.</strong> Your exact preview joins the shared queue. Everyone sees the same show, and your personal countdown tells you when to look.</p><p><strong>3. Pass the building on.</strong> Each animation plays for five seconds. The website address then scrolls twice so another person can join. This is a browser simulator for the Sundai hack.</p></div>}
      </section>
      <footer className="site-footer"><div><span className="footer-cross" aria-hidden="true">✳</span><span>Built together at <a href="https://www.sundai.club/events/boston/beyond-tetris-building-scale-physical-ai-for-mit-green-building" target="_blank" rel="noreferrer">Sundai Hack 140</a>.</span></div><span className="footer-baseline-note">Explore the architecture. Light up the city.</span></footer>
    </main>
  </>;
}
