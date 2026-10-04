import { useEffect, useRef, useState } from 'react';
import { itemDef } from '../../data/items';
import { QUESTS } from '../../data/progression';
import { Game } from '../../game/Game';
import { touchEnabled } from '../../app/mobile';
import { useGameStore } from '../../stores/gameStore';
import { HOTBAR_SIZE, useInventoryStore } from '../../stores/inventoryStore';
import { BUFF_INFO, usePlayerStore } from '../../stores/playerStore';
import { keyLabel, useSettingsStore } from '../../stores/settingsStore';
import { useWorldStore } from '../../stores/worldStore';
import { ItemSlot } from '../common/ItemSlot';
import { DebugPanel } from './DebugPanel';
import { Toasts } from './Toasts';
import { BuildHUD } from '../Build/BuildHUD';
import { CoopBar, PvpHud } from './PvpHud';
import { usePvpStore } from '../../stores/pvpStore';
import { armorStats } from '../../game/player/Player';
import { DeathmatchHud } from '../Deathmatch/DeathmatchHud';

export function HUD() {
  const hidden = useGameStore((s) => s.hudHidden);
  const overlay = useGameStore((s) => s.overlay);
  const mode = useGameStore((s) => s.world?.mode);
  if (mode === 'build')
    return (
      <div className="hud">
        <BuildHUD />
        <CoopBar />
        <Toasts />
        <DebugPanel />
      </div>
    );
  if (mode === 'deathmatch')
    return (
      <div className="hud">
        <DeathmatchHud />
        <HurtVignette />
        <Toasts />
        <DebugPanel />
      </div>
    );
  return (
    <div className={`hud ${hidden ? 'hud-hidden' : ''} ${mode === 'pvp' ? 'pvp-hud' : ''}`}>
      {/* lowest layer: catches clicks on the 3D view only — the hotbar & objective stay clickable */}
      <ClickToPlay />
      {!hidden && (
        <>
          <Compass />
          <Vitals />
          {mode !== 'pvp' && <QuestPanel />}
          <Hotbar />
          {overlay === null && <Crosshair />}
          <ContextPrompt />
          <Subtitles />
          {mode !== 'pvp' && <HomeMarker />}
        </>
      )}
      {mode === 'pvp' && <PvpHud />}
      <HurtVignette />
      <UnderwaterTint />
      <Toasts />
      <DebugPanel />
    </div>
  );
}

function Crosshair() {
  const progress = useGameStore((s) => s.breakProgress);
  const hc = useSettingsStore((s) => s.accessibility.highContrastOutline);
  const r = 13, c = 2 * Math.PI * r;
  return (
    <div className={`crosshair ${hc ? 'hc' : ''}`}>
      <span className="dot" />
      {progress > 0 && (
        <svg width="36" height="36" viewBox="0 0 36 36" className="break-ring">
          <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="4" />
          <circle cx="18" cy="18" r={r} fill="none" stroke="#ffe08a" strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} strokeLinecap="round" transform="rotate(-90 18 18)" />
        </svg>
      )}
    </div>
  );
}

function Hotbar() {
  const slots = useInventoryStore((s) => s.slots);
  const selected = useInventoryStore((s) => s.selected);
  const select = useInventoryStore((s) => s.select);
  const sel = slots[selected];
  const [flash, setFlash] = useState(0);
  const prev = useRef(selected);
  useEffect(() => {
    if (prev.current !== selected) {
      prev.current = selected;
      setFlash((f) => f + 1);
    }
  }, [selected]);
  return (
    <div className="hotbar-wrap">
      {sel && (
        <div key={flash} className="held-name">
          {itemDef(sel.item).name}
        </div>
      )}
      <div className="hotbar">
        {slots.slice(0, HOTBAR_SIZE).map((s, i) => (
          <div key={i} className="hotbar-cell" onPointerDown={() => select(i)}>
            <ItemSlot stack={s} selected={i === selected} tooltip={false} />
            <span className="hotkey">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeafMeter({ value, max, kind }: { value: number; max: number; kind: 'vitality' | 'energy' }) {
  const f = Math.max(0, Math.min(1, value / max));
  const low = f < 0.25;
  return (
    <div className={`meter ${kind} ${low ? 'low' : ''}`} title={`${kind === 'vitality' ? 'Vitality' : 'Energy'} ${Math.round(value)} / ${max}`}>
      <span className="meter-icon">{kind === 'vitality' ? <HeartLeaf /> : <Acorn />}</span>
      <span className="meter-bar">
        <span className="meter-fill" style={{ width: `${f * 100}%` }} />
        <span className="meter-shine" />
      </span>
      <span className="meter-num">{Math.round(value)}</span>
    </div>
  );
}

function HeartLeaf() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M12 21 C 4 15, 2 10, 5 6 C 7.5 3, 11 4, 12 7 C 13 4, 16.5 3, 19 6 C 22 10, 20 15, 12 21 Z" fill="#e0553a" stroke="#6a2218" strokeWidth="1.5" />
      <path d="M12 8 C 12 12, 12 15, 12 19" stroke="#8a2a1e" strokeWidth="1.2" fill="none" />
      <path d="M12 12 L 8.5 9.5 M12 14.5 L 15.5 12" stroke="#8a2a1e" strokeWidth="1" fill="none" />
    </svg>
  );
}

function Acorn() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M6 10 C 6 16, 9 20, 12 21 C 15 20, 18 16, 18 10 Z" fill="#e0b23d" stroke="#6a4a18" strokeWidth="1.5" />
      <path d="M4.5 10 C 5 6, 9 4.5, 12 4.5 C 15 4.5, 19 6, 19.5 10 Z" fill="#8a5a32" stroke="#4a2e18" strokeWidth="1.5" />
      <path d="M12 4.5 L 13 2" stroke="#4a2e18" strokeWidth="1.5" />
    </svg>
  );
}

function Vitals() {
  const v = usePlayerStore((s) => s.vitality);
  const mv = usePlayerStore((s) => s.maxVitality);
  const e = usePlayerStore((s) => s.energy);
  const buffs = usePlayerStore((s) => s.buffs);
  const sheltered = usePlayerStore((s) => s.sheltered);
  const time = useWorldStore((s) => s.timeLabel);
  const day = useWorldStore((s) => s.dayCount);
  return (
    <div className="vitals">
      <LeafMeter value={v} max={mv} kind="vitality" />
      <LeafMeter value={e} max={100} kind="energy" />
      <div className="vitals-row">
        <span className="clock">☀︎ Day {day} · {time}</span>
        {sheltered && <span className="home-badge" title="Sheltered — you recover faster here">🏡</span>}
        <ArmorChip />
      </div>
      {buffs.length > 0 && (
        <div className="buffs">
          {buffs.map((b) => (
            <span key={b.id} className="buff" title={`${BUFF_INFO[b.id].name}: ${BUFF_INFO[b.id].description}`}>
              {BUFF_INFO[b.id].icon}
              <small>{Math.ceil(b.remaining / 60)}m</small>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ArmorChip() {
  const equipment = useInventoryStore((s) => s.equipment);
  const st = armorStats(equipment);
  if (st.defense <= 0 && st.block <= 0) return null;
  return (
    <span className={`armor-chip ${st.fullSet ? 'set' : ''}`} title={`Armor: ${Math.round(st.defense * 100)}% less damage${st.block ? ` · shield blocks ${Math.round(st.block * 100)}% of hits from the front` : ''}${st.fullSet ? ' · full set bonus' : ''}`}>
      🛡️{Math.round(st.defense * 100)}%
    </span>
  );
}

const CARDINALS = [
  { a: 0, l: 'N' }, { a: 45, l: 'NE' }, { a: 90, l: 'E' }, { a: 135, l: 'SE' }, { a: 180, l: 'S' }, { a: 225, l: 'SW' }, { a: 270, l: 'W' }, { a: 315, l: 'NW' },
];

/** Compass strip; updated from the engine via rAF + refs (no React re-render per frame). */
function Compass() {
  const stripRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const W = 320;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const g = Game.current;
      if (!g || !stripRef.current) return;
      // heading: 0 = north (-Z), clockwise
      const heading = ((-g.player.yaw * 180) / Math.PI + 360 * 10) % 360;
      const place = (angle: number) => {
        let d = angle - heading;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
      };
      const kids = stripRef.current.children;
      CARDINALS.forEach((c, i) => {
        const d = place(c.a);
        const el = kids[i] as HTMLElement;
        el.style.transform = `translateX(${(d / 90) * (W / 2)}px)`;
        el.style.opacity = String(Math.max(0, 1 - Math.abs(d) / 95));
      });
      const ws = useWorldStore.getState();
      const p = g.player.position;
      const mk = markersRef.current?.children;
      const targets = [
        ws.home ? { x: ws.home.x, z: ws.home.z } : null,
        g.questTarget,
        ws.waypoint,
        ws.deathMarker,
      ];
      if (mk) {
        targets.forEach((t, i) => {
          const el = mk[i] as HTMLElement;
          if (!t) {
            el.style.display = 'none';
            return;
          }
          const ang = (Math.atan2(t.x - p.x, -(t.z - p.z)) * 180) / Math.PI;
          const d = place((ang + 360) % 360);
          const dist = Math.hypot(t.x - p.x, t.z - p.z);
          el.style.display = Math.abs(d) < 95 && dist > 3 ? 'block' : 'none';
          el.style.transform = `translateX(${(d / 90) * (W / 2)}px)`;
          const label = el.querySelector('small');
          if (label) label.textContent = `${Math.round(dist)}m`;
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const biome = useWorldStore((s) => s.biomeName);
  return (
    <div className="compass-wrap">
      <div className="compass">
        <div className="compass-strip" ref={stripRef}>
          {CARDINALS.map((c) => (
            <span key={c.l} className={`cardinal ${c.l.length === 1 ? 'major' : ''}`}>{c.l}</span>
          ))}
        </div>
        <div className="compass-markers" ref={markersRef}>
          <span className="marker home">🏡<small /></span>
          <span className="marker quest">❗<small /></span>
          <span className="marker waypoint">📍<small /></span>
          <span className="marker death">🍂<small /></span>
        </div>
        <span className="compass-needle" />
      </div>
      {biome && <div className="biome-name">{biome}</div>}
    </div>
  );
}

function QuestPanel() {
  const qi = useWorldStore((s) => s.questIndex);
  const stats = useWorldStore((s) => s.stats);
  const tips = useSettingsStore((s) => s.gameplay.tips);
  // phones: start collapsed so the objective card doesn't cover the view (tap to expand)
  const [open, setOpen] = useState(() => !document.documentElement.classList.contains('touch-ui'));
  const q = QUESTS[qi];
  if (!q) return null;
  const v = Math.min(q.goal, stats[q.stat] ?? 0);
  return (
    <div className={`quest ${open ? 'open' : ''}`}>
      <button className="quest-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="quest-kicker">Objective</span>
        <span className="quest-title">{q.title}</span>
        <span className="quest-count">{v}/{q.goal}</span>
      </button>
      {open && (
        <div className="quest-body">
          <div className="quest-bar"><span style={{ width: `${(v / q.goal) * 100}%` }} /></div>
          {tips && <p>{q.hint}</p>}
          <div className="quest-reward">Reward: {q.reward.map((r) => `${r.count}× ${itemDef(r.item).name}`).join(', ')}</div>
        </div>
      )}
    </div>
  );
}

function ContextPrompt() {
  const prompt = useGameStore((s) => s.prompt);
  const overlay = useGameStore((s) => s.overlay);
  const keys = useSettingsStore((s) => s.controls.keys);
  if (!prompt || overlay) return null;
  const [key, ...rest] = prompt.split('  ');
  const touch = document.documentElement.classList.contains('touch-ui');
  const touchKey: Record<string, string> = { F: '✋ / Tap', RMB: 'Tap', LMB: 'Tap', 'Hold LMB': 'Hold ⛏️', Space: '⛵' };
  const shown = touch ? touchKey[key] ?? key : key === 'F' ? keyLabel(keys.interact) : key;
  return (
    <div className="context-prompt">
      <span className="kbd">{shown}</span> {rest.join('  ')}
    </div>
  );
}

function Subtitles() {
  const sub = useGameStore((s) => s.subtitle);
  const on = useSettingsStore((s) => s.accessibility.subtitles);
  const [, force] = useState(0);
  useEffect(() => {
    if (!sub) return;
    const t = setTimeout(() => force((n) => n + 1), 3200);
    return () => clearTimeout(t);
  }, [sub]);
  if (!on || !sub || performance.now() - sub.t > 3000) return null;
  return <div className="subtitle">{sub.text}{sub.dir ? ` (${sub.dir})` : ''}</div>;
}

function HomeMarker() {
  // Arrow toward home when far away, so players never get permanently lost.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const g = Game.current;
      const el = ref.current;
      if (!g || !el) return;
      const ws = useWorldStore.getState();
      const t = ws.home ?? ws.camp;
      const p = g.player.position;
      const dist = Math.hypot(t.x - p.x, t.z - p.z);
      if (dist < 60) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'flex';
      const ang = Math.atan2(t.x - p.x, -(t.z - p.z)) + g.player.yaw;
      el.style.setProperty('--rot', `${ang}rad`);
      el.querySelector('small')!.textContent = `${ws.home ? 'Home' : 'Camp'} ${Math.round(dist)}m`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="home-arrow" ref={ref}>
      <span className="arrow">➤</span>
      <small />
    </div>
  );
}

function HurtVignette() {
  const t = useGameStore((s) => s.hurtFlash);
  const v = usePlayerStore((s) => s.vitality);
  const reduce = useSettingsStore((s) => s.accessibility.reduceFlashing);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!t) return;
    setOn(true);
    const id = setTimeout(() => setOn(false), 350);
    return () => clearTimeout(id);
  }, [t]);
  const low = v < 25;
  return <div className={`vignette ${on && !reduce ? 'hit' : ''} ${low ? 'low' : ''}`} />;
}

function UnderwaterTint() {
  const u = usePlayerStore((s) => s.underwater);
  return <div className={`underwater ${u ? 'on' : ''}`} />;
}

function ClickToPlay() {
  const overlay = useGameStore((s) => s.overlay);
  const [locked, setLocked] = useState(true);
  const touch = useSettingsStore((s) => s.controls.touch);
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', on);
    on();
    return () => document.removeEventListener('pointerlockchange', on);
  }, []);
  const pvp = useGameStore((s) => s.world?.mode === 'pvp');
  const isTouch = touchEnabled(touch);
  if (locked || overlay !== null || isTouch) return null;
  return (
    <button
      className="click-to-play"
      onClick={() => {
        const g = Game.current;
        if (g?.pvp && usePvpStore.getState().gearOpen) g.setPvpOptions(false);
        else g?.input.requestLock();
      }}
    >
      <span className="ctp-card">
        <b>{pvp ? 'Click to get back in the match' : 'Click to continue exploring'}</b>
        <small>{pvp ? 'Mouse to look · WASD to move · O quick options · Esc pause' : 'Mouse to look · WASD to move · E backpack · Esc pause'}</small>
      </span>
    </button>
  );
}
