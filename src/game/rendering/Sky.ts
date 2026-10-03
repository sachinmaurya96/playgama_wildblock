import * as THREE from 'three';

/**
 * Stylised sky dome: gradient, sun disc + glow, crescent moon, twinkling stars.
 * Follows the camera; colours are driven by DayNightSystem each frame.
 */
const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}
`;

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uTime;
uniform float uSunsetGlow;
varying vec3 vDir;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, clamp(-h * 4.0, 0.0, 1.0));
  // warm band near the sun at sunrise / sunset
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(sd, 6.0) * 0.35 * uSunsetGlow * clamp(1.0 - abs(h) * 2.5, 0.0, 1.0);
  // sun disc + glow
  col += uSunColor * (smoothstep(0.9985, 0.9992, sd) * 2.2 + pow(sd, 180.0) * 0.6 + pow(sd, 18.0) * 0.12) * step(-0.05, uSunDir.y + 0.1);
  // moon: soft disc with a crescent shadow
  float md = dot(d, uMoonDir);
  float disc = smoothstep(0.9990, 0.9994, md);
  vec3 off = normalize(uMoonDir + vec3(0.018, 0.012, 0.0));
  float shadow = smoothstep(0.9990, 0.9994, dot(d, off));
  col += vec3(0.85, 0.88, 1.0) * (disc * (1.0 - shadow * 0.85) * 1.1 + pow(max(md, 0.0), 400.0) * 0.25) * uStars;
  // stars
  if (uStars > 0.01 && h > 0.0) {
    vec3 cell = floor(d * 160.0);
    float r = hash(cell);
    if (r > 0.993) {
      vec3 center = (cell + 0.5) / 160.0;
      float dist = length(d - normalize(center)) * 160.0;
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 5.0) + r * 60.0);
      float s = smoothstep(0.5, 0.0, dist) * tw * uStars * smoothstep(0.0, 0.25, h);
      col += mix(vec3(1.0, 0.9, 0.8), vec3(0.8, 0.9, 1.0), fract(r * 91.0)) * s * 1.8;
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uTop: { value: new THREE.Color('#4a8fd8') },
    uHorizon: { value: new THREE.Color('#bfe0f5') },
    uBottom: { value: new THREE.Color('#9cc0dc') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color('#fff2d0') },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uSunsetGlow: { value: 0 },
  };

  constructor() {
    const geo = new THREE.SphereGeometry(500, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.name = 'sky';
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
    this.mesh.updateMatrixWorld();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Blocky drifting clouds (instanced, wrapped around the camera in the vertex shader). */
export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  readonly uniforms = {
    uOffset: { value: new THREE.Vector2(0, 0) },
    uCam: { value: new THREE.Vector3() },
    uLight: { value: new THREE.Color('#ffffff') },
    uShadow: { value: new THREE.Color('#c8d4e4') },
    uFogColor: { value: new THREE.Color('#bcd8f0') },
    uFogFar: { value: 400 },
    uCover: { value: 0.6 },
  };
  private static TILE = 640;

  constructor(seed: number) {
    const clusters = 70;
    const perCluster = 5;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec2 uOffset;
        uniform vec3 uCam;
        uniform float uCover;
        varying float vShade;
        varying float vDist;
        varying float vFade;
        void main() {
          vec4 local = instanceMatrix * vec4(position, 1.0);
          float T = ${Clouds.TILE.toFixed(1)};
          vec2 base = local.xz + uOffset - uCam.xz + T * 0.5;
          vec2 wrapped = mod(base, T) - T * 0.5 + uCam.xz;
          // cover: clusters with a higher id fade out when the sky is clearer
          vFade = step(instanceMatrix[3].w * 0.0 + fract(sin(dot(floor(instanceMatrix[3].xz / 40.0), vec2(12.9, 78.2))) * 437.5), uCover);
          vec4 world = vec4(wrapped.x, local.y, wrapped.y, 1.0);
          vShade = normal.y * 0.5 + 0.5;
          vec4 mv = viewMatrix * world;
          vDist = length(mv.xz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        uniform vec3 uShadow;
        uniform vec3 uFogColor;
        uniform float uFogFar;
        varying float vShade;
        varying float vDist;
        varying float vFade;
        void main() {
          if (vFade < 0.5) discard;
          vec3 c = mix(uShadow, uLight, vShade);
          float f = smoothstep(uFogFar * 0.45, uFogFar, vDist);
          gl_FragColor = vec4(mix(c, uFogColor, f), 0.88 * (1.0 - f));
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, clusters * perCluster);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    const m = new THREE.Matrix4();
    let rnd = seed >>> 0 || 1;
    const rand = () => {
      rnd ^= rnd << 13;
      rnd ^= rnd >>> 17;
      rnd ^= rnd << 5;
      return ((rnd >>> 0) % 10000) / 10000;
    };
    let i = 0;
    for (let c = 0; c < clusters; c++) {
      const cx = (rand() - 0.5) * Clouds.TILE, cz = (rand() - 0.5) * Clouds.TILE;
      const cy = 112 + rand() * 12;
      for (let k = 0; k < perCluster; k++) {
        const sx = 12 + rand() * 26, sz = 10 + rand() * 22, sy = 3 + rand() * 3;
        m.makeScale(sx, sy, sz);
        m.setPosition(cx + (rand() - 0.5) * 30, cy + (k === 0 ? 0 : rand() * 3), cz + (rand() - 0.5) * 24);
        this.mesh.setMatrixAt(i++, m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera, wind: number): void {
    this.uniforms.uOffset.value.x += dt * 1.6 * wind;
    this.uniforms.uOffset.value.y += dt * 0.5 * wind;
    this.uniforms.uCam.value.copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
