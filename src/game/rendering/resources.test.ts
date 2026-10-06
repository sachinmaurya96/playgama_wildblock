import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CombatFX } from './CombatFX';
import { FirstPersonViewModel } from './FirstPersonViewModel';
import type { AssetManager } from '../core/AssetManager';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('rendering resource ownership', () => {
  it('releases a held preview plane without disposing the shared texture', () => {
    const model = new FirstPersonViewModel({} as AssetManager);
    const texture = new THREE.Texture();
    const textureDispose = vi.spyOn(texture, 'dispose');
    model.setHeld({ key: 'preview', texture });
    let plane!: THREE.Mesh;
    model.scene.traverse((o) => { if (o.userData.ownGeometry) plane = o as THREE.Mesh; });
    const geometryDispose = vi.spyOn(plane.geometry, 'dispose');
    const materialDispose = vi.spyOn(plane.material as THREE.Material, 'dispose');
    model.dispose();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).not.toHaveBeenCalled();
    expect(model.scene.children).toHaveLength(0);
  });

  it('evicts only idle combat textures and releases active ones on cleanup', () => {
    const ctx = { strokeText: vi.fn(), fillText: vi.fn() };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
    const fx = new CombatFX();
    // Fill the cache with expired entries, then reactivate the oldest entry.
    for (let i = 0; i < 160; i++) { fx.pop(String(i), 0, 0, 0); fx.update(1); }
    fx.pop('0', 0, 0, 0);
    const active = fx.group.children[0] as THREE.Sprite;
    const textureDispose = vi.spyOn(active.material.map!, 'dispose');
    fx.pop('new', 0, 0, 0);
    expect(textureDispose).not.toHaveBeenCalled();
    expect(fx.group.children).toHaveLength(2);
    fx.clear();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(fx.group.children).toHaveLength(0);
    // Reopening starts with fresh resources, without double-disposing old ones.
    fx.pop('0', 0, 0, 0);
    expect(textureDispose).toHaveBeenCalledOnce();
    fx.clear();
  });
});
