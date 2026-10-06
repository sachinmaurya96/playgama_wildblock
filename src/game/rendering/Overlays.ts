import * as THREE from 'three';

/** Selection outline + glowing fracture lines while breaking (original effect). */
export class BlockOutline {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private crack: THREE.Mesh;
  private lineMat: THREE.LineBasicMaterial;
  readonly crackUniforms = { uProgress: { value: 0 }, uTime: { value: 0 } };
  private ghost: THREE.Mesh;

  constructor() {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.lineMat = new THREE.LineBasicMaterial({ color: '#1b140e', transparent: true, opacity: 0.55, depthTest: true });
    this.lines = new THREE.LineSegments(edges, this.lineMat);
    this.lines.renderOrder = 5;
    const crackMat = new THREE.ShaderMaterial({
      uniforms: this.crackUniforms,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: /* glsl */ `
        varying vec3 vP;
        varying vec3 vN;
        void main() { vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress;
        uniform float uTime;
        varying vec3 vP;
        varying vec3 vN;
        vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
        void main() {
          vec3 n = abs(vN);
          vec2 uv = n.y > 0.5 ? vP.xz : n.x > 0.5 ? vP.zy : vP.xy;
          uv = (uv + 0.5) * 4.0;
          // voronoi edges = fracture lines, revealed from the centre outwards
          vec2 i = floor(uv), f = fract(uv);
          float d1 = 8.0, d2 = 8.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = hash2(i + g);
            float d = length(g + o - f);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          float edge = 1.0 - smoothstep(0.02, 0.09, d2 - d1);
          float reach = length(uv - 2.0) / 2.9;
          float show = step(reach, uProgress * 1.15) * edge;
          if (show < 0.5) discard;
          float pulse = 0.75 + 0.25 * sin(uTime * 14.0);
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * pulse, 0.85);
        }
      `,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), crackMat);
    this.crack.renderOrder = 6;
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.18, depthWrite: false }));
    this.ghost.renderOrder = 4;
    this.group.add(this.lines, this.crack, this.ghost);
    this.group.visible = false;
  }

  setHighContrast(on: boolean): void {
    this.lineMat.color.set(on ? '#ffe14a' : '#1b140e');
    this.lineMat.opacity = on ? 1 : 0.55;
  }

  show(box: [number, number, number, number, number, number] | null, x: number, y: number, z: number, progress: number, time: number): void {
    if (!box) {
      this.lines.visible = false;
      this.crack.visible = false;
      return;
    }
    this.group.visible = true;
    this.lines.visible = true;
    const sx = box[3] - box[0], sy = box[4] - box[1], sz = box[5] - box[2];
    const cx = x + (box[0] + box[3]) / 2, cy = y + (box[1] + box[4]) / 2, cz = z + (box[2] + box[5]) / 2;
    this.lines.position.set(cx, cy, cz);
    this.lines.scale.set(sx + 0.006, sy + 0.006, sz + 0.006);
    this.crack.visible = progress > 0.02;
    this.crack.position.copy(this.lines.position);
    this.crack.scale.copy(this.lines.scale);
    this.crackUniforms.uProgress.value = progress;
    this.crackUniforms.uTime.value = time;
  }

  showGhost(visible: boolean, x = 0, y = 0, z = 0): void {
    this.ghost.visible = visible;
    if (visible) this.ghost.position.set(x + 0.5, y + 0.5, z + 0.5);
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.lineMat.dispose();
    for (const mesh of [this.crack, this.ghost]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
