import { lazy, Suspense, useEffect, useRef } from 'react';
import { audio } from '../game/core/audio';
import { gameRegistry } from '../game/registry';
import { platform } from '../platform';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { MainMenu } from '../ui/MainMenu/MainMenu';
import { NewWorldScreen } from '../ui/MainMenu/NewWorldScreen';
import { NewBuildHomeScreen } from '../ui/MainMenu/NewBuildHomeScreen';
import { WorldSelect } from '../ui/MainMenu/WorldSelect';
import { HowToPlay } from '../ui/MainMenu/HowToPlay';
import { Credits } from '../ui/MainMenu/Credits';
import { SettingsScreen } from '../ui/Settings/SettingsScreen';
import { LoadingScreen } from '../ui/Loading/LoadingScreen';
import { Toasts } from '../ui/HUD/Toasts';
import { FatalScreen } from './ErrorBoundary';
import { RotateHint } from '../ui/Touch/RotateHint';
import { inviteCodeFromUrl, PvpScreen } from '../ui/MainMenu/PvpScreen';
import { pvpNet } from '../net/pvpNet';
import { dmInviteFromUrl, dmNet } from '../net/deathmatchNet';
import { DeathmatchScreen } from '../ui/Deathmatch/DeathmatchScreen';
import { voiceService } from '../net/voice';
import { lifecycle } from '../platform/lifecycle';
import { getAds } from '../platform/playgama';

// The 3D engine (three.js + R3F) loads only when a world starts: menus appear instantly.
const GameView = lazy(() => import('./GameView'));

export function App() {
  const screen = useGameStore((s) => s.screen);
  const fatal = useGameStore((s) => s.fatalError);
  const uiScale = useSettingsStore((s) => s.accessibility.uiScale);
  const adOpportunity = useRef(false);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    if (useGameStore.getState().screen === 'boot') useGameStore.getState().setScreen(dmInviteFromUrl() ? 'deathmatch' : inviteCodeFromUrl() ? 'pvp' : 'menu');
    // unlock audio on the first interaction anywhere
    const unlock = () => {
      if (!lifecycle.audioEnabled) return;
      audio.init();
      audio.applyVolumes(useSettingsStore.getState().audio);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('touchend', unlock);
    window.addEventListener('pointerup', unlock);
    window.addEventListener('click', unlock);
    let interrupted = false;
    const syncLifecycle = () => {
      const g = gameRegistry.current;
      audio.setAllowed(lifecycle.audioEnabled);
      if (!lifecycle.audioEnabled) {
        voiceService.current?.suspendAudio();
      } else {
        voiceService.current?.resumeAudio();
      }
      if (lifecycle.interrupted && g && useGameStore.getState().screen === 'playing') {
        g.releasePointer();
        g.input.clearHeld();
        g.input.endFrame();
        if (!interrupted && !g.pvp && !g.dm) void g.saveNow('hidden');
      }
      interrupted = lifecycle.interrupted;
    };
    const removeLifecycle = lifecycle.subscribe(syncLifecycle);
    const syncGame = () => {
      const gs = useGameStore.getState();
      lifecycle.set('loading', gs.screen === 'loading');
      const solo = gs.world?.mode !== 'pvp' && gs.world?.mode !== 'deathmatch' && !gameRegistry.current?.pvp;
      lifecycle.set('user', solo && gs.screen === 'playing' && ['pause', 'settings', 'death', 'sleep'].includes(gs.overlay ?? ''));
    };
    const removeGame = useGameStore.subscribe((s, previous) => {
      syncGame();
      // The match/world has ended locally. Never request an ad inside a live match.
      if (previous.screen === 'playing' && s.screen === 'menu') adOpportunity.current = true;
    });
    const removeSettings = useSettingsStore.subscribe((s) => {
      lifecycle.setAudio(lifecycle.platformAudio, s.audio.master > 0);
      audio.applyVolumes(s.audio);
    });
    syncLifecycle(); syncGame();
    const beforeUnload = () => {
      pvpNet.current?.close(); // tell the other players right away
      dmNet.current?.close();
      // Checkpoints happen during play and on visibility changes; unload is not a save guarantee.
    };
    window.addEventListener('pagehide', beforeUnload);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchend', unlock);
      window.removeEventListener('pointerup', unlock);
      window.removeEventListener('click', unlock);
      window.removeEventListener('pagehide', beforeUnload);
      removeLifecycle(); removeGame(); removeSettings();
    };
  }, []);

  useEffect(() => {
    // Passive unmount cleanup has disposed the world/network before this menu effect.
    if (screen === 'menu' && adOpportunity.current) {
      adOpportunity.current = false;
      void getAds()?.interstitial();
    }
  }, [screen]);

  useEffect(() => {
    if (screen === 'boot' || screen === 'loading' || screen === 'playing' || fatal) return;
    // Confirm an actual interactive menu was committed and got a paint opportunity.
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      if (document.querySelector('.app button:not(:disabled)')) platform.gameReady();
    }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [screen, fatal]);

  if (fatal) return <FatalScreen message={fatal} />;

  const inGame = screen === 'loading' || screen === 'playing';
  return (
    <div className="app">
      {inGame && (
        <Suspense fallback={<LoadingScreen />}>
          <GameView />
        </Suspense>
      )}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'menu' && <MainMenu />}
      {screen === 'newWorld' && <NewWorldScreen />}
      {screen === 'newBuild' && <NewBuildHomeScreen />}
      {screen === 'worlds' && <WorldSelect />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'howto' && <HowToPlay />}
      {screen === 'credits' && <Credits />}
      {screen === 'pvp' && <PvpScreen />}
      {screen === 'joinFriends' && <PvpScreen initialTab="join" />}
      {screen === 'deathmatch' && <DeathmatchScreen />}
      {!inGame && <Toasts />}
      <RotateHint />
    </div>
  );
}
