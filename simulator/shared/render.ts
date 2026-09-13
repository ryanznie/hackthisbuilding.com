import { COLS, DOMAIN, ROWS, URL_PASS_MS, type Clip, type Frame, type Layer, type Motion, type RGB, type Scene, type Shape } from './contracts';

const SHAPES = new Set<Shape>(['heart', 'star', 'circle', 'ring', 'rectangle', 'line', 'rain', 'sparkles', 'wave', 'rocket', 'smile', 'socks']);
const MOTIONS = new Set<Motion>(['still', 'pulse', 'rise', 'fall', 'orbit', 'sway', 'spin']);
const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const modulo = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus;
const hash = (seed: number) => modulo(Math.sin(seed * 127.1 + 311.7) * 43758.5453, 1);
// A fixed pixel-art pair of stockings, drawn for this tiny building display.
const SOCKS = ['000000000', '011100000', '011100000', '011101110', '011101110', '011001110', '111001110', '110001110', '000011110', '000011100', '000000000'];

function record(input: unknown, name: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${name} must be an object.`);
  return input as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, keys: string[], name: string) {
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error(`${name} contains unsupported fields.`);
}

function number(input: unknown, name: string, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) throw new Error(`${name} must be a finite number.`);
  return clamp(input, min, max);
}

function color(input: unknown): string {
  if (typeof input !== 'string' || !/^#[0-9a-f]{6}$/i.test(input)) throw new Error('Colors must use six-digit hexadecimal notation.');
  return input.toLowerCase();
}

/** The only executable display vocabulary. No scripts, HTML, or remote resources. */
export function validateScene(input: unknown): Scene {
  const scene = record(input, 'Scene');
  exactKeys(scene, ['version', 'background', 'layers'], 'Scene');
  if (scene.version !== 1) throw new Error('Unsupported scene version.');
  if (!Array.isArray(scene.layers) || scene.layers.length < 1 || scene.layers.length > 8) throw new Error('A scene needs between one and eight layers.');
  return {
    version: 1,
    background: color(scene.background),
    layers: scene.layers.map((input, index): Layer => {
      const layer = record(input, `Layer ${index + 1}`);
      exactKeys(layer, ['shape', 'color', 'x', 'y', 'size', 'motion', 'speed', 'phase'], 'Layer');
      if (!SHAPES.has(layer.shape as Shape)) throw new Error('Unsupported shape.');
      if (!MOTIONS.has(layer.motion as Motion)) throw new Error('Unsupported motion.');
      return {
        shape: layer.shape as Shape,
        color: color(layer.color),
        x: number(layer.x, 'x', 0, COLS - 1),
        y: number(layer.y, 'y', 0, ROWS - 1),
        size: number(layer.size, 'size', 0.5, 17),
        motion: layer.motion as Motion,
        speed: number(layer.speed, 'speed', 0, 2),
        phase: number(layer.phase, 'phase', -TAU, TAU),
      };
    }),
  };
}

const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const blank = (background: RGB): Frame => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, (): RGB => [...background]));
const edge = (distance: number, softness = 0.7) => clamp(0.5 - distance / softness, 0, 1);

function shapeCoverage(shape: Shape, dx: number, dy: number, size: number, time: number, phase: number, speed: number, seed: number): number {
  const radius = size / 2;
  const distance = Math.hypot(dx, dy);
  switch (shape) {
    case 'socks': {
      const col = Math.floor(dx * 9 / size + 4.5);
      const row = Math.floor(dy * 9 / size + 5.5);
      return SOCKS[row]?.[col] === '1' ? 1 : 0;
    }
    case 'circle': return edge(distance - radius);
    case 'ring': return edge(Math.abs(distance - radius * 0.82) - Math.max(0.32, size * 0.065));
    case 'rectangle': return edge(Math.max(Math.abs(dx) - radius, Math.abs(dy) - radius * 0.65));
    case 'line': return edge(Math.max(Math.abs(dx) - radius, Math.abs(dy) - 0.4));
    case 'heart': {
      const u = dx / (radius * 0.93);
      const v = -dy / radius + 0.15;
      return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0 ? 1 : 0;
    }
    case 'star': {
      // Intersect each ray with the edge of a real five-point polygon.
      const angle = modulo(Math.atan2(dy, dx) + Math.PI / 2, TAU);
      const segment = Math.floor(angle / (Math.PI / 5));
      const local = angle - segment * Math.PI / 5;
      const r1 = segment % 2 === 0 ? radius : radius * 0.44;
      const r2 = segment % 2 === 0 ? radius * 0.44 : radius;
      const limit = r1 * r2 * Math.sin(Math.PI / 5) / (r2 * Math.sin(Math.PI / 5 - local) + r1 * Math.sin(local));
      return edge(distance - limit);
    }
    case 'smile': {
      const outline = edge(Math.abs(distance - radius * 0.87) - 0.3);
      const eyes = Math.max(edge(Math.hypot(dx - radius * 0.34, dy + radius * 0.25) - 0.4), edge(Math.hypot(dx + radius * 0.34, dy + radius * 0.25) - 0.4));
      const mouth = dy > radius * 0.07 ? edge(Math.abs(Math.hypot(dx, dy) - radius * 0.52) - 0.32) : 0;
      return Math.max(outline, eyes, mouth);
    }
    case 'rocket': {
      const body = edge(Math.max(Math.abs(dx) - radius * 0.35, Math.abs(dy) - radius * 0.63));
      const nose = dy < -radius * 0.45 && dy > -radius * 1.3 ? edge(Math.abs(dx) - (dy + radius * 1.3) * 0.42) : 0;
      const fins = dy > radius * 0.15 && dy < radius * 0.85 ? edge(Math.abs(dx) - (dy + radius * 0.1) * 0.83) : 0;
      const flameLength = radius * (0.5 + Math.sin(time * 2.8 + phase) * 0.12);
      const flame = dy > radius * 0.65 && dy < radius * 0.65 + flameLength ? edge(Math.abs(dx) - (radius * 0.65 + flameLength - dy) * 0.45) * 0.7 : 0;
      const window = edge(Math.hypot(dx, dy + radius * 0.22) - radius * 0.15);
      return Math.max(body, nose, fins, flame) * (1 - window * 0.7);
    }
    case 'wave': {
      const amplitude = Math.min(radius * 0.55, 3);
      const center = Math.sin(dx * 0.55 - time * (0.65 + speed * 0.5) + phase) * amplitude;
      return edge(Math.abs(dy - center) - 0.5) * edge(Math.abs(dx) - Math.max(radius, 4.5));
    }
    case 'rain': {
      let brightness = 0;
      for (let i = 0; i < 9; i++) {
        const dropX = (i - 4) * size / 8;
        const dropY = modulo(hash(seed * 37 + i) * (ROWS + 5) + time * (1 + speed * 1.7), ROWS + 5) - (ROWS + 5) / 2;
        const tail = dropY - dy;
        if (tail > -0.6 && tail < 3.2) brightness = Math.max(brightness, edge(Math.abs(dx - dropX) - 0.28) * Math.max(0, 1 - Math.max(0, tail) / 3.2));
      }
      return brightness;
    }
    case 'sparkles': {
      let brightness = 0;
      for (let i = 0; i < 14; i++) {
        const sparkX = (hash(seed * 91 + i * 2) - 0.5) * size;
        const sparkY = (hash(seed * 91 + i * 2 + 1) - 0.5) * size * 1.7;
        const glow = 0.35 + 0.65 * (Math.sin(time * (0.7 + speed * 0.25) + hash(i + seed) * TAU + phase) + 1) / 2;
        brightness = Math.max(brightness, edge(Math.hypot(dx - sparkX, dy - sparkY) - 0.4) * glow);
      }
      return brightness;
    }
  }
}

/** Pure, deterministic RGB renderer; coordinates are columns 0–8 and rows 0–16. */
export function renderScene(scene: Scene, elapsedMs: number): Frame {
  const frame = blank(rgb(scene.background));
  const time = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) / 1000 : 0;
  const samples = [-0.25, 0.25];
  scene.layers.slice(0, 8).forEach((layer, index) => {
    const channels = rgb(layer.color);
    // Motions never blink the entire display; pulse stays above 60% brightness.
    const phase = time * TAU * layer.speed * 0.3 + layer.phase;
    let x = layer.x, y = layer.y, size = layer.size, opacity = 1, angle = 0;
    if (layer.motion === 'pulse') { size *= 0.88 + Math.sin(phase) * 0.12; opacity = 0.8 + Math.sin(phase) * 0.2; }
    if (layer.motion === 'rise' || layer.motion === 'fall') {
      const direction = layer.motion === 'rise' ? -1 : 1;
      y = modulo(layer.y + direction * time * layer.speed * 1.5 + size * 1.5, ROWS + size * 3) - size * 1.5;
    }
    if (layer.motion === 'orbit') { x += Math.cos(phase) * Math.min(1.5, size * 0.18); y += Math.sin(phase) * Math.min(2.5, size * 0.25); }
    if (layer.motion === 'sway') x += Math.sin(phase) * Math.min(1.7, size * 0.22);
    if (layer.motion === 'spin') angle = phase;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      let coverage = 0;
      for (const sy of samples) for (const sx of samples) {
        const dx = col + sx - x, dy = row + sy - y;
        coverage += shapeCoverage(layer.shape, dx * cosine + dy * sine, -dx * sine + dy * cosine, size, time, layer.phase, layer.speed, index + 1) / 4;
      }
      const alpha = clamp(coverage * opacity, 0, 1);
      // Screen blending keeps overlapping neon layers luminous without clipping white.
      for (let channel = 0; channel < 3; channel++) frame[row][col][channel] = Math.round(255 - (255 - frame[row][col][channel]) * (1 - channels[channel] / 255 * alpha));
    }
  });
  return frame;
}

const makeLayer = (shape: Shape, color: string, x: number, y: number, size: number, motion: Motion = 'still', speed = 0.7, phase = 0): Layer => ({ shape, color, x, y, size, motion, speed, phase });

export function exampleClips(): Clip[] {
  const definitions: { id: string; title: string; interpretation: string; layers: Layer[] }[] = [
    { id: 'example-heart', title: 'A heartbeat for the city', interpretation: 'A warm pink heart breathes above a field of violet stars.', layers: [makeLayer('sparkles', '#613ab9', 4, 8, 9, 'still', 0.4), makeLayer('heart', '#ff386f', 4, 7.5, 7, 'pulse', 0.9), makeLayer('wave', '#5c39ff', 4, 14, 9, 'still', 0.5)] },
    { id: 'example-rocket', title: 'Next stop: the stars', interpretation: 'An amber rocket climbs through a deep blue starfield.', layers: [makeLayer('sparkles', '#3c88ff', 4, 8, 9, 'still', 0.6), makeLayer('rocket', '#ffad36', 4, 11, 5.4, 'rise', 0.95)] },
    { id: 'example-waves', title: 'An electric ocean', interpretation: 'Turquoise, violet, and pink waves drift across the facade.', layers: [makeLayer('wave', '#15d7ba', 4, 4, 10, 'still', 0.7), makeLayer('wave', '#7656ff', 4, 8, 11, 'still', 0.6, 1.8), makeLayer('wave', '#ff3989', 4, 12, 10, 'still', 0.8, 3.6)] },
    { id: 'example-stars', title: 'Make a little magic', interpretation: 'A golden star turns gently in a constellation of blue lights.', layers: [makeLayer('sparkles', '#368bef', 4, 8, 9, 'still', 0.5), makeLayer('star', '#ffcc52', 4, 8, 8.5, 'spin', 0.35), makeLayer('circle', '#ff8038', 4, 8, 1.5, 'pulse', 0.5)] },
    { id: 'example-rain', title: 'Neon rain', interpretation: 'Soft trails of cyan and violet fall down the windows.', layers: [makeLayer('rain', '#37daca', 4, 8, 8, 'still', 0.8), makeLayer('rain', '#754fee', 4, 8, 7, 'still', 0.45, 2)] },
    { id: 'example-smile', title: 'Hello, Cambridge', interpretation: 'A bright smile sways gently above a purple ripple.', layers: [makeLayer('smile', '#ffd44e', 4, 6, 7.6, 'sway', 0.35), makeLayer('wave', '#9870ff', 4, 13, 9, 'still', 0.8)] },
    { id: 'example-red-sox', title: 'Red Sox rally', interpretation: 'A pixel-art pair of red socks with white cuffs cheers on Boston beneath twinkling blue lights.', layers: [makeLayer('sparkles', '#174a95', 4, 8, 9, 'still', 0.7), makeLayer('socks', '#f22d46', 4, 8, 9, 'still', 0), makeLayer('line', '#fff3dc', 2, 3, 2.8, 'still', 0), makeLayer('line', '#fff3dc', 6, 5, 2.8, 'still', 0)] },
  ];
  return definitions.map(({ layers, ...definition }) => ({ ...definition, source: 'example', createdAt: 0, expiresAt: 0, scene: validateScene({ version: 1, background: '#02040b', layers }) }));
}

// Compact, actual letterforms rather than a text-shaped random pattern.
const FONT: Record<string, string[]> = {
  a: ['010', '101', '111', '101', '101'], b: ['110', '101', '110', '101', '110'],
  c: ['011', '100', '100', '100', '011'], d: ['110', '101', '101', '101', '110'],
  e: ['111', '100', '110', '100', '111'], f: ['111', '100', '110', '100', '100'],
  g: ['011', '100', '101', '101', '011'], h: ['101', '101', '111', '101', '101'],
  i: ['111', '010', '010', '010', '111'], j: ['001', '001', '001', '101', '010'],
  k: ['101', '101', '110', '101', '101'], l: ['100', '100', '100', '100', '111'],
  m: ['10001', '11011', '10101', '10001', '10001'], n: ['1001', '1101', '1011', '1001', '1001'],
  o: ['010', '101', '101', '101', '010'], p: ['110', '101', '110', '100', '100'],
  q: ['010', '101', '101', '011', '001'], r: ['110', '101', '110', '101', '101'],
  s: ['011', '100', '010', '001', '110'], t: ['111', '010', '010', '010', '010'],
  u: ['101', '101', '101', '101', '111'], v: ['101', '101', '101', '101', '010'],
  w: ['10001', '10001', '10101', '11011', '10001'], x: ['101', '101', '010', '101', '101'],
  y: ['101', '101', '010', '010', '010'], z: ['111', '001', '010', '100', '111'],
  '.': ['0', '0', '0', '0', '1'],
};
const DOMAIN_COLUMNS: number[][] = Array.from(DOMAIN).flatMap(letter => {
  const glyph = FONT[letter];
  return [...Array.from({ length: glyph[0].length }, (_, col) => glyph.map(row => Number(row[col]))), [0, 0, 0, 0, 0]];
}).slice(0, -1);

/** One entire domain pass every 12 seconds; caller schedules two passes. */
export function urlFrame(elapsedMs: number): Frame {
  const time = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const frame = blank([2, 4, 10]);
  const position = modulo(time, URL_PASS_MS) / URL_PASS_MS * (DOMAIN_COLUMNS.length + COLS);
  const firstColumn = Math.floor(position) - COLS;
  for (let col = 0; col < COLS; col++) {
    const glyph = DOMAIN_COLUMNS[firstColumn + col];
    if (glyph) for (let row = 0; row < 5; row++) if (glyph[row]) frame[row + 6][col] = [156, 238, 91];
    // Quiet architectural rails keep the facade alive between letters.
    const glow = Math.round(13 + 8 * (1 + Math.sin(col * 0.65 + time / 1700)) / 2);
    frame[3][col] = [4, glow, 14];
    frame[13][col] = [4, glow, 14];
  }
  return frame;
}
