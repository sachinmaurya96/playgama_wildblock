import * as THREE from 'three';
import type { PlotType } from '../../persistence/types';
import type { WorldUniforms } from './TerrainMaterials';

/**
 * Distant scenery for Build Home plots: a low-poly silhouette ring (mountain
 * ridges, forest tree-lines, mesas, a sea or lake horizon) far beyond the
 * loaded terrain, so every plot type reads at a glance even from the middle of
 * a 256 × 256 lot. It follows the camera horizontally like the sky and fades
 * into the horizon colour; no textures, a few thousand triangles.
 */
const SEGMENTS = 360;

interface Layer {
  radius: number;
  height: (a: number) => number;
  color: (a: number, h: number) => [number, number, number];
  snow?: number;
  snowColor?: [number, number, number];
  haze: number;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 1D value noise over the angle (periodic). */
function noise(a: number, freq: number, seed: number): number {
  const t = ((a / (Math.PI * 2)) % 1 + 1) % 1 * freq;
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  const h0 = hash(((i % freq) + freq) % freq + seed * 17.3), h1 = hash((((i + 1) % freq) + freq) % freq + seed * 17.3);
  return h0 + (h1 - h0) * u;
}

function fbm(a: number, seed: number, base = 6): number {
  return noise(a, base, seed) * 0.55 + noise(a, base * 3, seed + 1) * 0.3 + noise(a, base * 9, seed + 2) * 0.15;
}

/** Weight 1 in the given compass direction (radians, 0 = +X east, -PI/2 = north), falling to 0 at ±spread. */
function dirWeight(a: number, dir: number, spread: number): number {
  let d = Math.abs(a - dir) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  const t = Math.max(0, 1 - d / spread);
  return t * t * (3 - 2 * t);
}

const NORTH = -Math.PI / 2, SOUTH = Math.PI / 2, EAST = 0;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function layersFor(plot: PlotType, seed: number): Layer[] {
  const s = (seed % 997) / 997;
  const hills = hex('#5f8a4a'), hillsFar = hex('#667f86'), treeDark = hex('#2f5230'), rock = hex('#666f7e'), sand = hex('#d9bf8a');
  const mesaCol = hex('#c0764a'), sea = hex('#3f86b8'), lake = hex('#4f98c8');
  switch (plot) {
    case 'mountain':
      return [
        { radius: 390, haze: 0.3, height: (a) => 14 + fbm(a, s + 1) * 18 + dirWeight(a, NORTH, 1.9) * (45 + fbm(a, s + 3, 7) * 60 + noise(a, 90, s + 6) * 12), color: () => rock, snow: 72, snowColor: hex('#f2f5f8') },
        { radius: 330, haze: 0.16, height: (a) => 10 + fbm(a, s + 5, 14) * 12, color: () => hex('#3d5f45') },
      ];
    case 'forest':
      return [
        { radius: 390, haze: 0.33, height: (a) => 16 + fbm(a, s + 1) * 16, color: () => hillsFar },
        { radius: 320, haze: 0.15, height: (a) => 18 + fbm(a, s + 2, 40) * 12 + noise(a, 160, s + 4) * 5, color: () => treeDark },
      ];
    case 'desert':
      return [
        { radius: 390, haze: 0.28, height: (a) => { const m = fbm(a, s + 1, 5); return m > 0.5 ? 18 + Math.round((m - 0.5) * 70 / 4) * 4 : 4 + m * 6; }, color: (_a, h) => (h > 16 ? mesaCol : sand) },
        { radius: 320, haze: 0.15, height: (a) => 3 + fbm(a, s + 3, 10) * 5, color: () => hex('#e3c996') },
      ];
    case 'coastal':
      return [
        { radius: 390, haze: 0.3, height: (a) => (1 - dirWeight(a, SOUTH, 1.7)) * (10 + fbm(a, s + 1) * 16) + 0.6, color: (_a, h) => (h < 2 ? sea : hills) },
        { radius: 320, haze: 0.15, height: (a) => (1 - dirWeight(a, SOUTH, 1.5)) * (8 + fbm(a, s + 2, 40) * 10) + noise(a, 120, s) * 3 * (1 - dirWeight(a, SOUTH, 1.5)), color: () => hex('#4f7f45') },
      ];
    case 'lakeside':
      return [
        { radius: 390, haze: 0.3, height: (a) => 12 + fbm(a, s + 1) * 22 + dirWeight(a, NORTH, 1.2) * 18, color: () => hillsFar },
        { radius: 320, haze: 0.15, height: (a) => (1 - dirWeight(a, EAST, 0.9)) * (7 + fbm(a, s + 2, 36) * 10) + 0.5, color: (_a, h) => (h < 1.5 ? lake : treeDark) },
      ];
    case 'meadow':
      return [
        { radius: 390, haze: 0.32, height: (a) => 10 + fbm(a, s + 1) * 18, color: () => hillsFar },
        { radius: 320, haze: 0.15, height: (a) => 4 + fbm(a, s + 2, 8) * 8 + Math.max(0, noise(a, 60, s + 3) - 0.55) * 26, color: () => hills },
      ];
    default:
      return [];
  }
}

export class PlotBackdrop {
  readonly mesh: THREE.Mesh | null = null;
  private baseY: number;

  constructor(plot: PlotType, seed: number, baseY: number, uniforms: WorldUniforms) {
    this.baseY = baseY;
    const layers = layersFor(plot, seed);
    if (!layers.length) return;
    const pos: number[] = [];
    const col: number[] = [];
    const haze: number[] = [];
    const idx: number[] = [];
    for (const L of layers) {
      const start = pos.length / 3;
      for (let i = 0; i <= SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2;
        const h = L.height(a);
        const c = L.color(a, h);
        const x = Math.cos(a) * L.radius, z = Math.sin(a) * L.radius;
        const snowAt = L.snow !== undefined && h > L.snow ? L.snow + (hash(i + seed) - 0.5) * 6 : h;
        // bottom, ground level, snow line, top: the foot melts into the horizon fog, the silhouette stays crisp
        pos.push(x, -40, z, x, 0, z, x, snowAt, z, x, h, z);
        const top = L.snow !== undefined && h > L.snow ? L.snowColor! : c;
        col.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2], top[0], top[1], top[2]);
        const midHaze = L.haze + (1 - L.haze) * 0.35 * Math.max(0, 1 - snowAt / Math.max(1, h));
        haze.push(1, 0.9, midHaze, L.haze * 0.55);
      }
      for (let i = 0; i < SEGMENTS; i++) {
        const a = start + i * 4, b = start + (i + 1) * 4;
        for (let k = 0; k < 3; k++) idx.push(a + k, b + k, a + k + 1, b + k, b + k + 1, a + k + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aHaze', new THREE.Float32BufferAttribute(haze, 1));
    geo.setIndex(idx);
    const u = uniforms as unknown as Record<string, THREE.IUniform>;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uFogColor: u.uFogColor, uDaylight: u.uDaylight, uSunColor: u.uSunColor, uSkyAmbient: u.uSkyAmbient },
      vertexShader: /* glsl */ `
        attribute vec3 aCol;
        attribute float aHaze;
        varying vec3 vCol;
        varying float vHaze;
        void main() {
          vCol = aCol;
          vHaze = aHaze;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor;
        uniform float uDaylight;
        uniform vec3 uSunColor;
        uniform vec3 uSkyAmbient;
        varying vec3 vCol;
        varying float vHaze;
        void main() {
          float m = max(0.001, max(uSunColor.r, max(uSunColor.g, uSunColor.b)));
          vec3 tint = mix(vec3(1.0), uSunColor / m, 0.35);
          vec3 lit = vCol * tint * (0.22 + 0.78 * uDaylight);
          vec3 col = mix(lit, uFogColor, clamp(vHaze, 0.0, 0.92));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    mesh.name = 'plot-backdrop';
    (this as { mesh: THREE.Mesh | null }).mesh = mesh;
  }

  follow(camera: THREE.Camera): void {
    if (!this.mesh) return;
    this.mesh.position.set(camera.position.x, this.baseY, camera.position.z);
    this.mesh.updateMatrixWorld();
  }

  dispose(): void {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
