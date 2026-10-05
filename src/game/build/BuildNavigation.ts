import * as THREE from 'three';
import type { Game } from '../Game';
import { boxCollides } from '../player/VoxelPhysics';
import { LOT_HALF } from '../world/PlotGenerator';

/** Loads the destination before moving, then checks the whole body against blocks and furniture. */
export class BuildNavigation {
  private pending: { pos: THREE.Vector3; y?: number; started: number; resolve: (why: string | null) => void } | null = null;
  private disposed = false;

  constructor(
    private game: Pick<Game, 'world' | 'player' | 'chunks' | 'audio' | 'notify'>,
    private onTeleport: () => void,
  ) {}

  get target(): THREE.Vector3 | null { return this.pending?.pos ?? null; }

  teleportTo(x: number, z: number, y?: number): Promise<string | null> {
    if (this.disposed) return Promise.resolve('This project is closed.');
    if (this.pending) return Promise.resolve('A teleport is already in progress.');
    if (![x, z].every(Number.isFinite) || x < -LOT_HALF || x >= LOT_HALF || z < -LOT_HALF || z >= LOT_HALF) {
      return Promise.resolve(`Stay inside the lot: X and Z from ${-LOT_HALF} to ${LOT_HALF - 1}.`);
    }
    if (y !== undefined && (!Number.isFinite(y) || y < 2 || y > 120)) return Promise.resolve('Y must be between 2 and 120.');
    return new Promise((resolve) => {
      this.pending = { pos: new THREE.Vector3(Math.floor(x) + 0.5, y ?? 0, Math.floor(z) + 0.5), y, started: performance.now(), resolve };
      this.update();
    });
  }

  update(): void {
    const move = this.pending;
    if (!move) return;
    const { world, player, chunks } = this.game;
    const { x, z } = move.pos;
    if (!chunks.isReady(x, z)) {
      if (performance.now() - move.started > 15000) this.finish('The destination could not load — please try again.');
      return;
    }
    const body = player.body;
    let y = move.y ?? world.standableY(Math.floor(x), Math.floor(z)) + 1.05;
    // Preserve an explicit indoor floor; lift only enough to clear an obstacle.
    while (y <= 120 && boxCollides(world, x - body.halfW, y, z - body.halfW, x + body.halfW, y + body.height, z + body.halfW)) y += 0.25;
    if (y > 120) return this.finish('There is no clear space at that location.');
    player.teleport(x, y, z);
    body.grounded = false;
    this.onTeleport();
    this.game.audio.play('chime');
    this.game.notify(`Teleported to ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}`, '📍');
    this.finish(null);
  }

  private finish(why: string | null): void {
    const move = this.pending;
    this.pending = null;
    move?.resolve(why);
  }

  dispose(): void {
    this.disposed = true;
    this.finish('This project is closed.');
  }
}
