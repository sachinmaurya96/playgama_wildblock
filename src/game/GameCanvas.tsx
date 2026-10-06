import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { LoadedWorld } from '../persistence/SaveManager';
import { platform } from '../platform';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { Game } from './Game';
import { effectivePixelRatio } from './core/graphics';

/**
 * React Three Fiber hosts the WebGL canvas, render loop and resize handling.
 * The voxel world itself is rendered by engine classes (chunk BufferGeometry),
 * never as React components — React only bridges the frame loop.
 */
export function GameCanvas({ launch }: { launch: LoadedWorld }) {
  const g = useSettingsStore((s) => s.graphics);
  const dpr = effectivePixelRatio(g, typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  return (
    <Canvas
      flat
      dpr={dpr}
      gl={{ antialias: g.preset !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false }}
      camera={{ fov: g.fov, near: 0.08, far: 420, position: [0, 80, 0] }}
      onCreated={({ gl }) => {
        gl.setClearColor('#1d2a22');
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <GameBridge launch={launch} />
    </Canvas>
  );
}

function GameBridge({ launch }: { launch: LoadedWorld }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gameRef = useRef<Game | null>(null);

  useEffect(() => {
    let cancelled = false;
    let game: Game;
    try {
      game = new Game({ renderer: gl, scene, camera, meta: launch.meta, state: launch.state, mods: launch.mods });
    } catch (e) {
      console.error(e);
      useGameStore.getState().fail(`Could not start the game engine: ${(e as Error).message}`);
      return;
    }
    gameRef.current = game;
    game.input.attach(gl.domElement);
    game
      .start(launch.state, (p, stage) => useGameStore.getState().setLoading(p, stage))
      .then(() => {
        if (cancelled) return;
        useGameStore.getState().setScreen('playing');
        platform.gameReady();
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) useGameStore.getState().fail(`World failed to load: ${(e as Error).message}`);
      });
    return () => {
      cancelled = true;
      gameRef.current = null;
      game.dispose();
    };
  }, [gl, scene, camera, launch]);

  // priority 1 = we render manually (world pass + first-person hand pass)
  useFrame((_, delta) => {
    const g = gameRef.current;
    if (!g) return;
    try {
      g.update(delta);
      g.render();
    } catch (e) {
      console.error('[WildBlocks] frame error', e);
    }
  }, 1);

  return null;
}
