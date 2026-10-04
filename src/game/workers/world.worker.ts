/// <reference lib="webworker" />
import { generateChunk } from '../world/ChunkGenerator';
import { meshChunk, meshTransferables } from '../world/ChunkMesher';
import { TerrainSampler } from '../world/TerrainSampler';
import { generatePlotChunk, PlotSampler } from '../world/PlotGenerator';
import type { WorkerRequest } from './protocol';
import { cityBlueprint } from '../deathmatch/DeathmatchMap';

/**
 * Terrain generation + chunk meshing worker. Several of these run in a pool
 * (see WorkerPool) so the main thread never freezes while the world streams in.
 */
let sampler: TerrainSampler | null = null;
let plotSampler: PlotSampler | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'gen') {
      let r;
      if (msg.city) r = cityBlueprint(msg.seed).generateChunk(msg.cx, msg.cz);
      else if (msg.plot) {
        if (!plotSampler || plotSampler.seed !== msg.seed >>> 0 || plotSampler.plot !== msg.plot) plotSampler = new PlotSampler(msg.seed, msg.plot);
        r = generatePlotChunk(msg.cx, msg.cz, plotSampler);
      } else {
        if (!sampler || sampler.seed !== msg.seed >>> 0 || sampler.caveVersion !== (msg.caves ?? 1)) sampler = new TerrainSampler(msg.seed, msg.caves ?? 1);
        r = generateChunk(msg.cx, msg.cz, sampler);
      }
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result: r }, [
        r.blocks.buffer, r.meta.buffer, r.heightmap.buffer, r.biomes.buffer, r.tints.buffer, r.mapColors.buffer,
      ] as ArrayBuffer[]);
    } else {
      const r = meshChunk({ blocks: msg.blocks, meta: msg.meta, tints: msg.tints });
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result: r }, meshTransferables(r));
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: String((err as Error)?.stack ?? err) });
  }
};
