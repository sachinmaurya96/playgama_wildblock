import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { platform } from './platform';
import { installTouchGuards, isTouchDevice } from './app/mobile';
import { useGameStore } from './stores/gameStore';
import './styles/global.css';
import './styles/ui.css';
import './styles/build.css';
import './styles/deathmatch.css';

// Last-resort error reporting: never leave the player staring at a blank screen.
window.addEventListener('error', (e) => {
  console.error('[WildBlocks] uncaught error', e.error ?? e.message);
  if (e.message?.includes('WebGL')) useGameStore.getState().fail(`Graphics error: ${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[WildBlocks] unhandled promise rejection', e.reason);
});

void platform.init();

// Phones & tablets: no double-tap / pinch zoom, no long-press callouts, landscape UI.
installTouchGuards();
if (isTouchDevice()) document.documentElement.classList.add('touch-ui');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
