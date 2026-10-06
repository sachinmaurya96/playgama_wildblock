import { describe, expect, it } from 'vitest';
import { defaultSettings, PRESETS } from '../../stores/settingsStore';
import { effectivePixelRatio, nextQualityReduction } from './graphics';

describe('graphics budgets', () => {
  it('uses the same pixel ratio limit for initial canvas and live updates', () => {
    expect(effectivePixelRatio({ maxPixelRatio: 1.75, resolutionScale: 1 }, 3)).toBe(1.75);
    expect(effectivePixelRatio({ maxPixelRatio: 1, resolutionScale: 0.5 }, 3)).toBe(0.5);
  });
  it('trims dense touch displays before reducing view distance', () => {
    const g = { ...defaultSettings().graphics, maxPixelRatio: 1.75 };
    expect(nextQualityReduction(g, true, 3)).toEqual({ maxPixelRatio: 1.5 });
    expect(nextQualityReduction(g, true, 1)).toEqual({ renderDistance: g.renderDistance - 1 });
  });
  it.each([0.51, 0.55, 0.6, 0.7, 0.75, 1])('keeps resolution %s within the allowed slider range', (resolutionScale) => {
    const g = { ...defaultSettings().graphics, renderDistance: 3, resolutionScale };
    const patch = nextQualityReduction(g, false, 1)!;
    expect(patch.resolutionScale).toBeGreaterThanOrEqual(0.5);
    expect(patch.resolutionScale).toBeLessThan(resolutionScale);
  });
  it('can reach a lighter graphics profile in every mode without changing game settings', () => {
    let g = { ...defaultSettings().graphics, ...PRESETS.high };
    for (let i = 0; i < 30; i++) {
      const patch = nextQualityReduction(g, false, 1);
      if (!patch) break;
      g = { ...g, ...patch };
    }
    expect(g).toMatchObject({ renderDistance: 3, resolutionScale: 0.5, shadows: false, particles: 'low', clouds: false });
    expect(nextQualityReduction(g, false, 1)).toBeNull();
  });
});
