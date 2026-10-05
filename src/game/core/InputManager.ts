import { useSettingsStore, type Action } from '../../stores/settingsStore';
import { Gyro } from './Gyro';

/**
 * Keyboard / mouse / pointer-lock / touch input. Engine systems poll this each
 * frame (no React state involved). Key bindings come from the settings store so
 * rebinding takes effect immediately.
 */
export class InputManager {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** Keys pressed this frame while Ctrl/Cmd (or Shift) was held — modifier state at the moment of the press. */
  private pressedCtrl = new Set<string>();
  private pressedShift = new Set<string>();
  mouseLeft = false;
  mouseRight = false;
  mouseLeftPressed = false;
  mouseRightPressed = false;
  mouseMiddlePressed = false;
  lookX = 0;
  lookY = 0;
  wheel = 0;
  pointerLocked = false;
  /** The shortcut frees the pointer for UI only; world input is blocked until recaptured. */
  cursorFree = false;
  /** Runs inside the key gesture so browsers allow pointer lock on the second press. */
  onCursorToggle: (() => boolean) | null = null;
  onCursorChange: ((free: boolean) => void) | null = null;
  /** Build Home: accept mouse buttons + track the cursor while the pointer is NOT locked (build camera / cursor mode). */
  allowUnlocked = false;
  /** Build Home: swallow browser shortcuts (Ctrl+Z/Y/D/C/V/S, Tab, F10). */
  captureShortcuts = false;
  mouseMiddle = false;
  /** Cursor position in normalised device coords (-1..1) over the canvas. */
  ndcX = 0;
  ndcY = 0;
  /** Mouse movement while the right / middle button is held and the pointer is free (camera drag). */
  dragRX = 0;
  dragRY = 0;
  dragMX = 0;
  dragMY = 0;
  ctrl = false;
  shift = false;
  alt = false;
  private lockTime = 0;
  private canvas: HTMLElement | null = null;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  /** Fired when pointer lock is lost while playing (→ pause menu). */
  onLockLost: (() => void) | null = null;
  onLockGained: (() => void) | null = null;
  /** Optional gyro aiming on phones / tablets (Settings → Controls). */
  readonly gyro = new Gyro();

  /** Virtual (touch) input written by the TouchControls component. */
  touch = {
    active: false,
    moveX: 0,
    moveY: 0,
    jump: false,
    crouch: false,
    sprint: false,
    breakHeld: false,
    placeHeld: false,
    placePressed: false,
    interactPressed: false,
    /** A quick tap on the open screen (look area): use / place / attack / open, depending on the target. */
    tapPressed: false,
  };

  attach(canvas: HTMLElement): void {
    this.canvas = canvas;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.listeners.push([t, type, fn as EventListener, opts]);
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      this.ctrl = e.ctrlKey || e.metaKey;
      this.shift = e.shiftKey;
      this.alt = e.altKey;
      if (isTypingTarget(e.target)) return;
      if (e.code === this.code('cursor') && !e.ctrlKey && !e.metaKey && !e.altKey && this.onCursorToggle) {
        if (e.repeat || this.onCursorToggle()) {
          e.preventDefault();
          return;
        }
      }
      if (!e.repeat) {
        this.pressed.add(e.code);
        if (e.ctrlKey || e.metaKey) this.pressedCtrl.add(e.code);
        if (e.shiftKey) this.pressedShift.add(e.code);
      }
      this.down.add(e.code);
      if (this.captureShortcuts && e.code === this.code('buildView') && !this.ctrl && !this.alt) e.preventDefault();
      if (this.captureShortcuts && ((this.ctrl && ['KeyZ', 'KeyY', 'KeyD', 'KeyC', 'KeyV', 'KeyS'].includes(e.code)) || e.code === 'Tab' || e.code === 'F10' || (e.altKey && e.code !== 'Tab'))) e.preventDefault();
      // Stop the browser from scrolling / opening find etc. while playing.
      if (this.pointerLocked && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab' || e.code === 'F3' || e.code === 'F2' || (e.ctrlKey && e.code !== 'KeyR'))) e.preventDefault();
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.ctrl = e.ctrlKey || e.metaKey;
      this.shift = e.shiftKey;
      this.alt = e.altKey;
      this.down.delete(e.code);
    });
    on(window, 'blur', () => {
      this.down.clear();
      this.mouseLeft = this.mouseRight = false;
    });
    on(canvas, 'mousedown', (e: MouseEvent) => {
      if (this.cursorFree) return;
      if (!this.pointerLocked && !this.allowUnlocked) return;
      this.updateNdc(e);
      if (!this.pointerLocked && e.button === 1) e.preventDefault();
      if (e.button === 0) {
        this.mouseLeft = true;
        this.mouseLeftPressed = true;
      } else if (e.button === 2) {
        this.mouseRight = true;
        this.mouseRightPressed = true;
      } else if (e.button === 1) {
        this.mouseMiddlePressed = true;
        this.mouseMiddle = true;
      }
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.mouseLeft = false;
      else if (e.button === 2) this.mouseRight = false;
      else if (e.button === 1) this.mouseMiddle = false;
    });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(window, 'mousemove', (e: MouseEvent) => {
      if (this.cursorFree) return;
      if (!this.pointerLocked) {
        if (!this.allowUnlocked) return;
        this.updateNdc(e);
        if (this.mouseRight) {
          this.dragRX += e.movementX;
          this.dragRY += e.movementY;
        }
        if (this.mouseMiddle) {
          this.dragMX += e.movementX;
          this.dragMY += e.movementY;
        }
        return;
      }
      // Ignore the large spurious delta some browsers report right after locking.
      if (performance.now() - this.lockTime < 120 && (Math.abs(e.movementX) > 60 || Math.abs(e.movementY) > 60)) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    on(canvas, 'wheel', (e: WheelEvent) => {
      if (this.cursorFree) return;
      if (!this.pointerLocked && !this.allowUnlocked) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    on(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      const was = this.pointerLocked;
      this.pointerLocked = locked;
      if (locked) {
        this.setCursorFree(false);
        this.lockTime = performance.now();
        this.lookX = this.lookY = 0;
        this.onLockGained?.();
      } else {
        this.down.clear();
        this.mouseLeft = this.mouseRight = false;
        if (was) this.onLockLost?.();
      }
    });
  }

  private updateNdc(e: MouseEvent) {
    const r = this.canvas?.getBoundingClientRect();
    if (!r || !r.width) return;
    this.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }

  detach(): void {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
    if (document.pointerLockElement) document.exitPointerLock();
    this.gyro.stop();
    this.canvas = null;
  }

  requestLock(force = false): void {
    if (!this.canvas || this.touch.active || (this.cursorFree && !force)) return;
    try {
      const p = (this.canvas as HTMLCanvasElement).requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => { /* user must click again (browser cooldown) */ });
    } catch {
      /* ignore */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setCursorFree(free: boolean): void {
    if (this.cursorFree === free) return;
    this.cursorFree = free;
    this.clearHeld();
    this.endFrame();
    this.onCursorChange?.(free);
  }

  private code(action: Action): string {
    return useSettingsStore.getState().controls.keys[action];
  }

  isDown(action: Action): boolean {
    if (this.cursorFree && ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch'].includes(action)) return false;
    if (action === 'crouch' && this.captureShortcuts) return false; // Ctrl is for shortcuts in Build Home
    const c = this.code(action);
    if (this.down.has(c)) return true;
    if (action === 'sprint' && this.down.has('ShiftRight')) return true;
    if (action === 'crouch' && !this.captureShortcuts && (this.down.has('KeyC') || this.down.has('ControlRight'))) return true;
    return false;
  }

  keyDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(action: Action): boolean {
    return this.pressed.has(this.code(action));
  }

  keyPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Pressed together with Ctrl / Cmd. */
  ctrlPressed(code: string): boolean {
    return this.pressedCtrl.has(code);
  }

  /** Pressed together with Shift. */
  shiftPressed(code: string): boolean {
    return this.pressedShift.has(code);
  }

  /** Movement vector from keys + virtual joystick: x = strafe, y = forward. */
  moveVector(): { x: number; y: number } {
    if (this.cursorFree) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.touch.active) {
      x += this.touch.moveX;
      y += this.touch.moveY;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.pressedCtrl.clear();
    this.pressedShift.clear();
    this.mouseLeftPressed = this.mouseRightPressed = this.mouseMiddlePressed = false;
    this.lookX = this.lookY = 0;
    this.dragRX = this.dragRY = this.dragMX = this.dragMY = 0;
    this.wheel = 0;
    this.touch.placePressed = false;
    this.touch.interactPressed = false;
    this.touch.tapPressed = false;
  }

  clearHeld(): void {
    this.down.clear();
    this.mouseLeft = this.mouseRight = this.mouseMiddle = false;
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
