import { generateChunk } from '../world/ChunkGenerator';
import { meshChunk } from '../world/ChunkMesher';
import { TerrainSampler } from '../world/TerrainSampler';
import { generatePlotChunk, PlotSampler } from '../world/PlotGenerator';
import { cityBlueprint } from '../deathmatch/DeathmatchMap';
import type { GenRequest, MeshRequest, WorkerRequest, WorkerResponse } from './protocol';

type JobInput = Omit<GenRequest, 'id'> | Omit<MeshRequest, 'id'>;

interface Job {
  id: number;
  req: WorkerRequest;
  transfer: Transferable[];
  priority: () => number;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  cancelled: boolean;
}

/**
 * Prioritised job queue over N module workers. Jobs are re-prioritised at
 * dispatch time (nearest / in-view chunks first). If workers are unavailable
 * (blocked by CSP, very old browser) jobs run on the main thread in small
 * slices so the game still works, just with less smooth streaming.
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private busy: (Job | null)[] = [];
  private queue: Job[] = [];
  private nextId = 1;
  private fallback = false;
  private fallbackSampler: TerrainSampler | null = null;
  private fallbackPlot: PlotSampler | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  readonly size: number;

  constructor(size?: number) {
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.size = Math.max(1, Math.min(size ?? hc - 1, 6));
    try {
      for (let i = 0; i < this.size; i++) {
        const w = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<WorkerResponse>) => this.onResult(w, e.data);
        w.onerror = (e) => {
          console.error('[WorkerPool] worker error', e.message);
          e.preventDefault();
          this.failWorker(w);
        };
        this.workers.push(w);
        this.busy.push(null);
      }
    } catch (e) {
      console.warn('[WorkerPool] Web Workers unavailable, generating on the main thread.', e);
      this.enableFallback();
    }
  }

  get pending(): number {
    return this.queue.length + this.busy.filter(Boolean).length;
  }

  get usingFallback(): boolean {
    return this.fallback;
  }

  run<T>(req: JobInput, transfer: Transferable[], priority: () => number): { promise: Promise<T>; cancel: () => void } {
    if (this.disposed) return { promise: Promise.reject(new Error('disposed')), cancel: () => {} };
    const id = this.nextId++;
    let job!: Job;
    const promise = new Promise<T>((resolve, reject) => {
      job = { id, req: { ...req, id } as WorkerRequest, transfer, priority, resolve: resolve as (v: unknown) => void, reject, cancelled: false };
    });
    this.queue.push(job);
    this.pump();
    return {
      promise,
      cancel: () => {
        job.cancelled = true;
      },
    };
  }

  /** Dispatch queued jobs to idle workers (call once per frame too, so priorities stay fresh). */
  pump(): void {
    if (this.disposed) return;
    if (this.fallback) {
      this.scheduleFallback();
      return;
    }
    for (let i = 0; i < this.workers.length; i++) {
      if (this.busy[i]) continue;
      const job = this.takeBest();
      if (!job) return;
      this.busy[i] = job;
      try {
        this.workers[i].postMessage(job.req, job.transfer);
      } catch (e) {
        this.busy[i] = null;
        job.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  private takeBest(): Job | null {
    let best = -1;
    let bestP = Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      const j = this.queue[i];
      if (j.cancelled) {
        this.queue.splice(i, 1);
        j.reject(new Error('cancelled'));
        i--;
        continue;
      }
      const p = j.priority();
      if (p < bestP) {
        bestP = p;
        best = i;
      }
    }
    if (best < 0) return null;
    return this.queue.splice(best, 1)[0];
  }

  private onResult(worker: Worker, msg: WorkerResponse) {
    const i = this.workers.indexOf(worker);
    if (i < 0 || this.disposed) return;
    const job = this.busy[i];
    if (!job || job.id !== msg.id) return;
    this.busy[i] = null;
    if (job.cancelled) job.reject(new Error('cancelled'));
    else if (msg.ok) job.resolve(msg.result);
    else job.reject(new Error(msg.error ?? 'worker failed'));
    this.pump();
  }

  private failWorker(worker: Worker) {
    const i = this.workers.indexOf(worker);
    if (i < 0 || this.disposed) return;
    const job = this.busy[i];
    this.busy[i] = null;
    // Mesh inputs were transferred and are detached here. The caller must
    // rebuild them, rather than posting detached buffers to another worker.
    if (job) job.reject(new Error('worker failed'));
    // If every worker dies (e.g. module workers unsupported), switch to fallback.
    this.workers[i].terminate();
    this.workers.splice(i, 1);
    this.busy.splice(i, 1);
    if (this.workers.length === 0) this.enableFallback();
    else this.pump();
  }

  private enableFallback() {
    // A constructor can fail after some workers have already started.
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.busy = [];
    this.fallback = true;
    this.scheduleFallback();
  }

  private scheduleFallback() {
    if (this.fallbackTimer || this.disposed) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      const start = performance.now();
      while (performance.now() - start < 8) {
        const job = this.takeBest();
        if (!job) return;
        try {
          const r = job.req;
          if (r.type === 'gen' && r.city) job.resolve(cityBlueprint(r.seed).generateChunk(r.cx, r.cz));
          else if (r.type === 'gen' && r.plot) {
            if (!this.fallbackPlot || this.fallbackPlot.seed !== r.seed >>> 0 || this.fallbackPlot.plot !== r.plot) this.fallbackPlot = new PlotSampler(r.seed, r.plot);
            job.resolve(generatePlotChunk(r.cx, r.cz, this.fallbackPlot));
          } else if (r.type === 'gen') {
            if (!this.fallbackSampler || this.fallbackSampler.seed !== r.seed >>> 0 || this.fallbackSampler.caveVersion !== (r.caves ?? 1)) this.fallbackSampler = new TerrainSampler(r.seed, r.caves ?? 1);
            job.resolve(generateChunk(r.cx, r.cz, this.fallbackSampler));
          } else {
            job.resolve(meshChunk({ blocks: r.blocks, meta: r.meta, tints: r.tints }));
          }
        } catch (e) {
          job.reject(e as Error);
        }
      }
      if (this.queue.length) this.scheduleFallback();
    }, 0);
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    for (const j of this.queue) j.reject(new Error('disposed'));
    for (const j of this.busy) j?.reject(new Error('disposed'));
    this.queue = [];
    this.workers = [];
    this.busy = [];
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
  }
}
