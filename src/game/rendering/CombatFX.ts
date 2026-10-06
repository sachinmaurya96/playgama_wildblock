import * as THREE from 'three';

/**
 * Combat feedback in the 3D world: floating damage numbers and small health
 * bars above hurt enemies (creatures and PvP opponents). Canvas sprites,
 * pooled and cached so a busy fight costs almost nothing.
 */
interface FloatText {
  sprite: THREE.Sprite;
  life: number;
  vy: number;
  asset: TextAsset;
}

interface Bar {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  frac: number;
  shown: number;
  timer: number;
}

interface TextAsset { material: THREE.SpriteMaterial; users: number }

function textMaterial(cache: Map<string, TextAsset>, text: string, color: string, big: boolean): TextAsset {
  const key = `${text}|${color}|${big}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= 160) {
    for (const [oldKey, asset] of cache) {
      if (asset.users) continue;
      asset.material.map?.dispose();
      asset.material.dispose();
      cache.delete(oldKey);
      break;
    }
  }
  const c = document.createElement('canvas');
  const fs = big ? 52 : 40;
  c.width = 256;
  c.height = 72;
  const g = c.getContext('2d')!;
  g.font = `900 ${fs}px Nunito, 'Trebuchet MS', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(30,18,10,0.9)';
  g.strokeText(text, 128, 38);
  g.fillStyle = color;
  g.fillText(text, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const asset = { material: new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }), users: 0 };
  cache.set(key, asset);
  return asset;
}

export class CombatFX {
  readonly group = new THREE.Group();
  private texts: FloatText[] = [];
  private bars = new Map<string, Bar>();
  private textCache = new Map<string, TextAsset>();

  constructor() {
    this.group.name = 'combat-fx';
    this.group.renderOrder = 10;
  }

  /** Damage number (or a word like "Blocked!") rising from a point. */
  pop(text: string, x: number, y: number, z: number, color = '#ffffff', big = false): void {
    const asset = textMaterial(this.textCache, text, color, big);
    asset.users++;
    const sprite = new THREE.Sprite(asset.material.clone());
    const s = big ? 0.95 : 0.75;
    sprite.scale.set(s * 3.55, s, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 0.4, y + 0.65, z + (Math.random() - 0.5) * 0.4);
    sprite.renderOrder = 11;
    this.group.add(sprite);
    this.texts.push({ sprite, life: 0, vy: 1.3, asset });
    if (this.texts.length > 40) this.drop(this.texts.shift()!);
  }

  /** Show / update a health bar for an entity id. */
  health(id: string, frac: number, x: number, y: number, z: number): void {
    let b = this.bars.get(id);
    if (!b) {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 14;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      sprite.scale.set(0.95, 0.14, 1);
      sprite.renderOrder = 10;
      this.group.add(sprite);
      b = { sprite, canvas, tex, frac: -1, shown: 1, timer: 0 };
      this.bars.set(id, b);
    }
    b.timer = 4;
    b.sprite.position.set(x, y + 0.35, z);
    const f = Math.max(0, Math.min(1, frac));
    if (Math.abs(f - b.frac) > 0.004) {
      b.frac = f;
      this.drawBar(b);
    }
  }

  /** Keep a visible bar glued to its entity (called each frame by the owner). */
  follow(id: string, x: number, y: number, z: number): void {
    const b = this.bars.get(id);
    if (b) b.sprite.position.set(x, y + 0.35, z);
  }

  removeBar(id: string): void {
    const b = this.bars.get(id);
    if (!b) return;
    this.group.remove(b.sprite);
    b.tex.dispose();
    b.sprite.material.dispose();
    this.bars.delete(id);
  }

  private drawBar(b: Bar) {
    const g = b.canvas.getContext('2d')!;
    g.clearRect(0, 0, 96, 14);
    g.fillStyle = 'rgba(25,15,10,0.85)';
    g.fillRect(0, 0, 96, 14);
    const col = b.frac > 0.5 ? '#7fd05a' : b.frac > 0.25 ? '#f0c040' : '#e0503a';
    g.fillStyle = col;
    g.fillRect(2, 2, Math.round(92 * b.frac), 10);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(2, 2, Math.round(92 * b.frac), 3);
    b.tex.needsUpdate = true;
  }

  private drop(t: FloatText) {
    this.group.remove(t.sprite);
    t.sprite.material.dispose();
    t.asset.users--;
  }

  update(dt: number): void {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life += dt;
      t.sprite.position.y += t.vy * dt;
      t.vy = Math.max(0.25, t.vy - dt * 2);
      t.sprite.material.opacity = t.life < 0.6 ? 1 : Math.max(0, 1 - (t.life - 0.6) / 0.4);
      if (t.life >= 1) {
        this.drop(t);
        this.texts.splice(i, 1);
      }
    }
    for (const [id, b] of this.bars) {
      b.timer -= dt;
      b.sprite.material.opacity = Math.min(1, Math.max(0, b.timer));
      if (b.timer <= 0) this.removeBar(id);
    }
  }

  clear(): void {
    for (const t of this.texts) this.drop(t);
    this.texts = [];
    for (const id of [...this.bars.keys()]) this.removeBar(id);
    for (const asset of this.textCache.values()) {
      asset.material.map?.dispose();
      asset.material.dispose();
    }
    this.textCache.clear();
  }
}
