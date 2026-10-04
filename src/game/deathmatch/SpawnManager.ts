import { spawnPoints, type SpawnPoint, type Team } from './DeathmatchMap';
import { traceVoxels, type Vec } from './HitDetection';

/**
 * Safe team respawns: always from the team's own spawn region, scored against
 * nearby enemies, enemy line of sight and other players standing on the point.
 * Never random coordinates — every candidate is a validated spawn point.
 */
export interface Occupant {
  team: Team;
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

export function chooseSpawn(team: Team, others: Occupant[], blockAt: (x: number, y: number, z: number) => number, rnd: () => number = Math.random, exclude?: Set<number>): SpawnPoint & { index: number } {
  const pts = spawnPoints(team);
  let best = 0, bestScore = -Infinity;
  pts.forEach((p, i) => {
    if (exclude?.has(i)) return;
    let score = rnd() * 2; // a little variety between equally good points
    for (const o of others) {
      if (!o.alive) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < 1.5) score -= 1000; // occupied
      if (o.team === team) {
        if (d < 3) score -= 20;
        continue;
      }
      score += Math.min(d, 60) * 0.6;
      if (d < 70) {
        const eye: Vec = [o.x, o.y + 1.5, o.z];
        const dir: Vec = [p.x - o.x, p.y + 1.2 - eye[1], p.z - o.z];
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        const tr = traceVoxels(eye, [dir[0] / len, dir[1] / len, dir[2] / len], len, blockAt);
        if (!tr.hit) score -= 60; // an enemy could shoot you the moment you appear
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return { ...pts[best], index: best };
}
