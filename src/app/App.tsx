import { lazy, Suspense, useEffect } from 'react';
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

// The 3D engine (three.js + R3F) loads only when a world starts: menus appear instantly.
const GameView = lazy(() => import('./GameView'));

export function App() {
  const screen = useGameStore((s) => s.screen);
  const fatal = useGameStore((s) => s.fatalError);
  const uiScale = useSettingsStore((s) => s.accessibility.uiScale);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    if (useGameStore.getState().screen === 'boot') useGameStore.getState().setScreen(dmInviteFromUrl() ? 'deathmatch' : inviteCodeFromUrl() ? 'pvp' : 'menu');
    // unlock audio on the first interaction anywhere
    const unlock = () => {
      audio.init();
      audio.applyVolumes(useSettingsStore.getState().audio);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('touchend', unlock);
    window.addEventListener('pointerup', unlock);
    window.addEventListener('click', unlock);
    // host page / tab visibility → pause + save
    platform.onPauseChange((paused) => {
      const g = gameRegistry.current;
      if (paused) {
        audio.suspend();
        voiceService.current?.suspendAudio();
        // PvP keeps running in the background (the match doesn't stop for one player)
        if (g && !g.pvp && !g.dm && useGameStore.getState().screen === 'playing') {
          void g.saveNow('hidden');
          if (useGameStore.getState().overlay === null) g.openOverlay('pause');
        }
      } else {
        audio.resume();
        voiceService.current?.resumeAudio();
      }
    });
    const beforeUnload = () => {
      pvpNet.current?.close(); // tell the other players right away
      dmNet.current?.close();
      void gameRegistry.current?.saveNow('hidden');
    };
    window.addEventListener('pagehide', beforeUnload);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchend', unlock);
      window.removeEventListener('pointerup', unlock);
      window.removeEventListener('click', unlock);
      window.removeEventListener('pagehide', beforeUnload);
    };
  }, []);

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
