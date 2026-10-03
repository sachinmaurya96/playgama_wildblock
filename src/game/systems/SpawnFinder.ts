import { SEA_LEVEL } from '../world/constants';
import type { TerrainSampler } from '../world/TerrainSampler';

/**
 * Finds a friendly starting spot: meadow or forest edge on dry, gentle ground,
 * ideally with a river or lake in view. Never underwater, in a canyon or on a cliff.
 */
export function findSpawn(sampler: TerrainSampler): { x: number; z: number; y: number } {
  let best: { x: number; z: number; y: number; score: number } | null = null;
  for (let ring = 0; ring < 40 && (!best || best.score < 7); ring++) {
    const r = ring * 12;
    const steps = Math.max(1, ring * 6);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      const c = sampler.sample(x, z);
      if (c.waterLevel > 0 || c.height <= SEA_LEVEL + 1 || c.height > SEA_LEVEL + 30) continue;
      if (c.biome !== 0 && c.biome !== 1) continue;
      // flatness
      let maxDiff = 0;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3]]) maxDiff = Math.max(maxDiff, Math.abs(sampler.sample(x + dx, z + dz).height - c.height));
      if (maxDiff > 2) continue;
      let score = 4 - maxDiff;
      if (c.biome === 0) score += 1;
      // water nearby?
      let waterNear = false;
      for (let k = 0; k < 12 && !waterNear; k++) {
        const wa = (k / 12) * Math.PI * 2;
        for (const d of [14, 26, 40]) {
          const w = sampler.sample(x + Math.round(Math.cos(wa) * d), z + Math.round(Math.sin(wa) * d));
          if (w.waterLevel > 0) {
            waterNear = true;
            break;
          }
        }
      }
      if (waterNear) score += 3;
      score -= ring * 0.02;
      if (!best || score > best.score) best = { x, z, y: c.height + 1, score };
    }
  }
  if (!best) {
    const c = sampler.sample(0, 0);
    return { x: 0, z: 0, y: Math.max(c.height, c.waterLevel) + 2 };
  }
  return { x: best.x, z: best.z, y: best.y };
}
