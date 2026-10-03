/**
 * Mobile / tablet helpers: touch detection, landscape lock, and guards that
 * stop the browser from zooming or opening callouts while you play.
 *
 * Landscape: Android Chrome/Edge/Samsung Internet can truly lock the
 * orientation, but only in fullscreen and only from a user gesture — so we
 * try fullscreen + `screen.orientation.lock('landscape')` on taps. iOS Safari
 * has no orientation lock at all; there a "rotate your device" card covers the
 * game while the phone is held upright (see ui/Touch/RotateHint.tsx).
 */

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  // iPads (incl. "desktop website" mode, which pretends to be a Mac) have touch points and no pointer lock
  const noPointerLock = typeof document !== 'undefined' && !('requestPointerLock' in document.documentElement);
  return mm('(pointer: coarse)') || (mm('(any-pointer: coarse)') && !mm('(pointer: fine)')) || ((navigator.maxTouchPoints ?? 0) > 1 && (noPointerLock || !mm('(pointer: fine)')));
}

/** Touch controls on? (Settings → Controls → Touch: auto / on / off.) Decided once, up front — never by render order. */
export function touchEnabled(mode: 'auto' | 'on' | 'off'): boolean {
  return mode === 'on' || (mode === 'auto' && isTouchDevice());
}

export function isPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  const o = (screen.orientation as ScreenOrientation | undefined)?.type;
  if (o) return o.startsWith('portrait');
  return window.innerHeight > window.innerWidth;
}

let lockInFlight = false;

/** Best-effort: go fullscreen and lock to landscape. Must be called from a user gesture. */
export async function requestLandscape(): Promise<boolean> {
  if (!isTouchDevice() || lockInFlight) return false;
  lockInFlight = true;
  try {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
      try {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        else await el.webkitRequestFullscreen?.();
      } catch {
        /* iframes without allowfullscreen, iOS Safari… */
      }
    }
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (so?.lock) {
      try {
        await so.lock('landscape');
        return true;
      } catch {
        /* not supported (iOS) or not fullscreen */
      }
    }
    return false;
  } finally {
    lockInFlight = false;
  }
}

let installed = false;

/**
 * Global guards against browser gestures that fight the game:
 * double-tap zoom, pinch zoom (incl. iOS `gesture*` events), long-press
 * callouts / context menus and text selection. Inputs keep working normally.
 */
export function installTouchGuards(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const isField = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  // iOS pinch-zoom
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  // multi-finger zoom on browsers that ignore touch-action / user-scalable
  document.addEventListener(
    'touchmove',
    (e) => {
      const te = e as TouchEvent & { scale?: number };
      if ((te.scale !== undefined && te.scale !== 1) || (te.touches.length > 1 && !isGameSurface(e.target))) e.preventDefault();
    },
    { passive: false },
  );
  // double-tap zoom: swallow the second tap of a quick double tap
  let lastTap = 0;
  let lastX = 0, lastY = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      // controls handle their own taps (and CSS touch-action already stops zoom on them) —
      // swallowing a second quick tap there would eat real taps, e.g. tapping a catalog tile twice
      if (isField(e.target) || (e.target as HTMLElement | null)?.closest?.('button, a, label, select, [role=button], [role=tab], .slot, .cat-tile, .seg-btn, .swatch')) return;
      const t = e.changedTouches[0];
      const now = performance.now();
      const near = t ? Math.hypot(t.clientX - lastX, t.clientY - lastY) < 40 : true;
      if (now - lastTap < 320 && near && e.touches.length === 0) e.preventDefault();
      lastTap = now;
      if (t) {
        lastX = t.clientX;
        lastY = t.clientY;
      }
    },
    { passive: false },
  );
  document.addEventListener('dblclick', (e) => {
    if (!isField(e.target)) e.preventDefault();
  });
  // long-press callout / context menu (holding the break button!)
  document.addEventListener('contextmenu', (e) => {
    if (!isField(e.target)) e.preventDefault();
  });
  document.addEventListener('selectstart', (e) => {
    if (!isField(e.target)) e.preventDefault();
  });
}

/** Two-finger look + joystick on the game layer is legitimate multi-touch. */
function isGameSurface(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.closest?.('.touch-layer, .canvas-wrap');
}
