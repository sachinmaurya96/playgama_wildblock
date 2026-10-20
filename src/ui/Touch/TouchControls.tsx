import { useEffect, useRef } from 'react';
import { lifecycle } from '../../platform/lifecycle';
import { touchEnabled } from '../../app/mobile';
import { gameRegistry } from '../../game/registry';
import { useBuildStore } from '../../stores/buildStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { hasItem, itemDef } from '../../data/items';
import { useGameStore } from '../../stores/gameStore';
import { usePlayerStore } from '../../stores/playerStore';
import { usePvpStore } from '../../stores/pvpStore';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { useSettingsStore } from '../../stores/settingsStore';

/** Hold this long without moving on the open screen = break / keep placing. */
const HOLD_MS = 260;
/** Finger travel that turns a tap into a look-drag. */
const TAP_SLOP = 12;

type Held = 'jump' | 'breakHeld' | 'placeHeld' | 'crouch';

/**
 * Mobile & tablet controls.
 *
 * Left: a floating virtual joystick (push to the rim to sprint).
 * Right half of the screen: drag to look · quick tap = use / place / attack /
 * open (whatever you aim at) · press & hold = break blocks (Build Home: keep
 * placing / removing). Big buttons sit bottom-right in two tidy rows that never
 * overlap the hotbar, which stays tappable (the HUD is layered above this).
 */
export function TouchControls() {
  const mode = useSettingsStore((s) => s.controls.touch);
  const overlay = useGameStore((s) => s.overlay);
  const buildMode = useGameStore((s) => s.world?.mode === 'build');
  const flying = useBuildStore((s) => s.flying);
  const buildCam = useBuildStore((s) => s.camera === 'build');
  const walkthrough = useBuildStore((s) => s.walkthrough);
  const photo = useBuildStore((s) => s.photo);
  const boating = usePlayerStore((s) => s.boating);
  const pvp = useGameStore((s) => s.world?.mode === 'pvp');
  const dm = useGameStore((s) => s.world?.mode === 'deathmatch');
  const dmAim = useDeathmatchStore((s) => s.aiming);
  const enabled = touchEnabled(mode);
  const heldRanged = useInventoryStore((s) => {
    const st = s.slots[s.selected];
    return !!st && hasItem(st.item) && !!itemDef(st.item).ranged;
  });
  const stick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const stickId = useRef<number | null>(null);
  const look = useRef<{ id: number; x: number; y: number; sx: number; sy: number; moved: boolean; holding: boolean; timer: number } | null>(null);
  const lastJump = useRef(0);
  /** Deathmatch: the finger holding 🔥 also aims — slide it to steer / pull down against recoil. */
  const fireLook = useRef<{ id: number; x: number; y: number } | null>(null);
  /** Which held action each finger on a button controls — released by pointer id, even if the button
   *  under the finger is swapped out mid-press (e.g. ⤒ turning into ⏬ when flight starts). */
  const heldBy = useRef(new Map<number, Held>());

  const input = () => gameRegistry.current?.input;
  const releaseAll = () => {
    const inp = input();
    if (look.current) clearTimeout(look.current.timer);
    look.current = null;
    stickId.current = null;
    if (knob.current) knob.current.style.transform = '';
    if (!inp) return;
    inp.touch.moveX = inp.touch.moveY = 0;
    inp.touch.sprint = inp.touch.jump = inp.touch.crouch = inp.touch.breakHeld = inp.touch.placeHeld = false;
    heldBy.current.clear();
  };

  // release held buttons from the window too: a finger lifted after its button was re-rendered
  useEffect(() => lifecycle.subscribe(() => { if (lifecycle.paused) releaseAll(); }), []);
  // away must never leave "fly up" / "crouch" stuck on
  useEffect(() => {
    const release = (e: PointerEvent) => {
      const key = heldBy.current.get(e.pointerId);
      if (!key) return;
      heldBy.current.delete(e.pointerId);
      const inp = gameRegistry.current?.input;
      if (inp && ![...heldBy.current.values()].includes(key)) inp.touch[key] = false;
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, []);

  useEffect(() => {
    const g = gameRegistry.current;
    if (g) g.input.touch.active = enabled;
    document.documentElement.classList.toggle('touch-ui', enabled);
  }, [enabled]);

  // starting / ending flight swaps ⤒ for ⏫⏬: drop any up/down hold so you never keep rising or sinking
  const verticalMode = buildMode && (flying || buildCam || photo);
  useEffect(() => {
    const inp = gameRegistry.current?.input;
    for (const [id, k] of [...heldBy.current]) if (k === 'jump' || k === 'crouch') heldBy.current.delete(id);
    if (inp) inp.touch.jump = inp.touch.crouch = false;
  }, [verticalMode]);

  // never leave a button "stuck" down when an overlay opens mid-press
  useEffect(() => {
    if (overlay !== null) releaseAll();
  }, [overlay, photo]);

  if (!enabled || overlay) return null;

  const onStick = (e: React.PointerEvent) => {
    const el = stick.current!;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    // small dead zone so a resting thumb doesn't drift
    const dl = Math.hypot(dx, dy);
    const k = dl < 0.12 ? 0 : (dl - 0.12) / 0.88 / (dl || 1);
    knob.current!.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
    const inp = input();
    if (inp) {
      inp.touch.moveX = dx * k;
      inp.touch.moveY = -dy * k;
      inp.touch.sprint = l > 0.96;
    }
  };
  const endStick = () => {
    stickId.current = null;
    if (knob.current) knob.current.style.transform = '';
    const inp = input();
    if (inp) {
      inp.touch.moveX = inp.touch.moveY = 0;
      inp.touch.sprint = false;
    }
  };

  const hold = (key: Held) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* pointer already gone: release still arrives via pointerup / cancel */
      }
      const inp = input();
      if (!inp) return;
      if (key === 'jump' && buildMode && !buildCam && !flying) {
        // double-tap ⤒ toggles flight (like double-tapping Space). The tap that starts flying
        // doesn't also count as "hold up" — you hover in place until you press ⏫.
        const now = performance.now();
        if (now - lastJump.current < 350) {
          lastJump.current = 0;
          inp.touch.jump = false;
          gameRegistry.current?.build?.toggleFly(true);
          return;
        }
        lastJump.current = now;
      }
      heldBy.current.set(e.pointerId, key);
      inp.touch[key] = true;
      if (key === 'placeHeld') inp.touch.placePressed = true;
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      heldBy.current.delete(e.pointerId);
      const inp = input();
      if (inp) inp.touch[key] = false;
    },
    onPointerCancel: (e: React.PointerEvent) => {
      heldBy.current.delete(e.pointerId);
      const inp = input();
      if (inp) inp.touch[key] = false;
    },
  });
  const fireBtn = () => {
    const h = hold('breakHeld');
    const end = (e: React.PointerEvent) => {
      if (fireLook.current?.id === e.pointerId) fireLook.current = null;
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        h.onPointerDown(e);
        fireLook.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const f = fireLook.current;
        if (!f || f.id !== e.pointerId) return;
        e.stopPropagation();
        const inp = input();
        if (inp) {
          inp.lookX += (e.clientX - f.x) * 2.2;
          inp.lookY += (e.clientY - f.y) * 2.2;
        }
        f.x = e.clientX;
        f.y = e.clientY;
      },
      onPointerUp: (e: React.PointerEvent) => {
        end(e);
        h.onPointerUp(e);
      },
      onPointerCancel: (e: React.PointerEvent) => {
        end(e);
        h.onPointerCancel(e);
      },
    };
  };
  const tapBtn = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      fn();
    },
  });
  const interact = () => {
    const inp = input();
    if (inp) inp.touch.interactPressed = true;
  };

  // ---- the open screen: drag = look, tap = use, hold = break / keep placing
  const holdKey: 'breakHeld' | 'placeHeld' = buildMode ? 'placeHeld' : 'breakHeld';
  const onLookDown = (e: React.PointerEvent) => {
    if (look.current || e.clientX < window.innerWidth * 0.3) return;
    const timer = window.setTimeout(() => {
      const l = look.current;
      if (!l || l.moved) return;
      l.holding = true;
      const inp = input();
      if (inp) {
        inp.touch[holdKey] = true;
        if (buildMode) inp.touch.placePressed = true;
      }
    }, HOLD_MS);
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, holding: false, timer };
  };
  const onLookMove = (e: React.PointerEvent) => {
    const l = look.current;
    if (!l || l.id !== e.pointerId) return;
    const inp = input();
    if (inp) {
      const sens = 2.2;
      inp.lookX += (e.clientX - l.x) * sens;
      inp.lookY += (e.clientY - l.y) * sens;
    }
    l.x = e.clientX;
    l.y = e.clientY;
    if (!l.moved && Math.hypot(e.clientX - l.sx, e.clientY - l.sy) > TAP_SLOP) {
      l.moved = true;
      clearTimeout(l.timer);
    }
  };
  const onLookUp = (e: React.PointerEvent) => {
    const l = look.current;
    if (!l || l.id !== e.pointerId) return;
    clearTimeout(l.timer);
    look.current = null;
    const inp = input();
    if (!inp) return;
    if (l.holding) inp.touch[holdKey] = false;
    else if (!l.moved && e.type === 'pointerup') {
      if (buildMode) inp.touch.placePressed = true;
      else inp.touch.tapPressed = true;
    }
  };

  const vertical = buildMode && (flying || buildCam || photo);
  return (
    <div className="touch-layer" onPointerDown={onLookDown} onPointerMove={onLookMove} onPointerUp={onLookUp} onPointerCancel={onLookUp}>
      <div
        className="joystick"
        ref={stick}
        onPointerDown={(e) => {
          e.stopPropagation();
          stickId.current = e.pointerId;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          onStick(e);
        }}
        onPointerMove={(e) => stickId.current === e.pointerId && onStick(e)}
        onPointerUp={(e) => {
          e.stopPropagation();
          endStick();
        }}
        onPointerCancel={endStick}
      >
        <div className="knob" ref={knob} />
      </div>
      {dm ? (
        <div className="touch-buttons dm-touch">
          <button className="tbtn big t-main dm-fire" aria-label="Fire (slide to aim)" {...fireBtn()}>🔥</button>
          <button className="tbtn big t-jump" aria-label="Jump" {...hold('jump')}>⤒</button>
          <button className={`tbtn t-a ${dmAim ? 'on' : ''}`} aria-label="Aim" {...tapBtn(() => { const s = gameRegistry.current?.dm; if (s) s.touchAim = !s.touchAim; })}>🎯</button>
          <button className="tbtn t-b" aria-label="Reload" {...tapBtn(() => gameRegistry.current?.dm?.reload())}>R</button>
          <button className="tbtn t-c" aria-label="Crouch" {...hold('crouch')}>⤓</button>
          <button className="tbtn t-d" aria-label="Switch weapon" {...tapBtn(() => gameRegistry.current?.dm?.cycleWeapon(1))}>⇄</button>
          <button className="tbtn t-e" aria-label="Pick up" {...tapBtn(interact)}>✋</button>
          <button className="tbtn t-f" aria-label="Medkit" {...tapBtn(() => gameRegistry.current?.dm?.heal())}>🩹</button>
        </div>
      ) : buildMode && photo ? (
        <div className="touch-buttons build vertical photo">
          <button key="up" className="tbtn t-corner" aria-label="Camera up" {...hold('jump')}>⏫</button>
          <button key="down" className="tbtn big t-jump" aria-label="Camera down" {...hold('crouch')}>⏬</button>
        </div>
      ) : buildMode ? (
        <div className={`touch-buttons build ${vertical ? 'vertical' : ''}`}>
          {!walkthrough && <button className="tbtn big t-main" aria-label="Place" {...hold('placeHeld')}>🧱</button>}
          {vertical && <button key="up" className="tbtn t-corner" aria-label="Fly up" {...hold('jump')}>⏫</button>}
          {vertical ? (
            <button key="down" className="tbtn big t-jump" aria-label="Fly down" {...hold('crouch')}>⏬</button>
          ) : (
            <button key="jump" className="tbtn big t-jump" aria-label="Jump (double-tap to fly)" {...hold('jump')}>⤒</button>
          )}
          <button className="tbtn t-a" aria-label="Open / use" {...tapBtn(interact)}>✋</button>
          {!walkthrough && <button className="tbtn t-b" aria-label="Rotate" {...tapBtn(() => gameRegistry.current?.build?.rotate())}>⟳</button>}
          {!walkthrough && <button className="tbtn t-c" aria-label="Undo" {...tapBtn(() => gameRegistry.current?.build?.undo())}>↶</button>}
        </div>
      ) : (
        <div className="touch-buttons survival">
          <button className="tbtn big t-main" aria-label="Break / attack" {...hold('breakHeld')}>⛏️</button>
          <button className={`tbtn big t-jump ${boating ? 'boat' : ''}`} aria-label={boating ? 'Leave boat' : 'Jump'} {...hold('jump')}>{boating ? '⛵' : '⤒'}</button>
          <button className="tbtn t-a" aria-label="Interact" {...tapBtn(interact)}>✋</button>
          <button className="tbtn t-b" aria-label="Use / place / shoot" {...hold('placeHeld')}>{heldRanged ? '🏹' : '🧱'}</button>
          <button className="tbtn t-c" aria-label="Crouch" {...hold('crouch')}>⤓</button>
        </div>
      )}
      {dm && (
        <div className="touch-top">
          <button className="tbtn small" aria-label="Scoreboard" {...tapBtn(() => gameRegistry.current?.dm?.toggleScoreboard())}>🏆</button>
          <button className="tbtn small" aria-label="Options" {...tapBtn(() => gameRegistry.current?.setDmOptions(!useDeathmatchStore.getState().optionsOpen))}>⚙️</button>
          <button className="tbtn small" aria-label="Pause" {...tapBtn(() => gameRegistry.current?.openOverlay('pause'))}>⏸</button>
        </div>
      )}
      {!buildMode && !dm && (
        <div className="touch-top">
          <button className="tbtn small" aria-label="Backpack" {...tapBtn(() => gameRegistry.current?.openOverlay('inventory'))}>🎒</button>
          {pvp ? (
            <button className="tbtn small" aria-label="Scoreboard" {...tapBtn(() => usePvpStore.getState().set({ scoreboardOpen: !usePvpStore.getState().scoreboardOpen }))}>🏆</button>
          ) : (
            <button className="tbtn small" aria-label="Journal" {...tapBtn(() => gameRegistry.current?.openOverlay('journal'))}>📔</button>
          )}
          <button className="tbtn small" aria-label="Map" {...tapBtn(() => gameRegistry.current?.openOverlay('map'))}>🗺️</button>
          <button className="tbtn small" aria-label="Pause" {...tapBtn(() => gameRegistry.current?.openOverlay('pause'))}>⏸</button>
        </div>
      )}
    </div>
  );
}
