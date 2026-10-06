import type { Settings } from '../../stores/settingsStore';

type Graphics = Settings['graphics'];

/** One calculation for the canvas and live settings updates. */
export function effectivePixelRatio(g: Pick<Graphics, 'maxPixelRatio' | 'resolutionScale'>, devicePixelRatio: number): number {
  return Math.max(0.5, Math.min(devicePixelRatio || 1, g.maxPixelRatio) * g.resolutionScale);
}

/** Reduce one graphics cost at a time; gameplay simulation is unchanged. */
export function nextQualityReduction(g: Graphics, touch: boolean, devicePixelRatio: number): Partial<Graphics> | null {
  if (touch && g.maxPixelRatio > 1.25 && devicePixelRatio > 1.25) {
    return { maxPixelRatio: Math.max(1.25, Math.round((g.maxPixelRatio - 0.25) * 100) / 100) };
  }
  if (g.renderDistance > 3) return { renderDistance: g.renderDistance - 1 };
  if (g.resolutionScale > 0.5) return { resolutionScale: Math.max(0.5, Math.round((g.resolutionScale - 0.15) * 100) / 100) };
  if (g.shadows) return { shadows: false };
  if (g.particles === 'high') return { particles: 'low' };
  if (g.clouds) return { clouds: false };
  return null;
}
