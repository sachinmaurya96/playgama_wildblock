import { useGameStore } from '../../stores/gameStore';
import { MenuBackground } from './MenuBackground';
import { BUILD_CONTROLS } from '../../data/buildControls';

const CARDS: { icon: string; title: string; text: string }[] = [
  { icon: '🪓', title: 'Gather', text: 'Hold left click to chop, mine and dig. Chop the LOWEST log of a tree and the whole tree topples over. Break tall grass for fibre and seeds.' },
  { icon: '🔨', title: 'Craft', text: 'Press E to open your backpack and Recipe Book. Start with Planks, Rope and a Scrap Axe. Workbenches, Forges and Cooking Fires unlock more recipes when you stand near them.' },
  { icon: '🏡', title: 'Build a home', text: 'Right click places blocks (hold to keep placing, Ctrl to crouch safely at edges). Walls, a roof and a door make a shelter — the 🏡 icon lights up and you recover faster.' },
  { icon: '🛏️', title: 'Rest', text: 'Craft a Cozy Cot and press F on it to set your home and sleep through the night. Furniture nearby adds Comfort for a better morning buff.' },
  { icon: '🌱', title: 'Farm & cook', text: 'Till grass with a hoe, plant seeds and roots, and water the soil (or farm near a river). Cook meals at a Cooking Fire for bigger heals and buffs.' },
  { icon: '🐾', title: 'Befriend creatures', text: 'Hold a creature’s favourite food and press F. Happy creatures follow you and leave gifts. Feed a Fenn three times and it may become your companion.' },
  { icon: '🌙', title: 'Dangerous nights', text: 'At dusk you get a warning: after dark Gloomstalkers and Duskfang packs hunt you down, and around midnight a pack comes looking for you. Torch-lit places and homes with a roof are safe. At dawn they retreat — and you see how many you drove off.' },
  { icon: '🛡️', title: 'Armory', text: 'Craft helmets, chestplates, leggings and boots (Thornhide, Gloomhide, Copper, Tempered, Crystal) in the 🛡️ Armor tab. A full set gives +8% protection. Shields block hits from the front; bows (right click / tap) shoot arrows.' },
  { icon: '🕳️', title: 'Caves', text: 'New worlds have big cave systems: wide tunnels, huge caverns, more cave mouths and deep ravines. Bring torches — glowing ore and crystals hide down there, and so do cave creatures.' },
  { icon: '🎮', title: 'PvP Mode', text: 'Main menu → PvP Mode. Choose ⚔️ Battle or 🤝 Build together, host a game and share the 6-letter code (or invite link); friends join from their own devices. Pick the Wild World or a flat arena. Everyone gets the same kit, takedowns score, and you respawn after 5 seconds. The top-left radar shows where everyone is; stuck in a cave or water? Tap 🆘 (or press R).' },
  { icon: '🧭', title: 'Explore', text: 'Follow rivers to waterfalls, find stone circles, hollow trees and Whisper Steles. Your Discovery Journal (J) and Map (M) fill in as you go.' },
  { icon: '⛵', title: 'Boats', text: 'Craft a Rowboat at a Workbench (5 planks + 2 rope). Use it on water, press F (✋ on touch) to climb in and steer with WASD or the joystick — it turns toward where you push. Jump steps out; two hits pick it back up.' },
  { icon: '🗡️', title: 'Swords', text: 'Wooden, Stone, Copper, Tempered and Crystal swords sweep every foe in front of you. Jump and strike on the way down for a sparkling critical hit.' },
  { icon: '🍃', title: 'Harmony & Homestead', text: 'Planting trees and feeding animals keeps nature in harmony and attracts rare wildlife. Building, farming and discoveries raise your Homestead level, unlocking new recipes.' },
];

const BUILD_CARDS: { icon: string; title: string; text: string }[] = [
  { icon: '🏡', title: 'A creative project', text: 'Build Home gives you a flat 256 × 256 lot with scenery around it, unlimited materials and furniture, and no survival: no hunger, damage or creatures. Projects are saved separately from your survival worlds.' },
  { icon: '📚', title: 'Build Catalog (B)', text: 'Search walls, floors, roofs, windows, kitchens, bathrooms, lighting, gardens and house templates. Pick a material or colour, favourite items and re-use recent ones with 1–9.' },
  { icon: '🧱', title: 'Tools', text: 'Wall, Room, Floor, Roof, Stairs and Pool tools build big pieces from two clicks. Doors and windows cut their own openings. Paint, pick, move and rotate anything — and undo it all with Ctrl+Z.' },
  { icon: '🕊️', title: 'Fly & doors', text: 'Double-tap Space or press 🕊️ Fly to float up to roofs and upper floors (Space up, Shift down). Click any door or gate to swing it open.' },
  { icon: '🌾', title: 'Farming', text: 'The Farming category has crops, soil, hay, scarecrows, coops and a Little Farmstead template. The 🚜 Farm Plot tool tills, plants, irrigates and fences a whole field. "Growing 🌱" crops grow live — tap them when ripe to harvest.' },
  { icon: '🎥', title: 'Look around', text: 'Press C for a free build camera (orbit, pan, zoom), F9 to walk through your home opening doors and switching lights, and F10 for photo mode with a time-of-day slider.' },
];

export function HowToPlay() {
  return (
    <div className="menu-screen">
      <MenuBackground />
      <div className="panel howto-panel">
        <button className="close-x" onClick={() => useGameStore.getState().setScreen('menu')} aria-label="Back">✕</button>
        <h2 className="panel-title">📖 How to Play</h2>
        <div className="howto-grid scroll">
          {CARDS.map((c) => (
            <div key={c.title} className="howto-card">
              <div className="howto-icon">{c.icon}</div>
              <b>{c.title}</b>
              <p>{c.text}</p>
            </div>
          ))}
        </div>
        <h3 className="sub-title">🏡 Build Home</h3>
        <div className="howto-grid">
          {BUILD_CARDS.map((c) => (
            <div key={c.title} className="howto-card">
              <div className="howto-icon">{c.icon}</div>
              <b>{c.title}</b>
              <p>{c.text}</p>
            </div>
          ))}
        </div>
        <details className="howto-controls">
          <summary>Build Home controls</summary>
          <div className="controls-list">
            {BUILD_CONTROLS.map(([k, v]) => <div key={k} className="control-row"><span className="kbd">{k}</span><span>{v}</span></div>)}
          </div>
        </details>
        <p className="muted">Controls: WASD move · Space jump/swim · Shift sprint · Ctrl crouch · E backpack · F interact · V camera · J journal · M map · Q drop · Esc pause</p>
        <p className="muted">📱 Phones & tablets: left stick moves (push to the rim to sprint) · drag the right side to look · tap the screen to use, place, open or attack · press & hold to break · tap hotbar slots to switch items · double-tap ⤒ in Build Home to fly.</p>
      </div>
    </div>
  );
}
