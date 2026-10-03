# Changelog

## 1.3.0 — Loot drops, gyro aiming & separate talk / listen

- **🏡 Build Home together**: opening a Build Home to friends keeps everyone in Build Home mode — full catalog, every tool, flying — instead of a PvP kit. Anything anyone places, moves, deletes, paints or opens shows up for everyone, and it's all saved in the host's project. Room code, players and 🎧 / 🎤 sit at the bottom of the screen.
- **🎮 Play your own world with friends**: Settings (top) or the pause menu → "Play this world / home with friends" opens a PvP room (Battle or Build together) on the Survival world or Build Home you're in — same terrain, every block you changed and, for Build Home, your house and furniture (solid for everyone). Friends spawn around you. Your save isn't changed by the match.
- **Voice works on iPhone / iPad**: the 🎧 / 🎤 buttons did nothing there (audio was started on touch-down, which iOS doesn't count as a tap, and the game waited for it forever). Taps now use click, audio wakes on the next tap anywhere, and voice links are rebuilt once when you first switch your mic on so Safari sends your voice.
- **Listening is on by default** for everyone in a match (switch 🎧 off if you like — that choice is remembered). Talking stays optional.
- **Gyro on iPhone / iPad**: Safari reports the rotation axes in a different order, which turned the camera the wrong way. Detected automatically, with a manual "Axis layout" switch in Settings → Controls.
- **🆘 Quick respawn** is always in the PvP ⚙️ panel (not during a fight, 8 s cooldown); the pop-up 🆘 button in the middle of the screen (and its R key) is gone.
- **📍 Coordinates & teleport** in the PvP ⚙️ panel: your coordinates (tap to copy), every player's coordinates with a **Go** button, and a box to teleport to any `x y z` or `x z`.
- **✕ close button on every popup**: pause menus, controls, lore, Build Home dialogs and pop-ups, delete-world confirm, end-of-match scoreboard.
- **Character faces where you move**: in third person your explorer turns toward the joystick / WASD direction (walking left shows them walking left), and squares up to the camera while attacking, using or aiming. Other PvP players see your body direction too. Toggle: Settings → Gameplay.
- **PvP loot drops**: when a player is taken down in a Battle match, everything they carried (hotbar, backpack, armor, shield) spills on the ground where they fell, on every player's screen. Walk over it to pick it up. The host decides who gets each item (first come, first served), so two players grabbing the same item can't duplicate it. The defeated player respawns with a fresh kit as before. Loot disappears after 3 minutes or when a new round starts. (Not in Build Together.)
- **🎯 Gyro aiming (optional)** for phones & tablets: turn the device to aim, together with drag-to-look. Off by default. Settings → Controls has device profiles (Auto / 📱 Phone / 📲 Tablet), sensitivity, vertical speed, smoothing, invert left/right and up/down, "always" or "only while attacking / aiming", and a live "gyro is working" check. Asks for motion permission on iOS. Also a quick On/Off in the PvP ⚙️ panel.
- **Voice chat: separate 🎧 Listen and 🎤 Talk** buttons on screen (above the joystick on touch, under the radar on desktop). Listen works without a microphone; the mic is only requested the first time you talk. Talk is "hold to talk" or "tap on / off". Keys: **T** talk, **H** listen. Players who aren't listening are marked in the voice list; you can stop using the mic or leave voice from the ⚙️ panel.
- **PvP quick options on desktop**: press **O** (rebindable) to open / close the ⚙️ panel (camera 1st / 3rd person, voice, controls, exit) — the mouse is freed while it's open; O, Esc, ✕ or clicking the game closes it.
- **Responsive fixes** (automated audit on 14 screen sizes, 568×320 phone to 1920×1080 desktop, plus portrait): backpack panel cut off its Craft buttons and scarf picker on desktops; the journal list spilled out of its panel on phones; PvP match chips covered the energy bar on desktop windows narrower than 1280 px (chips now sit top-right there); the hotbar overlapped the joystick and buttons on small phones; the compass overlapped the top buttons on 667 px phones; Settings had almost no room on short landscape phones.

## 1.2.4 — Scrolling panels on every device

- **PvP host screen overflowed and couldn't scroll** on tablets and laptops (the long list of styles, maps, kits and options ran off the screen). All menu forms (PvP, New World, Build Home, Worlds, Settings, How to Play) now scroll inside the panel with touch swipe, mouse wheel and trackpad; nothing gets squashed.
- **PvP pause menu** ran off short phone screens (the new camera button made it taller): it now scrolls, and on landscape phones the buttons sit in two columns.
- **In-game ⚙️ panel** (camera, voice chat, controls…) scrolls on small screens; Resume is always reachable.
- Fixed a stray dashed border floating in the middle of scrolled panels.
- Verified with an automated audit on 8 screen sizes (small phone 667×375, phone 844×390, large phone 932×430, iPad 1180×820, iPad mini 1024×768, small laptop 1024×600, laptop 1366×768, desktop 1920×1080): each panel fits the screen, scrolls by real touch swipe / mouse wheel, and its last button is reachable and tappable.

## 1.2.3 — Voice chat in PvP Mode

- **🎤 Voice chat** (⚙️ menu → Voice chat: On). Free and serverless like the rest of PvP: every pair of players gets a direct WebRTC audio connection; the handshake travels over the existing game connection (relayed by the host), so it needs no extra service and also works in the two-tab test mode.
- **Hold T** (keyboard) or the **🎤 button** (touch, above the joystick) to talk, or switch to **Always on**. Echo cancellation, noise suppression and auto gain from the browser.
- **Nearby louder** (proximity voice: louder when close, from the speaker's direction, silent beyond ~48 blocks) or **Everyone** (same volume everywhere).
- Per-player **mute**, a list of who's in voice, live "🔊 name" chips while someone talks, and your own mic state on screen.
- Off by default; only players in your room can hear you. If the mic is blocked or missing you can still listen.

## 1.2.2 — PvP Mode: build together, camera & options

- The menu button is now **🎮 PvP Mode** ("battle or build with friends").
- New **game style** when hosting: **⚔️ Battle** (takedowns, timer, winner) or **🤝 Build together** — co-op: players can't hurt each other, no timer, building always on, and a builder's kit (pick, axe, planks, fieldstone, brick, glass, torches, food, plus a sword & bow for night creatures).
- **⚙️ Options button** in the PvP HUD: switch **1st / 3rd person** camera, controls help (touch or keyboard), players & scores, invite friends, settings and **Exit game** (tap twice). The pause menu also has a camera switch; V still toggles it on keyboards.
- **Faster movement**: walking 4.3 → 5.0 and sprinting 6.5 → 7.6 blocks/s everywhere; in PvP everyone moves at exactly the same speed (5.6 walk / 8.2 sprint) — armor, buffs and energy don't change it, and sprinting never runs out.

## 1.2.1 — PvP: radar, rescue & maps

- **Player radar** (top-left in PvP): you in the middle facing up, other players as coloured dots; players further than 60 blocks sit on the rim as arrows with their distance; ▲ / ▼ when someone is far above or below you; "Nearest: name · distance" underneath. On phones/tablets it replaces the compass.
- **🆘 Emergency respawn**: appears only when you're stuck — fallen into a cave, ravine or hole for ~7 s, or in water for ~5 s. Tap it (or press R) to be placed on solid ground near a random other player. You keep your health and items and no death is counted. Not available within 5 s of being hit (no escaping fights), 30 s cooldown.
- **Map choice** when hosting: 🌲 Wild World (the main map), 🟩 Flat Meadow, ⬜ Plain Arena, 🏜️ Desert Flats, 🌳 Forest Clearing, 🏞️ Lakeside, ⛰️ Mountain Valley, 🏖️ Coastal — the flat maps are big 256 × 256 arenas with scenery around them.
- Phone/tablet PvP HUD tidied: match chips moved under the top-right buttons.

## 1.2 — Armory, caves, dangerous nights & PvP

### ⚔️ PvP Battle (free, peer-to-peer)
- New main-menu mode: **host a match** and share a 6-character room code / invite link, or **join with a code**. Up to 8 players on a real WildBlocks map from the room's seed.
- **WebRTC + PeerJS, no server costs**: the free PeerJS cloud only introduces players; game data goes directly between browsers. Optional TURN / self-hosted PeerServer via `VITE_TURN_*` / `VITE_PEER_*` env vars. A "This device" mode runs a match between two tabs for testing.
- Kits (Hunter / Knight / Champion), match length, takedown goal, map seed, building & digging on/off, night creatures on/off.
- Synced players with name tags, armor, held weapons and swing animations; melee & arrow hits (your armor and shield count), shared block edits (late joiners get the whole map history), kill feed, scoreboard (Tab / 🏆), match timer, winner screen and "Play again", 5-second respawn with a fresh kit.

### 🛡️ Armory
- 5 armor sets × 4 pieces (Thornhide, Gloomhide, Copper, Tempered, Crystal) in a new **Armor** recipe tab; full set bonus +8%; damage reduction capped at 75%; Gloomhide makes you a little faster.
- New **Legs** and **Shield** equipment slots; 4 shields block hits from the front ("Blocked!").
- **Hunter Bow** and **Crystal Bow** with **Arrows** (right click / tap; hold to keep shooting). Arrows fly in an arc, stick in blocks and can sometimes be picked up again.
- Armor and shields are drawn on your character; armor % and set bonus in the backpack and a 🛡️ chip on the HUD.

### 🌙 Dangerous nights
- Dusk warning; many more hostile creatures after dark (Explorer: 5 on the first night, 12 after; Adventurer 18); new **Gloomstalker** and **Duskfang** (pack hunter) that track you from far away; a hunting pack comes for you around midnight. Lit places and roofed homes stay safe.
- At dawn they retreat, and you see how many you drove off.

### 💥 Mob killing
- Floating damage numbers (gold crits), health bars over hurt enemies, "Defeated!" bursts, kill milestones; new drops (Gloom Hide, Dusk Fang) used for armor and better arrows.

### 🕳️ Caves
- New worlds get **caves v2**: wider tunnels, a second long tunnel network, bigger caverns, more cave entrances and deep **ravines** (no floating trees over them). Existing worlds keep their terrain.

### Dev
- `npm run typecheck`, `npm run test` (81 tests), `npm run validate:data` (172 items obtainable) and `npm run build` pass. Two-player PvP verified end-to-end in two browser tabs (join, movement, armor sync, hits, takedown + respawn, block edits, arrows, leave).

## 1.1.3 — Every button, every device

Found with an automated audit that opens every screen and dialog on a small phone (667×375), a phone (844×390), an iPad (1180×820, touch) and a desktop (1280×720, mouse) and checks that each button is really on top and reachable, plus click-tests of the key actions.

- **Delete World did nothing.** The "Delete forever?" confirmation opened *behind* the world list (all modal dialogs now sit above the screen that opened them). Rename / delete verified on all four devices.
- **Build Catalog on phones:** picking an item needed a double-click or the details column — which is hidden on narrow screens, and the double-tap zoom guard swallowed the second tap. Now: tap a tile once for details (a bottom sheet on phones, with colours, Place and ☆), tap it again to place. The zoom guard never touches buttons/tiles any more.
- **The aiming dot blocked taps** in the middle of the screen (and an option button under it) in Build Home.
- **Desktop Build Home:** the "Click to keep building" layer covered the whole toolbar; it now only covers the 3D view, so Undo / Fly / Catalog / tools are clickable straight away (same for the survival hotbar).
- Small phones: the design-challenge card collapses to a 🎯 chip so it doesn't cover tool options; smaller tutorial card on short screens.

## 1.1.2 — iPad / phone fixes

- **"Click to keep building" got stuck on iPads / phones** (tapping did nothing). The card decided whether touch controls were on at its first render — before the touch UI had switched on — and never re-checked; iOS has no mouse capture to dismiss it. Touch mode is now decided up front (also detects iPads in "desktop website" mode) and every component reads it reactively.
- **Photo mode wasn't tappable on touch.** The photo panel rendered outside the Build Home HUD container and inherited its click-through. Fixed, plus touch camera controls in photo mode (stick moves, drag to look, ⏫ ⏬), touch help text, and the panel sits top-left clear of the joystick.
- **Toasts on phones/tablets:** small pills at the side under the top buttons, at most two at a time, the rest queue up one by one; shorter on screen; tap one to dismiss.

## 1.1.1 — Mobile flight fix & more homes

- **Flying on phones/tablets drifted up into the sky.** Double-tapping ⤒ swapped that button for ⏫/⏬ while the finger was still on it, so the "up" release was never seen and you kept climbing (the same could leave ⏬/crouch stuck after landing). Held buttons are now released by finger (pointer id) at window level, up/down holds reset whenever flight starts or ends, and the tap that starts flight no longer counts as "up" — you hover in place.
- Landing never triggered when you flew down onto the ground (the check ran after the collision zeroed the speed) — descending with ⏬ / Shift now lands you.
- Gentle flight ceiling and a calmer "full stick" fly speed on touch.
- **5 new Build Home templates:** Cozy Cottage, Beach House on Stilts, Modern Villa with Pool, Mountain A-Frame Chalet and Tiny Modern House (10 templates in total).

## 1.1 — Mobile, flying, farming, boats & swords

### Bugs fixed
- **Doors never visibly opened (Build Home).** The door-swing maths reused a shared scratch matrix that also held the door's world position, so every swinging door leaf (and the garden gate, double doors, the front entrance and the fridge doors) was drawn at the world origin under the ground — you only ever saw an empty frame. Fixed in `BuildObjects.animMatrix`; covered by a regression test (`farm_doors.test.ts`).
- **Hotbar not tappable on phones/tablets.** The full-screen touch "look" layer sat above the HUD and swallowed every tap (also on Build Home panels and the tutorial buttons). The HUD is now layered above the touch layer and stays click-through except for its controls.
- **Blurry graphics on phones/tablets.** Touch devices defaulted to pixel ratio 1 × 0.75 resolution (≈¼ of a phone's real pixels). New mobile profile renders sharp (up to 1.75×) and saves GPU time on render distance/particles instead; old saved settings are upgraded automatically. Auto quality trims the pixel ratio first on phones.
- **Couldn't hit creatures standing in tall grass/flowers** — plants no longer block attacks (or boarding a boat).
- Touch buttons overlapped the objective card and each other; Build Home's joystick covered the tool palette; the backpack opened on a large character card with the item grid off-screen; the main menu overflowed on landscape phones.

### Phones & tablets
- Always landscape: fullscreen + orientation lock on Android (first tap), a pause-and-rotate card on iOS, `manifest.webmanifest` with `"orientation": "landscape"`.
- No browser zoom: double-tap & pinch zoom, long-press callouts, text selection and context menus are blocked (`src/app/mobile.ts` + CSS `touch-action`).
- New touch layout: tidy two-row button cluster, compact HUD, tap-to-use / hold-to-break on the open screen, objective card collapsed by default, touch-friendly prompts, tabbed backpack, press-and-hold to split stacks, no sticky tooltips.
- Build Home on touch: tool drawer, scrollable top bar, centred aiming in the build camera (drag to look, ⏫ ⏬ to move up/down), touch-specific tutorial and status text.

### Build Home
- **Flying:** 🕊️ Fly button (plus double-tap Space / double-tap ⤒); Space/⏫ up, Shift/⏬ down, Ctrl or a full stick push = faster.
- **Doors:** click/tap a door, gate or curtain to open/close it; right-click also uses lights, taps, TVs.
- **Farming category (🌾):** 6 crops (Sunwheat, Skycorn, Blushberry, Emberroot, Puffgourd, Brookmint) as live-growing seedlings or fixed stages, soil, irrigation, berry bushes, hay bales, fences & gates, scarecrow, water trough, wheelbarrow, beehive, compost bin, harvest crates, chicken coop, farm stand, sliding barn door, fruit trees, "Barn Red" wall material and a **Little Farmstead** template.
- **🚜 Farm Plot tool:** two clicks build a whole field (tilled soil, crop rows or mixed rows, water channels, optional fence) as one undo step.
- Live crops grow over play time and can be harvested (tap/click) — they replant themselves; harvest counter.

### Survival
- **Swords:** Wooden (backpack), Stone (workbench), Copper (forge), Tempered and Crystal (renamed from "Blade"). Sweep attacks hit every hostile in front of you; falling strikes are critical hits.
- **Rowboats:** craft, place on water, ride with WASD/joystick, step out with Jump; saved with the world.
- **New crops & food:** Skycorn and Blushberry (found in tall grass), Roasted Skycorn, Garden Salad, Hay Bales.

### Dev
- `npm run typecheck`, `npm run test` (80 tests, 6 new), `npm run validate:data` and `npm run build` all pass.
