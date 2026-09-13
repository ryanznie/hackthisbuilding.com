import { memo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CLIP_MS, FPS, URL_PASS_MS, type Scene } from '../shared/contracts';
import { renderScene, urlFrame } from '../shared/render';
import { cameraPreset, type CameraView } from './three/layout';
import { createBuildingModel, disposeScene } from './three/model';

export interface Building3DProps {
  scene: Scene | null;
  startedAt: number;
  clockOffset: number;
  view: CameraView;
  paused: boolean;
  preview: boolean;
  title: string;
  cameraRevision?: number;
  onReady?: () => void;
  onError?: (error?: Error) => void;
}

export const Building3D = memo(function Building3D(props: Building3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  current.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer | undefined;
    let scene: THREE.Scene | undefined;
    let controls: OrbitControls | undefined;
    let environment: THREE.WebGLRenderTarget | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let animationFrame = 0, destroyed = false, failed = false, ready = false, shaderFailed = false;
    let lastFrame = -Infinity, lastRender = -Infinity, lastTime = 0;
    let frozenElapsed = 0, lastStartedAt = current.current.startedAt;
    let previousView = current.current.view, previousRevision = current.current.cameraRevision;
    let visible = true, intersection: IntersectionObserver | undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = reducedMotion.matches;
    let resetCamera = (_immediate = false) => {};
    let onControlsStart = () => {};

    const reportError = (error: unknown) => {
      if (failed || destroyed) return;
      failed = true;
      cancelAnimationFrame(animationFrame);
      controls?.dispose();
      if (scene) { disposeScene(scene); scene = undefined; }
      environment?.dispose(); environment = undefined;
      renderer?.dispose(); renderer = undefined;
      current.current.onError?.(error instanceof Error ? error : new Error('The 3D preview could not start.'));
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      reportError(new Error('The graphics context was interrupted.'));
    };
    const onMotionChange = () => { prefersReducedMotion = reducedMotion.matches; if (controls) controls.enableDamping = !prefersReducedMotion; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!controls || !renderer) return;
      if (event.key === 'Home') { event.preventDefault(); resetCamera(); return; }
      const camera = controls.object as THREE.PerspectiveCamera;
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      const amount = 0.06;
      if (event.key === 'ArrowLeft') spherical.theta -= amount;
      else if (event.key === 'ArrowRight') spherical.theta += amount;
      else if (event.key === 'ArrowUp') spherical.phi -= amount;
      else if (event.key === 'ArrowDown') spherical.phi += amount;
      else if (event.key === '+' || event.key === '=') spherical.radius *= 0.93;
      else if (event.key === '-' || event.key === '_') spherical.radius *= 1.07;
      else return;
      event.preventDefault();
      onControlsStart();
      spherical.theta = THREE.MathUtils.clamp(spherical.theta, controls.minAzimuthAngle, controls.maxAzimuthAngle);
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
      spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      controls.update();
    };

    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.debug.onShaderError = () => { shaderFailed = true; };
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.03;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      // Architectural geometry is static. Camera and RGB changes do not require
      // redrawing the 2048px shadow map every frame.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2('#819094', 0.0034);
      const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 750);
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = !prefersReducedMotion;
      controls.dampingFactor = 0.075;
      controls.enablePan = false;
      controls.rotateSpeed = 0.5;
      controls.zoomSpeed = 0.65;
      controls.minPolarAngle = Math.PI * 0.31;
      controls.maxPolarAngle = Math.PI * 0.515;
      controls.minAzimuthAngle = -1.18;
      controls.maxAzimuthAngle = 1.18;
      controls.touches.ONE = THREE.TOUCH.ROTATE;
      controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

      const hemispheric = new THREE.HemisphereLight('#bacbde', '#696357', 1.1);
      scene.add(hemispheric);
      const key = new THREE.DirectionalLight('#ffe1bd', 1.55);
      key.position.set(-60, 110, 85);
      key.target.position.set(0, 34, 0);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -100; key.shadow.camera.right = 100;
      key.shadow.camera.top = 100; key.shadow.camera.bottom = -70;
      key.shadow.camera.near = 1; key.shadow.camera.far = 290;
      key.shadow.bias = -0.00015;
      key.shadow.normalBias = 0.07;
      key.shadow.radius = 3;
      scene.add(key, key.target);
      const rim = new THREE.DirectionalLight('#b1cce8', 0.95);
      rim.position.set(60, 80, -65);
      scene.add(rim);
      const environmentGenerator = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = environmentGenerator.fromScene(room, 0.06);
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.26;
      room.dispose();
      environmentGenerator.dispose();

      const model = createBuildingModel(scene);
      let transition: { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;
      resetCamera = (immediate = false) => {
        if (!controls) return;
        const preset = cameraPreset(current.current.view, camera.aspect);
        controls.minDistance = preset.minDistance;
        controls.maxDistance = preset.maxDistance;
        if (immediate || prefersReducedMotion) {
          camera.position.set(...preset.position);
          controls.target.set(...preset.target);
          camera.fov = preset.fov;
          camera.updateProjectionMatrix();
          transition = null;
          controls.update();
        } else transition = { position: new THREE.Vector3(...preset.position), target: new THREE.Vector3(...preset.target), fov: preset.fov };
      };
      onControlsStart = () => { transition = null; };
      controls.addEventListener('start', onControlsStart);

      const resize = () => {
        if (!renderer) return;
        const rect = canvas.parentElement?.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect?.width || canvas.clientWidth || 1));
        const height = Math.max(1, Math.round(rect?.height || canvas.clientHeight || 1));
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        resetCamera(true);
      };
      resizeObserver = new ResizeObserver(resize);
      if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
      resize();
      if ('IntersectionObserver' in window) {
        intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; }, { rootMargin: '80px' });
        intersection.observe(canvas);
      }
      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('keydown', onKeyDown);
      reducedMotion.addEventListener('change', onMotionChange);

      const render = (timestamp: number) => {
        if (destroyed || failed || !renderer || !scene || !controls) return;
        animationFrame = requestAnimationFrame(render);
        if (document.hidden || !visible) return;
        try {
          const p = current.current;
          const delta = Math.min((timestamp - lastTime) / 1000 || 1 / 60, 0.05);
          lastTime = timestamp;
          if (p.view !== previousView || p.cameraRevision !== previousRevision) {
            previousView = p.view; previousRevision = p.cameraRevision;
            resetCamera();
          }
          if (transition) {
            const speed = 1 - Math.exp(-delta * 7.5);
            camera.position.lerp(transition.position, speed);
            controls.target.lerp(transition.target, speed);
            camera.fov = THREE.MathUtils.lerp(camera.fov, transition.fov, speed);
            camera.updateProjectionMatrix();
            if (camera.position.distanceToSquared(transition.position) < 0.0004 && controls.target.distanceToSquared(transition.target) < 0.0004) transition = null;
          }
          controls.update();
          // RGB sampling is shared with the 2D fallback and remains 30 FPS.
          // Camera interpolation and pointer response can render at 60 FPS.
          if (timestamp - lastFrame >= 1000 / FPS - 0.5 || p.startedAt !== lastStartedAt) {
            const elapsed = Date.now() + p.clockOffset - p.startedAt;
            if (!p.paused || p.startedAt !== lastStartedAt) frozenElapsed = elapsed;
            lastStartedAt = p.startedAt;
            const time = Math.max(0, p.paused ? frozenElapsed : elapsed);
            const frame = p.scene && (p.preview || time < CLIP_MS)
              ? renderScene(p.scene, time % CLIP_MS)
              : urlFrame(Math.max(0, time - (p.scene ? CLIP_MS : 0)) % URL_PASS_MS);
            model.updateFrame(frame);
            lastFrame = timestamp;
          }
          // High-refresh screens do not need 120/144 architectural renders/sec.
          if (timestamp - lastRender >= 1000 / 60 - 0.5) {
            renderer.render(scene, camera);
            if (shaderFailed) throw new Error('The graphics device could not compile the building materials.');
            lastRender = timestamp;
            canvas.dataset.windowCount = String(model.windowCount);
            if (!ready) { ready = true; current.current.onReady?.(); }
          }
        } catch (error) { reportError(error); }
      };
      animationFrame = requestAnimationFrame(render);
    } catch (error) { reportError(error); }

    return () => {
      destroyed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      controls?.removeEventListener('start', onControlsStart);
      controls?.dispose();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('keydown', onKeyDown);
      reducedMotion.removeEventListener('change', onMotionChange);
      if (scene) disposeScene(scene);
      environment?.dispose();
      renderer?.dispose();
    };
  }, []);

  return <div data-renderer="webgl" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
    <canvas
      ref={canvasRef}
      className="building-3d-canvas"
      data-renderer="webgl"
      tabIndex={0}
      role="img"
      aria-label={`${props.preview ? 'Your animation preview' : 'Shared simulator'}: ${props.title}. Interactive three-dimensional MIT Green Building with 153 animated windows. Drag to orbit, pinch or scroll to zoom. Keyboard: arrows rotate, plus and minus zoom, Home resets the view.`}
      style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', outlineOffset: '-4px' }}
    />
  </div>;
});
