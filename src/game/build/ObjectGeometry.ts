import * as THREE from 'three';
import { objectColors, type ObjectDef, type ObjPart, type PartMaterial } from '../../data/furniture';
import { POINT_LIGHTS_GLSL, type WorldUniforms } from '../rendering/TerrainMaterials';

/**
 * Geometry + materials for Build Home objects.
 *
 * Each (object, colour variant) compiles once into up to three merged
 * geometries per animation group — solid, glass, emissive — with per-vertex
 * colours. Instances share them through InstancedMesh (see BuildObjects), so
 * fifty identical dining chairs are a single draw call and no chair ever gets
 * its own material or texture.
 */

export type PartGroup = { solid: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null; emissive: THREE.BufferGeometry | null };

export interface ObjectGeometry {
  /** '' = static parts; other keys = animation groups. */
  groups: Map<string, PartGroup>;
  triangles: number;
}

class Acc {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  count = 0;
  quad(p: number[][], n: number[], c: number[]) {
    const b = this.count;
    for (const v of p) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(c[0], c[1], c[2]);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.count += 4;
  }
  tri(p: number[][], n: number[][], c: number[]) {
    const b = this.count;
    for (let i = 0; i < 3; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(n[i][0], n[i][1], n[i][2]);
      this.col.push(c[0], c[1], c[2]);
    }
    this.idx.push(b, b + 1, b + 2);
    this.count += 3;
  }
  build(): THREE.BufferGeometry | null {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function hexToRgb(h: string): number[] {
  const v = parseInt(h.slice(1, 7), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function emitBox(acc: Acc, a: number[], b: number[], c: number[]) {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  acc.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], c);
  acc.quad([[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], [-1, 0, 0], c);
  acc.quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], c);
  acc.quad([[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [0, -1, 0], c);
  acc.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c);
  acc.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], c);
}

/** Map a y-axis cylinder coordinate frame onto the requested axis. */
function axisMap(axis: 'x' | 'y' | 'z', u: number, v: number, h: number): number[] {
  // (u, v) radial, h along axis
  if (axis === 'x') return [h, u, v];
  if (axis === 'z') return [u, v, h];
  return [u, h, v];
}

function emitCyl(acc: Acc, p: ObjPart, c: number[]) {
  const axis = p.axis ?? 'y';
  const seg = p.seg ?? 14;
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const ui = axis === 'x' ? 1 : 0;
  const vi = axis === 'z' ? 1 : 2;
  const cu = (p.a[ui] + p.b[ui]) / 2, cv = (p.a[vi] + p.b[vi]) / 2;
  const ru = (p.b[ui] - p.a[ui]) / 2, rv = (p.b[vi] - p.a[vi]) / 2;
  const h0 = p.a[ai], h1 = p.b[ai];
  const ring = (k: number) => {
    const t = (k / seg) * Math.PI * 2;
    return [cu + Math.cos(t) * ru, cv + Math.sin(t) * rv, Math.cos(t), Math.sin(t)];
  };
  for (let k = 0; k < seg; k++) {
    const [u0, v0, nu0, nv0] = ring(k), [u1, v1, nu1, nv1] = ring(k + 1);
    const nm = axisMap(axis, (nu0 + nu1) / 2, (nv0 + nv1) / 2, 0);
    acc.quad([axisMap(axis, u0, v0, h0), axisMap(axis, u1, v1, h0), axisMap(axis, u1, v1, h1), axisMap(axis, u0, v0, h1)].map((q) => q), nm, c);
    const top = axisMap(axis, 0, 0, 1), bot = axisMap(axis, 0, 0, -1);
    acc.tri([axisMap(axis, cu, cv, h1), axisMap(axis, u1, v1, h1), axisMap(axis, u0, v0, h1)], [top, top, top], c);
    acc.tri([axisMap(axis, cu, cv, h0), axisMap(axis, u0, v0, h0), axisMap(axis, u1, v1, h0)], [bot, bot, bot], c);
  }
}

function fixWinding(acc: Acc, from: number) {
  // Make every triangle's winding agree with its stored normal (CCW from outside).
  for (let i = from; i < acc.idx.length; i += 3) {
    const a = acc.idx[i], b = acc.idx[i + 1], cc = acc.idx[i + 2];
    const pa = [acc.pos[a * 3], acc.pos[a * 3 + 1], acc.pos[a * 3 + 2]];
    const pb = [acc.pos[b * 3], acc.pos[b * 3 + 1], acc.pos[b * 3 + 2]];
    const pc = [acc.pos[cc * 3], acc.pos[cc * 3 + 1], acc.pos[cc * 3 + 2]];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const sn = [acc.nor[a * 3] + acc.nor[b * 3] + acc.nor[cc * 3], acc.nor[a * 3 + 1] + acc.nor[b * 3 + 1] + acc.nor[cc * 3 + 1], acc.nor[a * 3 + 2] + acc.nor[b * 3 + 2] + acc.nor[cc * 3 + 2]];
    if (n[0] * sn[0] + n[1] * sn[1] + n[2] * sn[2] < 0) {
      acc.idx[i + 1] = cc;
      acc.idx[i + 2] = b;
    }
  }
}

function emitSphere(acc: Acc, p: ObjPart, c: number[]) {
  const cx = (p.a[0] + p.b[0]) / 2, cy = (p.a[1] + p.b[1]) / 2, cz = (p.a[2] + p.b[2]) / 2;
  const rx = (p.b[0] - p.a[0]) / 2, ry = (p.b[1] - p.a[1]) / 2, rz = (p.b[2] - p.a[2]) / 2;
  const lat = 6, lon = 10;
  const pt = (i: number, j: number) => {
    const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2;
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    return { p: [cx + n[0] * rx, cy + n[1] * ry, cz + n[2] * rz], n };
  };
  for (let i = 0; i < lat; i++)
    for (let j = 0; j < lon; j++) {
      const a = pt(i, j), b = pt(i + 1, j), d = pt(i + 1, j + 1), e = pt(i, j + 1);
      acc.tri([a.p, b.p, d.p], [a.n, b.n, d.n], c);
      acc.tri([a.p, d.p, e.p], [a.n, d.n, e.n], c);
    }
}

const cache = new Map<string, ObjectGeometry>();

export function objectGeometry(def: ObjectDef, variant: string): ObjectGeometry {
  const key = `${def.id}|${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const colors = objectColors(def, variant);
  const accs = new Map<string, Record<PartMaterial, Acc>>();
  let tris = 0;
  for (const p of def.parts) {
    const g = p.anim ?? '';
    let set = accs.get(g);
    if (!set) {
      set = { solid: new Acc(), glass: new Acc(), emissive: new Acc() };
      accs.set(g, set);
    }
    const acc = set[p.mat ?? 'solid'];
    const col = hexToRgb(p.slot.startsWith('#') ? p.slot : colors[p.slot] ?? '#ff00ff');
    const start = acc.idx.length;
    if (p.kind === 'box') emitBox(acc, p.a, p.b, col);
    else if (p.kind === 'cyl') emitCyl(acc, p, col);
    else emitSphere(acc, p, col);
    fixWinding(acc, start);
    tris += (acc.idx.length - start) / 3;
  }
  const groups = new Map<string, PartGroup>();
  for (const [g, set] of accs) groups.set(g, { solid: set.solid.build(), glass: set.glass.build(), emissive: set.emissive.build() });
  const out = { groups, triangles: tris };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- materials

const OBJ_VERT = /* glsl */ `
attribute vec3 aCol;
uniform vec3 uInstDefault;
varying vec3 vCol;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDist;
varying vec3 vInst;
void main() {
#ifdef USE_INSTANCING
  mat4 m = modelMatrix * instanceMatrix;
#else
  mat4 m = modelMatrix;
#endif
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(m) * normal);
#ifdef USE_INSTANCING_COLOR
  vInst = instanceColor;
#else
  vInst = uInstDefault;
#endif
  vCol = aCol;
  vec4 mv = viewMatrix * w;
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const OBJ_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform vec3 uTorchColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uDaylight;
uniform vec3 uSkyReflect;
uniform vec4 uHeldLight;
${POINT_LIGHTS_GLSL}
varying vec3 vCol;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDist;
varying vec3 vInst;
void main() {
  vec3 N = normalize(vNormal);
  vec3 alb = pow(vCol, vec3(2.2));
  float sky = vInst.x;
  float sky2 = sky * sky;
  float faceShade = N.y > 0.5 ? 1.0 : N.y < -0.5 ? 0.62 : (abs(N.x) > 0.5 ? 0.82 : 0.9);
  vec3 ambient = mix(uGroundAmbient, uSkyAmbient, N.y * 0.5 + 0.5);
  vec3 light = ambient * (0.07 + sky2 * 0.93) * faceShade + uSunColor * max(dot(N, uSunDir), 0.0) * sky2 * 0.85;
  light += uTorchColor * pow(vInst.y, 1.7) * 1.3;
  light += pointLights(vWorld, N);
  if (uHeldLight.w > 0.0) {
    vec3 toL = uHeldLight.xyz - vWorld;
    float d = length(toL);
    light += uTorchColor * pow(max(0.0, 1.0 - d / 9.0), 2.0) * uHeldLight.w;
  }
  vec3 col = alb * light;
  float alpha = 1.0;
#ifdef EMISSIVE
  col = mix(col, alb * 1.35 + 0.04, vInst.z);
#endif
#ifdef GLASS
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);
  vec3 refl = uSkyReflect * (0.35 + 0.65 * uDaylight) * (0.35 + 0.65 * sky2);
  col = mix(alb * light, refl, 0.25 + fres * 0.45);
  alpha = clamp(0.26 + fres * 0.45, 0.0, 0.92);
#endif
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, max(alpha, fog));
  #include <colorspace_fragment>
}
`;

const GHOST_FRAG = /* glsl */ `
uniform vec3 uGhost;
uniform float uGhostAlpha;
varying vec3 vCol;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDist;
varying vec3 vInst;
void main() {
  vec3 N = normalize(vNormal);
  float shade = 0.72 + 0.28 * max(dot(N, normalize(vec3(0.4, 1.0, 0.3))), 0.0);
  vec3 col = mix(vCol, uGhost, 0.45) * shade;
  gl_FragColor = vec4(col, uGhostAlpha);
  #include <colorspace_fragment>
}
`;

export interface ObjectMaterials {
  solid: THREE.ShaderMaterial;
  glass: THREE.ShaderMaterial;
  emissive: THREE.ShaderMaterial;
  ghostValid: THREE.ShaderMaterial;
  ghostInvalid: THREE.ShaderMaterial;
}

let shared: ObjectMaterials | null = null;

export function objectMaterials(world: WorldUniforms): ObjectMaterials {
  if (shared) return shared;
  const u = { ...(world as unknown as Record<string, THREE.IUniform>), uInstDefault: { value: new THREE.Vector3(1, 0, 1) } };
  const mk = (defines: Record<string, number>, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
    new THREE.ShaderMaterial({ uniforms: u, vertexShader: OBJ_VERT, fragmentShader: OBJ_FRAG, defines, ...extra });
  const ghost = (color: string, alpha: number) => new THREE.ShaderMaterial({
    uniforms: { uGhost: { value: new THREE.Color(color) }, uGhostAlpha: { value: alpha }, uInstDefault: { value: new THREE.Vector3(1, 0, 1) } },
    vertexShader: OBJ_VERT, fragmentShader: GHOST_FRAG, transparent: true, depthWrite: false,
  });
  shared = {
    solid: mk({}),
    glass: mk({ GLASS: 1 }, { transparent: true, depthWrite: false }),
    emissive: mk({ EMISSIVE: 1 }),
    ghostValid: ghost('#e8fff0', 0.55),
    ghostInvalid: ghost('#ff5a4a', 0.55),
  };
  return shared;
}

/** A standalone object model (icons, ghost previews). */
export function objectPreview(def: ObjectDef, variant: string, mats: { solid: THREE.Material; glass: THREE.Material; emissive: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  const geo = objectGeometry(def, variant);
  for (const [, grp] of geo.groups) {
    if (grp.solid) g.add(new THREE.Mesh(grp.solid, mats.solid));
    if (grp.emissive) g.add(new THREE.Mesh(grp.emissive, mats.emissive));
    if (grp.glass) {
      const m = new THREE.Mesh(grp.glass, mats.glass);
      m.renderOrder = 2;
      g.add(m);
    }
  }
  return g;
}
