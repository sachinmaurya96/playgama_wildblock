import { useState, useSyncExternalStore } from 'react';
import { useGameStore } from '../stores/gameStore';
import { bridgeStorage, preferences } from './storage';
import { getAds } from './playgama';
import { messages } from './localization';
import { REWARDED_PLACEMENT } from './ads';

export const SCARF_UNLOCK = 'wildblocks.starlight-unlocked';
export function useStarlightUnlocked(): boolean {
  return useSyncExternalStore(preferences.subscribe, () => preferences.getItem(SCARF_UNLOCK) === 'true', () => false);
}
export function ScarfBonus() {
  const unlocked = useStarlightUnlocked();
  const mode = useGameStore((s) => s.world?.mode);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  if (unlocked || mode !== 'survival' || !getAds()?.rewardedAvailable && !busy) return null;
  const claim = async () => {
    const ads = getAds(), worldId = useGameStore.getState().world?.id;
    if (!ads || !worldId || busy) return;
    setBusy(true); setResult('');
    const earned = await ads.rewarded({ token: crypto.randomUUID(), placement: REWARDED_PLACEMENT, worldId, reward: 'starlight' }, async () => {
      // Account-wide cosmetic; idempotent across remounts and duplicate events.
      if (preferences.getItem(SCARF_UNLOCK) !== 'true') preferences.setItem(SCARF_UNLOCK, 'true');
      await bridgeStorage.flush();
      useGameStore.getState().toast(messages.rewardSaved, 'info', '✨');
    });
    setResult(earned ? messages.rewardSaved : messages.rewardFailed);
    setBusy(false);
  };
  return <div><button className="btn small" disabled={busy} onClick={() => void claim()}>{busy ? messages.rewardPending : messages.rewardOffer}</button>
    <small className="muted">Optional cosmetic. You can also earn it through Homestead progress.</small>
    {result && <p role="status">{result}</p>}
  </div>;
}
