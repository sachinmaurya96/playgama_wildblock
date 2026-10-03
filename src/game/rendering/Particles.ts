import * as THREE from 'three';

export type ParticleKind = 'chip' | 'dust' | 'splash' | 'mist' | 'leaf' | 'spark' | 'firefly' | 'heart' | 'butterfly' | 'poof' | 'sparkle';

interface P {
  alive: boolean;
  kind: ParticleKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number;
  r: number; g: number; b: number;
  glow: number;
  rot: number; spin: number;
  phase: number;
}

/**
 * Pooled particles rendered as one InstancedMesh of tiny cubes (fits the voxel
 * look, 1 draw call). No allocations during gameplay: dead particles are reused.
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private pool: P[] = [];
  private cursor = 0;
  private readonly max: number;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private color = new THREE.Color();
  /** 0 = off, 0.35 = low, 1 = high (spawn count multiplier) */
  density = 1;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(max: number, uniforms: Record<string, THREE.IUniform>) {
    this.max = max;
    this.uniforms = uniforms;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vColor;
        varying vec3 vN;
        varying float vDist;
        void main() {
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0);
          #endif
          vN = normalize(mat3(instanceMatrix) * normal);
          vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
          vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyAmbient;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec3 vColor;
        varying vec3 vN;
        varying float vDist;
        void main() {
          vec3 c = vColor;
          float glow = step(1.001, max(c.r, max(c.g, c.b)));
          vec3 lit = c * (uSkyAmbient * 0.9 + uSunColor * max(dot(vN, uSunDir), 0.0) * 0.6 + 0.12);
          vec3 col = mix(lit, min(c, vec3(1.6)), glow);
          col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDist));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < max; i++) {
      this.pool.push({
        alive: false, kind: 'chip', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, r: 1, g: 1, b: 1, glow: 0, rot: 0, spin: 0, phase: 0,
      });
    }
  }

  private take(): P {
    for (let n = 0; n < this.max; n++) {
      const i = (this.cursor + n) % this.max;
      if (!this.pool[i].alive) {
        this.cursor = (i + 1) % this.max;
        return this.pool[i];
      }
    }
    // pool exhausted: recycle the oldest slot
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    return p;
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, count: number, color: [number, number, number] | THREE.Color, opts: { spread?: number; speed?: number; size?: number; life?: number; up?: number; glow?: boolean } = {}): void {
    const n = Math.max(this.density > 0 ? 1 : 0, Math.round(count * this.density));
    const rgb: [number, number, number] = color instanceof THREE.Color ? [color.r, color.g, color.b] : color;
    for (let i = 0; i < n; i++) {
      const p = this.take();
      const spread = opts.spread ?? 0.4;
      const speed = opts.speed ?? 2;
      p.alive = true;
      p.kind = kind;
      p.x = x + (Math.random() - 0.5) * spread;
      p.y = y + (Math.random() - 0.5) * spread;
      p.z = z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      p.vx = Math.cos(a) * sp * 0.6;
      p.vz = Math.sin(a) * sp * 0.6;
      p.vy = (opts.up ?? 1) * sp * (0.5 + Math.random() * 0.8);
      p.max = p.life = (opts.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      p.size = (opts.size ?? 0.09) * (0.7 + Math.random() * 0.6);
      const jitter = 0.85 + Math.random() * 0.3;
      const g = opts.glow ? 1.6 : 1;
      p.r = rgb[0] * jitter * g;
      p.g = rgb[1] * jitter * g;
      p.b = rgb[2] * jitter * g;
      p.glow = opts.glow ? 1 : 0;
      p.rot = Math.random() * 6;
      p.spin = (Math.random() - 0.5) * 8;
      p.phase = Math.random() * 10;
      if (kind === 'mist' || kind === 'dust' || kind === 'poof') {
        p.vy = Math.abs(p.vy) * 0.4;
      }
    }
  }

  /** Is (x,y,z) inside solid ground? (used for simple particle bounce) */
  solidAt: (x: number, y: number, z: number) => boolean = () => false;

  update(dt: number, time: number): void {
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const t = 1 - p.life / p.max;
      let scale = p.size;
      switch (p.kind) {
        case 'chip':
        case 'splash':
          p.vy -= 18 * dt;
          if (p.vy < 0 && this.solidAt(p.x, p.y - p.size, p.z)) {
            p.vy *= -0.3;
            p.vx *= 0.5;
            p.vz *= 0.5;
          }
          scale *= 1 - t * t;
          break;
        case 'leaf':
          p.vy = Math.max(p.vy - 3 * dt, -0.9);
          p.vx += Math.sin(time * 3 + p.phase) * dt * 2;
          p.vz *= 0.98;
          break;
        case 'dust':
        case 'poof':
          p.vx *= 0.92;
          p.vz *= 0.92;
          scale *= 0.6 + t * (p.kind === 'poof' ? 2.2 : 1.2);
          scale *= 1 - t * t;
          break;
        case 'mist':
          p.vx *= 0.97;
          p.vz *= 0.97;
          scale *= 0.8 + t * 2.4;
          scale *= 1 - t;
          break;
        case 'spark':
        case 'sparkle':
          p.vy -= (p.kind === 'spark' ? 3 : 0.5) * dt;
          scale *= 1 - t;
          break;
        case 'heart':
          p.vy = 0.8;
          p.vx = Math.sin(time * 4 + p.phase) * 0.3;
          p.vz = 0;
          scale *= t < 0.2 ? t * 5 : 1 - (t - 0.2) * 0.8;
          break;
        case 'firefly':
        case 'butterfly':
          p.vx = Math.sin(time * 1.3 + p.phase) * 0.6 + Math.sin(time * 3.1 + p.phase * 2) * 0.3;
          p.vz = Math.cos(time * 1.1 + p.phase) * 0.6;
          p.vy = Math.sin(time * 2 + p.phase * 3) * 0.3;
          scale *= p.kind === 'butterfly' ? 0.6 + Math.abs(Math.sin(time * 14 + p.phase)) * 0.6 : 0.6 + 0.4 * Math.sin(time * 5 + p.phase);
          if (t > 0.85) scale *= (1 - t) / 0.15;
          break;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      this.p.set(p.x, p.y, p.z);
      this.e.set(p.rot, p.rot * 0.7, 0);
      this.q.setFromEuler(this.e);
      const flat = p.kind === 'leaf' || p.kind === 'butterfly' ? 0.25 : 1;
      this.s.set(scale, scale * flat, scale);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.color.setRGB(p.r, p.g, p.b);
      this.mesh.setColorAt(n, this.color);
      n++;
    }
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Camera-relative rain streaks animated entirely in the vertex shader. */
export class Rain {
  readonly mesh: THREE.LineSegments;
  readonly uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uIntensity: { value: 0 },
    uColor: { value: new THREE.Color('#a8c4dc') },
  };

  constructor(count = 1400) {
    const pos = new Float32Array(count * 6);
    const seeds = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 36, y = Math.random() * 30, z = (Math.random() - 0.5) * 36, s = Math.random();
      pos.set([x, y, z, x + 0.05, y - 0.7, z + 0.02], i * 6);
      seeds.set([s, 0, i / count, s, 1, i / count], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime;
        uniform vec3 uCam;
        uniform float uIntensity;
        varying float vA;
        void main() {
          vec3 p = position;
          float fall = mod(p.y - uTime * (16.0 + aSeed.x * 6.0), 30.0);
          vec3 world = vec3(mod(p.x - uCam.x + 18.0, 36.0) - 18.0 + uCam.x, fall + uCam.y - 12.0, mod(p.z - uCam.z + 18.0, 36.0) - 18.0 + uCam.z);
          world.y -= aSeed.y * 0.7;
          vA = step(aSeed.z, uIntensity) * 0.55;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          if (vA < 0.01) discard;
          gl_FragColor = vec4(uColor, vA);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  update(time: number, camera: THREE.Camera, intensity: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.01;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
