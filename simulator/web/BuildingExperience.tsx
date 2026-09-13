import { Component, lazy, Suspense, useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Building } from './Building';

const Building3D = lazy(() => import('./Building3D').then(module => ({ default: module.Building3D })));
export type RenderingMode = 'loading' | '3d' | '2d';
type Props = ComponentProps<typeof Building> & { cameraRevision?: number; onModeChange?: (mode: RenderingMode) => void };

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Keep a usable simulator while the 3D chunk loads or a GPU cannot render it. */
export function BuildingExperience({ onModeChange, cameraRevision, ...props }: Props) {
  const [mode, setMode] = useState<RenderingMode>('loading');
  const onReady = useCallback(() => setMode(previous => previous === '2d' ? previous : '3d'), []);
  const onError = useCallback(() => setMode('2d'), []);

  useEffect(() => { onModeChange?.(mode); }, [mode, onModeChange]);
  useEffect(() => {
    if (mode !== 'loading') return;
    const timeout = window.setTimeout(onError, 15000);
    return () => window.clearTimeout(timeout);
  }, [mode, onError]);

  return <div className={`building-experience renderer-${mode}`} data-renderer={mode}>
    {mode !== '3d' && <div className="fallback-scene"><Building {...props} /></div>}
    {mode !== '2d' && <SceneBoundary onError={onError}><Suspense fallback={null}><Building3D {...props} cameraRevision={cameraRevision} onReady={onReady} onError={onError} /></Suspense></SceneBoundary>}
    {mode === 'loading' && <div className="scene-loading" role="status"><span className="scene-loading-mark" aria-hidden="true"><i /><i /><i /></span><span>Preparing your view<span className="scene-loading-detail">Building the light, the city, the atmosphere.</span></span></div>}
  </div>;
}
