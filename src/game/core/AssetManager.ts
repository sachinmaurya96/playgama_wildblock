import * as THREE from 'three';
import { ITEM_DEFS, itemDef } from '../../data/items';
import { blockId, SHAPE } from '../world/BlockRegistry';
import { blockObject } from '../rendering/BlockGeometry';
import { drawIcon } from '../rendering/IconPainter';
import { createAtlasTexture, createTerrainMaterials, createWorldUniforms, type TerrainMaterials, type WorldUniforms } from '../rendering/TerrainMaterials';
import { itemIconUrls as icons } from './iconUrls';
export { getIcon } from './iconUrls';

/**
 * Owns generated GPU assets: the block texture array, shared terrain materials
 * and all item icons. Everything is procedurally generated at load time, so
 * there are no image downloads that could fail. If a GLB/texture pipeline is
 * added later, load files here and fall back to the procedural versions.
 */
const iconCanvases = new Map<string, HTMLCanvasElement>();
const spriteTextures = new Map<string, THREE.CanvasTexture>();
let iconsReady = false;

export function iconsGenerated(): boolean {
  return iconsReady;
}

export class AssetManager {
  readonly uniforms: WorldUniforms;
  readonly atlas: THREE.DataArrayTexture;
  /** Average colour per tile (particles, map). */
  readonly tileColors: [number, number, number][];
  readonly materials: TerrainMaterials;

  constructor() {
    this.uniforms = createWorldUniforms();
    const { texture, averages } = createAtlasTexture();
    this.atlas = texture;
    this.tileColors = averages;
    this.uniforms.uAtlas.value = texture;
    this.materials = createTerrainMaterials(this.uniforms);
  }

  /** Render/paint every item icon. Yields between batches so the loader can animate. */
  async generateIcons(renderer: THREE.WebGLRenderer, onProgress?: (f: number) => void): Promise<void> {
    if (iconsReady) return;
    const size = 96;
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 10);
    cam.position.set(2.2, 1.8, 2.2);
    cam.lookAt(0, -0.02, 0);
    const scene = new THREE.Scene();
    const pixels = new Uint8Array(size * size * 4);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    // friendly studio lighting for icons
    const u = this.uniforms;
    const saved = {
      sun: u.uSunDir.value.clone(), sunC: u.uSunColor.value.clone(), sky: u.uSkyAmbient.value.clone(), ground: u.uGroundAmbient.value.clone(),
      fogN: u.uFogNear.value, fogF: u.uFogFar.value,
    };
    u.uSunDir.value.set(0.5, 0.8, 0.3).normalize();
    u.uSunColor.value.setRGB(0.9, 0.86, 0.78);
    u.uSkyAmbient.value.setRGB(0.75, 0.78, 0.85);
    u.uGroundAmbient.value.setRGB(0.5, 0.45, 0.42);
    u.uFogNear.value = 1000;
    u.uFogFar.value = 2000;

    renderer.setClearColor(0x000000, 0);
    const list = ITEM_DEFS;
    let i = 0;
    for (const def of list) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      if ('block' in def.icon) {
        const id = blockId(def.icon.block);
        const mesh = blockObject(id, def.icon.meta ?? 0, this.materials);
        const isFlat = SHAPE[id] === 2;
        if (isFlat) {
          mesh.rotation.y = Math.PI / 4;
          cam.position.set(0.001, 0.2, 3);
        } else cam.position.set(2.2, 1.8, 2.2);
        cam.lookAt(0, -0.02, 0);
        scene.add(mesh);
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
        scene.remove(mesh);
        const img = new ImageData(size, size);
        for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        const tmp = document.createElement('canvas');
        tmp.width = tmp.height = size;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        ctx.imageSmoothingQuality = 'high';
        // soft drop shadow
        ctx.shadowColor = 'rgba(30,20,10,0.35)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 2;
        ctx.drawImage(tmp, 0, 0, 64, 64);
      } else {
        drawIcon(ctx, def.icon);
      }
      iconCanvases.set(def.key, canvas);
      icons.set(def.key, canvas.toDataURL());
      if (++i % 12 === 0) {
        onProgress?.(i / list.length);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    u.uSunDir.value.copy(saved.sun);
    u.uSunColor.value.copy(saved.sunC);
    u.uSkyAmbient.value.copy(saved.sky);
    u.uGroundAmbient.value.copy(saved.ground);
    u.uFogNear.value = saved.fogN;
    u.uFogFar.value = saved.fogF;
    iconsReady = true;
    onProgress?.(1);
  }

  /** Billboard texture for dropped non-block items. */
  spriteTexture(item: string): THREE.CanvasTexture {
    let t = spriteTextures.get(item);
    if (!t) {
      let canvas = iconCanvases.get(item);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const def = itemDef(item);
        if (!('block' in def.icon)) drawIcon(canvas.getContext('2d')!, def.icon);
      }
      t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      spriteTextures.set(item, t);
    }
    return t;
  }

  dispose(): void {
    this.atlas.dispose();
    this.materials.solid.dispose();
    this.materials.cutout.dispose();
    this.materials.glass.dispose();
    this.materials.water.dispose();
    for (const t of spriteTextures.values()) t.dispose();
    spriteTextures.clear();
  }
}
