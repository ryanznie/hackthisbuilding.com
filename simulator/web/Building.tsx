import { memo, useEffect, useRef } from 'react';
import type { Frame, Scene } from '../shared/contracts';
import { CLIP_MS, URL_PASS_MS } from '../shared/contracts';
import { renderScene, urlFrame } from '../shared/render';

export type BuildingView = 'full' | 'windows' | 'river';
interface Props { scene: Scene | null; startedAt: number; clockOffset: number; view: BuildingView; paused: boolean; preview: boolean; title: string; }
const W = 900, H = 750;

function windowLight(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rgb: number[], glow = true) {
  const brightness = Math.max(...rgb);
  c.fillStyle = '#141c1e'; c.fillRect(x, y, w, h);
  if (brightness > 10) {
    const color = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    if (glow) {
      const g = c.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, w * 1.55);
      g.addColorStop(0, `rgba(${color},.25)`); g.addColorStop(1, `rgba(${color},0)`);
      c.fillStyle = g; c.fillRect(x - w, y - w, w * 3, h + w * 2);
    }
    c.fillStyle = `rgb(${color})`; c.globalAlpha *= .83; c.fillRect(x + .7, y + .7, w - 1.4, h - 1.4); c.globalAlpha /= .83;
    const reflection = c.createLinearGradient(x, y, x, y + h);
    reflection.addColorStop(0, 'rgba(255,255,255,.28)'); reflection.addColorStop(.45, 'rgba(255,255,255,.03)'); reflection.addColorStop(1, 'rgba(0,0,0,.13)');
    c.fillStyle = reflection; c.fillRect(x + .7, y + .7, w - 1.4, h - 1.4);
  } else {
    c.fillStyle = '#263032'; c.fillRect(x + 1, y + 1, w - 2, h * .2);
  }
  c.strokeStyle = '#787a68'; c.lineWidth = .7; c.strokeRect(x, y, w, h);
  c.strokeStyle = brightness > 80 ? 'rgba(35,34,24,.38)' : '#404942'; c.beginPath(); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.stroke();
}

function tower(c: CanvasRenderingContext2D, frame: Frame) {
  const x = 337, y = 119, width = 230, bottom = 654;
  const concrete = c.createLinearGradient(x, y, x + width, y + 300);
  concrete.addColorStop(0, '#716e5e'); concrete.addColorStop(.45, '#8a8068'); concrete.addColorStop(1, '#686656');
  c.fillStyle = '#40473e'; c.beginPath(); c.moveTo(x + width, y + 5); c.lineTo(x + width + 15, y + 14); c.lineTo(x + width + 17, bottom); c.lineTo(x + width, bottom); c.fill();
  c.fillStyle = concrete; c.fillRect(x, y, width, bottom - y);
  c.strokeStyle = 'rgba(213,200,161,.28)'; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, width - 1, bottom - y);
  c.fillStyle = '#b0a98a'; c.fillRect(x - 1, y - 4, width + 2, 6);
  c.fillStyle = '#555a4e'; c.fillRect(x + 11, y + 8, width - 22, 31);
  for (let r = 0; r < 2; r++) for (let col = 0; col < 9; col++) {
    c.fillStyle = '#273132'; c.fillRect(x + 17 + col * 22, y + 11 + r * 13, 18, 10);
  }
  for (let row = 0; row < 17; row++) for (let col = 0; col < 9; col++) {
    windowLight(c, x + 15 + col * 22.3, y + 52 + row * 24.7, 18.4, 20.4, frame[row]?.[col] || [0, 0, 0]);
  }
  c.strokeStyle = 'rgba(40,48,41,.35)';
  for (let i = 0; i < 11; i++) { c.beginPath(); c.moveTo(x + 9 + i * 21.3, y + 40); c.lineTo(x + 9 + i * 21.3, bottom - 55); c.stroke(); }
  c.fillStyle = '#575b4e'; c.fillRect(x + 12, bottom - 54, width - 24, 54);
  for (let i = 0; i < 11; i++) {
    const ex = x + 17 + i * 18.8;
    c.fillStyle = [2, 5, 8].includes(i) ? '#8c8870' : '#aa9f75'; c.fillRect(ex, bottom - 45, 12, 39);
    if (![2, 5, 8].includes(i)) { c.fillStyle = '#e8dcb0'; c.fillRect(ex + 1, bottom - 38, 10, 24); }
  }
  for (const col of [x + 2, x + 71, x + 142, x + 211]) { c.fillStyle = '#898571'; c.fillRect(col, bottom - 60, 15, 60); }
  c.fillStyle = '#4f605b'; c.fillRect(x + 45, y - 20, 23, 16);
  const radome = c.createRadialGradient(x + 45, y - 40, 2, x + 59, y - 26, 26);
  radome.addColorStop(0, '#b0c0be'); radome.addColorStop(1, '#536662');
  c.fillStyle = radome; c.beginPath(); c.arc(x + 57, y - 27, 21, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#687e76'; c.lineWidth = .6;
  for (const yy of [-39, -29, -21]) { c.beginPath(); c.ellipse(x + 57, y + yy, yy === -39 ? 15 : 20, 5, -.12, 0, Math.PI * 2); c.stroke(); }
  c.fillStyle = '#a2b0a6'; c.beginPath(); c.arc(x + 186, y - 15, 11, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#879080'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 141, y - 4); c.lineTo(x + 141, y - 46); c.stroke();
  const beacon = c.createRadialGradient(x + 141, y - 46, 0, x + 141, y - 46, 13);
  beacon.addColorStop(0, 'rgba(255,124,82,.8)'); beacon.addColorStop(.2, 'rgba(255,111,75,.4)'); beacon.addColorStop(1, 'rgba(255,98,62,0)');
  c.fillStyle = beacon; c.fillRect(x + 128, y - 59, 26, 26); c.fillStyle = '#fbb28a'; c.fillRect(x + 140, y - 47, 2, 2);
}

function campus(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  c.fillStyle = '#222c28'; c.fillRect(x, y, w, h); c.fillStyle = '#43483b'; c.fillRect(x, y, w, 3);
  for (let r = 0; r < h / 22 - 1; r++) {
    c.fillStyle = '#161f1d'; c.fillRect(x, y + 20 + r * 22, w, 2);
    for (let col = 0; col < w / 14 - 1; col++) {
      const lit = (col * 17 + r * 13 + seed) % 11 < 2;
      c.fillStyle = lit ? '#9e8d5a' : '#141d1b'; c.fillRect(x + 6 + col * 14, y + 9 + r * 22, 6, 9);
    }
  }
}

function tree(c: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  c.fillStyle = '#333a2c'; c.fillRect(-5, -16, 10, 85);
  for (let i = 0; i < 12; i++) { c.fillStyle = i % 3 === 0 ? '#1b2a20' : '#16221c'; c.beginPath(); c.ellipse(Math.sin(i * 3.5) * 33, -35 + Math.cos(i * 2.3) * 34, 35, 43, i, 0, Math.PI * 2); c.fill(); }
  c.restore();
}

function streetlamp(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = '#212b23'; c.fillRect(x - 1, y, 2, 58); c.fillRect(x - 9, y + 1, 18, 2);
  for (const dx of [-8, 0, 8]) { c.fillStyle = '#f7ddb0'; c.beginPath(); c.ellipse(x + dx, y - (dx === 0 ? 5 : 0), 2.1, 3, 0, 0, Math.PI * 2); c.fill(); }
  const light = c.createRadialGradient(x, y, 0, x, y, 35); light.addColorStop(0, 'rgba(236,210,145,.13)'); light.addColorStop(1, 'rgba(236,210,145,0)'); c.fillStyle = light; c.fillRect(x - 35, y - 35, 70, 70);
}

function draw(c: CanvasRenderingContext2D, frame: Frame, view: BuildingView) {
  c.clearRect(0, 0, W, H);
  const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#10191b'); sky.addColorStop(.54, '#202d2b'); sky.addColorStop(.87, '#4e5140'); sky.addColorStop(1, '#242f29');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  const haze = c.createRadialGradient(450, 540, 20, 450, 470, 500); haze.addColorStop(0, 'rgba(163,138,78,.13)'); haze.addColorStop(1, 'rgba(163,138,78,0)'); c.fillStyle = haze; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 65; i++) { c.globalAlpha = .17 + (i % 5) * .07; c.fillStyle = '#c6d6cf'; c.fillRect((i * 137.37) % W, (i * 91.53) % 450, i % 7 === 0 ? 1.7 : .8, i % 7 === 0 ? 1.7 : .8); } c.globalAlpha = 1;
  if (view === 'windows') {
    c.fillStyle = '#131b18'; c.fillRect(0, 0, W, H);
    const x = 297, y = 56, step = 35, size = 27;
    for (let r = 0; r < 17; r++) for (let col = 0; col < 9; col++) {
      c.fillStyle = '#485043'; c.fillRect(x + col * step - 2, y + r * step - 2, size + 4, size + 4);
      windowLight(c, x + col * step, y + r * step, size, size, frame[r]?.[col] || [0, 0, 0]);
    }
    c.font = '11px monospace'; c.textAlign = 'right'; c.fillStyle = '#829184';
    for (let i = 0; i < 17; i++) c.fillText(String(17 - i).padStart(2, '0'), x - 22, y + i * step + 19);
    c.textAlign = 'center'; for (let i = 0; i < 9; i++) c.fillText(String(i + 1).padStart(2, '0'), x + i * step + 13.5, y + 17 * step + 20);
    return;
  }
  const river = view === 'river';
  c.save(); if (river) { c.translate(138, 24); c.scale(.7, .7); }
  campus(c, -15, 506, 210, 151, 4); campus(c, 182, 565, 132, 92, 2); campus(c, 649, 515, 181, 142, 7); campus(c, 803, 548, 142, 109, 10);
  tower(c, frame);
  c.fillStyle = '#303b2d'; c.fillRect(-220, 654, 1500, 96);
  c.strokeStyle = 'rgba(156,154,110,.08)'; c.lineWidth = 1;
  for (let i = 0; i < 11; i++) { c.beginPath(); c.moveTo(-200, 660 + i * 12); c.lineTo(1300, 660 + i * 12); c.stroke(); }
  tree(c, 139, 602, 1); tree(c, 774, 596, .96); tree(c, 844, 620, .72);
  streetlamp(c, 300, 634); streetlamp(c, 620, 634); streetlamp(c, 66, 635); streetlamp(c, 885, 635);
  c.restore();
  if (river) {
    const water = c.createLinearGradient(0, 484, 0, H); water.addColorStop(0, '#1b302f'); water.addColorStop(1, '#0d1a1c'); c.fillStyle = water; c.fillRect(0, 484, W, H - 484);
    c.save(); c.globalAlpha = .14; c.translate(138, 952); c.scale(.7, -.7); tower(c, frame); c.restore();
    for (let i = 0; i < 85; i++) { c.strokeStyle = i % 3 === 0 ? 'rgba(160,171,128,.1)' : 'rgba(6,19,22,.6)'; c.lineWidth = 1 + i % 3; c.beginPath(); const yy = 484 + (i * 29) % 260; const xx = (i * 73) % 900; c.moveTo(xx, yy); c.lineTo(xx + 13 + i % 64, yy); c.stroke(); }
  }
  const vignette = c.createRadialGradient(W / 2, H / 2, 250, W / 2, H / 2, 620); vignette.addColorStop(0, 'rgba(5,11,10,0)'); vignette.addColorStop(1, 'rgba(5,11,10,.5)'); c.fillStyle = vignette; c.fillRect(0, 0, W, H);
}

export const Building = memo(function Building(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef(props); current.current = props;
  const frozenElapsed = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const context = canvas.getContext('2d'); if (!context) return;
    let raf = 0, last = 0;
    const drawFrame = (timestamp: number) => {
      if (timestamp - last >= 1000 / 30) {
        const p = current.current;
        const elapsed = Date.now() + p.clockOffset - p.startedAt;
        if (!p.paused) frozenElapsed.current = elapsed;
        const t = p.paused ? frozenElapsed.current : elapsed;
        const frame = p.scene && (p.preview || t < CLIP_MS)
          ? renderScene(p.scene, Math.max(0, t) % CLIP_MS)
          : urlFrame(Math.max(0, t - (p.scene ? CLIP_MS : 0)) % URL_PASS_MS);
        draw(context, frame, p.view); last = timestamp;
      }
      raf = requestAnimationFrame(drawFrame);
    };
    raf = requestAnimationFrame(drawFrame); return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvasRef} className={`building-canvas building-canvas--${props.view}`} width={W} height={H} role="img" aria-label={`${props.preview ? 'Your animation preview' : 'Shared simulator'}: ${props.title}. A night view of MIT's Green Building, with 153 individually animated windows.`} />;
});
