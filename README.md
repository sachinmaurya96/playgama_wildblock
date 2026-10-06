# WildBlocks — A Tiny Living World

An original, cozy single-player voxel adventure that runs in the browser. Start with almost nothing, fell trees, craft tools from a recipe book, build a home, farm, cook, befriend creatures, explore rivers, waterfalls, caves and ruins, and make the wilds feel like home.

It also has **🏡 Build Home**, a separate creative mode: a flat 256 × 256 lot, an unlimited catalog of modern building materials, doors, windows, kitchens, bathrooms, lighting and landscaping, and dedicated house-building tools (walls, rooms, floors, roofs, stairs, pools, copy/paste, blueprints, undo/redo, a free build camera, walkthrough and photo mode).

Everything you see and hear is **generated in code**: block textures, item icons, creature models, all sound effects and the adaptive music. There are no third-party art or audio assets (see `ASSET_LICENSES.md`).

Complete documentation: [Player guide for every supported input/device](docs/PLAYER_GUIDE.md) · [Development guide](docs/DEVELOPER_GUIDE.md) · [Code audit, optimizations and device test matrix](docs/CODE_AUDIT.md). The in-game **How to Play** has the same player guidance with topic navigation, search and your current key bindings.

---

## Contents

1. [Quick start](#quick-start)
2. [Technology](#technology)
3. [Controls](#controls)
4. [What's in the game](#whats-in-the-game)
5. [Build Home](#build-home)
5b. [PvP Mode (free peer-to-peer multiplayer)](#pvp-mode-free-peer-to-peer-multiplayer)
5c. [Deathmatch — Team Battle](#deathmatch--team-battle)
6. [Architecture](#architecture)
7. [World system](#world-system)
8. [Save system](#save-system)
9. [Performance & optimisation](#performance--optimisation)
10. [Extending the game](#extending-the-game) — blocks, recipes, biomes, creatures, art
11. [Debugging](#debugging)
12. [Testing](#testing)
13. [Playgama build](#playgama-build)
14. [Known limitations](#known-limitations)

---

## Quick start

Requirements: **Node.js 20.19+** (or 22+) and a browser with **WebGL 2** (current Chrome, Edge, Firefox, Safari).

```bash
npm install
npm run dev          # http://localhost:5173
```

Production:

```bash
npm run typecheck    # tsc --noEmit
npm run test         # vitest (unit + IndexedDB integration tests)
npm run validate:data # content references and obtainability
npm run docs:players # regenerate the manual from the in-game guide
npm run build        # typecheck + vite build → dist/
npm run preview      # serve dist/ locally
```

`vite.config.ts` uses `base: './'`, so `dist/` works from any sub-directory (itch.io, Playgama, GitHub Pages…). Single-player needs no backend and a loaded session can run offline. Reopening/refreshing may need a connection; no service worker guarantees offline loading. Online rooms and voice require networking.

## Technology

| Purpose | Package |
| --- | --- |
| Build / dev server | Vite 7, `@vitejs/plugin-react` |
| UI | React 19, TypeScript, plain modular CSS |
| 3D | three.js (r185), `@react-three/fiber` 9 (canvas, frame loop, resize) |
| State | zustand (UI-facing state only) |
| Saves | IndexedDB via `idb` (in-memory fallback when storage is blocked) |
| Background work | Web Workers (terrain generation + meshing) |
| Audio | Web Audio API (fully synthesised) |
| Tests | Vitest + `fake-indexeddb` |

Dependencies were kept deliberately small. Two suggested packages were not needed:

* **simplex-noise** — a seeded simplex implementation lives in `src/game/world/noise.ts` (Gustavson, public domain), so generation code is identical in workers, tests and the main thread.
* **@react-three/rapier** — rigid-body physics isn't needed for this design: the player and creatures use a small axis-separated swept-AABB voxel collider (`VoxelPhysics.ts`) that only queries the handful of cells around a body, and the falling-tree effect is a single animated mesh by design. This avoids shipping a ~2 MB WASM physics engine and per-chunk collider rebuilds.

## Controls

| Key | Action |
| --- | --- |
| **W A S D** | Move |
| **Space** | Jump / swim up |
| **Shift** | Sprint (uses a little Energy) |
| **Ctrl** or **C** | Crouch — edge-safe, you won't walk off ledges while building |
| **Left mouse (hold)** | Break / chop / mine / dig · attack |
| **Right mouse** | Place · eat · till · plant · water · open doors & chests (hold to keep placing) |
| **F** | Interact: open chests & stations, rest in bed, read steles, harvest, feed / pet creatures |
| **E** | Backpack + Recipe Book |
| **1–9 / mouse wheel** | Select hotbar slot |
| **Q** | Drop one (Ctrl+Q: whole stack) |
| **V** | First / third-person camera |
| **Backtick (below Esc)** | Free the cursor for UI options only; world clicks, movement and tools are blocked until pressed again (all desktop modes) |
| **J** | Discovery Journal |
| **M** | World map (drag, scroll, double-click to set a compass waypoint) |
| **F2** | Hide HUD (photo mode) |
| **F3** | Debug overlay |
| **Esc** | Pause (auto-saves) |

Build Home has its own keys (B catalog, R rotate, X remove, P pick, Ctrl+Z / Ctrl+Y undo & redo, C build camera, F9 walkthrough, F10 photo mode…) — see [Build Home](#build-home) or *Pause → Controls* inside a project.

Actions listed in *Settings → Controls* can be rebound (conflicting bindings swap). Build-tool shortcuts and Deathmatch weapon controls have fixed keys.

### Phones & tablets

The game runs in **landscape**: on Android it goes fullscreen and locks the orientation on the first tap; on iOS (which can't lock orientation) a "turn your device" card pauses the game while the phone is upright. The web manifest also asks for landscape when the game is added to the home screen. Browser zoom gestures (double-tap, pinch), long-press callouts and text selection are blocked in-game.

| Touch | Action |
| --- | --- |
| Left stick | Move (push to the rim to sprint) |
| Drag on the right side | Look |
| Quick tap on the screen | Use what you aim at: place a block, eat, till, plant, open doors / chests, harvest, attack, board a boat |
| Press & hold on the screen / ⛏️ | Break / chop / mine (Build Home: keep placing / removing) |
| 🧱 ✋ ⤓ ⤒ | Place / use · interact · crouch · jump (in a boat ⛵ steps out) |
| Hotbar | Tap a slot to select it |
| Backpack | Tabs (Backpack · Crafting · Explorer); tap to pick up / drop, press & hold a slot to split |
| Build Home | 🧱 place · ⟳ rotate · ↶ undo · ✋ use · tool drawer top-left · 🕊️ Fly (or double-tap ⤒), then ⏫ / ⏬ |

Phones default to a sharp-but-light graphics profile (native-ish pixel ratio up to 1.75×, render distance 4, light particles); Auto quality trims the pixel ratio first if the frame rate drops. Older saved settings with the previous blurry phone default are upgraded automatically.

**Stuck in water, a cave or a build?** Open **Pause → Quick Respawn**, directly below Resume / Keep building. Survival returns you to Home or starting camp, Build Home returns to the lot entrance, and friend rooms use their existing nearby-player rescue with combat/cooldown checks. It keeps your current health, energy, items and progress. Terrain may need to load before movement resumes. Deathmatch does not offer this rescue button.

## What's in the game

* **6 biomes** with smooth blending: Sunny Meadow, Deepwood, Pine Highlands, Sandy Coast, Amber Canyon and the rare Crystal Highlands.
* **Terrain**: layered continental / elevation / erosion noise, terraced cliffs and plateaus, beaches, lakes, winding **rivers** in carved valleys, **waterfalls** where rivers step down between terraces (sheet shader + mist + splash particles + positional roar), 3-D noise **caves** and chambers with ores, underground pools, crystal clusters and glow mushrooms.
* **Landmarks** (8 templates): Ancient Stone Circle, Overgrown Ruin, Forgotten Campsite, Giant Hollow Tree, Crystal Spire, Abandoned Cabin, Flower Valley, Sky Pillar — plus waterfalls. Ruins hold loot chests and **Whisper Steles** with the Wayfarers' journal fragments.
* **Tree Collapse** (signature mechanic): chop the lowest log and the whole tree shakes, leans and topples as a single temporary mesh, then lands as collectible logs, sticks, saplings and fruit.
* **112 blocks** including stairs, slabs, doors (2-tall, orientable), windows, fences, 25+ furniture / appliance / station models (bed, tables, chairs, shelves, cabinets, rugs, hearth, flower pots, Ice Box, Water Barrel, Wind Lamp, Grain Grinder, Crystal Lantern, Stone Oven…).
* **193 survival items** and **144 recipes** in a recipe book (never hidden: missing ingredients, far stations and a full backpack are explained, and `npm run validate:data` proves every item is obtainable with no dependency deadlocks). Survival building also has modern architecture pieces — plaster walls, concrete, cut stone, oak floors, cladding, clay & shingle roofs, glass walls, stairs, beams, columns, garden walls, fences and glass railings with stations (Workbench, Stone Cutter, Forge, Cooking Fire, Kitchen Table/Grinder, Stone Oven, Carpentry Bench, Crystal Bench). Tool tiers: Scrap → Copper → Tempered → Crystal, with durability.
* **Armory**: 5 armor sets (Thornhide, Gloomhide, Copper, Tempered, Crystal) × helmet / chestplate / leggings / boots — damage reduction capped at 75%, +8% for a full set, Gloomhide also makes you a little faster. 4 shields (off-hand: chance to block hits from the front), Hunter Bow & Crystal Bow with arrows (gravity-arced projectiles, can be picked up again), all in the 🛡️ Armor / Weapons recipe tabs. Armor shows on your character (third person and in PvP).
* **Dangerous nights**: a dusk warning, far more hostiles after dark (Explorer: 5 on the first night, 12 later; Adventurer 18), Zombies, Skeletons, Gloomstalkers and Duskfang packs that track you from ~44 blocks away, a hunting pack around midnight, and a dawn retreat with a "creatures driven off" tally. Torch-lit spots and roofed homes discourage hostile spawning; existing enemies can still threaten you.
* **Combat feedback**: floating damage numbers (gold for critical hits), health bars over hurt enemies, "Blocked!" pops, "Defeated!" bursts and kill milestones.
* **Caves v2** (new worlds): wider tunnels, a second long tunnel network, bigger caverns, more cave mouths and deep ravines. Existing worlds keep their original terrain (`WorldMeta.caves`).
* **Swords**: Wooden, Stone, Copper, Tempered and Crystal swords. Every swing sweeps all hostiles in an arc in front of you (60% damage to the extras); strike while falling for a sparkling ×1.5 critical hit.
* **Rowboats**: craft at a Workbench (5 planks + 2 rope), set one down on a river or lake, F / ✋ to climb in. The boat steers toward where you push (relative to the camera — the same on keyboard and joystick), glides with gentle drag, bumps off banks, crawls on land and can be picked up again with two hits. Boats are saved with the world.
* **Farming**: hoe → till → plant (Sunwheat, Emberroot, Puffgourd, Brookmint, Skycorn, Blushberry) → water (watering can, rain or nearby rivers) → grows by game-time timestamps (even while unloaded) → harvest & auto-replant. Berry bushes regrow.
* **Cooking & buffs**: soups, teas, pies, bread, stews — Swift, Sturdy, Well Fed, Hearty, Glowsight. Hunger is gentle: an **Energy** meter that never starves you.
* **Creatures**: friendly Mossback, Pufftail, Twiglet, Mudsnout, Glowbug and **Fenn** (a fox-like companion you can befriend, who warns about danger and sniffs out ore); hostile Thorncrawler, Nightling (fears light), Stoneback, Cave Mite, Bog Snapper, Gloomstalker, Duskfang, Zombie and Skeleton. State-machine AI, tiered update rates, family-friendly "poof" when driven off.
* **Creature loot**: defeated untamed wildlife drops species meat; cook it at a Cooking Fire for better recovery. Other creatures have guaranteed material loot. Skeleton bones can be used for arrows. Feeding, gifts and the protected tamed Fenn remain available.
* **Beds and seats**: Sleep / Set home and Sit buttons appear within about three blocks of reachable furniture on desktop, phones and tablets. Survival sleep requires night and no nearby hostiles; Build Home beds can advance locked daytime too. Move, jump, Interact or tap Stand up to leave a seat. Shared sleep is checked by the host; friends see the seated pose. Chair saves resume at an exit position.
* **Day/night** (24 min default), stylised sun/moon/stars, drifting voxel clouds, **weather** (clear, cloudy, rain, storm with accessibility-safe lightning, mist).
* **Homestead Level** (building, farming, friendships, discoveries unlock recipes and cosmetics), **Home Comfort** (furniture near your bed improves the morning buff), **Nature Harmony** (plant trees, feed animals → rare butterflies and more wildlife; over-harvesting quietly thins it).
* **Discovery Journal**, **world map** of explored areas, **compass** with home / quest / waypoint / lost-satchel markers, onboarding **quests**, **achievements**, shelter detection 🏡, sleep & set home, immediate automatic respawn at Home (or starting camp) with existing item-loss rules by difficulty (Peaceful / Explorer / Adventurer), 75% Vitality, at least 60 Energy and 3 s protection.

## Build Home

Choose **🏡 Build Home** on the main menu (the orange button under *New World*), name the project, pick a plot — **Flat Meadow, Coastal Plot, Forest Clearing, Mountain View, Lakeside, Desert Modern** or a **Blank White Studio** — and a time of day. Projects are saved separately from survival worlds and are badged *BUILD HOME* in the world list with their building time.

**Rules:** unlimited items, no hunger / damage / creatures / durability / crafting. The lot is perfectly flat, edged by a paved path and a hedge, with scenery (and a distant backdrop) beyond it.

**Coordinates & teleport** — open *Pause → Settings → 📍 Location* to copy your position or enter `x y z` (or `x z` to land on the surface). Teleports stay within the lot (X/Z −128 to 127, Y 2 to 120), load the destination first, and clear blocks and furniture safely. The active camera follows you. Shared projects also offer this in ⚙️ Options, with friends' coordinates and **Go** buttons.

**Build Catalog (B)** — categories on the left (Structure, Modern Architecture, Doors & Windows, Kitchen, Living Room, Bedroom, Bathroom, Office, Lighting, Decoration, Outdoor, Landscaping, Utility, Tools, Presets), items in the centre with rendered thumbnails, a preview with colour / material variants and ☆ favourite on the right, search on top (names, rooms, materials and tags), and Recent / Favourites along the bottom. Style palettes (Warm Minimal, Modern Dark, Scandinavian, Tropical Modern) suggest matching materials; they never build anything for you.

**Tools** — everything goes through one undo history (150 steps; a whole room or roof is one step):

| Tool | How |
| --- | --- |
| Place (Q) | Blocks snap to the grid, furniture to ¼ block (hold **Alt** for free placement). A see-through ghost turns **red** when something (wall, furniture, you) is in the way. **R** rotates 90°, **Shift+R** 15° for decor. Cabinets push back to the wall and line up with neighbours. |
| Doors & windows | Aim at a wall: the opening is cut automatically (previewed in orange); undo puts the wall back, removing the window closes the wall again. Doors swing, sliding doors slide, the garage door lifts. |
| Select & Move (V) | Click to select, drag to move, **R** rotate, **Delete** remove, **Ctrl+D** duplicate, recolour from the panel. |
| Remove (X) · Paint (T) · Pick (P / middle click) | Remove blocks/objects (hold to repeat) · repaint without replacing · eyedropper for any block or object. |
| Wall (Y) · Room (U) · Floor (I) · Foundation | Two clicks. Walls 1–4 high (**[ ]**), rooms get a floor, four walls and an optional ceiling. Floors laid on top of walls become the next storey. |
| Roof (O) | Flat, gable, shed or hip roofs from dedicated slope / corner meshes, steep or low pitch, optional overhang. |
| Stairs (J) | Click the bottom step, then the upper floor (or its underside): straight, 1–3 wide, optionally floating; the stairwell is cut for you. |
| Pool (K) · Pond | Excavated, tiled, with coping, steps and water. |
| Landscape (L) | Raise, lower, flatten, paint ground (grass, soil, sand, gravel, stone, pavers, decking) with a 1/3/5/9 brush; tree, palm, bush and hedge stamps. |
| Measure (N) · Copy (Ctrl+C) | Distances in metres · copy an area (auto height), paste with rotation (**Ctrl+V**), save it as a **blueprint** usable in every project, or delete it (big deletions ask first). |
| Presets | Starter Modern Cabin, Modern One-Story Home, Two-Story Family Home, Lakeside Glass House, Cozy Cottage, Beach House on Stilts, Modern Villa with Pool, Mountain A-Frame Chalet, Tiny Modern House and Little Farmstead — placed with a ghost, rotatable, fully editable afterwards. Houses and pasted blueprints require a clear area: a red preview blocks overlaps with existing structures or furniture, including rooms and roof overhangs. Existing houses are protected after loading a saved project; undo restores the area. |

**Flying:** double-tap **Space** or press **🕊️ Fly** in the top bar (touch: double-tap ⤒). Space / ⏫ goes up, Shift / ⏬ down, Ctrl (or the stick pushed fully) flies faster; touching down on the ground lands you.

**Doors:** click / tap any door, gate or curtain with the Place tool to open or close it (F, ✋ or right-click also work, and switch lights, taps and TVs).

**Farming (🌾 category):** six crops (each as "Growing 🌱" live seedlings or a fixed stage), tilled and watered soil, irrigation water, berry bushes, hay bales, picket fences and gates, scarecrow, water trough, wheelbarrow, beehive, compost bin, harvest crates, chicken coop, farm stand, a sliding barn door, fruit trees and a **Little Farmstead** template. The **🚜 Farm Plot** tool builds a whole field from two clicks — tilled soil, crop rows (one crop or mixed), a water channel every 4th row and an optional fence — as one undo step. Live crops grow by play time (4× faster than survival, faster on watered soil); click / tap a ripe crop to harvest it and it replants itself.

**Views:** **F6** or the **👁️ 1st person / 3rd person** button switches the player perspective; the key can be changed in *Settings → Controls*. **C** toggles the free build camera (WASD fly, Q/E down/up, right-drag look, Alt+right-drag orbit, middle-drag pan, wheel zoom; the hand is hidden and C returns you to where you stood). **Tab** frees the cursor for UI options in the walking view; clicking the map cannot build, remove or select anything until you press Tab or backtick again. **F9** is walkthrough mode (tools hidden; **F** opens doors, switches lights, runs taps and showers). **F10** is photo mode with a time-of-day slider and weather. The time of day can be locked; weather can be set to clear, cloudy or rain. **G** toggles the grid, which follows the storey you are on and fades with distance. **H** collapses the hint panel. Double-tap **Space** to fly.

**Lighting:** every lamp is a real light source, but only the 8 most relevant lights near the camera are active at once (the HUD shows the budget); light switches toggle the lights in their room.

**Also:** room labels, an optional design-challenge checklist (🎯), autosave a few seconds after every change (plus a backup of the previous save), a first-visit tutorial, touch buttons on phones and tablets.

**Data:** the whole catalog is defined in `src/data/buildCatalog.ts`, materials in `src/data/architecture.ts`, furniture models (procedural box/cylinder parts with colour slots and variants) in `src/data/furniture.ts`, challenges in `src/data/buildChallenges.ts`. The engine lives in `src/game/build/` (`BuildMode` controller, `BuildTools` pure construction functions, `BuildHistory` commands, `BuildObjects` instanced furniture, `Presets`, `BuildCamera`). Objects are saved as plain data `{ id, itemId, position, rotation, variantId, state }` — never three.js objects.

## PvP Mode (free peer-to-peer multiplayer)

Main menu → **🎮 PvP Mode**. One player hosts (picks **⚔️ Battle** or **🤝 Build together** — co-op with no player damage —, a kit — Hunter / Knight / Champion —, takedown goal, map seed, building on/off, night creatures on/off) and gets a **6-character room code** plus an invite link (`?pvp=CODE`). Friends choose **Main menu → Join Friend’s World**, enter their name and code, and press **Join game**; **PvP Mode → Join with code** also works. Up to 8 players on a real WildBlocks map generated from the room's seed. Shared worlds, Build together and Battle have no time limit; only Deathmatch is timed. Battle can still end at its selected takedown goal, or use No takedown limit for an ongoing room.

To join a friend's existing survival map or Build Home project, the host first opens **Settings → Play with Friends → Open to friends**, then shares the code shown in their in-game room bar. The same **Join Friend’s World** button opens the correct shared map automatically, including Build Home's full tools. **Worlds → Join Friend’s World with Code** is another entry point. Use **Online** on both devices and keep the host connected. No invite link is required. Deathmatch has its own separate join screen and room codes.

Shared Build Home projects also show the player radar in the top-left: friends appear as coloured dots, distant friends as arrows with distance, and the label shows the nearest friend. It uses existing multiplayer position updates, works for hosts and guests, and hides in Photo mode or when the HUD is hidden. Phone/tablet sizing leaves the header and tool drawer accessible.

* **No server to pay for.** Players connect browser-to-browser over **WebRTC data channels** using [PeerJS](https://peerjs.com). The free PeerJS cloud (`0.peerjs.com`) is only used for the initial handshake; all game traffic then goes directly between players. STUN servers (Google / Cloudflare, free) find the direct route.
* **Topology**: the host is the hub and referee — clients send to the host, the host relays and keeps the scoreboard, timer and map-change log (late joiners receive all block edits so far). Code: `src/net/transport.ts` (PeerJS + a BroadcastChannel transport for two tabs on one device), `src/net/pvpNet.ts` (room create/join), `src/game/pvp/PvpSession.ts` (in-game sync), `src/stores/pvpStore.ts`, `src/ui/MainMenu/PvpScreen.tsx`, `src/ui/HUD/PvpHud.tsx`.
* **Sync**: position/look/animation 12×/s with 110 ms interpolation, armor & held item, swings, arrows, block edits (batched, < 16 KB per WebRTC message), hits (the attacker's game detects the hit, the victim's game applies its own armor & shield), takedowns, match end and "play again".
* **Maps**: Wild World (main map from the seed) or 7 flat arenas (the Build Home lot generator: Flat Meadow, Plain Arena, Desert, Forest, Lakeside, Mountain, Coastal — `WorldMeta.arena`).
* **⚙️ Options**: in-match button for 1st / 3rd person camera, controls help, scoreboard, invite, settings and exit. Everyone moves at the same speed in PvP (armor/buffs don't change it).
* **Voice chat** (`src/net/voice.ts`): opt-in from ⚙️. A WebRTC audio mesh (each pair of players connects directly, ~30 kbps per voice), signalled over the game connection (`v` / `vs` messages relayed by the host). Push-to-talk (T / 🎤) or open mic, proximity voice via Web Audio `PannerNode`, per-player mute. Needs https (or localhost) for the microphone.
* **Radar & rescue**: a top-left radar shows every player (rim arrows + distance when far, ▲/▼ for height). A 🆘 button (or R) appears only when you're stuck in a cave / ravine / water and puts you next to another player (30 s cooldown, not right after being hit).
* **Rules**: immediate automatic respawn while the round is active, with a random safe spawn, full health/energy, the chosen kit refilled and 3 s spawn protection. Battle gear drops where you fell; Build together does not drop gear. A round-ending death stays on results. Movement waits for terrain readiness. PvP hits do ×1.35 damage. These rooms are temporary, except the host's shared Build Home project. Deathmatch keeps its separate 5 s respawn wait.
* **Hosting it yourself (optional)**: very strict networks (some schools/offices, symmetric NAT on mobile carriers) block direct connections. Add a TURN relay with env vars at build time: `VITE_TURN_URL=turn:host:3478` (comma-separate several), `VITE_TURN_USER`, `VITE_TURN_PASS`. To use your own PeerJS signalling server instead of the free cloud: `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`.
* **Testing on one computer**: in the PvP screen open *Connection → This device*, host in one tab and join from a second tab of the same browser.

## Deathmatch — Team Battle

Room-based Red vs Blue combat in **City Clash**, a compact voxel city (152 × 152 playable blocks) built for 1v1 up to 4v4.

**Flow:** Main menu → *Deathmatch — Team Battle* → **Create Room** (pick 5 / 8 / 10 / 12 minutes) or **Join Room** with the 6-character code or an invite link (`?dm=CODE`; PvP's `?pvp=CODE` links are unaffected). In the lobby the host starts on Red and joiners are auto-balanced; switch teams by **double-clicking / double-tapping an empty slot** in the other team or with **⇄ Switch**. The host's **Start Match** needs at least one player per team. Teams then lock, everyone loads the city, and a host-timed 10-second countdown ends with **FIGHT!**. Everyone spawns with a sword; guns, ammo and medkits lie around the city (rare ones in the neutral centre). Eliminated players drop their guns and respawn after 5 s with 3 s of spawn protection (ends early if you attack). The team with more eliminations at the buzzer wins (a tie is a draw); the top killer is MVP (fewer deaths breaks ties, otherwise joint MVP). The host can **Play Again** (back to the lobby, everything reset).

| Desktop | Action |
|---|---|
| Left mouse | Fire (hold for automatics) / swing sword |
| Right mouse (hold) | Aim down sights — M24 uses its 4× scope |
| R | Reload |
| 1 / 2 / 3, wheel, Q | Sword / gun slots / last weapon |
| 4 / 5 | Small medkit (+30) / large medkit (+65, 2 s, interrupted by damage or firing) |
| E | Pick up a gun (ammo & medkits are collected by walking over them) |
| Tab (hold) | Scoreboard |
| Esc | Menu (the match keeps running) |

Touch: joystick left, drag right side to look, 🔥 fire, 🎯 aim toggle, R reload, ⇄ switch weapon, ✋ pick up, 🩹 medkit, ⤒ jump, ⤓ crouch, 🏆 scoreboard. Two health stations (north & south of the plaza) heal 20 HP with a 20 s cooldown.

| Weapon | Damage | Mag | Rate | Ammo |
|---|---:|---:|---|---|
| M416 | 19 | 30 | 11/s auto | 5.56mm |
| AK-47 | 26 | 30 | 8/s auto | 7.62mm |
| MP5 | 15 | 35 | 14/s auto | 9mm |
| Pump Shotgun | 9 × 8 pellets | 6 | 1/s | 12 Gauge |
| M24 Sniper | 80 | 5 | bolt (~0.9/s) | 7.62mm |
| Sword | 25 | — | 0.55 s | — |

Headshots multiply damage (×1.6 rifles, ×2 sniper); damage falls off with distance. Friendly fire is off. All numbers live in `src/game/deathmatch/WeaponDefinitions.ts`.

**Networking.** Same free PeerJS / WebRTC star as PvP (optional `VITE_TURN_*` relay for strict networks; a paid TURN service is the only possible running cost), in its own room namespace. The host runs an authoritative referee (`DmServer`) on a timer, independent of rendering: clients send inputs (movement, fire direction, pickup / heal requests), and the host validates phase, round, cooldowns, ammo, distance and movement speed, traces bullets against the map blueprint (walls stop bullets; glass, leaves and fences don't) with bounded lag compensation (≤ 300 ms), and owns health, eliminations, scores, loot and the match deadline. A dropped player can reconnect into the running match with their score; other joins are refused once preparation starts ("Match in progress"). If the host leaves, everyone gets a clear message and returns to the Deathmatch menu. Like any peer-hosted game this is fair for casual play but not cheat-proof (the host could cheat).

**Testing with two or more devices:** Device 1 → Deathmatch → Create Room → share the code / Invite link. Device 2 opens the link (or enters the code) → Join Room. For a single computer, open *Connection → Same device* in two tabs of one browser. Automated coverage: `src/game/deathmatch/*.test.ts` (lobby rules, combat, results, network edge cases, map walkability).

**Slower-device entry:** Deathmatch skips survival icon generation and waits for the spawn neighbourhood's terrain rather than the whole visible city. Distant chunks continue streaming at the selected render distance. The host allows up to 90 seconds for initial download/loading, then starts the unchanged ten-second countdown as soon as everyone is ready. A client never announces readiness just because a loading timer expired.

**Code:** `src/game/deathmatch/` (map blueprint, rules, referee, weapons, hit detection, loot, spawns, protocol, client session, gun models / view model / audio), `src/net/deathmatchNet.ts`, `src/stores/deathmatchStore.ts`, `src/ui/Deathmatch/`, `src/styles/deathmatch.css`.

## Architecture

```
src/
  main.tsx, app/              React shell: screens, error boundary, world launch, lazy 3D bundle
  ui/                         All interface (HUD, inventory, crafting, journal, map, menus, settings, touch)
  stores/                     zustand: game (screens/overlays/toasts), inventory, player vitals, world progress, settings
  data/                       Content tables: blocks, items, recipes, biomes, creatures, quests/lore
  persistence/                IndexedDB schema, SaveManager, migrations, save types
  platform/                   PlatformService + Browser/Playgama implementations
  game/
    Game.ts                   Engine root: owns world, systems, rendering; main update/render loop
    GameCanvas.tsx            R3F <Canvas> + frame bridge (the only React ↔ engine seam)
    core/                     EventBus, GameClock, InputManager, AudioManager, AssetManager, seeded random
    world/                    coordinates, Chunk, BlockRegistry, TerrainSampler (biomes/rivers/lakes),
                              ChunkGenerator (terrain/caves/ores/trees/landmarks), StructureGenerator,
                              TreeGenerator, ChunkMesher (greedy + AO + light), ChunkManager (streaming), World
    workers/                  world.worker.ts (generate + mesh), WorkerPool (priority queue, main-thread fallback)
    player/                   Player (movement, vitals, camera), PlayerInteraction, Raycast, VoxelPhysics
    entities/                 EntityManager (spawning, AI, combat hooks), DroppedItems
    systems/                  Crafting, Building/shelter, Farming, Containers, TreeFelling, Environment (day/night/weather),
                              Progress (quests/journal/homestead/harmony), SpawnFinder, InventoryLogic (pure)
    rendering/                TexturePainter (procedural atlas), TerrainMaterials (shaders), Sky/Clouds, Particles/Rain,
                              Models (creatures/explorer/tools), BlockGeometry, FirstPersonViewModel (hand rig), PlotBackdrop, IconPainter
    build/                    Build Home: BuildMode (tools, ghosts, camera, lights, autosave), BuildTools, BuildHistory,
                              BuildObjects (instanced furniture), ObjectGeometry, Presets, BuildCamera, BuildIcons
```

**React vs engine.** React renders menus and HUD only. The world is engine classes: chunk meshes are merged `BufferGeometry` built from typed arrays, creatures are plain objects with a `THREE.Group` rig, and nothing per-block or per-creature is a React component. The engine pushes UI-relevant values into zustand at low frequency and only when they change; the compass and home arrow read the engine directly in their own `requestAnimationFrame` to avoid per-frame React renders.

**Frame loop.** `GameCanvas` registers a single `useFrame(…, 1)`: `game.update(dt)` then `game.render()` (world pass, then a depth-cleared first-person hand pass so tools never clip into walls). Single-player simulation pauses in overlays (pause, backpack, journal, map…); multiplayer continues.

**Events.** Gameplay publishes typed events (`blockBroken`, `treeFelled`, `itemCrafted`, `creatureFed`, `landmarkFound`…) on the `EventBus`; quests, achievements, the journal, homestead points and harmony all subscribe instead of polling.

## World system

* **Coordinates** — `world/coordinates.ts` is the only place with chunk math: `blockToChunk` / `blockToLocal` handle negatives, index layout is `y*256 + z*16 + x`. Chunks are 16×16×128.
* **Storage** — one `Uint8Array` of block ids + one of metadata per chunk (rotation, open/closed, crop stage…). Block ids index `data/blocks.ts` (append-only).
* **Generation** — `TerrainSampler.sample(x, z)` is a pure column function (continentalness, climate → biome weights, blended heights, terraces, rivers, lakes, tints). `ChunkGenerator` fills columns, carves caves, places ores by depth/biome, decorates, grows trees and builds landmarks. Features crossing chunk borders are generated from world-space seeds so both chunks agree.
* **Streaming** — `ChunkManager` requests generation within `renderDistance + 1`, meshes a chunk once its 8 neighbours exist, uploads at most a few meshes per frame, and unloads beyond `renderDistance + 3` (disposing geometry). The player is frozen if the chunk underfoot isn't ready, and unloaded chunks collide as solid, so you can never fall through missing terrain.
* **Meshing** — greedy meshing for cubes with per-vertex ambient occlusion, sky exposure and flood-filled **block light** from torches/lanterns/crystals (computed over the 3×3 chunk neighbourhood so light crosses borders). Plants, furniture and shapes are emitted into the same chunk mesh (zero extra draw calls). Output: `solid`, `cutout` (alpha-tested, wind-sway in shader) and `water` (custom shader with depth colour, animated normals, fresnel, falling-sheet streaks).
* **Textures** — `TexturePainter` paints 88 tiles (64×64) into one `DataArrayTexture` at startup; per-block variation (rotation/mirroring) is chosen in the shader from the block position hash, and biome tint is applied through a per-texel tint mask.

## Save system

IndexedDB database `wildblocks` (v2) with six stores:

| Store | Key | Contents |
| --- | --- | --- |
| `worlds` | `id` | name, numeric seed + seed text, difficulty, created/last played, play time, thumbnail, `saveVersion` |
| `states` | `id` | player (position, vitals, buffs), inventory + equipment, progress (quests, journal, homestead, harmony, home, waypoints), game time, weather, containers, crops, dropped items, companion |
| `chunks` | `worldId\|cx,cz` | `changes: [localIndex, blockId \| meta << 8][]` — **only modified blocks** |
| `maps` | `worldId\|cx,cz` | 16×16 map colours of explored chunks |
| `backups` | `id` | the previous good `states` record (restored automatically if the latest save can't be read) |
| `blueprints` | `id` | Build Home blueprints (shared by all projects; stored with block keys so ids can be remapped) |

World metadata carries `mode: 'survival' | 'build'` and, for Build Home, the plot, time of day, lock and weather; Build Home state adds `build: { objects, nextId, camera }`. Version 1 saves are migrated to version 2 (they become survival worlds) — nothing is discarded.

Generated terrain is regenerated from the seed; recorded changes are re-applied when a chunk loads. Survival autosaves every 45 s; Build Home saves after edits and periodically. Pause, sleeping and quitting save too; tab hiding/closing attempts a best-effort save. Only changed chunks are written. Save metadata, state, edits, map tiles and the previous-state backup commit atomically. Edits made during saving remain pending, failed writes retain data for retry, and Save & Quit stays open on failure. Every record carries `saveVersion`; `persistence/migrations/index.ts` upgrades old data step by step (`SAVE_VERSION = 2`). The loader can recover an unreadable current state from one previous-state backup; this is not a full terrain/version history. Settings live in `localStorage`. All progress is local to the browser/site/device. If IndexedDB is unavailable the game uses an in-memory store and warns on the main menu.

## Performance & optimisation

* Workers: generation + meshing run in a pool of `hardwareConcurrency − 1` (max 6) module workers with a nearest/in-view/ahead-of-movement priority queue, re-prioritised at dispatch.
* Greedy meshing + neighbour culling: a typical chunk is ~2–3k triangles; three shared materials; one draw call per chunk layer.
* Batched edits (`world.beginBatch/endBatch`): a felled tree or door toggle remeshes each affected chunk once; neighbour chunks remesh only for border edits or light changes.
* Creature AI tiers: < 24 blocks = 10 Hz decisions, < 56 = 3 Hz, beyond = asleep and hidden; > 88 = despawned.
* Pooled particles (one instanced mesh), camera-relative rain in the vertex shader, instanced clouds wrapped in the vertex shader, a pool of 4 point lights for creatures near torches, blob shadows instead of shadow maps.
* Pixel ratio is clamped (`maxPixelRatio`) and resolution scale is adjustable; **Auto quality** watches sustained frame time and lowers touch-device pixel ratio → render distance (down to 3) → resolution (down to 0.5) → shadows → high particles → clouds, with a toast. Build Home respects lower render-distance settings too.
* Frustum culling via per-chunk bounding spheres; fog is matched to render distance to hide chunk edges.
* Mesh preparation and uploads are bounded between complete chunks; stale meshes are discarded. Standable-column queries are cached by chunk version, furniture lighting avoids full-map copies, and session-owned preview/combat/helper resources are released. See the audit for validation and remaining real-device performance checks.

## Extending the game

### Adding a block
1. Append an entry to `BLOCK_DEFS` in `src/data/blocks.ts` (**append only** — the array index is the id stored in saves). Pick `shape` (`cube`, `cross`, `model`, `fence`, `liquid`), `layer`, `hardness`, `tool`, `drop`, `sound`, and optional `light`, `interact`, `station`, `rotates`, `comfort`, `homestead`.
2. Cube blocks: set `tiles: { top, side, bottom }` to tile names. New tile? add its name to `TILE_NAMES` in `world/tiles.ts` and a painter function in `rendering/TexturePainter.ts`.
3. Model blocks: add a box list to `MODELS` in `world/shapes.ts` (1/16 units; front is +Z).
4. Make it an item: add the key to `PLACEABLE_BLOCKS` in `data/items.ts` (icon is rendered automatically).
5. `npm run test` — `data.test.ts` checks every drop, tile, model and item reference.

### Adding a recipe
Add a line to `RECIPES` in `src/data/recipes.ts`:
```ts
r(i('lantern', 2), [i('copper_ingot'), i('torch'), i('glass')], 'forge', 'Furniture'),
//  output ×count    inputs                                   station   category   [homestead level]
```
`station: null` means craftable anywhere from the backpack.

### Adding a biome
Add a `BiomeDef` to `src/data/biomes.ts` (climate centre, height parameters, terrace strength, tints, surface blocks, trees, flowers, map colour). `TerrainSampler.biomeWeights` blends biomes by climate distance automatically; give a rare biome an extra gate like the Crystal Highlands. Mention it in `ProgressSystem`/journal (automatic via `BIOMES`).

### Adding a creature
1. Add a `CreatureDef` to `src/data/creatures.ts` (stats, biomes, time, habitat, favourite foods, gifts or drops, subtitle).
2. Add a case to `buildCreature` in `rendering/Models.ts` returning a rig (`root`, `body`, `head`, `legs`, …) and optionally a tweak in `animateCreature`.
3. Optional synth voice in `AudioManager.creature`.
Spawning, AI tiers, combat, feeding and the journal pick it up automatically.

### Replacing procedural art
* Block textures: replace `paintAllTiles()` with a loader that fills the same `DataArrayTexture` layers from a `terrain-atlas.webp` (keep the tile order from `TILE_NAMES`; alpha is the tint mask for opaque tiles).
* Creatures/player: return a GLB scene from `buildCreature` / `buildExplorer` with the same pivot names; drive clips with an `AnimationMixer` in `animateCreature`.
* Sounds: `AudioManager.play(name)` is the single entry point — swap the synth call for a decoded `AudioBuffer`.
* Record every external asset in `ASSET_LICENSES.md`.

## Debugging

* **F3** toggles the debug overlay: FPS, position, chunk, biome, loaded/meshed chunks, worker queue, triangles, draw calls, entities, light level, seed, time, memory. It can also be enabled in *Settings → Gameplay*.
* In the console, `window.wildblocks.game` is the running `Game` and `window.wildblocks.stores` exposes the zustand stores (handy for testing: e.g. `wildblocks.stores.inventory.getState().add('torch', 16)`).
* If Web Workers are blocked (strict CSP), `WorkerPool` falls back to main-thread jobs with an 8 ms scheduling budget between complete jobs; one generation/mesh job can take longer.

## Testing

`npm run test` runs Vitest in Node:

* `coordinates.test.ts` — coordinate conversions (incl. negatives), chunk indexing, chunk keys.
* `InventoryLogic.test.ts` — stacking, overflow, removal, click/split/merge/swap, quick transfer, sorting.
* `data.test.ts` — content integrity (every id/tile/model/item reference), MVP targets, crafting rules & stations.
* `worldgen.test.ts` — seed determinism, biome/river/water variety, caves & floor, safe spawn, greedy meshing, border culling, light propagation.
* `systems.test.ts` — orientation, doors, placement rules, shelter detection, timestamp crop growth, game clock/sleep.
* `save.test.ts` (fake IndexedDB) — create/list/rename/delete worlds; **place/break → save → reload → blocks remain**; crafted inventory, chest contents and crops persist; old-save migration; Build Home projects stay separate and round-trip their objects; a damaged save restores the backup.
* `validation.test.ts` — the data validator (no errors), survival obtainability, building-recipe coverage, craft states (missing / far station / inventory full), recipe search.
* `build.test.ts` — Build Home tools (walls, rooms, gable/hip roofs, pools, stairs, terrain brushes, wall openings, copy/paste rotation), undo/redo commands, object collision/doors/raycast/instancing, plot generation, catalog, presets, window bounds, scenery backdrops, challenges.

`npm run validate:data` runs the content validator on its own (exit code 1 on any error): broken references, unobtainable items, self-consuming recipes, dependency cycles/deadlocks, stack sizes, catalog variants and furniture models.

## Playgama build

Platform code is isolated in `src/platform/`. The core game only calls the `platform` facade (`gameReady`, `onPauseChange`, optional `showRewarded`). `PlaygamaService` uses only documented Playgama Bridge calls (`bridge.initialize()`, `bridge.platform.sendMessage('game_ready')`, `PAUSE_STATE_CHANGED`, `advertisement.showRewarded()` + `REWARDED_STATE_CHANGED`, `platform.language`).

1. `npm run build`.
2. In Playgama's config set the game's orientation to **landscape** (the game also locks / asks for landscape itself, but portals can override it inside their iframe).
3. Add the bridge script to `dist/index.html` **before** the game script:
   `<script src="https://bridge.playgama.com/v1/stable/playgama-bridge.js"></script>`
4. Create `playgama-bridge-config.json` with Playgama's config editor and place it next to `index.html`.
5. Zip the contents of `dist/` and upload. The facade detects `window.bridge` and switches to `PlaygamaService` automatically; without it the game runs in plain browser mode.

Ad policy baked in: no interstitials during play; rewarded ads (if you wire one to a cosmetic, e.g. a scarf dye) are strictly player-initiated. Saves stay in local IndexedDB.

## Known limitations

* **No fluid simulation** — water is static (rivers, lakes, oceans, waterfalls are generated); placing/removing blocks next to water doesn't make it flow.
* **Voxel lighting is baked per chunk mesh** (sky exposure + propagated block light). Opening a roof or adding a torch remeshes the chunk (and neighbours for light), which is fast but not instantaneous in the same frame. Sky light under long overhangs is approximated by depth.
* **Shadows** — creatures use blob shadows; there are no real-time shadow maps for terrain (by design for low-end devices).
* **Combat** is intentionally simple: melee sweeps, crits, bows and shield blocks — no dodge roll; armor doesn't wear out.
* **PvP** trusts each player's game for its own hits (fine among friends, not cheat-proof); if the host leaves, the match ends. The free PeerJS cloud has no uptime guarantee — set `VITE_PEER_HOST` to run your own.
* **Gamepad** input is not implemented (touch and keyboard/mouse are).
* **Weather** doesn't change terrain (no puddles/snow build-up); rain only soaks farmland.
* Creatures other than a tamed companion aren't saved — they respawn naturally around you.
* **Build Home:** at most 8 lamps light the scene at once (nearest / brightest first); furniture uses simple procedural box models; walls are whole blocks (thin partitions use wall panels); only straight staircases are generated by the tool (landings and L-shapes can be built from stair blocks); copy/paste regions and blueprints are capped at 400k blocks.
* Device performance and networking need release testing on actual target hardware. The audit includes a repeatable acceptance matrix; successful TypeScript, Vitest and Vite checks do not guarantee a particular mobile frame rate.
# wildblock-by-sachin
