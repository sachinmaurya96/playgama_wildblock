import { useEffect, useState, useSyncExternalStore } from 'react';
import { App } from '../app/App';
import { initializeGame } from './startup';
import { bridgeStorage } from './storage';
import { messages } from './localization';

export function PlatformGate() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void initializeGame().then(() => { if (active) setState('ready'); }, (e: unknown) => { console.error('[WildBlocks] startup failed', e); if (active) setState('error'); });
    return () => { active = false; };
  }, [attempt]);
  if (state === 'ready') return <><App /><SaveStatus /></>;
  return <div className="modal-backdrop"><div className="panel platform-loading" role={state === 'error' ? 'alert' : 'status'}>
    <h2 className="panel-title">WildBlocks</h2>
    <p>{state === 'error' ? messages.startupFailed : messages.starting}</p>
    {state === 'error' && <button className="btn primary" onClick={() => { setState('loading'); setAttempt((a) => a + 1); }}>{messages.retry}</button>}
  </div></div>;
}
function SaveStatus() {
  const error = useSyncExternalStore(bridgeStorage.subscribe, () => bridgeStorage.error);
  const [busy, setBusy] = useState(false);
  if (!error) return null;
  return <div className="save-error panel" role="alert"><p>{error}</p><button className="btn small" disabled={busy} onClick={async () => {
    setBusy(true); try { await bridgeStorage.flush(); } catch { /* alert stays visible */ } finally { setBusy(false); }
  }}>{busy ? 'Saving…' : 'Retry saving'}</button></div>;
}
