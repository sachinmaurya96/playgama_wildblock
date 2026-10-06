import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool } from './WorkerPool';
import type { WorkerRequest } from './protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failAt = -1;
  onmessage: ((e: { data: { id: number; ok: boolean; result: unknown } }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null;
  requests: WorkerRequest[] = [];
  terminate = vi.fn();
  postMessage = vi.fn((req: WorkerRequest, transfer: Transferable[]) => {
    this.requests.push(structuredClone(req, { transfer }));
  });
  constructor() {
    if (FakeWorker.instances.length === FakeWorker.failAt) throw new Error('CSP blocked worker');
    FakeWorker.instances.push(this);
  }
  finish(result: unknown) {
    this.onmessage?.({ data: { id: this.requests.at(-1)!.id, ok: true, result } });
  }
  fail() { this.onerror?.({ message: 'worker crashed', preventDefault() {} }); }
}

const gen = (cx = 0) => ({ type: 'gen' as const, seed: 1, cx, cz: 0 });
let pool: WorkerPool;

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.failAt = -1;
  vi.stubGlobal('Worker', FakeWorker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { pool?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('worker recovery and cancellation', () => {
  it('keeps other workers attached to their own jobs when an earlier worker crashes', async () => {
    pool = new WorkerPool(3);
    const a = pool.run(gen(0), [], () => 0).promise;
    const b = pool.run(gen(1), [], () => 0).promise;
    const c = pool.run(gen(2), [], () => 0).promise;
    const failed = expect(a).rejects.toThrow('worker failed');
    FakeWorker.instances[0].fail();
    FakeWorker.instances[1].finish('second');
    FakeWorker.instances[2].finish('third');
    await failed;
    await expect(b).resolves.toBe('second');
    await expect(c).resolves.toBe('third');
    expect(pool.pending).toBe(0);
    const d = pool.run(gen(3), [], () => 0).promise;
    FakeWorker.instances[1].finish('next');
    await expect(d).resolves.toBe('next');
  });

  it('rejects transferred mesh jobs after a crash instead of retrying detached buffers', async () => {
    pool = new WorkerPool(2);
    const blocks = new Uint8Array(8), meta = new Uint8Array(8), tints = new Uint8Array(9);
    const job = pool.run({ type: 'mesh', blocks, meta, tints }, [blocks.buffer, meta.buffer, tints.buffer], () => 0);
    expect(blocks.byteLength).toBe(0);
    const failed = expect(job.promise).rejects.toThrow('worker failed');
    FakeWorker.instances[0].fail();
    await failed;
    expect(FakeWorker.instances[1].postMessage).not.toHaveBeenCalled();
  });

  it('terminates partially created workers before enabling the fallback', () => {
    vi.useFakeTimers();
    FakeWorker.failAt = 2;
    pool = new WorkerPool(3);
    expect(pool.usingFallback).toBe(true);
    expect(FakeWorker.instances.every((w) => w.terminate.mock.calls.length === 1)).toBe(true);
  });

  it('settles queued and in-flight cancellation without losing the next job', async () => {
    pool = new WorkerPool(1);
    const first = pool.run(gen(0), [], () => 0);
    const cancelled = pool.run(gen(1), [], () => 0);
    const next = pool.run(gen(2), [], () => 0);
    first.cancel(); cancelled.cancel();
    const firstCheck = expect(first.promise).rejects.toThrow('cancelled');
    const queuedCheck = expect(cancelled.promise).rejects.toThrow('cancelled');
    FakeWorker.instances[0].finish('discard');
    FakeWorker.instances[0].finish('keep');
    await Promise.all([firstCheck, queuedCheck]);
    await expect(next.promise).resolves.toBe('keep');
  });

  it('rejects all pending work on disposal and rejects new jobs immediately', async () => {
    pool = new WorkerPool(1);
    const first = pool.run(gen(0), [], () => 0).promise;
    const queued = pool.run(gen(1), [], () => 0).promise;
    const checks = [expect(first).rejects.toThrow('disposed'), expect(queued).rejects.toThrow('disposed')];
    pool.dispose();
    await Promise.all(checks);
    expect(pool.pending).toBe(0);
    await expect(pool.run(gen(), [], () => 0).promise).rejects.toThrow('disposed');
  });

  it('handles synchronous posting errors without stranding the worker', async () => {
    pool = new WorkerPool(1);
    FakeWorker.instances[0].postMessage.mockImplementationOnce(() => { throw new Error('posting failed'); });
    await expect(pool.run(gen(), [], () => 0).promise).rejects.toThrow('posting failed');
    const next = pool.run(gen(), [], () => 0).promise;
    FakeWorker.instances[0].finish('recovered');
    await expect(next).resolves.toBe('recovered');
  });
});
