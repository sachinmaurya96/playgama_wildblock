import * as THREE from 'three';
import { paintAllTiles } from './TexturePainter';

/**
 * Shared terrain/water shaders. All chunk meshes use just three materials
 * (solid, cutout, water) that share one uniform block, so a day/night update
 * is a handful of uniform writes per frame regardless of world size.
 */
export interface WorldUniforms {
  uAtlas: { value: THREE.DataArrayTexture | null };
  uTime: { value: number };
  uWind: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSkyAmbient: { value: THREE.Color };
  uGroundAmbient: { value: THREE.Color };
  uTorchColor: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uDaylight: { value: number };
  uNightVision: { value: number };
  uSkyReflect: { value: THREE.Color };
  uWet: { value: number };
  /** Light carried by the player (held torch): xyz = position, w = strength 0..1. */
  uHeldLight: { value: THREE.Vector4 };
  /** Dynamic light budget (lamps placed as build objects): xyz = position, w = range (0 = off). */
  uPointPos: { value: THREE.Vector4[] };
  /** Colour × intensity per dynamic light. */
  uPointCol: { value: THREE.Color[] };
  /** Build-mode floor grid: x = enabled, y = grid y level, z/w = lot half size. */
  uGrid: { value: THREE.Vector4 };
}

/** Maximum dynamic point lights shading terrain + build objects at once. */
export const MAX_POINT_LIGHTS = 8;

export function createWorldUniforms(): WorldUniforms {
  return {
    uAtlas: { value: null },
    uTime: { value: 0 },
    uWind: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uSkyAmbient: { value: new THREE.Color(0.55, 0.62, 0.75) },
    uGroundAmbient: { value: new THREE.Color(0.35, 0.3, 0.25) },
    uTorchColor: { value: new THREE.Color('#ffb566') },
    uFogColor: { value: new THREE.Color('#bcd8f0') },
    uFogNear: { value: 40 },
    uFogFar: { value: 120 },
    uDaylight: { value: 1 },
    uNightVision: { value: 0 },
    uSkyReflect: { value: new THREE.Color('#9cc8f0') },
    uWet: { value: 0 },
    uHeldLight: { value: new THREE.Vector4(0, -1000, 0, 0) },
    uPointPos: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Vector4(0, -1000, 0, 0)) },
    uPointCol: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
    uGrid: { value: new THREE.Vector4(0, 0, 128, 128) },
  };
}

export function createAtlasTexture(): { texture: THREE.DataArrayTexture; averages: [number, number, number][] } {
  const { data, size, layers, averages } = paintAllTiles();
  const tex = new THREE.DataArrayTexture(data, size, size, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { texture: tex, averages };
}

/** GLSL: sum of the dynamic point-light budget at a surface point. */
export const POINT_LIGHTS_GLSL = /* glsl */ `
uniform vec4 uPointPos[${MAX_POINT_LIGHTS}];
uniform vec3 uPointCol[${MAX_POINT_LIGHTS}];
vec3 pointLights(vec3 P, vec3 N) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    vec4 L = uPointPos[i];
    if (L.w <= 0.0) continue;
    vec3 d = L.xyz - P;
    float dist = length(d);
    if (dist >= L.w) continue;
    float att = pow(1.0 - dist / L.w, 2.0);
    float lam = 0.35 + 0.65 * max(dot(N, d / max(dist, 0.001)), 0.0);
    sum += uPointCol[i] * att * lam;
  }
  return sum;
}
`;

const TERRAIN_VERT = /* glsl */ `
attribute vec4 aData;
attribute vec4 aColor;
uniform float uTime;
uniform float uWind;
varying vec2 vUv;
varying float vTile;
varying vec3 vTint;
varying float vSky;
varying float vBlock;
varying float vAO;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDist;
flat varying int vFlags;

void main() {
  int flags = int(aData.y + 0.5);
  vec4 world = modelMatrix * vec4(position, 1.0);
  if ((flags & 1) != 0) {
    float ph = world.x * 0.7 + world.z * 0.5;
    world.x += sin(uTime * 1.7 + ph) * 0.07 * uWind;
    world.z += cos(uTime * 1.3 + ph * 1.3) * 0.05 * uWind;
  } else if ((flags & 2) != 0) {
    float ph = world.x * 0.3 + world.y * 0.2 + world.z * 0.4;
    world.xyz += vec3(sin(uTime * 1.1 + ph), sin(uTime * 0.9 + ph * 1.7) * 0.5, cos(uTime * 1.2 + ph)) * 0.022 * uWind;
  }
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vTile = aData.x;
  vFlags = flags;
  vBlock = aData.z;
  vAO = aData.w;
  vTint = aColor.rgb;
  vSky = aColor.a;
  vNormal = normal;
}
`;

const TERRAIN_FRAG = /* glsl */ `
uniform highp sampler2DArray uAtlas;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform vec3 uTorchColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uNightVision;
uniform float uWet;
uniform vec4 uHeldLight;
uniform vec4 uGrid;
#ifdef GHOST
uniform vec4 uGhostTint;
#endif
${POINT_LIGHTS_GLSL}
varying vec2 vUv;
varying float vTile;
varying vec3 vTint;
varying float vSky;
varying float vBlock;
varying float vAO;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDist;
flat varying int vFlags;

void main() {
  vec3 N = normalize(vNormal);
  vec2 f = fract(vUv);
  if ((vFlags & 8) != 0) {
    // Deterministic per-block texture variation (rotation / mirror) — no extra storage.
    vec3 bp = floor(vWorld - N * 0.5 + 0.001);
    float h = fract(sin(dot(bp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (abs(N.y) > 0.5) {
      if (h < 0.25) f = vec2(1.0 - f.y, f.x);
      else if (h < 0.5) f = vec2(1.0 - f.x, 1.0 - f.y);
      else if (h < 0.75) f = vec2(f.y, 1.0 - f.x);
    } else if (h < 0.5) f.x = 1.0 - f.x;
  }
  vec4 tex = textureGrad(uAtlas, vec3(f, vTile), dFdx(vUv), dFdy(vUv));
#ifdef CUTOUT
  if (tex.a < 0.5) discard;
  float tintMask = 1.0;
#else
  float tintMask = tex.a;
#endif
  vec3 tint = pow(vTint, vec3(2.2));
  vec3 albedo = tex.rgb * mix(vec3(1.0), tint, tintMask);
  float sky = vSky;
  float sky2 = sky * sky;
  float faceShade = N.y > 0.5 ? 1.0 : N.y < -0.5 ? 0.58 : (abs(N.x) > 0.5 ? 0.8 : 0.9);
  float sunAmt = max(dot(N, uSunDir), 0.0);
  vec3 ambient = mix(uGroundAmbient, uSkyAmbient, N.y * 0.5 + 0.5);
  vec3 light = ambient * (0.05 + sky2 * 0.95) * faceShade + uSunColor * sunAmt * sky2 * 0.85;
  float bl = vBlock / 15.0;
  light += uTorchColor * pow(bl, 1.7) * 1.4 * (0.7 + 0.3 * faceShade);
  light += vec3(0.16, 0.2, 0.26) * uNightVision;
  if (uHeldLight.w > 0.0) {
    vec3 toL = uHeldLight.xyz - vWorld;
    float d = length(toL);
    float held = pow(max(0.0, 1.0 - d / 9.0), 2.0) * uHeldLight.w;
    light += uTorchColor * held * (0.55 + 0.45 * max(dot(N, toL / max(d, 0.001)), 0.0)) * 1.3;
  }
  light += pointLights(vWorld, N);
  vec3 col = albedo * light * vAO;
  if ((vFlags & 4) != 0) col = max(col, albedo * 1.05);
  if (uGrid.x > 0.5 && N.y > 0.5 && abs(vWorld.y - uGrid.y) < 0.02 && abs(vWorld.x) < uGrid.z && abs(vWorld.z) < uGrid.w) {
    // subtle build grid on the lot's floor, fading with distance
    vec2 g = abs(fract(vWorld.xz) - 0.5);
    float line = 1.0 - smoothstep(0.468, 0.494, max(g.x, g.y));
    vec2 g4 = abs(fract(vWorld.xz / 4.0) - 0.5);
    float major = 1.0 - smoothstep(0.485, 0.497, max(g4.x, g4.y));
    float fade = 1.0 - smoothstep(10.0, 40.0, vDist);
    col = mix(col, vec3(1.0), (1.0 - line) * 0.08 * fade + (1.0 - major) * 0.08 * fade);
  }
  // wet surfaces during rain: slightly darker and more saturated
  col *= 1.0 - uWet * 0.15 * sky2;
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, uFogColor, fog);
#ifdef GHOST
  col = mix(col, uGhostTint.rgb, 0.4);
  gl_FragColor = vec4(col, uGhostTint.a);
#else
  gl_FragColor = vec4(col, 1.0);
#endif
  #include <colorspace_fragment>
}
`;

const WATER_VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec3 aFlow;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vTint;
varying float vSky;
varying float vKind;
varying float vBlock;
varying float vDepth;
varying float vDist;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  if (aFlow.x < 0.5) {
    world.y += (sin(world.x * 1.1 + uTime * 1.3) + cos(world.z * 0.9 + uTime * 1.1)) * 0.025 - 0.03;
  }
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
  vTint = aColor.rgb;
  vSky = aColor.a;
  vKind = aFlow.x;
  vBlock = aFlow.y;
  vDepth = aFlow.z;
}
`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uTorchColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uDaylight;
uniform vec3 uSkyReflect;
uniform vec4 uHeldLight;
varying vec3 vWorld;
varying vec3 vTint;
varying float vSky;
varying float vKind;
varying float vBlock;
varying float vDepth;
varying float vDist;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec3 tint = pow(vTint, vec3(2.2));
  float sky2 = vSky * vSky;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col;
  float alpha;
  vec3 lightAmt = uSkyAmbient * (0.12 + sky2 * 0.88) + uSunColor * 0.35 * sky2 + uTorchColor * pow(vBlock / 15.0, 1.7) * 1.2;
  if (uHeldLight.w > 0.0) lightAmt += uTorchColor * pow(max(0.0, 1.0 - length(uHeldLight.xyz - vWorld) / 9.0), 2.0) * uHeldLight.w;
  if (vKind < 0.5) {
    vec2 p = vWorld.xz;
    float e = 0.15;
    float t = uTime;
    float h0 = vnoise(p * 1.3 + vec2(t * 0.6, t * 0.4)) + vnoise(p * 2.7 - vec2(t * 0.5, -t * 0.7)) * 0.5;
    float hx = vnoise((p + vec2(e, 0.0)) * 1.3 + vec2(t * 0.6, t * 0.4)) + vnoise((p + vec2(e, 0.0)) * 2.7 - vec2(t * 0.5, -t * 0.7)) * 0.5;
    float hz = vnoise((p + vec2(0.0, e)) * 1.3 + vec2(t * 0.6, t * 0.4)) + vnoise((p + vec2(0.0, e)) * 2.7 - vec2(t * 0.5, -t * 0.7)) * 0.5;
    vec3 N = normalize(vec3((h0 - hx) * 1.6, 1.0, (h0 - hz) * 1.6));
    float d = smoothstep(0.0, 5.0, vDepth);
    vec3 shallow = tint * 1.35 + vec3(0.03, 0.08, 0.06);
    vec3 deep = tint * 0.3;
    vec3 base = mix(shallow, deep, d) * lightAmt;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 refl = uSkyReflect * (0.4 + 0.6 * uDaylight) * sky2;
    col = mix(base, refl, fres * 0.65);
    float spec = pow(max(dot(reflect(-V, N), uSunDir), 0.0), 90.0);
    col += uSunColor * spec * 1.4 * sky2 * uDaylight;
    float foam = smoothstep(0.9, 0.2, vDepth) * (0.35 + 0.35 * vnoise(p * 4.0 + t));
    col = mix(col, vec3(0.85, 0.92, 0.95) * lightAmt * 1.4, foam * 0.5);
    alpha = mix(0.55, 0.9, d) + fres * 0.1;
  } else {
    // falling sheets / exposed sides: scrolling streaks + foam
    float streak = vnoise(vec2((vWorld.x + vWorld.z) * 3.0, vWorld.y * 0.6 + uTime * 2.6));
    float streak2 = vnoise(vec2((vWorld.x - vWorld.z) * 6.0, vWorld.y * 1.2 + uTime * 3.4));
    float w = smoothstep(0.45, 0.9, streak * 0.6 + streak2 * 0.6);
    col = mix(tint * 1.2, vec3(0.9, 0.96, 1.0), w * 0.7) * lightAmt;
    alpha = 0.72 + w * 0.2;
  }
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, min(1.0, alpha + fog));
  #include <colorspace_fragment>
}
`;

const GLASS_FRAG = /* glsl */ `
uniform highp sampler2DArray uAtlas;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmbient;
uniform vec3 uTorchColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uDaylight;
uniform vec3 uSkyReflect;
${POINT_LIGHTS_GLSL}
varying vec2 vUv;
varying float vTile;
varying vec3 vTint;
varying float vSky;
varying float vBlock;
varying float vAO;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDist;
flat varying int vFlags;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float streak = texture(uAtlas, vec3(fract(vUv), vTile)).a;
  vec3 tint = pow(vTint, vec3(2.2));
  float sky2 = vSky * vSky;
  vec3 light = uSkyAmbient * (0.25 + sky2 * 0.75) + uSunColor * max(dot(N, uSunDir), 0.0) * sky2 * 0.4 + uTorchColor * pow(vBlock / 15.0, 1.7);
  light += pointLights(vWorld, N);
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);
  vec3 refl = uSkyReflect * (0.35 + 0.65 * uDaylight) * (0.35 + 0.65 * sky2);
  vec3 col = mix(tint * light, refl, 0.22 + fres * 0.5) + vec3(streak) * 0.25 * (0.4 + 0.6 * uDaylight);
  float alpha = clamp(vAO + fres * 0.35 + streak * 0.2, 0.0, 0.94);
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, max(alpha, fog));
  #include <colorspace_fragment>
}
`;

export interface TerrainMaterials {
  solid: THREE.ShaderMaterial;
  cutout: THREE.ShaderMaterial;
  glass: THREE.ShaderMaterial;
  water: THREE.ShaderMaterial;
}

/** Translucent placement-preview materials for blocks (white = valid, red = blocked). */
export function createGhostMaterials(uniforms: WorldUniforms): { valid: THREE.ShaderMaterial; invalid: THREE.ShaderMaterial } {
  const mk = (tint: [number, number, number, number]) => new THREE.ShaderMaterial({
    uniforms: { ...(uniforms as unknown as Record<string, THREE.IUniform>), uGhostTint: { value: new THREE.Vector4(...tint) } },
    vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, defines: { GHOST: 1, CUTOUT: 1 },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  return { valid: mk([0.92, 1, 0.94, 0.62]), invalid: mk([1, 0.3, 0.25, 0.55]) };
}

export function createTerrainMaterials(uniforms: WorldUniforms): TerrainMaterials {
  const u = uniforms as unknown as Record<string, THREE.IUniform>;
  const solid = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
  });
  const cutout = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
    defines: { CUTOUT: 1 }, side: THREE.DoubleSide,
  });
  const water = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const glass = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: TERRAIN_VERT, fragmentShader: GLASS_FRAG,
    transparent: true, depthWrite: false,
  });
  return { solid, cutout, glass, water };
}
