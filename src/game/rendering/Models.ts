import * as THREE from 'three';
import type { CreatureKind } from '../../data/creatures';

/**
 * Procedural low-poly models built from boxes (placeholder-quality but with a
 * cohesive, charming style). Each builder returns a rig with named pivots that
 * the animators below move. To swap in GLB art later, return a GLTF scene with
 * the same pivot names from these builders.
 */

const BOX = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map<string, THREE.MeshLambertMaterial>();

export function mat(color: string, emissive?: string): THREE.MeshLambertMaterial {
  const key = color + (emissive ?? '');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: emissive ?? '#000000', emissiveIntensity: emissive ? 1 : 0 });
    matCache.set(key, m);
  }
  return m;
}

export function part(
  parent: THREE.Object3D, w: number, h: number, d: number, color: string | THREE.Material, x = 0, y = 0, z = 0, emissive?: string,
): THREE.Mesh {
  const m = new THREE.Mesh(BOX, typeof color === 'string' ? mat(color, emissive) : color);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function pivot(parent: THREE.Object3D, x = 0, y = 0, z = 0, name = ''): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.name = name;
  parent.add(g);
  return g;
}

/** Big friendly eyes: white + pupil + sparkle. */
function eyes(head: THREE.Object3D, x: number, y: number, z: number, spacing: number, size: number, pupil = '#2a1e18', glow?: string) {
  for (const s of [-1, 1]) {
    if (glow) {
      part(head, size, size * 1.1, 0.02, glow, x + s * spacing, y, z, glow);
    } else {
      part(head, size, size * 1.15, 0.02, '#fbf7ee', x + s * spacing, y, z);
      part(head, size * 0.6, size * 0.75, 0.03, pupil, x + s * spacing + s * size * 0.08, y - size * 0.08, z + 0.005);
      part(head, size * 0.22, size * 0.22, 0.04, '#ffffff', x + s * spacing - size * 0.12, y + size * 0.18, z + 0.01);
    }
  }
}

export interface Rig {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  tail?: THREE.Object3D;
  wings?: THREE.Object3D[];
  extra: Record<string, THREE.Object3D>;
  height: number;
}

// ---------------------------------------------------------------- player explorer

export function buildExplorer(scarfColor = '#d9573f'): Rig {
  const root = new THREE.Group();
  root.name = 'explorer';
  const skin = '#e8b88f', tunic = '#4f7a4a', trousers = '#6b5a44', boot = '#5a3a24', glove = '#8a5a32';
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const hip = pivot(root, s * 0.11, 0.62, 0, s < 0 ? 'legL' : 'legR');
    part(hip, 0.17, 0.42, 0.19, trousers, 0, -0.2, 0);
    part(hip, 0.2, 0.2, 0.27, boot, 0, -0.52, 0.03);
    part(hip, 0.21, 0.05, 0.28, '#3f2718', 0, -0.62, 0.03);
    legs.push(hip);
  }
  const body = pivot(root, 0, 0.62, 0, 'body');
  part(body, 0.42, 0.44, 0.26, tunic, 0, 0.22, 0);
  part(body, 0.44, 0.06, 0.28, '#6b4424', 0, 0.02, 0); // belt
  part(body, 0.08, 0.07, 0.05, '#d8b04a', 0.08, 0.02, 0.15); // buckle
  // big backpack with bedroll
  const pack = pivot(body, 0, 0.22, -0.2, 'pack');
  part(pack, 0.4, 0.46, 0.2, '#b0703c', 0, 0, 0);
  part(pack, 0.3, 0.18, 0.05, '#8f5a2e', 0, -0.08, -0.12);
  part(pack, 0.46, 0.13, 0.13, '#6f8a3a', 0, 0.28, 0.0);
  part(pack, 0.05, 0.5, 0.05, '#6b4424', -0.14, 0, 0.1);
  part(pack, 0.05, 0.5, 0.05, '#6b4424', 0.14, 0, 0.1);
  const arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const sh = pivot(body, s * 0.28, 0.4, 0, s < 0 ? 'armL' : 'armR');
    part(sh, 0.14, 0.36, 0.15, tunic, 0, -0.16, 0);
    part(sh, 0.15, 0.13, 0.16, glove, 0, -0.38, 0);
    arms.push(sh);
  }
  const hand = pivot(arms[1], 0, -0.42, 0.04, 'hand');
  const head = pivot(body, 0, 0.46, 0, 'head');
  part(head, 0.44, 0.4, 0.4, skin, 0, 0.2, 0);
  part(head, 0.47, 0.14, 0.44, '#7a4a2a', 0, 0.38, -0.01); // hair
  part(head, 0.12, 0.1, 0.44, '#7a4a2a', 0.17, 0.3, -0.01);
  part(head, 0.49, 0.06, 0.5, '#8a6a3a', 0, 0.46, 0); // hat brim
  part(head, 0.34, 0.14, 0.34, '#a8844a', 0, 0.54, -0.01); // hat crown
  part(head, 0.35, 0.04, 0.35, '#c0563f', 0, 0.49, -0.01); // hat band
  eyes(head, 0, 0.22, 0.205, 0.1, 0.09);
  part(head, 0.07, 0.03, 0.02, '#c0765a', -0.14, 0.13, 0.205); // cheeks
  part(head, 0.07, 0.03, 0.02, '#c0765a', 0.14, 0.13, 0.205);
  part(head, 0.08, 0.025, 0.02, '#8a4a3a', 0, 0.1, 0.205); // smile
  const scarf = pivot(body, 0, 0.44, 0, 'scarf');
  const scarfMat = new THREE.MeshLambertMaterial({ color: scarfColor });
  part(scarf, 0.46, 0.1, 0.3, scarfMat, 0, 0, 0);
  const tail = pivot(scarf, 0.12, 0, -0.14, 'scarfTail');
  part(tail, 0.1, 0.05, 0.3, scarfMat, 0, 0, -0.15);
  return { root, body, head, legs, arms, tail, extra: { hand, scarf, pack }, height: 1.62 };
}

export function setScarfColor(rig: Rig, color: string): void {
  rig.extra.scarf.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (m && 'color' in m) m.color.set(color);
  });
}

// ---------------------------------------------------------------- creatures

function quad(root: THREE.Object3D, bodyY: number, spanX: number, spanZ: number, legH: number, legW: number, color: string, hoof?: string): THREE.Object3D[] {
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const p = pivot(root, sx * spanX, bodyY, sz * spanZ);
    part(p, legW, legH, legW, color, 0, -legH / 2, 0);
    if (hoof) part(p, legW * 1.05, legH * 0.18, legW * 1.05, hoof, 0, -legH + legH * 0.09, 0);
    legs.push(p);
  }
  return legs;
}

export function buildCreature(kind: CreatureKind): Rig {
  const root = new THREE.Group();
  root.name = kind;
  const extra: Record<string, THREE.Object3D> = {};
  switch (kind) {
    case 'mossback': {
      const legs = quad(root, 0.62, 0.3, 0.38, 0.6, 0.16, '#8a6a4a', '#4a3a2a');
      const body = pivot(root, 0, 0.62, 0);
      part(body, 0.72, 0.52, 1.12, '#9a7a56', 0, 0.22, 0);
      part(body, 0.76, 0.16, 1.02, '#6f9a45', 0, 0.52, -0.02); // moss blanket
      for (let i = 0; i < 6; i++) part(body, 0.14 + (i % 3) * 0.04, 0.1, 0.14, i % 2 ? '#8fbf5a' : '#5f8a3a', ((i % 3) - 1) * 0.22, 0.63, -0.35 + Math.floor(i / 3) * 0.5);
      part(body, 0.08, 0.08, 0.08, '#f0d27a', 0.18, 0.64, 0.15); // tiny flower
      const head = pivot(body, 0, 0.42, 0.6);
      part(head, 0.42, 0.4, 0.42, '#a8845e', 0, 0.06, 0.08);
      part(head, 0.3, 0.2, 0.2, '#d8bf9a', 0, -0.06, 0.34); // snout
      part(head, 0.06, 0.05, 0.02, '#3a2a20', -0.07, -0.02, 0.445);
      part(head, 0.06, 0.05, 0.02, '#3a2a20', 0.07, -0.02, 0.445);
      eyes(head, 0, 0.14, 0.295, 0.13, 0.09);
      for (const s of [-1, 1]) {
        part(head, 0.18, 0.08, 0.06, '#8a6a4a', s * 0.28, 0.2, 0.02).rotation.z = s * 0.4;
        const tw = pivot(head, s * 0.12, 0.28, 0);
        part(tw, 0.05, 0.28, 0.05, '#6b4424', 0, 0.14, 0).rotation.z = -s * 0.3;
        part(tw, 0.12, 0.05, 0.05, '#6b4424', s * 0.08, 0.22, 0);
        part(tw, 0.08, 0.06, 0.06, '#8fbf5a', s * 0.12, 0.26, 0);
      }
      const tail = pivot(body, 0, 0.36, -0.56);
      part(tail, 0.1, 0.3, 0.08, '#6f9a45', 0, -0.12, -0.02);
      return { root, body, head, legs, arms: [], tail, extra, height: 1.3 };
    }
    case 'pufftail': {
      const body = pivot(root, 0, 0.26, 0);
      part(body, 0.46, 0.42, 0.5, '#efe3cf', 0, 0, 0);
      part(body, 0.3, 0.2, 0.06, '#fff8ee', 0, -0.06, 0.25); // belly
      const head = pivot(body, 0, 0.14, 0.2);
      eyes(head, 0, 0.05, 0.06, 0.11, 0.1);
      part(head, 0.07, 0.05, 0.03, '#e58aa0', 0, -0.04, 0.07);
      for (const s of [-1, 1]) {
        const ear = pivot(head, s * 0.12, 0.16, -0.05);
        part(ear, 0.09, 0.34, 0.06, '#efe3cf', 0, 0.16, 0);
        part(ear, 0.05, 0.24, 0.02, '#f5b3c3', 0, 0.16, 0.03);
        extra[s < 0 ? 'earL' : 'earR'] = ear;
      }
      const tail = pivot(body, 0, 0.12, -0.25);
      part(tail, 0.38, 0.38, 0.38, '#ffffff', 0, 0.08, -0.12);
      part(tail, 0.28, 0.28, 0.28, '#f6f0e6', 0, 0.2, -0.22);
      const legs: THREE.Object3D[] = [];
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const p = pivot(root, sx * 0.14, 0.08, sz * 0.14);
        part(p, 0.1, 0.1, 0.16, '#e0d0b8', 0, -0.04, 0.02);
        legs.push(p);
      }
      return { root, body, head, legs, arms: [], tail, extra, height: 0.55 };
    }
    case 'twiglet': {
      const body = pivot(root, 0, 0.18, 0);
      part(body, 0.2, 0.2, 0.26, '#e0a94f', 0, 0, 0);
      part(body, 0.21, 0.05, 0.2, '#7b5a36', 0, 0.05, -0.02);
      part(body, 0.21, 0.05, 0.2, '#7b5a36', 0, -0.03, -0.02);
      part(body, 0.14, 0.12, 0.06, '#f6e8c8', 0, -0.03, 0.12);
      const head = pivot(body, 0, 0.14, 0.1);
      part(head, 0.18, 0.16, 0.16, '#e0a94f', 0, 0, 0);
      part(head, 0.06, 0.05, 0.1, '#d8702b', 0, -0.02, 0.12);
      eyes(head, 0, 0.03, 0.081, 0.055, 0.05);
      part(head, 0.03, 0.1, 0.03, '#7b5a36', 0, 0.12, -0.02);
      const wings = [-1, 1].map((s) => {
        const w = pivot(body, s * 0.11, 0.04, 0);
        part(w, 0.03, 0.14, 0.2, '#7b5a36', s * 0.01, -0.04, -0.02);
        return w;
      });
      const tail = pivot(body, 0, 0.02, -0.13);
      part(tail, 0.08, 0.03, 0.2, '#7b5a36', 0, 0, -0.08);
      const legs = [-1, 1].map((s) => {
        const p = pivot(root, s * 0.05, 0.08, 0);
        part(p, 0.025, 0.1, 0.025, '#d8702b', 0, -0.04, 0);
        return p;
      });
      return { root, body, head, legs, arms: [], tail, wings, extra, height: 0.4 };
    }
    case 'mudsnout': {
      const legs = quad(root, 0.3, 0.2, 0.26, 0.3, 0.14, '#9a6a5a', '#4a3028');
      const body = pivot(root, 0, 0.3, 0);
      part(body, 0.6, 0.48, 0.8, '#c48a78', 0, 0.2, 0);
      part(body, 0.3, 0.2, 0.3, '#7a5236', 0.16, 0.34, -0.1); // mud patches
      part(body, 0.2, 0.14, 0.26, '#7a5236', -0.2, 0.12, 0.2);
      part(body, 0.62, 0.08, 0.5, '#8a5a44', 0, 0.46, -0.1); // bristles
      const head = pivot(body, 0, 0.26, 0.42);
      part(head, 0.44, 0.38, 0.3, '#c48a78', 0, 0, 0.06);
      part(head, 0.26, 0.18, 0.12, '#e8a898', 0, -0.06, 0.26);
      part(head, 0.05, 0.06, 0.02, '#6a3a30', -0.06, -0.06, 0.325);
      part(head, 0.05, 0.06, 0.02, '#6a3a30', 0.06, -0.06, 0.325);
      part(head, 0.04, 0.1, 0.04, '#f6ecd8', -0.16, -0.08, 0.26);
      part(head, 0.04, 0.1, 0.04, '#f6ecd8', 0.16, -0.08, 0.26);
      eyes(head, 0, 0.08, 0.215, 0.11, 0.08);
      for (const s of [-1, 1]) {
        const ear = pivot(head, s * 0.2, 0.16, 0.04);
        part(ear, 0.14, 0.06, 0.16, '#a8705e', s * 0.04, 0, 0).rotation.z = s * -0.5;
        extra[s < 0 ? 'earL' : 'earR'] = ear;
      }
      const tail = pivot(body, 0, 0.32, -0.4);
      part(tail, 0.06, 0.06, 0.14, '#c48a78', 0, 0.02, -0.06);
      return { root, body, head, legs, arms: [], tail, extra, height: 0.9 };
    }
    case 'glowbug': {
      const body = pivot(root, 0, 0.3, 0);
      part(body, 0.22, 0.2, 0.3, '#3a3050', 0, 0, 0.08);
      part(body, 0.28, 0.26, 0.34, '#f8f07a', 0, -0.02, -0.2, '#e0d040'); // lantern abdomen
      const head = pivot(body, 0, 0.04, 0.26);
      part(head, 0.18, 0.16, 0.14, '#3a3050', 0, 0, 0);
      eyes(head, 0, 0.03, 0.071, 0.05, 0.05, '#2a1e18');
      for (const s of [-1, 1]) {
        const ant = pivot(head, s * 0.05, 0.08, 0.02);
        part(ant, 0.02, 0.16, 0.02, '#3a3050', 0, 0.08, 0.02).rotation.x = 0.4;
        part(ant, 0.05, 0.05, 0.05, '#f8f07a', 0, 0.16, 0.06, '#e0d040');
      }
      const wings = [-1, 1].map((s) => {
        const w = pivot(body, s * 0.1, 0.12, 0);
        const wing = part(w, 0.3, 0.02, 0.22, new THREE.MeshLambertMaterial({ color: '#dfefff', transparent: true, opacity: 0.55 }), s * 0.15, 0, 0);
        wing.castShadow = false;
        return w;
      });
      return { root, body, head, legs: [], arms: [], wings, extra, height: 0.4 };
    }
    case 'fenn': {
      const legs = quad(root, 0.34, 0.12, 0.2, 0.34, 0.09, '#c85a2a', '#3a2a22');
      const body = pivot(root, 0, 0.34, 0);
      part(body, 0.3, 0.28, 0.6, '#e0703a', 0, 0.12, 0);
      part(body, 0.22, 0.14, 0.4, '#f6e8d0', 0, 0.02, 0.06);
      const head = pivot(body, 0, 0.26, 0.32);
      part(head, 0.3, 0.26, 0.26, '#e0703a', 0, 0.02, 0.04);
      part(head, 0.14, 0.12, 0.16, '#f6e8d0', 0, -0.04, 0.22);
      part(head, 0.05, 0.04, 0.03, '#2a1e18', 0, 0.0, 0.3);
      eyes(head, 0, 0.06, 0.171, 0.08, 0.07);
      for (const s of [-1, 1]) {
        const ear = pivot(head, s * 0.1, 0.15, 0.02);
        part(ear, 0.09, 0.16, 0.05, '#e0703a', 0, 0.06, 0);
        part(ear, 0.06, 0.06, 0.06, '#ffb04a', 0, 0.15, 0, '#ff8a2a');
        extra[s < 0 ? 'earL' : 'earR'] = ear;
      }
      const tail = pivot(body, 0, 0.18, -0.3);
      part(tail, 0.16, 0.16, 0.36, '#e0703a', 0, 0.04, -0.16).rotation.x = -0.4;
      part(tail, 0.14, 0.14, 0.14, '#ffc46a', 0, 0.12, -0.34, '#ff8a2a');
      return { root, body, head, legs, arms: [], tail, extra, height: 0.75 };
    }
    case 'thorncrawler': {
      const body = pivot(root, 0, 0.36, 0);
      part(body, 0.7, 0.34, 0.8, '#3f5a2a', 0, 0.06, 0);
      for (let i = 0; i < 9; i++) {
        const t = part(body, 0.07, 0.26, 0.07, i % 2 ? '#8a7a3a' : '#6f8a3a', ((i % 3) - 1) * 0.22, 0.3, (Math.floor(i / 3) - 1) * 0.24);
        t.rotation.set(((i % 3) - 1) * 0.35, 0, (Math.floor(i / 3) - 1) * 0.35);
      }
      const head = pivot(body, 0, 0.02, 0.44);
      part(head, 0.42, 0.24, 0.2, '#2f4a1f', 0, 0, 0);
      eyes(head, 0, 0.04, 0.105, 0.1, 0.07, '#000', '#ff5a3a');
      part(head, 0.06, 0.12, 0.12, '#c8b87a', -0.14, -0.08, 0.12).rotation.x = 0.5;
      part(head, 0.06, 0.12, 0.12, '#c8b87a', 0.14, -0.08, 0.12).rotation.x = 0.5;
      const legs: THREE.Object3D[] = [];
      for (let i = 0; i < 6; i++) {
        const s = i % 2 ? 1 : -1;
        const p = pivot(root, s * 0.36, 0.34, (Math.floor(i / 2) - 1) * 0.28);
        part(p, 0.32, 0.06, 0.06, '#2f4a1f', s * 0.14, 0, 0).rotation.z = s * -0.4;
        part(p, 0.06, 0.3, 0.06, '#2f4a1f', s * 0.3, -0.18, 0);
        legs.push(p);
      }
      return { root, body, head, legs, arms: [], extra, height: 0.7 };
    }
    case 'gloomstalker':
    case 'zombie': {
      // tall shambling husk: dark mossy body, long arms, glowing eyes
      const dark = kind === 'zombie' ? '#66844a' : '#2f3a2c', moss = kind === 'zombie' ? '#8da764' : '#4f6a3a', rag = kind === 'zombie' ? '#426b83' : '#3a2f44';
      const legs: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) {
        const hip = pivot(root, sx * 0.12, 0.8, 0);
        part(hip, 0.16, 0.8, 0.18, dark, 0, -0.4, 0);
        part(hip, 0.18, 0.08, 0.24, '#1f2a1c', 0, -0.78, 0.03);
        legs.push(hip);
      }
      const body = pivot(root, 0, 0.8, 0);
      part(body, 0.46, 0.62, 0.28, dark, 0, 0.3, 0);
      part(body, 0.5, 0.2, 0.32, rag, 0, 0.12, 0);
      part(body, 0.2, 0.16, 0.06, moss, -0.1, 0.48, 0.14);
      part(body, 0.14, 0.1, 0.06, moss, 0.12, 0.3, 0.14);
      const arms: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) {
        const sh = pivot(body, sx * 0.3, 0.56, 0);
        part(sh, 0.12, 0.72, 0.13, dark, 0, -0.34, 0);
        part(sh, 0.14, 0.12, 0.15, moss, 0, -0.72, 0);
        sh.rotation.x = -1.2; // reaching forward
        arms.push(sh);
      }
      const head = pivot(body, 0, 0.62, 0);
      part(head, 0.38, 0.38, 0.36, kind === 'zombie' ? dark : '#3a4a33', 0, 0.18, 0);
      part(head, 0.42, 0.1, 0.4, moss, 0, 0.36, 0);
      eyes(head, 0, 0.2, 0.185, 0.1, 0.08, '#000', '#9cff7a');
      part(head, 0.14, 0.03, 0.02, '#111', 0, 0.06, 0.185);
      return { root, body, head, legs, arms, extra, height: 1.75 };
    }
    case 'skeleton': {
      const bone = '#e3dbc8', joint = '#b3a995';
      const body = pivot(root, 0, 0.76, 0);
      part(body, 0.09, 0.6, 0.1, joint, 0, 0.29, 0);
      part(body, 0.32, 0.13, 0.17, bone, 0, 0.04, 0);
      for (let i = 0; i < 4; i++) part(body, 0.38 - i * 0.025, 0.055, 0.19, bone, 0, 0.51 - i * 0.1, 0);
      const legs: THREE.Object3D[] = [], arms: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) {
        const leg = pivot(root, sx * 0.11, 0.76, 0);
        part(leg, 0.085, 0.7, 0.09, bone, 0, -0.35, 0);
        part(leg, 0.11, 0.1, 0.2, bone, 0, -0.7, 0.04);
        legs.push(leg);
        const arm = pivot(body, sx * 0.25, 0.57, 0);
        part(arm, 0.075, 0.64, 0.085, bone, 0, -0.32, 0);
        part(arm, 0.1, 0.12, 0.1, bone, 0, -0.64, 0);
        arms.push(arm);
      }
      const head = pivot(body, 0, 0.62, 0);
      part(head, 0.34, 0.3, 0.3, bone, 0, 0.15, 0);
      eyes(head, 0, 0.19, 0.155, 0.085, 0.095, '#272333', '#d76b58');
      part(head, 0.2, 0.07, 0.02, '#665e54', 0, 0.055, 0.16);
      return { root, body, head, legs, arms, extra, height: 1.7 };
    }
    case 'duskfang': {
      // lean wolf-like pack hunter
      const fur = '#3b3550', light = '#5a5272';
      const legs = quad(root, 0.48, 0.17, 0.3, 0.48, 0.11, fur, '#221e30');
      const body = pivot(root, 0, 0.5, 0);
      part(body, 0.38, 0.32, 0.86, fur, 0, 0.12, 0);
      part(body, 0.3, 0.12, 0.6, light, 0, 0.3, -0.05);
      const head = pivot(body, 0, 0.24, 0.46);
      part(head, 0.3, 0.28, 0.3, fur, 0, 0.04, 0.06);
      part(head, 0.18, 0.14, 0.22, light, 0, -0.04, 0.28);
      part(head, 0.06, 0.05, 0.03, '#111', 0, 0, 0.4);
      for (const sx of [-1, 1]) part(head, 0.08, 0.14, 0.05, fur, sx * 0.1, 0.24, 0.02).rotation.z = sx * 0.2;
      eyes(head, 0, 0.08, 0.215, 0.1, 0.06, '#000', '#ffd24a');
      part(head, 0.04, 0.06, 0.03, '#f4f1ea', -0.05, -0.11, 0.36);
      part(head, 0.04, 0.06, 0.03, '#f4f1ea', 0.05, -0.11, 0.36);
      const tail = pivot(body, 0, 0.24, -0.44);
      part(tail, 0.1, 0.1, 0.4, fur, 0, 0, -0.18).rotation.x = 0.5;
      return { root, body, head, legs, arms: [], tail, extra, height: 0.85 };
    }
    case 'nightling': {
      const body = pivot(root, 0, 0.42, 0);
      const dark = new THREE.MeshLambertMaterial({ color: '#2a2240', emissive: '#150f28', transparent: true, opacity: 0.92 });
      part(body, 0.46, 0.5, 0.42, dark, 0, 0, 0);
      part(body, 0.34, 0.2, 0.3, dark, 0.05, 0.32, -0.04).rotation.z = 0.3;
      part(body, 0.2, 0.18, 0.2, dark, -0.1, 0.46, -0.06).rotation.z = -0.4;
      const head = pivot(body, 0, 0.06, 0.21);
      eyes(head, 0, 0.02, 0.005, 0.1, 0.1, '#000', '#b8a8ff');
      const wisps: THREE.Object3D[] = [];
      for (let i = 0; i < 4; i++) {
        const w = pivot(body, ((i % 2) - 0.5) * 0.3, -0.28, (Math.floor(i / 2) - 0.5) * 0.24);
        part(w, 0.12, 0.2, 0.12, dark, 0, -0.08, 0);
        wisps.push(w);
      }
      return { root, body, head, legs: wisps, arms: [], extra, height: 0.8 };
    }
    case 'stoneback': {
      const legs = quad(root, 0.34, 0.36, 0.36, 0.34, 0.2, '#6a6458', '#3a3630');
      const body = pivot(root, 0, 0.34, 0);
      part(body, 0.9, 0.3, 1.0, '#5a5448', 0, 0.12, 0);
      const shell = [
        [0, 0.42, 0, 0.84, 0.3, 0.9, '#8d8a82'], [0.24, 0.62, 0.12, 0.34, 0.2, 0.36, '#a6a39b'], [-0.2, 0.6, -0.16, 0.36, 0.2, 0.34, '#77746c'],
        [0.02, 0.66, -0.2, 0.3, 0.16, 0.3, '#9a978f'], [-0.18, 0.62, 0.22, 0.26, 0.14, 0.24, '#8a877f'],
      ] as const;
      for (const [x, y, z, w, h, d, c] of shell) part(body, w, h, d, c, x, y, z);
      part(body, 0.14, 0.08, 0.14, '#5f8a3a', 0.1, 0.78, 0.0); // a little moss
      const head = pivot(body, 0, 0.2, 0.55);
      part(head, 0.38, 0.3, 0.32, '#6a6458', 0, 0, 0.1);
      part(head, 0.3, 0.1, 0.12, '#4a463e', 0, 0.16, 0.14);
      eyes(head, 0, 0.02, 0.265, 0.1, 0.07, '#1a1410');
      return { root, body, head, legs, arms: [], extra, height: 1.1 };
    }
    case 'cave_mite': {
      const body = pivot(root, 0, 0.2, 0);
      part(body, 0.36, 0.2, 0.44, '#4f6380', 0, 0.02, 0);
      part(body, 0.3, 0.1, 0.36, '#6f86a8', 0, 0.14, -0.02);
      const head = pivot(body, 0, 0.0, 0.26);
      part(head, 0.24, 0.16, 0.14, '#3f506a', 0, 0, 0);
      eyes(head, 0, 0.02, 0.071, 0.06, 0.05, '#000', '#9fd0ff');
      for (const s of [-1, 1]) {
        const a = pivot(head, s * 0.06, 0.06, 0.04);
        part(a, 0.02, 0.2, 0.02, '#3f506a', 0, 0.1, 0.02).rotation.x = 0.6;
        part(a, 0.05, 0.05, 0.05, '#9fd0ff', 0, 0.18, 0.1, '#6fb0ff');
      }
      const legs: THREE.Object3D[] = [];
      for (let i = 0; i < 6; i++) {
        const s = i % 2 ? 1 : -1;
        const p = pivot(root, s * 0.18, 0.2, (Math.floor(i / 2) - 1) * 0.14);
        part(p, 0.16, 0.04, 0.04, '#3f506a', s * 0.08, -0.04, 0).rotation.z = s * -0.6;
        legs.push(p);
      }
      return { root, body, head, legs, arms: [], extra, height: 0.4 };
    }
    case 'bog_snapper': {
      const legs = quad(root, 0.16, 0.26, 0.32, 0.16, 0.14, '#3f6a4a');
      const body = pivot(root, 0, 0.2, 0);
      part(body, 0.58, 0.28, 1.0, '#4f8a6a', 0, 0.08, 0);
      for (let i = 0; i < 4; i++) part(body, 0.14, 0.08, 0.14, '#2f5a40', 0, 0.26, -0.3 + i * 0.2);
      const head = pivot(body, 0, 0.1, 0.5);
      part(head, 0.4, 0.14, 0.44, '#4f8a6a', 0, 0.06, 0.2);
      const jaw = pivot(head, 0, -0.02, 0.02);
      part(jaw, 0.36, 0.08, 0.42, '#3f6a4a', 0, -0.04, 0.2);
      for (let i = 0; i < 4; i++) part(jaw, 0.04, 0.05, 0.04, '#f6ecd8', -0.12 + i * 0.08, 0.02, 0.36);
      extra.jaw = jaw;
      eyes(head, 0, 0.16, 0.12, 0.12, 0.08, '#000', '#e8d84a');
      const tail = pivot(body, 0, 0.06, -0.5);
      part(tail, 0.24, 0.14, 0.6, '#4f8a6a', 0, 0, -0.28);
      return { root, body, head, legs, arms: [], tail, extra, height: 0.6 };
    }
  }
}

// ---------------------------------------------------------------- animation

export interface AnimState {
  /** 0..1 how fast it is moving relative to run speed */
  moving: number;
  time: number;
  /** 0..1 attack / action swing progress (0 = idle) */
  action: number;
  grounded: boolean;
  swimming?: boolean;
  sleeping?: boolean;
  eating?: boolean;
  sitting?: boolean;
  hurt?: number;
}

export function animateCreature(kind: CreatureKind, rig: Rig, s: AnimState): void {
  const t = s.time;
  const walk = Math.sin(t * (6 + s.moving * 6)) * s.moving;
  const legs = rig.legs;
  const quadLegs = legs.length === 4;
  if (quadLegs && kind !== 'pufftail') {
    legs[0].rotation.x = walk * 0.7;
    legs[3].rotation.x = walk * 0.7;
    legs[1].rotation.x = -walk * 0.7;
    legs[2].rotation.x = -walk * 0.7;
  }
  rig.head.rotation.x = s.eating ? 0.6 + Math.sin(t * 8) * 0.08 : Math.sin(t * 1.3) * 0.05;
  if (rig.tail) rig.tail.rotation.y = Math.sin(t * (s.moving > 0.1 ? 10 : 3)) * 0.35;
  rig.body.position.y = rig.body.userData.baseY ?? (rig.body.userData.baseY = rig.body.position.y);
  switch (kind) {
    case 'pufftail': {
      const hop = s.moving > 0.05 ? Math.abs(Math.sin(t * 9)) * 0.22 : Math.abs(Math.sin(t * 2)) * 0.015;
      rig.root.children.forEach(() => void 0);
      rig.body.position.y += hop;
      for (const l of legs) l.position.y = 0.08 + hop * 0.6;
      rig.extra.earL.rotation.x = -0.2 + Math.sin(t * 3) * 0.1 - hop;
      rig.extra.earR.rotation.x = -0.2 + Math.sin(t * 3 + 1) * 0.1 - hop;
      break;
    }
    case 'twiglet':
    case 'glowbug': {
      const flap = Math.sin(t * (kind === 'glowbug' ? 30 : 24));
      if (rig.wings) {
        rig.wings[0].rotation.z = 0.3 + flap * 0.7;
        rig.wings[1].rotation.z = -0.3 - flap * 0.7;
      }
      if (kind === 'twiglet' && s.moving > 0.05) rig.body.position.y += Math.abs(Math.sin(t * 12)) * 0.08;
      if (kind === 'glowbug') rig.body.position.y += Math.sin(t * 2) * 0.08;
      break;
    }
    case 'nightling': {
      rig.body.position.y += Math.sin(t * 3) * 0.06;
      legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 5 + i) * 0.4));
      break;
    }
    case 'thorncrawler':
    case 'cave_mite': {
      legs.forEach((l, i) => (l.rotation.y = Math.sin(t * 16 * Math.max(0.3, s.moving) + i * 1.7) * 0.5 * Math.max(0.15, s.moving)));
      break;
    }
    case 'gloomstalker':
    case 'zombie':
    case 'skeleton': {
      const sway = Math.sin(t * (4 + s.moving * 3)) * s.moving;
      legs[0].rotation.x = sway * 0.7;
      legs[1].rotation.x = -sway * 0.7;
      rig.arms[0].rotation.x = -1.2 + Math.sin(t * 2) * 0.1 - (s.action > 0 ? Math.sin(s.action * Math.PI) * 0.6 : 0);
      rig.arms[1].rotation.x = -1.2 + Math.sin(t * 2 + 1) * 0.1 - (s.action > 0 ? Math.sin(s.action * Math.PI) * 0.6 : 0);
      rig.body.rotation.z = Math.sin(t * 1.7) * 0.06;
      break;
    }
    case 'bog_snapper': {
      rig.extra.jaw.rotation.x = s.action > 0 ? Math.sin(s.action * Math.PI) * 0.6 : Math.max(0, Math.sin(t * 0.8)) * 0.1;
      break;
    }
    case 'fenn': {
      if (s.sitting) {
        legs[2].rotation.x = legs[3].rotation.x = -1.2;
        rig.body.rotation.x = -0.35;
      } else rig.body.rotation.x = 0;
      break;
    }
    default:
      break;
  }
  if (s.action > 0 && kind !== 'bog_snapper') {
    rig.body.rotation.x = -Math.sin(s.action * Math.PI) * 0.35;
    rig.head.rotation.x = Math.sin(s.action * Math.PI) * 0.3;
  } else if (kind !== 'fenn') rig.body.rotation.x = 0;
  if (s.sleeping) {
    rig.head.rotation.x = 0.5;
    rig.body.position.y -= 0.1;
  }
}

export function animateExplorer(rig: Rig, s: AnimState & { swing: number; swingKind: 'chop' | 'place' | 'attack' | 'none'; look: number }): void {
  const t = s.time;
  const [legL, legR] = rig.legs;
  const [armL, armR] = rig.arms;
  const stride = Math.sin(t * (7 + s.moving * 5)) * s.moving;
  if (s.sitting) {
    legL.rotation.x = legR.rotation.x = -Math.PI / 2;
    armL.rotation.x = armR.rotation.x = -0.3;
    armL.rotation.z = -0.06;
    armR.rotation.z = 0.06;
    rig.body.rotation.x = 0;
  } else if (s.swimming) {
    legL.rotation.x = Math.sin(t * 6) * 0.5;
    legR.rotation.x = -Math.sin(t * 6) * 0.5;
    armL.rotation.x = -2.6 + Math.sin(t * 3) * 0.6;
    armR.rotation.x = -2.6 - Math.sin(t * 3) * 0.6;
    rig.body.rotation.x = 0.9;
  } else if (!s.grounded) {
    legL.rotation.x = 0.5;
    legR.rotation.x = -0.3;
    armL.rotation.x = -0.6;
    armR.rotation.x = -0.6;
    armL.rotation.z = -0.4;
    armR.rotation.z = 0.4;
    rig.body.rotation.x = 0;
  } else {
    legL.rotation.x = stride * 0.9;
    legR.rotation.x = -stride * 0.9;
    armL.rotation.x = -stride * 0.8;
    armR.rotation.x = stride * 0.8;
    armL.rotation.z = -0.06;
    armR.rotation.z = 0.06;
    rig.body.rotation.x = s.moving * 0.12;
  }
  rig.body.position.y = 0.62 + (s.grounded ? Math.abs(Math.sin(t * (7 + s.moving * 5))) * 0.04 * s.moving + Math.sin(t * 2) * 0.008 : 0);
  if (s.swing > 0) {
    const k = Math.sin(s.swing * Math.PI);
    armR.rotation.x = s.swingKind === 'place' ? -1.2 * k : -2.2 * k + 0.4;
    armR.rotation.z = 0.1 - k * 0.2;
  }
  rig.head.rotation.x = s.look * 0.6;
  if (rig.tail) rig.tail.rotation.x = 0.2 + Math.sin(t * 4) * 0.15 + s.moving * 0.4;
}

// ---------------------------------------------------------------- held tools

export function buildToolMesh(kind: string, colors: string[]): THREE.Group {
  const g = new THREE.Group();
  const [head, handle] = colors;
  const shape = kind;
  if (shape === 'axe') {
    part(g, 0.06, 0.62, 0.06, handle, 0, 0, 0);
    part(g, 0.05, 0.2, 0.2, head, 0, 0.22, 0.1);
    part(g, 0.06, 0.26, 0.05, head, 0, 0.22, 0.21);
  } else if (shape === 'pick') {
    part(g, 0.06, 0.62, 0.06, handle, 0, 0, 0);
    part(g, 0.06, 0.07, 0.5, head, 0, 0.28, 0);
    part(g, 0.05, 0.06, 0.08, head, 0, 0.25, 0.27);
    part(g, 0.05, 0.06, 0.08, head, 0, 0.25, -0.27);
  } else if (shape === 'shovel') {
    part(g, 0.05, 0.6, 0.05, handle, 0, 0, 0);
    part(g, 0.04, 0.22, 0.18, head, 0, 0.36, 0);
  } else if (shape === 'hoe') {
    part(g, 0.05, 0.64, 0.05, handle, 0, 0, 0);
    part(g, 0.05, 0.06, 0.2, head, 0, 0.3, 0.08);
    part(g, 0.05, 0.12, 0.06, head, 0, 0.25, 0.17);
  } else if (shape === 'club') {
    part(g, 0.08, 0.5, 0.08, handle, 0, 0, 0);
    part(g, 0.16, 0.24, 0.16, head, 0, 0.3, 0);
  } else if (shape === 'hammer') {
    part(g, 0.06, 0.56, 0.06, handle, 0, 0, 0);
    part(g, 0.14, 0.14, 0.3, head, 0, 0.28, 0);
  } else if (shape === 'spear') {
    part(g, 0.04, 1.0, 0.04, handle, 0, 0.1, 0);
    part(g, 0.05, 0.2, 0.08, head, 0, 0.68, 0);
  } else if (shape === 'blade') {
    part(g, 0.05, 0.18, 0.05, handle, 0, -0.1, 0);
    part(g, 0.05, 0.05, 0.22, handle, 0, 0.0, 0);
    part(g, 0.04, 0.56, 0.1, head, 0, 0.3, 0);
  } else if (shape === 'sword') {
    part(g, 0.05, 0.16, 0.05, handle, 0, -0.08, 0);
    part(g, 0.06, 0.06, 0.06, handle, 0, -0.18, 0);
    part(g, 0.05, 0.045, 0.26, colors[1] === '#5a3a22' ? '#c9a45c' : '#8a8f96', 0, 0.02, 0);
    part(g, 0.035, 0.62, 0.085, head, 0, 0.36, 0);
    part(g, 0.03, 0.08, 0.05, head, 0, 0.7, 0);
  } else if (shape === 'bow') {
    // curved limbs from three segments + string
    part(g, 0.05, 0.12, 0.05, handle, 0, 0, 0);
    const up = part(g, 0.045, 0.32, 0.045, head, 0, 0.2, 0.05);
    up.rotation.x = -0.35;
    const dn = part(g, 0.045, 0.32, 0.045, head, 0, -0.2, 0.05);
    dn.rotation.x = 0.35;
    part(g, 0.012, 0.7, 0.012, '#efe6cf', 0, 0, 0.12);
  } else if (shape === 'shield') {
    part(g, 0.05, 0.5, 0.4, head, 0, 0.05, 0);
    part(g, 0.06, 0.5, 0.06, handle, 0, 0.05, 0);
    part(g, 0.06, 0.06, 0.4, handle, 0, 0.12, 0);
  } else if (shape === 'arrow') {
    part(g, 0.03, 0.5, 0.03, head, 0, 0.1, 0);
    part(g, 0.05, 0.08, 0.05, handle, 0, 0.38, 0);
  } else if (shape === 'boat') {
    part(g, 0.5, 0.12, 0.26, head, 0, 0, 0);
    part(g, 0.5, 0.1, 0.03, handle, 0, 0.1, 0.12);
    part(g, 0.5, 0.1, 0.03, handle, 0, 0.1, -0.12);
  } else if (shape === 'can') {
    part(g, 0.2, 0.2, 0.2, head, 0, 0, 0);
    part(g, 0.04, 0.04, 0.24, head, 0, 0.06, 0.18);
  } else {
    part(g, 0.2, 0.2, 0.2, head, 0, 0, 0);
  }
  return g;
}

// ---------------------------------------------------------------- armor & held item on the explorer

export interface Dress {
  head?: [string, string] | null;
  body?: [string, string] | null;
  legs?: [string, string] | null;
  feet?: [string, string] | null;
  offhand?: [string, string] | null;
  /** Held item: [shape, colorA, colorB] */
  held?: [string, string, string] | null;
}

function dressGroup(parent: THREE.Object3D, name: string): THREE.Group {
  const old = parent.getObjectByName(name);
  if (old) {
    parent.remove(old);
    old.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      m?.dispose?.();
    });
  }
  const g = new THREE.Group();
  g.name = name;
  parent.add(g);
  return g;
}

/** Puts armor plates, a shield and the held item on an explorer rig (third person + PvP opponents). */
export function dressExplorer(rig: Rig, d: Dress): void {
  const head = rig.head, body = rig.body;
  const [legL, legR] = rig.legs;
  const [armL, armR] = rig.arms;
  // helmet replaces the hat look
  const hg = dressGroup(head, 'armor-head');
  for (const c of head.children) if (c !== hg && (c as THREE.Mesh).isMesh && c.position.y > 0.44) c.visible = !d.head;
  if (d.head) {
    const [a, b] = d.head;
    part(hg, 0.5, 0.22, 0.48, a, 0, 0.42, -0.01);
    part(hg, 0.5, 0.2, 0.08, a, 0, 0.3, -0.21);
    part(hg, 0.08, 0.26, 0.46, a, -0.24, 0.3, -0.01);
    part(hg, 0.08, 0.26, 0.46, a, 0.24, 0.3, -0.01);
    part(hg, 0.07, 0.24, 0.07, b, 0, 0.54, 0.0);
  }
  const bg = dressGroup(body, 'armor-body');
  if (d.body) {
    const [a, b] = d.body;
    part(bg, 0.46, 0.4, 0.3, a, 0, 0.24, 0);
    part(bg, 0.2, 0.16, 0.02, b, 0, 0.28, 0.155);
    for (const arm of [armL, armR]) {
      const s = dressGroup(arm, 'armor-arm');
      part(s, 0.17, 0.14, 0.18, a, 0, -0.05, 0);
    }
  } else for (const arm of [armL, armR]) dressGroup(arm, 'armor-arm');
  for (const leg of [legL, legR]) {
    const lg = dressGroup(leg, 'armor-leg');
    if (d.legs) part(lg, 0.19, 0.3, 0.21, d.legs[0], 0, -0.16, 0);
    if (d.feet) part(lg, 0.22, 0.14, 0.29, d.feet[0], 0, -0.5, 0.03);
  }
  const og = dressGroup(armL, 'armor-shield');
  if (d.offhand) {
    const [a, b] = d.offhand;
    part(og, 0.05, 0.42, 0.34, a, -0.1, -0.3, 0.05);
    part(og, 0.06, 0.08, 0.36, b, -0.11, -0.28, 0.05);
  }
  const hand = rig.extra.hand;
  if (hand) {
    const held = dressGroup(hand, 'held');
    if (d.held) {
      const mesh = buildToolMesh(d.held[0], [d.held[1], d.held[2]]);
      mesh.scale.setScalar(0.8);
      mesh.rotation.x = Math.PI / 2.2;
      held.add(mesh);
    }
  }
}

const HOLDABLE = new Set(['axe', 'pick', 'shovel', 'hoe', 'club', 'hammer', 'spear', 'blade', 'sword', 'bow', 'can', 'arrow']);

/** Compact, network-friendly description of what someone wears: [head, body, legs, feet, offhand, held] item keys. */
export function dressFromItems(itemDefOf: (k: string) => { icon: unknown } | undefined, keys: (string | null | undefined)[]): Dress {
  const col = (k: string | null | undefined): [string, string] | null => {
    if (!k) return null;
    const ic = itemDefOf(k)?.icon as { shape?: string; colors?: string[] } | undefined;
    return ic?.colors ? [ic.colors[0], ic.colors[1] ?? ic.colors[0]] : null;
  };
  const heldKey = keys[5];
  let held: Dress['held'] = null;
  if (heldKey) {
    const ic = itemDefOf(heldKey)?.icon as { shape?: string; colors?: string[] } | undefined;
    if (ic?.shape && ic.colors && HOLDABLE.has(ic.shape)) held = [ic.shape, ic.colors[0], ic.colors[1] ?? ic.colors[0]];
  }
  return { head: col(keys[0]), body: col(keys[1]), legs: col(keys[2]), feet: col(keys[3]), offhand: col(keys[4]), held };
}
