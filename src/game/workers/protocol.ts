import type { PlotType } from '../../persistence/types';

export interface GenRequest {
  id: number;
  type: 'gen';
  seed: number;
  cx: number;
  cz: number;
  /** Cave generation version (2 = big caves & ravines, worlds made with v1.2+). */
  caves?: number;
  /** Build Home plot type (flat construction lot) instead of survival terrain. */
  plot?: PlotType;
}

export interface MeshRequest {
  id: number;
  type: 'mesh';
  blocks: Uint8Array;
  meta: Uint8Array;
  tints: Uint8Array;
}

export type WorkerRequest = GenRequest | MeshRequest;

export interface WorkerResponse<T = unknown> {
  id: number;
  ok: boolean;
  result?: T;
  error?: string;
}
