import { Game } from '../../game/Game';
import { GUNS, AMMO_NAMES, SWORD, type WeaponId } from '../../game/deathmatch/WeaponDefinitions';
import type { Slot } from '../../game/deathmatch/WeaponSystem';
import { useDeathmatchStore } from '../../stores/deathmatchStore';

const ICON: Record<WeaponId, string> = { sword: '🗡️', m416: '🔫', ak47: '🔫', mp5: '🔫', shotgun: '💥', m24: '🎯' };

/** Bottom centre: weapon slots. Bottom right: ammo, reload state. */
export function WeaponHud() {
  const lo = useDeathmatchStore((s) => s.loadout);
  const weapon = useDeathmatchStore((s) => s.weapon);
  const reloading = useDeathmatchStore((s) => s.reloading);
  if (!lo) return null;
  const slots: { slot: Slot; w: WeaponId | null }[] = [
    { slot: 0, w: 'sword' },
    { slot: 1, w: lo.guns[0] },
    { slot: 2, w: lo.guns[1] },
  ];
  const gun = weapon === 'sword' ? null : weapon;
  const mag = gun ? lo.mags[gun] ?? 0 : 0;
  const reserve = gun ? lo.ammo[GUNS[gun].ammo] : 0;
  const low = gun ? mag <= Math.ceil(GUNS[gun].magazine * 0.25) : false;
  return (
    <>
      <div className="dm-slots-bar">
        {slots.map(({ slot, w }) => (
          <button
            key={slot}
            type="button"
            className={`dm-wslot ${lo.sel === slot ? 'active' : ''} ${w ? '' : 'empty'}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              Game.current?.dm?.equip(slot);
            }}
          >
            <kbd className="k">{slot + 1}</kbd>
            <span className="i">{w ? ICON[w] : '·'}</span>
            <span className="n">{w ? (w === 'sword' ? SWORD.name : GUNS[w].short) : 'empty'}</span>
          </button>
        ))}
      </div>
      <div className="dm-ammo">
        <div className="dm-wname">{gun ? GUNS[gun].name : SWORD.name}</div>
        {gun ? (
          <>
            <div className={`dm-count ${low ? 'low' : ''}`}>
              <b>{mag}</b>
              <span>/ {reserve}</span>
            </div>
            <div className="dm-cal">{AMMO_NAMES[GUNS[gun].ammo]}</div>
            <div className="dm-khint"><span><kbd className="dm-k">R</kbd>Reload</span><span><kbd className="dm-k">RMB</kbd>{gun === 'm24' ? 'Scope' : 'Aim'}</span></div>
            {reloading > 0 && (
              <div className="dm-reload">
                <i style={{ width: `${Math.round(reloading * 100)}%` }} />
                <span>Reloading…</span>
              </div>
            )}
            {!reloading && mag === 0 && <div className="dm-empty">{reserve > 0 ? 'Press R to reload' : 'No ammo'}</div>}
          </>
        ) : (
          <>
            <div className="dm-cal">Melee · {SWORD.damage} damage</div>
            <div className="dm-khint"><span><kbd className="dm-k">LMB</kbd>Swing</span></div>
          </>
        )}
      </div>
    </>
  );
}
