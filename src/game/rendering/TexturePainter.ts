import { TILE_NAMES, TILE_PIXELS, type TileName } from '../world/tiles';

/**
 * Procedurally paints every block tile in a soft, hand-painted style — no image
 * files, so the whole game is original and asset-license free.
 *
 * Conventions:
 *  - Opaque tiles: alpha is the biome TINT MASK (1 = multiply by grass/foliage tint).
 *  - Cutout tiles (plants, glass, fire): alpha is coverage (alpha-tested at 0.5).
 *  - Tiles must wrap seamlessly (all noise is periodic over the tile).
 */

const N = TILE_PIXELS;
type RGB = [number, number, number];

export function hex(s: string): RGB {
  const v = parseInt(s.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise: `period` cells across the tile. */
function vnoise(x: number, y: number, period: number, seed: number): number {
  const fx = (x / N) * period, fy = (y / N) * period;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const m = (v: number) => ((v % period) + period) % period;
  const a = hash(m(ix), m(iy), seed), b = hash(m(ix + 1), m(iy), seed);
  const c = hash(m(ix), m(iy + 1), seed), d = hash(m(ix + 1), m(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, period: number, seed: number, oct = 3): number {
  let s = 0, amp = 1, norm = 0, p = period;
  for (let o = 0; o < oct; o++) {
    s += vnoise(x, y, p, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return s / norm;
}

/** Periodic Worley-ish cells: returns [distance to nearest, distance to 2nd nearest, cell id]. */
function cells(x: number, y: number, count: number, seed: number): [number, number, number] {
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let i = 0; i < count; i++) {
    const cx = hash(i, 1, seed) * N, cy = hash(i, 2, seed) * N;
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        const dx = x - (cx + ox * N), dy = y - (cy + oy * N);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = i;
        } else if (d < d2) d2 = d;
      }
  }
  return [d1, d2, id];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

class Tile {
  readonly px = new Float32Array(N * N * 4);
  set(x: number, y: number, c: RGB, a = 1) {
    const xx = ((x % N) + N) % N, yy = ((y % N) + N) % N;
    const i = (yy * N + xx) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const xx = ((x % N) + N) % N, yy = ((y % N) + N) % N;
    const i = (yy * N + xx) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2]];
  }
  alpha(x: number, y: number): number {
    const xx = ((x % N) + N) % N, yy = ((y % N) + N) % N;
    return this.px[(yy * N + xx) * 4 + 3];
  }
  setAlpha(x: number, y: number, a: number) {
    const xx = ((x % N) + N) % N, yy = ((y % N) + N) % N;
    this.px[(yy * N + xx) * 4 + 3] = a;
  }
  paint(fn: (x: number, y: number) => RGB, a = 1) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) this.set(x, y, fn(x, y), a);
  }
  clear() {
    this.px.fill(0);
  }
  /** Soft blob. */
  disc(cx: number, cy: number, r: number, c: RGB, a = 1, soft = 0.3) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d > 1) continue;
        const t = d > 1 - soft ? (1 - d) / soft : 1;
        const cur = this.get(x, y);
        const ca = this.alpha(x, y);
        this.set(x, y, mix(cur, c, t), Math.max(ca, a * (t > 0.5 ? 1 : t * 2)));
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      for (let oy = -w; oy <= w; oy++)
        for (let ox = -w; ox <= w; ox++) {
          if (ox * ox + oy * oy > w * w + 0.25) continue;
          this.set(Math.round(x + ox), Math.round(y + oy), c, a);
        }
    }
  }
  /** Multiply-shade existing pixels. */
  shade(fn: (x: number, y: number) => number) {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const k = fn(x, y);
        const i = (y * N + x) * 4;
        this.px[i] *= k;
        this.px[i + 1] *= k;
        this.px[i + 2] *= k;
      }
  }
}

// ---------------------------------------------------------------- reusable painters

function mottled(t: Tile, a: RGB, b: RGB, period: number, seed: number, contrast = 1, alpha = 1) {
  t.paint((x, y) => mix(a, b, clamp01((fbm(x, y, period, seed) - 0.5) * 2 * contrast + 0.5)), alpha);
}

function speckle(t: Tile, c: RGB, density: number, seed: number, size = 1) {
  for (let y = 0; y < N; y += size)
    for (let x = 0; x < N; x += size) {
      if (hash(x, y, seed) < density) {
        for (let oy = 0; oy < size; oy++) for (let ox = 0; ox < size; ox++) t.set(x + ox, y + oy, mix(t.get(x + ox, y + oy), c, 0.7), t.alpha(x, y));
      }
    }
}

function paintDirt(t: Tile, seed = 11) {
  mottled(t, hex('#6a4a2e'), hex('#8c6640'), 4, seed, 1.2);
  t.shade((x, y) => 0.9 + fbm(x, y, 16, seed + 5) * 0.2);
  for (let i = 0; i < 22; i++) {
    const cx = hash(i, 3, seed) * N, cy = hash(i, 4, seed) * N;
    const r = 1 + hash(i, 5, seed) * 1.8;
    t.disc(cx, cy, r, mix(hex('#a08060'), hex('#7a6a58'), hash(i, 6, seed)), 1, 0.6);
  }
  speckle(t, hex('#4a3320'), 0.05, seed + 9);
}

function paintStone(t: Tile, base: RGB, dark: RGB, seed: number, cracks = true) {
  t.paint((x, y) => {
    const n = fbm(x, y, 4, seed, 4);
    const strata = Math.sin((y / N) * Math.PI * 6 + fbm(x, y, 4, seed + 3) * 5) * 0.04;
    return mul(mix(dark, base, clamp01(n * 1.4 - 0.2)), 0.95 + strata);
  });
  if (cracks) {
    t.shade((x, y) => {
      const [d1, d2] = cells(x, y, 7, seed + 17);
      const edge = d2 - d1;
      return edge < 1.1 ? 0.72 + edge * 0.2 : 1;
    });
  }
  t.shade((x, y) => 0.92 + vnoise(x, y, 32, seed + 44) * 0.12);
}

function paintCobble(t: Tile, base: RGB, mortar: RGB, seed: number, count = 9) {
  t.paint((x, y) => {
    const [d1, d2, id] = cells(x, y, count, seed);
    const edge = d2 - d1;
    const stoneCol = mix(base, mul(base, 0.78), hash(id, 9, seed));
    if (edge < 2.2) return mix(mortar, stoneCol, smooth(1.2, 2.2, edge));
    const bevel = 1 - Math.min(1, d1 / 14) * 0.18;
    return mul(stoneCol, (0.9 + fbm(x, y, 8, seed + id) * 0.2) * bevel + 0.06);
  });
}

function paintPlanks(t: Tile, light: RGB, dark: RGB, seed: number, boards = 4, vertical = false) {
  const bh = N / boards;
  t.paint((xx, yy) => {
    const x = vertical ? yy : xx, y = vertical ? xx : yy;
    const b = Math.floor(y / bh);
    const off = hash(b, 7, seed) * N;
    const grain = fbm((x + off) % N, y * 6, 2, seed + b, 3);
    const tone = 0.88 + hash(b, 3, seed) * 0.16;
    let c = mul(mix(dark, light, clamp01(grain * 1.3 - 0.1)), tone);
    const ly = y - b * bh;
    if (ly < 1.2) c = mul(dark, 0.55);
    else if (ly < 2.5) c = mul(c, 0.82);
    else if (ly > bh - 2) c = mul(c, 1.06);
    // board seam
    const seamX = (hash(b, 11, seed) * N + (b % 2) * N * 0.5) % N;
    if (Math.abs(x - seamX) < 0.8) c = mul(dark, 0.6);
    return c;
  });
  // nails
  for (let b = 0; b < boards; b++) {
    const y = b * bh + bh / 2;
    for (const nx of [4, N - 5]) {
      const x = vertical ? y : nx, yy = vertical ? nx : y;
      t.disc(x, yy, 1.1, hex('#3a2c22'), 1, 0.2);
    }
  }
}

function paintBark(t: Tile, a: RGB, b: RGB, seed: number, groove = 0.55) {
  t.paint((x, y) => {
    const n = fbm(x * 3, y * 0.5, 3, seed, 4);
    const ridge = Math.abs(Math.sin((x / N) * Math.PI * 7 + fbm(x, y, 2, seed + 9) * 6));
    const c = mix(b, a, clamp01(n * 1.2 - 0.1));
    return mul(c, ridge < 0.22 ? groove + ridge : 1);
  });
}

function paintRings(t: Tile, bark: RGB, wood: RGB, ring: RGB, seed: number) {
  t.paint((x, y) => {
    const dx = x + 0.5 - N / 2, dy = y + 0.5 - N / 2;
    const d = Math.hypot(dx, dy) + fbm(x, y, 4, seed) * 4;
    if (d > N / 2 - 4) return mul(bark, 0.8 + fbm(x, y, 8, seed + 1) * 0.3);
    const r = Math.sin(d * 0.9) * 0.5 + 0.5;
    return mix(wood, ring, r * 0.55);
  });
}

function paintFoliage(t: Tile, base: number, seed: number, colored?: { a: RGB; b: RGB; dark: RGB }) {
  // grayscale when tinted by biome, colored otherwise
  const dark: RGB = colored ? colored.dark : [base * 0.42, base * 0.46, base * 0.4];
  const mid: RGB = colored ? colored.a : [base * 0.78, base * 0.82, base * 0.74];
  const light: RGB = colored ? colored.b : [base, base, base * 0.92];
  t.paint(() => dark);
  for (let i = 0; i < 70; i++) {
    const cx = hash(i, 1, seed) * N, cy = hash(i, 2, seed) * N;
    const r = 3 + hash(i, 3, seed) * 4;
    t.disc(cx, cy, r, mix(mid, light, hash(i, 4, seed) * 0.8), 1, 0.5);
    t.disc(cx - r * 0.25, cy - r * 0.3, r * 0.45, light, 1, 0.8);
  }
  t.shade((x, y) => 0.9 + fbm(x, y, 8, seed + 3) * 0.2);
}

type Stroke = { x: number; y0: number; y1: number; bend: number; w: number; c: RGB };
function paintBlades(t: Tile, strokes: Stroke[]) {
  for (const s of strokes) {
    const steps = Math.ceil((s.y0 - s.y1) * 1.5);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const y = s.y0 + (s.y1 - s.y0) * u;
      const x = s.x + s.bend * u * u;
      const w = s.w * (1 - u * 0.75);
      const c = mul(s.c, 0.72 + u * 0.4);
      for (let ox = -Math.ceil(w); ox <= Math.ceil(w); ox++) {
        if (Math.abs(ox) > w) continue;
        t.set(Math.round(x + ox), Math.round(y), c, 1);
      }
    }
  }
}

function grassStrokes(seed: number, count: number, minH: number, maxH: number, gray = true, col?: RGB): Stroke[] {
  const out: Stroke[] = [];
  for (let i = 0; i < count; i++) {
    const h = minH + hash(i, 2, seed) * (maxH - minH);
    const v = 0.7 + hash(i, 5, seed) * 0.3;
    out.push({
      x: 4 + hash(i, 1, seed) * (N - 8), y0: N - 1, y1: N - 1 - h, bend: (hash(i, 3, seed) - 0.5) * 16,
      w: 1.3 + hash(i, 4, seed) * 1.2, c: gray ? [v, v, v * 0.9] : mul(col!, v),
    });
  }
  return out;
}

function flowerHead(t: Tile, cx: number, cy: number, r: number, petal: RGB, center: RGB, petals = 5) {
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    t.disc(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, r * 0.6, petal, 1, 0.3);
  }
  t.disc(cx, cy, r * 0.45, center, 1, 0.3);
}

function stem(t: Tile, x: number, y0: number, y1: number, c: RGB, bend = 0, w = 1.2) {
  paintBlades(t, [{ x, y0, y1, bend, w, c }]);
}

function paintCrop(t: Tile, kind: 'wheat' | 'root' | 'gourd' | 'mint' | 'corn' | 'tomato', stage: number, seed: number) {
  t.clear();
  const green = hex('#5f9a3a');
  const s = (stage + 1) / 4;
  if (kind === 'corn') {
    // tall stalks with long leaves; golden cobs + tassels when ripe
    const stalk = hex('#6fa84a');
    for (let i = 0; i < 3; i++) {
      const x = 14 + i * 18 + (hash(i, 1, seed) - 0.5) * 4;
      const h = (22 + hash(i, 2, seed) * 14) * s + 10;
      stem(t, x, N - 1, N - 1 - h, stalk, (hash(i, 3, seed) - 0.5) * 3, 2.2);
      for (let k = 0; k < 2 + stage; k++) {
        const yy = N - 6 - k * (h / (3 + stage));
        const dir = k % 2 ? 1 : -1;
        t.line(x, yy, x + dir * (8 + stage * 2), yy - 6, 1.1, mul(stalk, 0.9 + (k % 2) * 0.15));
      }
      if (stage >= 2) {
        const cy = N - 1 - h * 0.55;
        t.disc(x + 3, cy, stage >= 3 ? 3.4 : 2.4, stage >= 3 ? hex('#f2cf4a') : hex('#b8c86a'), 1, 0.3);
        t.disc(x + 3, cy - 4, stage >= 3 ? 3 : 2, stage >= 3 ? hex('#e8bf3a') : hex('#a9bd5f'), 1, 0.3);
        t.line(x + 1, cy + 3, x + 5, cy - 8, 1.2, hex('#7fb04f'));
      }
      if (stage >= 3) for (let k = 0; k < 3; k++) t.line(x, N - 1 - h, x + (k - 1) * 4, N - 7 - h, 0.6, hex('#d9b36a'));
    }
  } else if (kind === 'tomato') {
    // bushy vine on a little cane; green → blushing red berries
    t.line(32, N - 1, 32, N - 1 - 46 * s - 4, 0.8, hex('#a07a48'));
    for (let i = 0; i < 6; i++) {
      const x = 16 + i * 6.5;
      const h = (10 + hash(i, 2, seed) * 20) * s + 6;
      stem(t, x, N - 1, N - 1 - h, hex('#4f8f3a'), (hash(i, 4, seed) - 0.5) * 8, 1.4);
      t.disc(x + (hash(i, 5, seed) - 0.5) * 6, N - 1 - h, 3.6 * s + 1.6, hex('#5fa848'), 1, 0.4);
    }
    if (stage >= 2) {
      for (let i = 0; i < (stage >= 3 ? 7 : 4); i++) {
        const x = 18 + hash(i, 8, seed) * 28, y = N - 14 - hash(i, 9, seed) * 26 * s;
        t.disc(x, y, stage >= 3 ? 3.6 : 2.6, stage >= 3 ? mix(hex('#e0453a'), hex('#f06a4a'), hash(i, 10, seed)) : hex('#9cc85a'), 1, 0.25);
        if (stage >= 3) t.disc(x - 1, y - 1, 0.9, hex('#ffd0c0'), 0.8, 0.4);
      }
    }
  } else if (kind === 'wheat') {
    const gold = hex('#e6c35a');
    const col = stage >= 3 ? gold : mix(green, gold, stage / 4);
    for (let i = 0; i < 7; i++) {
      const x = 8 + i * 8 + (hash(i, 1, seed) - 0.5) * 4;
      const h = (18 + hash(i, 2, seed) * 20) * s + 6;
      stem(t, x, N - 1, N - 1 - h, col, (hash(i, 3, seed) - 0.5) * 6, 1);
      if (stage >= 2) for (let k = 0; k < 5; k++) t.disc(x + (hash(i, 3, seed) - 0.5) * 6, N - 1 - h + k * 2.6, 1.8, stage >= 3 ? hex('#f0d27a') : hex('#b8c26a'), 1, 0.3);
    }
  } else if (kind === 'root') {
    const leaf = hex('#6fb04a');
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 7;
      const h = (10 + hash(i, 2, seed) * 18) * s + 6;
      stem(t, x, N - 6, N - 6 - h, leaf, (i - 2.5) * 3, 2.2);
    }
    if (stage >= 3) {
      t.disc(26, N - 6, 7, hex('#d8493a'), 1, 0.3);
      t.disc(40, N - 5, 6, hex('#c23f33'), 1, 0.3);
    }
  } else if (kind === 'gourd') {
    for (let i = 0; i < 5; i++) {
      const x = 10 + i * 11;
      const h = (8 + hash(i, 2, seed) * 14) * s + 4;
      stem(t, x, N - 1, N - 1 - h, green, (hash(i, 5, seed) - 0.5) * 10, 1);
      t.disc(x + 3, N - 1 - h, 4.5 * s + 1.5, hex('#4f8a38'), 1, 0.4);
    }
    if (stage >= 2) {
      const r = stage >= 3 ? 12 : 6;
      t.disc(32, N - r - 1, r, stage >= 3 ? hex('#f0983b') : hex('#a8c65a'), 1, 0.25);
      if (stage >= 3) {
        t.line(32, N - 2 * r, 32, N - 2, 0.5, hex('#c8702b'));
        t.line(24, N - r - 6, 24, N - 4, 0.5, hex('#d8802f'));
        t.line(40, N - r - 6, 40, N - 4, 0.5, hex('#d8802f'));
        t.line(32, N - 2 * r - 1, 34, N - 2 * r - 5, 1, hex('#5f7a2a'));
      }
    }
  } else {
    const mint = hex('#5fcf8a');
    for (let i = 0; i < 6; i++) {
      const x = 10 + i * 9;
      const h = (8 + hash(i, 2, seed) * 16) * s + 6;
      stem(t, x, N - 1, N - 1 - h, hex('#3f8a58'), (hash(i, 7, seed) - 0.5) * 5, 1);
      for (let k = 0; k < 1 + stage; k++) {
        const yy = N - 1 - h + k * 5;
        t.disc(x - 3, yy, 3, mint, 1, 0.4);
        t.disc(x + 3, yy + 2, 3, mul(mint, 0.85), 1, 0.4);
      }
    }
    if (stage >= 3) for (let i = 0; i < 4; i++) t.disc(12 + i * 13, 18 + hash(i, 1, seed) * 8, 2, hex('#c9b8ff'), 1, 0.3);
  }
}

// ---------------------------------------------------------------- the tile table

const PAINTERS: Partial<Record<TileName, (t: Tile) => void>> = {
  grass_top: (t) => {
    t.paint((x, y) => {
      const n = fbm(x, y, 4, 101, 4);
      const v = 0.78 + n * 0.3;
      return [v, v, v * 0.88];
    });
    for (let i = 0; i < 160; i++) {
      const x = hash(i, 1, 102) * N, y = hash(i, 2, 102) * N;
      const len = 2 + hash(i, 3, 102) * 3;
      const d = hash(i, 4, 102) > 0.5 ? 1 : -1;
      const v = hash(i, 5, 102) > 0.5 ? 1.02 : 0.66;
      t.line(x, y, x + d, y - len, 0, [v, v, v * 0.85]);
    }
  },
  grass_side: (t) => {
    paintDirt(t, 12);
    for (let x = 0; x < N; x++) t.set(x, 0, t.get(x, 0), 0);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.setAlpha(x, y, 0);
    for (let x = 0; x < N; x++) {
      const edge = 9 + Math.round(vnoise(x, 0, 8, 103) * 7 + (hash(x, 1, 104) > 0.8 ? 4 : 0));
      for (let y = 0; y < edge; y++) {
        const v = 0.78 + fbm(x, y, 4, 105) * 0.26 - (y / edge) * 0.14;
        t.set(x, y, [v, v, v * 0.88], 1);
      }
      t.set(x, edge, mul(t.get(x, edge), 0.7), 0);
    }
  },
  dirt: (t) => paintDirt(t),
  stone: (t) => paintStone(t, hex('#9b9a94'), hex('#6f6e6a'), 201),
  deepstone: (t) => paintStone(t, hex('#4a4750'), hex('#2a2830'), 202),
  sand: (t) => {
    t.paint((x, y) => {
      const ripple = Math.sin((y / N) * Math.PI * 8 + fbm(x, y, 4, 301) * 6) * 0.04;
      return mul(mix(hex('#d9c38f'), hex('#f0e0b0'), fbm(x, y, 8, 302)), 0.98 + ripple);
    });
    speckle(t, hex('#b89c6a'), 0.06, 303);
    speckle(t, hex('#fff6d8'), 0.04, 304);
  },
  clay: (t) => {
    t.paint((x, y) => mix(hex('#a8968a'), hex('#c2b1a4'), fbm(x, y * 3, 3, 401)));
    t.shade((_x, y) => 0.96 + Math.sin((y / N) * Math.PI * 10) * 0.03);
  },
  gravel: (t) => {
    t.paint((x, y) => {
      const [d1, d2, id] = cells(x, y, 26, 501);
      const c = mix(hex('#7c7872'), hex('#b3aca2'), hash(id, 1, 501));
      return d2 - d1 < 1.3 ? hex('#4d4943') : mul(c, 1 - (d1 / 12) * 0.25);
    });
  },
  water: (t) => mottled(t, hex('#3f86b8'), hex('#6fb3d6'), 4, 601),
  log_side: (t) => paintBark(t, hex('#7a5836'), hex('#4f3822'), 701),
  log_top: (t) => paintRings(t, hex('#5a4028'), hex('#d0a86a'), hex('#a57d48'), 702),
  pine_side: (t) => paintBark(t, hex('#6e4430'), hex('#3f2519'), 703, 0.45),
  pine_top: (t) => paintRings(t, hex('#4a2c1e'), hex('#c49a64'), hex('#946a3e'), 704),
  birch_side: (t) => {
    t.paint((x, y) => mix(hex('#e4ded0'), hex('#f5f1e8'), fbm(x, y, 4, 705)));
    for (let i = 0; i < 16; i++) {
      const y = hash(i, 1, 706) * N, x = hash(i, 2, 706) * N, w = 4 + hash(i, 3, 706) * 12;
      t.line(x, y, x + w, y + (hash(i, 4, 706) - 0.5) * 2, 0.8, hex('#2e2a26'));
    }
    speckle(t, hex('#b8ae9c'), 0.04, 707);
  },
  birch_top: (t) => paintRings(t, hex('#e9e4d8'), hex('#e8d4a8'), hex('#c9ae7c'), 708),
  palm_side: (t) => {
    t.paint((x, y) => {
      const band = (y % 10) / 10;
      const c = mix(hex('#a8835a'), hex('#c9a57a'), fbm(x, y, 4, 709));
      return mul(c, band < 0.18 ? 0.7 : 1 - Math.abs(Math.sin((x / N) * Math.PI * 10)) * 0.08);
    });
  },
  palm_top: (t) => paintRings(t, hex('#8a6a44'), hex('#d8bf8f'), hex('#b69a6a'), 710),
  leaves: (t) => paintFoliage(t, 1, 801),
  pine_needles: (t) => {
    t.paint(() => [0.32, 0.36, 0.3]);
    for (let i = 0; i < 260; i++) {
      const x = hash(i, 1, 802) * N, y = hash(i, 2, 802) * N;
      const a = hash(i, 3, 802) * Math.PI;
      const v = 0.62 + hash(i, 4, 802) * 0.38;
      t.line(x, y, x + Math.cos(a) * 4, y + Math.sin(a) * 4, 0, [v, v, v * 0.9]);
    }
  },
  birch_leaves: (t) => paintFoliage(t, 1, 803, { a: hex('#a4c45a'), b: hex('#d4e48a'), dark: hex('#56722e') }),
  palm_fronds: (t) => {
    t.paint(() => [0.36, 0.4, 0.32]);
    for (let i = 0; i < 12; i++) {
      const y = (i / 12) * N;
      for (let x = 0; x < N; x += 2) {
        const v = 0.8 + hash(x, i, 804) * 0.2;
        t.line(x, y, x + 3, y + 5, 0.4, [v, v, v * 0.88]);
      }
    }
  },
  blossom_leaves: (t) => {
    paintFoliage(t, 1, 805, { a: hex('#6f9a45'), b: hex('#8fbf5a'), dark: hex('#3f5f2a') });
    for (let i = 0; i < 40; i++) flowerHead(t, hash(i, 1, 806) * N, hash(i, 2, 806) * N, 2.6, hash(i, 3, 806) > 0.3 ? hex('#f5b3cc') : hex('#fff4f7'), hex('#f0d27a'));
  },
  amberstone: (t) => {
    t.paint((x, y) => {
      const band = Math.sin((y / N) * Math.PI * 4 + fbm(x, y, 2, 901) * 3) * 0.06;
      return mul(mix(hex('#c9763e'), hex('#e59a5c'), fbm(x, y, 4, 902)), 1 + band);
    });
    speckle(t, hex('#f4c08a'), 0.03, 903);
  },
  amber_banded: (t) => {
    const bands = [hex('#e4a466'), hex('#c46b36'), hex('#f0caa0'), hex('#b25a2c'), hex('#d98a4e')];
    t.paint((x, y) => {
      const f = (y / N) * 5 + fbm(x, y, 2, 904) * 0.6;
      const b = bands[((Math.floor(f) % 5) + 5) % 5];
      return mul(b, 0.92 + fbm(x, y, 8, 905) * 0.16);
    });
  },
  crystal_stone: (t) => {
    paintStone(t, hex('#7f94a8'), hex('#51607a'), 906);
    for (let i = 0; i < 8; i++) {
      const x = hash(i, 1, 907) * N, y = hash(i, 2, 907) * N;
      t.line(x, y, x + 2, y - 4, 0.6, hex('#9ff3ff'));
    }
  },
  copper_ore: (t) => ore(t, hex('#d9814a'), hex('#5fbf9a'), 1001),
  ferra_ore: (t) => ore(t, hex('#9fbfd6'), hex('#5f7f98'), 1002),
  glow_ore: (t) => ore(t, hex('#8af4ff'), hex('#e0ffff'), 1003, true),
  moon_ore: (t) => ore(t, hex('#d9d4ff'), hex('#9f96e6'), 1004, true),
  ember_ore: (t) => ore(t, hex('#e2553a'), hex('#ffb06a'), 1005),
  planks: (t) => paintPlanks(t, hex('#c99a60'), hex('#8a6038'), 1101),
  birch_planks: (t) => paintPlanks(t, hex('#ecdcb4'), hex('#b9a27a'), 1102),
  dark_wood: (t) => paintPlanks(t, hex('#7a5236'), hex('#462c1c'), 1103),
  fieldstone: (t) => paintCobble(t, hex('#a6a39b'), hex('#5a5750'), 1201),
  mossy_fieldstone: (t) => {
    paintCobble(t, hex('#a6a39b'), hex('#5a5750'), 1201);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const m = fbm(x, y, 4, 1202, 3);
        if (m > 0.55) t.set(x, y, mix(t.get(x, y), mix(hex('#5f8a3a'), hex('#8fb85a'), fbm(x, y, 16, 1203)), smooth(0.55, 0.65, m)));
      }
  },
  brick: (t) => {
    const rows = 5, rh = N / rows;
    t.paint((x, y) => {
      const r = Math.floor(y / rh);
      const off = (r % 2) * (N / 4);
      const bx = Math.floor(((x + off) % N) / (N / 2));
      const ly = y - r * rh, lx = ((x + off) % N) - bx * (N / 2);
      if (ly < 2 || lx < 2) return mul(hex('#cfc3b0'), 0.85 + fbm(x, y, 16, 1301) * 0.2);
      const base = mix(hex('#a4523a'), hex('#c46a4a'), hash(r * 7 + bx, 1, 1302));
      return mul(base, 0.88 + fbm(x, y, 8, 1303) * 0.22);
    });
  },
  glass: (t) => {
    t.clear();
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const edge = x < 3 || y < 3 || x > N - 4 || y > N - 4;
        if (edge) t.set(x, y, hex('#e6f4f8'), 1);
      }
    for (let i = 0; i < 3; i++) t.line(12 + i * 7, 44 - i * 3, 24 + i * 7, 20 - i * 3, 0.5, hex('#ffffff'), 1);
  },
  thatch: (t) => {
    t.paint(() => hex('#8a6a2e'));
    for (let row = 0; row < 8; row++) {
      for (let i = 0; i < 40; i++) {
        const x = hash(i, row, 1401) * N;
        const y = row * 8 + hash(i, row + 9, 1401) * 3;
        const c = mix(hex('#d8b45a'), hex('#f0d68a'), hash(i, row + 3, 1401));
        t.line(x, y, x + 2, y + 9, 0.5, c);
      }
    }
  },
  lantern: (t) => {
    t.paint((x, y) => {
      const edge = x < 5 || x > N - 6 || y < 5 || y > N - 6 || Math.abs(x - N / 2) < 2;
      if (edge) return hex('#3a3430');
      const d = Math.hypot(x - N / 2, y - N / 2) / (N / 2);
      return mix(hex('#fff2c0'), hex('#ffb04a'), d);
    });
  },
  torch: (t) => paintBark(t, hex('#8a5a32'), hex('#5a3a1e'), 1501, 0.7),
  tall_grass: (t) => {
    t.clear();
    paintBlades(t, grassStrokes(1601, 13, 20, 50));
  },
  flower_sun: (t) => {
    t.clear();
    paintBlades(t, grassStrokes(1701, 4, 10, 22, false, hex('#6fa84a')));
    stem(t, 22, N - 1, 22, hex('#4f8a38'), 3);
    stem(t, 42, N - 1, 30, hex('#4f8a38'), -3);
    flowerHead(t, 25, 20, 9, hex('#f7cf3b'), hex('#9a5a22'), 8);
    flowerHead(t, 39, 29, 7, hex('#fbe07a'), hex('#9a5a22'), 7);
  },
  flower_sky: (t) => {
    t.clear();
    paintBlades(t, grassStrokes(1702, 4, 10, 20, false, hex('#6fa84a')));
    stem(t, 32, N - 1, 14, hex('#4f8a38'), 4);
    for (let i = 0; i < 4; i++) {
      const y = 16 + i * 9, x = 32 + (i % 2 ? 8 : -6);
      t.line(32 + i, y - 2, x, y, 0.6, hex('#4f8a38'));
      t.disc(x, y + 3, 4.5, hex('#6fa0f0'), 1, 0.3);
      t.disc(x, y + 5, 3, hex('#9fc4ff'), 1, 0.3);
    }
  },
  flower_ember: (t) => {
    t.clear();
    paintBlades(t, grassStrokes(1703, 5, 10, 22, false, hex('#6fa84a')));
    stem(t, 30, N - 1, 18, hex('#4f8a38'), -2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      t.line(30, 20, 30 + Math.cos(a) * 11, 20 + Math.sin(a) * 9 - 4, 2.2, i % 2 ? hex('#ff7a3a') : hex('#e2453a'));
    }
    t.disc(30, 19, 3, hex('#ffd36a'), 1, 0.3);
  },
  mushroom: (t) => {
    t.clear();
    for (const [x, y, r] of [[22, 36, 12], [44, 44, 8]] as [number, number, number][]) {
      t.line(x, N - 1, x, y, r * 0.28, hex('#efe3cc'));
      for (let yy = -r; yy <= 0; yy++)
        for (let xx = -r; xx <= r; xx++) {
          if ((xx * xx) / (r * r) + (yy * yy) / ((r * 0.75) ** 2) > 1) continue;
          t.set(x + xx, y + yy, mix(hex('#c9674a'), hex('#e0844a'), -yy / r), 1);
        }
      for (let i = 0; i < 4; i++) t.disc(x + (hash(i, r, 1801) - 0.5) * r * 1.4, y - 2 - hash(i, r + 1, 1801) * r * 0.5, 1.6, hex('#fff6e6'), 1, 0.3);
    }
  },
  berry_bush: (t) => bush(t, false),
  berry_bush_ripe: (t) => bush(t, true),
  sapling: (t) => {
    t.clear();
    stem(t, 32, N - 1, 18, hex('#7a5a36'), 2, 1.6);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.45;
      t.disc(32 + Math.cos(a) * 11, 20 + Math.sin(a) * 9 + 6, 5, mix(hex('#5f9a3a'), hex('#8fcf5a'), hash(i, 1, 1901)), 1, 0.5);
    }
  },
  tilled: (t) => tilled(t, false),
  tilled_moist: (t) => tilled(t, true),
  crop_wheat_0: (t) => paintCrop(t, 'wheat', 0, 2001),
  crop_wheat_1: (t) => paintCrop(t, 'wheat', 1, 2001),
  crop_wheat_2: (t) => paintCrop(t, 'wheat', 2, 2001),
  crop_wheat_3: (t) => paintCrop(t, 'wheat', 3, 2001),
  crop_root_0: (t) => paintCrop(t, 'root', 0, 2002),
  crop_root_1: (t) => paintCrop(t, 'root', 1, 2002),
  crop_root_2: (t) => paintCrop(t, 'root', 2, 2002),
  crop_root_3: (t) => paintCrop(t, 'root', 3, 2002),
  crop_gourd_0: (t) => paintCrop(t, 'gourd', 0, 2003),
  crop_gourd_1: (t) => paintCrop(t, 'gourd', 1, 2003),
  crop_gourd_2: (t) => paintCrop(t, 'gourd', 2, 2003),
  crop_gourd_3: (t) => paintCrop(t, 'gourd', 3, 2003),
  crop_mint_0: (t) => paintCrop(t, 'mint', 0, 2004),
  crop_mint_1: (t) => paintCrop(t, 'mint', 1, 2004),
  crop_mint_2: (t) => paintCrop(t, 'mint', 2, 2004),
  crop_mint_3: (t) => paintCrop(t, 'mint', 3, 2004),
  crop_corn_0: (t) => paintCrop(t, 'corn', 0, 2005),
  crop_corn_1: (t) => paintCrop(t, 'corn', 1, 2005),
  crop_corn_2: (t) => paintCrop(t, 'corn', 2, 2005),
  crop_corn_3: (t) => paintCrop(t, 'corn', 3, 2005),
  crop_tomato_0: (t) => paintCrop(t, 'tomato', 0, 2006),
  crop_tomato_1: (t) => paintCrop(t, 'tomato', 1, 2006),
  crop_tomato_2: (t) => paintCrop(t, 'tomato', 2, 2006),
  crop_tomato_3: (t) => paintCrop(t, 'tomato', 3, 2006),
  hay_top: (t) => {
    t.paint((x, y) => {
      const n = hash(x >> 1, y, 1501) * 0.18 + hash(x, y >> 2, 1502) * 0.1;
      return mix(hex('#d9b354'), hex('#f3d98a'), n * 3);
    });
    for (let i = 0; i < 90; i++) {
      const x = hash(i, 1, 1503) * N, y = hash(i, 2, 1503) * N, a = hash(i, 3, 1503) * Math.PI;
      t.line(x, y, x + Math.cos(a) * 6, y + Math.sin(a) * 6, 0.45, mix(hex('#c99a3a'), hex('#fbe7a8'), hash(i, 4, 1503)));
    }
  },
  hay_side: (t) => {
    t.paint((x, y) => mix(hex('#cfa446'), hex('#efd17e'), hash(x, y >> 1, 1511) * 0.6));
    for (let i = 0; i < 70; i++) {
      const x = hash(i, 1, 1512) * N, y = hash(i, 2, 1512) * N;
      t.line(x, y, x + 7, y + (hash(i, 3, 1512) - 0.5) * 2, 0.45, mix(hex('#b8862e'), hex('#fbe7a8'), hash(i, 4, 1512)));
    }
    // twine bands
    for (const bx of [16, 46]) for (let y = 0; y < N; y++) { t.set(bx, y, hex('#7a5230')); t.set(bx + 1, y, hex('#8a6238')); t.set(bx + 2, y, hex('#6b4424')); }
  },
  bench_top: (t) => {
    paintPlanks(t, hex('#d4a86a'), hex('#9a6a3e'), 2101, 3);
    t.line(10, 12, 26, 20, 1.2, hex('#6a6a70'));
    t.line(40, 40, 52, 30, 1.6, hex('#8a5a32'));
    t.disc(46, 14, 3, hex('#8f8f96'), 1, 0.3);
  },
  bench_side: (t) => paintPlanks(t, hex('#b0804a'), hex('#744c2a'), 2102, 4, true),
  metal: (t) => {
    t.paint((x, y) => mul(mix(hex('#8f9aa6'), hex('#c4ccd4'), fbm(x * 4, y * 0.25, 2, 2201)), 0.95 + ((x + y) % 7 === 0 ? 0.08 : 0)));
  },
  fire: (t) => {
    t.clear();
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const u = x / N - 0.5, v = 1 - y / N;
        const flick = fbm(x, y, 4, 2301) * 0.35;
        const shape = 0.45 - Math.abs(u) * 1.25 - v * 0.42 + flick;
        if (shape <= 0) continue;
        const heat = clamp01(shape * 3.2);
        t.set(x, y, mix(hex('#e2452a'), hex('#fff0a0'), heat), 1);
      }
  },
  oven: (t) => {
    PAINTERS.brick!(t);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = (x - N / 2) / 20, dy = (y - 40) / 18;
        const inArch = y > 22 && Math.abs(x - N / 2) < 20 && (y > 40 || dx * dx + dy * dy < 1);
        if (inArch && y < N - 6) {
          const glow = clamp01((y - 34) / 24);
          t.set(x, y, mix(hex('#201612'), hex('#ff8a3a'), glow * (0.6 + fbm(x, y, 8, 2401) * 0.4)));
        }
      }
  },
  soot: (t) => mottled(t, hex('#1e1c1c'), hex('#3a3634'), 4, 2501),
  fabric_red: (t) => weave(t, hex('#b8483a'), hex('#d8604a')),
  fabric_cream: (t) => weave(t, hex('#e8dcc4'), hex('#f8f0e0')),
  wool_green: (t) => weave(t, hex('#5f8a3a'), hex('#7fae5a')),
  chest_side: (t) => {
    paintPlanks(t, hex('#b8844a'), hex('#7a5230'), 2601, 3);
    for (const y of [6, N - 8]) for (let x = 0; x < N; x++) for (let k = 0; k < 3; k++) t.set(x, y + k, mix(hex('#6a6a70'), hex('#9a9aa2'), k / 2));
  },
  chest_front: (t) => {
    PAINTERS.chest_side!(t);
    for (let y = 22; y < 36; y++) for (let x = 27; x < 37; x++) t.set(x, y, mix(hex('#c9a13a'), hex('#f0d06a'), (y - 22) / 14));
    t.disc(32, 30, 1.5, hex('#3a2c1e'), 1, 0.1);
  },
  crystal: (t) => {
    t.clear();
    const shards: [number, number, number, number][] = [[32, 6, 7, 58], [18, 24, 5, 40], [46, 20, 5, 44], [26, 34, 4, 30], [40, 36, 4, 28]];
    for (const [x, top, w, len] of shards) {
      for (let y = top; y < top + len && y < N; y++) {
        const k = (y - top) / len;
        const hw = Math.min(w, (y - top) * 0.8);
        for (let xx = -hw; xx <= hw; xx++) {
          const edge = Math.abs(xx) / Math.max(1, hw);
          t.set(Math.round(x + xx), y, mix(hex('#e8ffff'), hex('#3fb3d6'), edge * 0.7 + k * 0.3), 1);
        }
      }
    }
  },
  lore_stone: (t) => {
    paintStone(t, hex('#8f9a8a'), hex('#5f6a5a'), 2701, false);
    const rune = hex('#7ff0d0');
    const glyphs = [[16, 12], [34, 12], [16, 30], [34, 30], [25, 46]];
    glyphs.forEach(([x, y], i) => {
      const r = hash(i, 1, 2702);
      t.line(x, y, x + 10, y + (r > 0.5 ? 8 : 0), 0.7, rune);
      t.line(x + 5, y - 2, x + 5, y + 10, 0.7, rune);
      if (r > 0.3) t.disc(x + 2, y + 8, 1.5, rune, 1, 0.2);
    });
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (fbm(x, y, 4, 2703) > 0.62) t.set(x, y, mix(t.get(x, y), hex('#6f9a45'), 0.6));
  },
  shell: (t) => {
    t.paint((x, y) => {
      const dx = x - N / 2, dy = y - N / 2;
      const a = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
      const spiral = Math.sin(a * 1 + d * 0.5) * 0.5 + 0.5;
      return mix(hex('#f6e0d0'), hex('#e8a8a0'), spiral * 0.6);
    });
  },
  ice: (t) => {
    t.paint((x, y) => mix(hex('#bfe4f4'), hex('#e8f8ff'), fbm(x, y, 4, 2801)));
    t.shade((x, y) => {
      const [d1, d2] = cells(x, y, 5, 2802);
      return d2 - d1 < 1 ? 0.85 : 1;
    });
  },
  barrel: (t) => {
    paintPlanks(t, hex('#a8743e'), hex('#6a4424'), 2901, 6, true);
    for (const y of [8, N - 12]) for (let x = 0; x < N; x++) for (let k = 0; k < 4; k++) t.set(x, y + k, mix(hex('#5a5a62'), hex('#8a8a92'), k / 3));
  },
  rug: (t) => {
    t.paint((x, y) => {
      const cx = Math.abs(x + 0.5 - N / 2), cy = Math.abs(y + 0.5 - N / 2);
      if (cx > N / 2 - 4 || cy > N / 2 - 4) return hex('#8a3a2e');
      const d = (cx + cy) % 16;
      const base = d < 4 ? hex('#e8c86a') : d < 8 ? hex('#c0563f') : hex('#f3ead8');
      return mul(base, 0.92 + ((x + y) % 2) * 0.08);
    });
  },
  door: (t) => {
    paintPlanks(t, hex('#b8844a'), hex('#7a5230'), 3001, 4, true);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (x < 4 || x > N - 5 || y < 4 || y > N - 5) t.set(x, y, mul(hex('#6a4424'), 0.9));
    }
    t.line(6, N - 8, N - 8, 8, 1.4, hex('#7a5230'));
    t.disc(N - 12, N / 2, 2.4, hex('#d8b04a'), 1, 0.3);
  },
  window: (t) => {
    t.clear();
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const frame = x < 5 || y < 5 || x > N - 6 || y > N - 6 || Math.abs(x - N / 2) < 2 || Math.abs(y - N / 2) < 2;
        if (frame) t.set(x, y, mix(hex('#8a5a32'), hex('#b0804a'), fbm(x, y, 8, 3101)), 1);
      }
    t.line(12, 26, 24, 10, 0.5, hex('#ffffff'), 1);
    t.line(40, 56, 52, 40, 0.5, hex('#ffffff'), 1);
  },
  leaf_litter: (t) => {
    paintDirt(t, 13);
    const cols = [hex('#b8642e'), hex('#d8943a'), hex('#8a4a2a'), hex('#9a8a3a')];
    for (let i = 0; i < 70; i++) {
      const x = hash(i, 1, 3201) * N, y = hash(i, 2, 3201) * N;
      t.disc(x, y, 2 + hash(i, 3, 3201) * 2.5, cols[i % 4], 1, 0.5);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.setAlpha(x, y, 0);
  },
  snow: (t) => {
    t.paint((x, y) => mix(hex('#e6eef6'), hex('#ffffff'), fbm(x, y, 4, 3301)));
    speckle(t, hex('#cfe0f0'), 0.05, 3302);
  },
  dry_shrub: (t) => {
    t.clear();
    const c = hex('#8a6a44');
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (hash(i, 1, 3401) - 0.5) * 2.2;
      const len = 20 + hash(i, 2, 3401) * 20;
      const x1 = 32 + Math.cos(a) * len, y1 = N - 2 + Math.sin(a) * len;
      t.line(32, N - 2, x1, y1, 0.7, c);
      t.line((32 + x1) / 2, (N - 2 + y1) / 2, (32 + x1) / 2 + 6 * Math.cos(a + 0.8), (N - 2 + y1) / 2 + 6 * Math.sin(a + 0.8), 0.5, c);
    }
  },
};


// ---------------------------------------------------------------- architecture tiles
// Painted near-white/neutral with a full tint mask: ARCH_MATERIALS supply the colour.

/** Light neutral base with gentle noise, for tinting. */
function neutral(t: Tile, lo: number, hi: number, period: number, seed: number) {
  t.paint((x, y) => {
    const v = lo + (hi - lo) * fbm(x, y, period, seed);
    return [v, v, v];
  });
}

function boards(t: Tile, count: number, vertical: boolean, seed: number, gap: number, lo = 0.8, hi = 0.98, grainScale = 6) {
  const bh = N / count;
  t.paint((xx, yy) => {
    const x = vertical ? yy : xx, y = vertical ? xx : yy;
    const b = Math.floor(y / bh);
    const ly = y - b * bh;
    const off = hash(b, 5, seed) * N;
    const grain = fbm((x + off) % N, y * grainScale, 2, seed + b, 3);
    const tone = 0.92 + hash(b, 9, seed) * 0.1;
    let v = (lo + (hi - lo) * clamp01(grain * 1.25 - 0.1)) * tone;
    if (ly < gap) v *= 0.45;
    else if (ly < gap + 1.2) v *= 0.84;
    return [v, v * 0.985, v * 0.97];
  });
}

const ARCH_PAINTERS: Partial<Record<TileName, (t: Tile) => void>> = {
  plaster: (t) => {
    neutral(t, 0.9, 0.99, 8, 4101);
    t.shade((x, y) => 0.975 + vnoise(x, y, 32, 4102) * 0.05);
  },
  concrete: (t) => {
    neutral(t, 0.84, 0.97, 4, 4201);
    speckle(t, [0.72, 0.72, 0.72], 0.025, 4202);
    // subtle form-tie holes + panel seam
    for (const [x, y] of [[12, 16], [52, 16], [12, 48], [52, 48]]) t.disc(x, y, 1.3, [0.66, 0.66, 0.66], 1, 0.4);
    for (let x = 0; x < N; x++) t.set(x, 0, mul(t.get(x, 0), 0.88));
  },
  brick_modern: (t) => {
    const rows = 8, rh = N / rows;
    t.paint((x, y) => {
      const r = Math.floor(y / rh);
      const off = (r % 2) * (N / 4);
      const bx = Math.floor(((x + off) % N) / (N / 2));
      const ly = y - r * rh, lx = ((x + off) % N) - bx * (N / 2);
      if (ly < 1.4 || lx < 1.4) return [0.7, 0.7, 0.69];
      const v = 0.86 + hash(r * 7 + bx, 1, 4301) * 0.12 + (fbm(x, y, 8, 4302) - 0.5) * 0.06;
      return [v, v, v];
    });
  },
  stone_smooth: (t) => {
    t.paint((x, y) => {
      const rowH = N / 2;
      const r = Math.floor(y / rowH);
      const off = (r % 2) * (N / 2);
      const lx = (x + off) % N, ly = y - r * rowH;
      if (ly < 1.2 || lx < 1.2) return [0.62, 0.62, 0.61];
      const v = 0.84 + fbm(x, y, 4, 4401 + r) * 0.14;
      return [v, v, v * 0.99];
    });
    speckle(t, [0.7, 0.7, 0.7], 0.02, 4402);
  },
  sandstone: (t) => {
    t.paint((x, y) => {
      const band = Math.sin((y / N) * Math.PI * 6 + fbm(x, y, 2, 4501) * 2.5) * 0.04;
      const v = 0.86 + fbm(x, y, 8, 4502) * 0.1 + band;
      return [v, v, v];
    });
    for (let x = 0; x < N; x++) t.set(x, 31, mul(t.get(x, 31), 0.8));
  },
  wood_cladding: (t) => {
    boards(t, 5, false, 4601, 1.6, 0.74, 0.98, 5);
    // shadow line under each overlapping board
    t.shade((_x, y) => 1 - Math.max(0, 1 - ((y % (N / 5)) / 3)) * 0.18);
  },
  wood_slats: (t) => {
    const slats = 8, w = N / slats;
    t.paint((x, y) => {
      const s = Math.floor(x / w);
      const lx = x - s * w;
      if (lx < 2) return [0.22, 0.2, 0.19];
      const grain = fbm(x * 0.4 + s * 13, y, 3, 4701 + s, 3);
      const v = (0.8 + grain * 0.2) * (0.94 + hash(s, 1, 4702) * 0.08) * (lx < 3 ? 0.85 : 1);
      return [v, v * 0.985, v * 0.97];
    });
  },
  wood_panel: (t) => boards(t, 4, true, 4801, 1, 0.8, 0.98, 4),
  metal_panel: (t) => {
    t.paint((x, y) => {
      const seam = x % 16;
      let v = 0.86 + fbm(x * 0.2, y * 4, 2, 4901) * 0.08;
      if (seam < 1) v *= 0.62;
      else if (seam < 2) v *= 1.08;
      return [v, v, v * 1.01];
    });
  },
  wood_floor: (t) => {
    boards(t, 6, false, 5001, 0.8, 0.8, 1.0, 7);
    // staggered butt joints
    for (let b = 0; b < 6; b++) {
      const jx = Math.floor(hash(b, 3, 5002) * N);
      for (let y = Math.floor(b * N / 6) + 1; y < Math.floor((b + 1) * N / 6); y++) t.set(jx, y, mul(t.get(jx, y), 0.55));
    }
  },
  marble: (t) => {
    t.paint((x, y) => {
      const n = fbm(x, y, 4, 5101, 4);
      const vein = Math.abs(Math.sin((x + y) / N * Math.PI * 2 + n * 7));
      let v = 0.93 + fbm(x, y, 8, 5102) * 0.05;
      if (vein < 0.06) v -= (0.06 - vein) * 4.5;
      return [v, v, v];
    });
  },
  terrazzo: (t) => {
    neutral(t, 0.9, 0.97, 8, 5201);
    const chips: RGB[] = [[0.55, 0.53, 0.5], [0.78, 0.66, 0.56], [0.62, 0.66, 0.66], [0.4, 0.4, 0.4]];
    for (let i = 0; i < 90; i++) t.disc(hash(i, 1, 5202) * N, hash(i, 2, 5202) * N, 0.8 + hash(i, 3, 5202) * 1.6, chips[i % 4], 1, 0.5);
  },
  tile_square: (t) => {
    t.paint((x, y) => {
      const g = x % 32 < 1.2 || y % 32 < 1.2;
      if (g) return [0.72, 0.72, 0.71];
      const v = 0.9 + fbm(x, y, 8, 5301) * 0.08 + hash(Math.floor(x / 32), Math.floor(y / 32), 5302) * 0.03;
      return [v, v, v];
    });
  },
  tile_small: (t) => {
    t.paint((x, y) => {
      if (x % 8 < 1 || y % 8 < 1) return [0.92, 0.95, 0.96];
      const v = 0.78 + hash(Math.floor(x / 8), Math.floor(y / 8), 5401) * 0.2;
      return [v, v, v];
    });
  },
  carpet: (t) => {
    neutral(t, 0.84, 0.96, 16, 5501);
    speckle(t, [0.78, 0.78, 0.78], 0.18, 5502);
    speckle(t, [0.99, 0.99, 0.99], 0.08, 5503);
  },
  shingles: (t) => {
    const rows = 6, rh = N / rows;
    t.paint((x, y) => {
      const r = Math.floor(y / rh);
      const off = (r % 2) * 5;
      const col = Math.floor((x + off) / 10);
      const ly = y - r * rh, lx = (x + off) % 10;
      let v = 0.78 + hash(col, r, 5601) * 0.16 + fbm(x, y, 8, 5602) * 0.06;
      if (lx < 0.9) v *= 0.6;
      if (ly > rh - 2) v *= 0.7;
      return [v, v, v];
    });
  },
  roof_tile: (t) => {
    const rows = 5, rh = N / rows;
    t.paint((x, y) => {
      const r = Math.floor(y / rh);
      const ly = (y - r * rh) / rh;
      const arc = Math.cos(((x % 16) / 16) * Math.PI * 2) * 0.5 + 0.5;
      let v = 0.72 + arc * 0.24 + hash(Math.floor(x / 16), r, 5701) * 0.05;
      if (ly > 0.82) v *= 0.62;
      return [v, v, v];
    });
  },
  metal_roof: (t) => {
    t.paint((x, y) => {
      const rib = x % 16;
      let v = 0.82 + fbm(x * 0.2, y * 3, 2, 5801) * 0.06;
      if (rib < 2) v = 0.98;
      else if (rib < 3) v *= 0.7;
      return [v, v, v * 1.01];
    });
  },
  wood_shingles: (t) => {
    const rows = 5, rh = N / rows;
    t.paint((x, y) => {
      const r = Math.floor(y / rh);
      const off = (r % 2) * 6;
      const w = 9 + (hash(Math.floor((x + off) / 12), r, 5901) * 4 | 0);
      const lx = (x + off) % w;
      const ly = y - r * rh;
      let v = (0.72 + fbm(x * 0.5, y * 4, 2, 5902) * 0.22) * (0.9 + hash(Math.floor((x + off) / w), r, 5903) * 0.12);
      if (lx < 1) v *= 0.55;
      if (ly > rh - 1.6) v *= 0.6;
      return [v, v * 0.98, v * 0.96];
    });
  },
  pavers: (t) => {
    t.paint((x, y) => {
      const r = Math.floor(y / 16);
      const off = (r % 2) * 16;
      const lx = (x + off) % 32, ly = y % 16;
      if (lx < 1.2 || ly < 1.2) return [0.58, 0.57, 0.55];
      const v = 0.84 + hash(Math.floor((x + off) / 32), r, 6001) * 0.1 + fbm(x, y, 8, 6002) * 0.06;
      return [v, v, v];
    });
  },
  decking: (t) => boards(t, 5, false, 6101, 2.2, 0.76, 0.98, 5),
  glass_pane: (t) => {
    // rgb = soft reflection streaks, alpha = extra reflectivity
    t.paint((x, y) => {
      const s = Math.max(0, Math.sin(((x + y * 0.6) / N) * Math.PI * 2) - 0.6) * 1.6;
      return [0.9 + s * 0.1, 0.95 + s * 0.05, 1];
    }, 1);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const s = Math.max(0, Math.sin(((x + y * 0.6) / N) * Math.PI * 2) - 0.7) * 1.5;
        t.setAlpha(x, y, s);
      }
  },
  hedge: (t) => paintFoliage(t, 1, 6201, { a: hex('#4f7f3a'), b: hex('#6f9f4a'), dark: hex('#2f4f24') }),
  gate: (t) => {
    t.clear();
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const post = x < 6 || x > N - 7;
        const rail = (y > 10 && y < 16) || (y > N - 18 && y < N - 12);
        const picket = (x % 12) < 6 && y > 4;
        if (post || rail || picket) t.set(x, y, mix(hex('#b8844a'), hex('#8a5a32'), fbm(x, y, 8, 6301)), 1);
      }
  },
};
Object.assign(PAINTERS, ARCH_PAINTERS);

function ore(t: Tile, gem: RGB, hi: RGB, seed: number, glow = false) {
  paintStone(t, hex('#9b9a94'), hex('#6f6e6a'), seed + 50);
  for (let i = 0; i < 7; i++) {
    const x = 8 + hash(i, 1, seed) * (N - 16), y = 8 + hash(i, 2, seed) * (N - 16);
    const r = 3.5 + hash(i, 3, seed) * 3;
    if (glow) t.disc(x, y, r + 3, mix(t.get(x, y), gem, 0.4), 1, 0.9);
    t.disc(x, y, r, mul(gem, 0.7), 1, 0.4);
    t.disc(x - r * 0.25, y - r * 0.25, r * 0.6, gem, 1, 0.5);
    t.disc(x - r * 0.4, y - r * 0.4, r * 0.25, hi, 1, 0.5);
  }
}

function bush(t: Tile, ripe: boolean) {
  t.clear();
  for (let i = 0; i < 26; i++) {
    const a = hash(i, 1, 1850) * Math.PI;
    const d = hash(i, 2, 1850) * 22;
    const x = 32 + Math.cos(a) * d * 1.2 - 0, y = N - 18 - Math.sin(a) * d;
    t.disc(x, y, 6 + hash(i, 3, 1850) * 3, mix(hex('#3f6a2a'), hex('#6f9a45'), hash(i, 4, 1850)), 1, 0.5);
  }
  if (ripe) {
    for (let i = 0; i < 16; i++) {
      const x = 12 + hash(i, 5, 1851) * 40, y = 22 + hash(i, 6, 1851) * 34;
      t.disc(x, y, 2.6, hex('#8a2f5c'), 1, 0.3);
      t.disc(x - 0.8, y - 0.8, 1, hex('#f07aa8'), 1, 0.3);
    }
  }
}

function tilled(t: Tile, moist: boolean) {
  paintDirt(t, 14);
  t.shade((_x, y) => {
    const f = Math.sin((y / N) * Math.PI * 8);
    return (0.72 + f * 0.2) * (moist ? 0.62 : 1);
  });
  if (moist) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.set(x, y, mix(t.get(x, y), hex('#2a3a4a'), 0.12));
}

function weave(t: Tile, a: RGB, b: RGB) {
  t.paint((x, y) => {
    const w = ((Math.floor(x / 2) + Math.floor(y / 2)) % 2) === 0;
    return mul(w ? a : b, 0.94 + fbm(x, y, 8, 3501) * 0.12);
  });
}

function fallback(t: Tile, name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  mottled(t, [0.6, 0.5, 0.45], [0.8, 0.7, 0.6], 4, h);
}

/**
 * Paint every tile. Returns RGBA8 data laid out as `layers` slices of N×N (bottom row first, GL convention),
 * ready for a THREE.DataArrayTexture, plus per-tile average colors (for particles/map/icons).
 */
export function paintAllTiles(): { data: Uint8Array; size: number; layers: number; averages: RGB[] } {
  const layers = TILE_NAMES.length;
  const data = new Uint8Array(N * N * 4 * layers);
  const averages: RGB[] = [];
  TILE_NAMES.forEach((name, layer) => {
    const t = new Tile();
    const p = PAINTERS[name];
    if (p) p(t);
    else fallback(t, name);
    const off = layer * N * N * 4;
    let ar = 0, ag = 0, ab = 0, n = 0;
    for (let i = 0; i < N * N; i++) {
      const r = clamp01(t.px[i * 4]), g = clamp01(t.px[i * 4 + 1]), b = clamp01(t.px[i * 4 + 2]), a = clamp01(t.px[i * 4 + 3]);
      // GL textures start at the bottom row: flip so painted "up" is +v on faces.
      const x = i % N, y = (i / N) | 0;
      const o = off + ((N - 1 - y) * N + x) * 4;
      data[o] = Math.round(r * 255);
      data[o + 1] = Math.round(g * 255);
      data[o + 2] = Math.round(b * 255);
      data[o + 3] = Math.round(a * 255);
      if (a > 0.5 || !isCutoutTile(name)) {
        ar += r; ag += g; ab += b; n++;
      }
    }
    averages.push(n ? [ar / n, ag / n, ab / n] : [0.5, 0.5, 0.5]);
  });
  // Cutout tiles: bleed colour into transparent texels so mipmaps don't get dark fringes.
  TILE_NAMES.forEach((name, layer) => {
    if (!isCutoutTile(name)) return;
    const off = layer * N * N * 4;
    const avg = averages[layer];
    for (let i = 0; i < N * N; i++) {
      if (data[off + i * 4 + 3] < 128) {
        data[off + i * 4] = Math.round(avg[0] * 255);
        data[off + i * 4 + 1] = Math.round(avg[1] * 255);
        data[off + i * 4 + 2] = Math.round(avg[2] * 255);
      }
    }
  });
  return { data, size: N, layers, averages };
}

const CUTOUT_TILES = new Set<string>([
  'glass', 'tall_grass', 'flower_sun', 'flower_sky', 'flower_ember', 'mushroom', 'berry_bush', 'berry_bush_ripe', 'sapling', 'fire',
  'crystal', 'dry_shrub', 'window', 'gate', 'glass_pane',
  'crop_wheat_0', 'crop_wheat_1', 'crop_wheat_2', 'crop_wheat_3', 'crop_root_0', 'crop_root_1', 'crop_root_2', 'crop_root_3',
  'crop_gourd_0', 'crop_gourd_1', 'crop_gourd_2', 'crop_gourd_3', 'crop_mint_0', 'crop_mint_1', 'crop_mint_2', 'crop_mint_3',
  'crop_corn_0', 'crop_corn_1', 'crop_corn_2', 'crop_corn_3', 'crop_tomato_0', 'crop_tomato_1', 'crop_tomato_2', 'crop_tomato_3',
]);

export function isCutoutTile(name: string): boolean {
  return CUTOUT_TILES.has(name);
}
