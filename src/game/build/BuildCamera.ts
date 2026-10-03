import * as THREE from 'three';
import type { InputManager } from '../core/InputManager';

/**
 * Free build camera: fly (WASD + Q/E or Space/Shift), look (right-drag),
 * orbit around the point under the cursor (Alt + right-drag), pan
 * (middle-drag) and zoom/dolly (mouse wheel). The cursor stays free so tools
 * aim at whatever is under the mouse. It never moves the player's body.
 */
export class BuildCamera {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = -0.5;
  speed = 10;
  private pivot: THREE.Vector3 | null = null;
  private tmp = new THREE.Vector3();

  enter(from: THREE.Vector3, yaw: number, pitch: number) {
    this.position.copy(from);
    this.yaw = yaw;
    this.pitch = Math.min(pitch, -0.25);
    // start a little above and behind so the builder sees the area
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(4);
    this.position.add(back).add(new THREE.Vector3(0, 3, 0));
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  update(dt: number, input: InputManager, orbitTarget: () => THREE.Vector3 | null) {
    const sens = 0.0045;
    // orbit (Alt + right drag) or look (right drag)
    if ((input.dragRX || input.dragRY) && input.alt) {
      if (!this.pivot) this.pivot = orbitTarget() ?? this.position.clone().addScaledVector(this.forward(this.tmp), 12);
      const off = this.position.clone().sub(this.pivot);
      const r = off.length();
      let yaw = Math.atan2(off.x, off.z);
      let pitch = Math.asin(THREE.MathUtils.clamp(off.y / Math.max(r, 1e-3), -1, 1));
      yaw -= input.dragRX * sens;
      pitch = THREE.MathUtils.clamp(pitch + input.dragRY * sens, -0.2, 1.5);
      this.position.set(this.pivot.x + Math.sin(yaw) * Math.cos(pitch) * r, this.pivot.y + Math.sin(pitch) * r, this.pivot.z + Math.cos(yaw) * Math.cos(pitch) * r);
      // look at the pivot
      const d = this.pivot.clone().sub(this.position).normalize();
      this.yaw = Math.atan2(-d.x, -d.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    } else {
      this.pivot = null;
      if (input.touch.active && (input.lookX || input.lookY)) {
        // touch: drag on the open screen to look around
        this.yaw -= input.lookX * sens * 0.5;
        this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY * sens * 0.5, -1.55, 1.55);
      } else if (input.dragRX || input.dragRY || input.pointerLocked) {
        const dx = input.pointerLocked ? input.lookX : input.dragRX;
        const dy = input.pointerLocked ? input.lookY : input.dragRY;
        this.yaw -= dx * sens * 0.6;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens * 0.6, -1.55, 1.55);
      }
    }
    // pan (middle drag)
    if (input.dragMX || input.dragMY) {
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const up = new THREE.Vector3(0, 1, 0);
      const k = 0.012 * Math.max(4, this.position.y * 0.1);
      this.position.addScaledVector(right, -input.dragMX * k).addScaledVector(up, input.dragMY * k);
    }
    // dolly / zoom
    if (input.wheel) this.position.addScaledVector(this.forward(this.tmp), -input.wheel * 2.2);
    // fly
    const mv = input.moveVector();
    const fast = input.shift || input.touch.sprint ? 2.4 : 1;
    const f = this.forward(this.tmp.set(0, 0, 0));
    const flat = new THREE.Vector3(f.x, 0, f.z).normalize();
    const right = new THREE.Vector3(-flat.z, 0, flat.x);
    const v = new THREE.Vector3().addScaledVector(flat, mv.y).addScaledVector(right, mv.x);
    if (input.keyDown('KeyE') || input.keyDown('Space') || input.touch.jump) v.y += 1;
    if (input.keyDown('KeyQ') || (input.keyDown('ShiftLeft') && input.keyDown('ControlLeft')) || input.touch.crouch) v.y -= 1;
    if (v.lengthSq() > 0) this.position.addScaledVector(v.normalize(), this.speed * fast * dt);
    this.position.y = THREE.MathUtils.clamp(this.position.y, 2, 180);
  }

  apply(camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
