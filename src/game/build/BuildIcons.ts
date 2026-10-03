import * as THREE from 'three';
import { BUILD_CATALOG, variantOf, type BuildCatalogItem } from '../../data/buildCatalog';
import { objectDef } from '../../data/furniture';
import type { AssetManager } from '../core/AssetManager';
import { blockObject } from '../rendering/BlockGeometry';
import { blockId, SHAPE } from '../world/BlockRegistry';
import { localBounds } from './BuildObjects';
import { objectPreview, type ObjectMaterials } from './ObjectGeometry';

/**
 * Rendered catalog thumbnails (blocks in their default material, furniture in
 * its default colour). Rendered once per session into small data URLs; tools,
 * presets and tree stamps use emoji icons instead.
 */
const icons = new Map<string, string>();
let rendered = false;

export function catalogIcon(id: string): string | undefined {
  return icons.get(id);
}

export function iconsRendered(): boolean {
  return rendered;
}

export async function renderCatalogIcons(renderer: THREE.WebGLRenderer, assets: AssetManager, omats: ObjectMaterials, onProgress?: (f: number) => void): Promise<void> {
  if (rendered) return;
  const size = 80;
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  const scene = new THREE.Scene();
  const pixels = new Uint8Array(size * size * 4);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const u = assets.uniforms;
  const saved = {
    sun: u.uSunDir.value.clone(), sunC: u.uSunColor.value.clone(), sky: u.uSkyAmbient.value.clone(), ground: u.uGroundAmbient.value.clone(),
    fogN: u.uFogNear.value, fogF: u.uFogFar.value,
  };
  u.uSunDir.value.set(0.5, 0.8, 0.3).normalize();
  u.uSunColor.value.setRGB(0.9, 0.86, 0.78);
  u.uSkyAmbient.value.setRGB(0.78, 0.8, 0.86);
  u.uGroundAmbient.value.setRGB(0.52, 0.48, 0.45);
  u.uFogNear.value = 1000;
  u.uFogFar.value = 2000;
  renderer.setClearColor(0x000000, 0);
  const seen = new Map<string, string>();
  const list = BUILD_CATALOG.filter((i) => i.placementType === 'block' || i.placementType === 'object');
  let n = 0;
  try {
    for (const item of list) {
      const key = iconKey(item);
      const cached = seen.get(key);
      if (cached) {
        icons.set(item.id, cached);
        continue;
      }
      const obj = buildIconObject(item, assets, omats);
      if (!obj) continue;
      // frame the object: isometric-ish view, fitted to its bounds
      const box = new THREE.Box3().setFromObject(obj);
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const r = Math.max(0.35, s.length() * 0.52);
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.near = 0.01; cam.far = r * 8 + 10;
      cam.updateProjectionMatrix();
      cam.position.set(c.x + r * 2.2, c.y + r * 1.7, c.z + r * 2.6);
      cam.lookAt(c);
      scene.add(obj);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
      scene.remove(obj);
      disposeTree(obj);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d')!;
      const img = g.createImageData(size, size);
      for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      g.putImageData(img, 0, 0);
      const url = canvas.toDataURL();
      seen.set(key, url);
      icons.set(item.id, url);
      if (++n % 10 === 0) {
        onProgress?.(n / list.length);
        await new Promise((res) => setTimeout(res, 0));
      }
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    u.uSunDir.value.copy(saved.sun);
    u.uSunColor.value.copy(saved.sunC);
    u.uSkyAmbient.value.copy(saved.sky);
    u.uGroundAmbient.value.copy(saved.ground);
    u.uFogNear.value = saved.fogN;
    u.uFogFar.value = saved.fogF;
  }
  rendered = true;
  onProgress?.(1);
}

function iconKey(item: BuildCatalogItem): string {
  const v = variantOf(item);
  return item.placementType === 'block' ? `b:${item.block}:${v?.meta ?? 0}` : `o:${item.object}:${v?.objectVariant ?? ''}`;
}

function buildIconObject(item: BuildCatalogItem, assets: AssetManager, omats: ObjectMaterials): THREE.Object3D | null {
  const v = variantOf(item);
  if (item.placementType === 'block' && item.block) {
    const id = blockId(item.block);
    const meta = item.metaKind === 'rotated' ? ((v?.meta ?? 0) << 2) | 2 : item.metaKind === 'slab' ? (v?.meta ?? 0) : item.metaKind === 'panel_h' ? ((v?.meta ?? 0) << 1) : (v?.meta ?? 0);
    const o = blockObject(id, meta, assets.materials);
    if (SHAPE[id] === 2) o.rotation.y = Math.PI / 4;
    return o;
  }
  if (item.placementType === 'object' && item.object) {
    const def = objectDef(item.object);
    if (!def) return null;
    const g = objectPreview(def, v?.objectVariant ?? 'default', { solid: omats.solid, glass: omats.glass, emissive: omats.emissive });
    // flat wall items: turn a little so the front face reads
    const [a, b] = localBounds(def);
    const group = new THREE.Group();
    g.position.set(-(a[0] + b[0]) / 2, 0, -(a[2] + b[2]) / 2);
    group.add(g);
    return group;
  }
  return null;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.userData.ownGeometry) m.geometry.dispose();
  });
}
