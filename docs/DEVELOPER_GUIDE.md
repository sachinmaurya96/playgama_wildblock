# WildBlocks development guide

For player instructions see [PLAYER_GUIDE.md](PLAYER_GUIDE.md). For findings, safety decisions and device acceptance checks see [CODE_AUDIT.md](CODE_AUDIT.md).

## Work locally

Use Node 20.19+ and install dependencies with `npm install` (or `npm ci` for the lockfile). Run `npm run dev` and open its local URL. A current WebGL 2 browser is required for the 3D game.

Before delivery run:

```sh
npm run test
npm run build
npm run validate:data
npm run docs:players
```

`build` includes strict TypeScript checks. `preview` serves the production output. Vite uses relative asset paths for subdirectory hosting. Deploy the complete `dist/` directory, including workers and lazy chunks. There is no service worker promising offline reloads.

## Find the right owner

| Change | Main location / responsibility |
| --- | --- |
| Screen navigation and launching | `src/app/App.tsx`, `launch.ts`, `GameView.tsx` |
| Input / cursor / touch / gyro | `game/core/InputManager.ts`, `Gyro.ts`, `app/mobile.ts`, `ui/Touch/` |
| Frame orchestration and lifecycle | `game/Game.ts`, `GameCanvas.tsx` |
| Survival movement and interaction | `game/player/Player.ts`, `VoxelPhysics.ts`, `PlayerInteraction.ts` |
| Terrain generation / meshing / streaming | `game/world/`, `game/workers/` |
| Inventory and recipe rules | `game/systems/InventoryLogic.ts`, `CraftingSystem.ts`; presentation in `ui/Inventory/` |
| Farms, containers, boats, progress | Corresponding classes in `game/systems/`, plus `game/entities/Boats.ts` |
| Creative tools, history and furniture | `game/build/BuildMode.ts`, `BuildTools.ts`, `BuildHistory.ts`, `BuildObjects.ts` |
| PvP session and transport | `game/pvp/`, `net/pvpNet.ts`, `net/transport.ts` |
| Deathmatch rules and host authority | `game/deathmatch/`, `net/deathmatchNet.ts` |
| Voice lifecycle and UI | `net/voice.ts`, `ui/Voice/`, multiplayer option panels |
| Saved records and migrations | `persistence/SaveManager.ts`, `database.ts`, `types.ts`, `migrations/` |
| Blocks/items/recipes/creatures/build catalog | `data/` |
| Player-facing documentation | `data/playerGuide.ts`, `data/buildControls.ts`, `ui/MainMenu/HowToPlay.tsx` |

React owns screens and HUD. Engine classes own simulation and Three objects. Push UI state at controlled rates and only when necessary; avoid a React component per block/entity or store writes on every render frame.

`joinFriends` reuses `PvpScreen` with `initialTab="join"`; it does not create a separate multiplayer protocol. `joinRoom` obtains the host's settings before `launchPvp` routes a Build Home guest into creative co-op or a survival/PvP guest into the shared map. Keep `?pvp=CODE` invites and Deathmatch's separate `?dm=CODE` namespace working.

Deathmatch skips survival icon generation. Its loading screen requires generated and meshed spawn-neighbourhood chunks, while the configured outer render distance streams during preparation/play. `LOAD_TIMEOUT_SECONDS` covers host waiting for initial downloads and terrain; do not announce readiness for an unmeshed spawn after a fixed timer. The host starts its ten-second countdown as soon as everyone is ready.

## Preserve compatibility and behavior

1. Identify callers, mode differences, saved data and resource ownership before changing a function. Search both static imports and dynamic uses such as workers, debug handles, callbacks and catalog keys.
2. Read the existing tests and add focused regressions for meaningful rules/races. Prefer observable outcomes (saved edits, usable doors, collision results, active textures) over tests that duplicate implementation details.
3. Make small changes with explicit invariants. Keep old-save loaders and intentional compatibility paths unless a migration proves removal safe.
4. Never reorder existing block IDs or change stable content keys casually. Worlds store numeric block IDs; blueprints and items use keys. Generation changes need version flags so old seeded worlds remain stable.
5. Validate all modes affected by shared code. Shared frame finishing still has distinct cloud/light behavior for Build Home and Deathmatch; a shared utility must not erase these differences.

## Safe hot paths

- Use `core/Spring.ts` for the existing view-model spring behavior and `core/graphics.ts` for DPR/Auto quality. Do not create divergent copies.
- UI must use `game/registry.ts` with type-only engine imports. Importing `Game` as a value into menu/UI modules can defeat lazy loading. Icon URLs come from `core/iconUrls.ts`; generating icons belongs to the engine.
- Reuse temporary vectors and immutable shared geometries where ownership permits. Cache expensive queries with an explicit invalidation contract: `World.standableY` invalidates on chunk version/replacement.
- Batch block edits with `world.beginBatch()` / `endBatch()` so one large action does not remesh on every cell. Build commands collect reversible edits through `BuildHistory`.
- Chunk work is versioned and tied to a record identity. Never install results after unload/reload or after newer edits. Worker transfer lists detach inputs: rebuild a failed mesh job instead of reposting its old arrays.
- Time budgets apply between complete jobs; large individual work is still capable of causing a hitch. Measure before promising smoothness.
- Keep frequent UI filtering/recipe state work memoized. Inventory actions create new slot arrays so React can detect changes.

## Rendering ownership and teardown

Cached model/object materials, box/model geometry and icon textures are shared across consumers. AssetManager owns each terrain atlas/material set, which all chunks and held blocks share within that renderer. Session-owned objects include chunk geometries, overlays, preview planes, private flash assets and CombatFX text/bar textures. Dispose resources through their owner after all consumers release them. Removing a scene node alone does not free GPU resources; renderer/context teardown also matters.

Do not traverse every object and dispose all materials indiscriminately: many instances share material and geometry caches. Mark or document private ownership, and test that disposing one session does not break a following session. CombatFX cache eviction must skip textures referenced by active sprites.

## Saves and failure handling

`Game.saveNow(reason)` returns whether the save succeeded; `false` means the caller should retain the session for retry. Temporary matches deliberately return success without persistence. Shared Build Home saves the host’s original project; a guest does not write a local project.

`saveNow` serializes requests. An explicit quit/pause/share request waits for an active write and then captures a fresh snapshot. Repeated auto/quiet requests can share the active write. `writeSave` captures modified terrain before yielding; new edits re-add their keys. Commit failure restores those keys. Queued map tiles are restored on failure as well.

The backend commits metadata, state, terrain deltas, map tiles and the previous-state backup in one transaction. Build dirty status clears only if object revision and terrain dirtiness still match the captured save. Keep these guarantees when extending saves.

The backup stores one prior **state**, not a complete terrain/version archive. Shutdown/page-hide saves are best-effort. IndexedDB is local to this browser/site/device; an in-memory fallback must remain clearly signaled to players. Schema changes belong in migrations with round-trip and old-save tests.

## Add content

**Blocks:** append `data/blocks.ts`; configure shape/layer/tiles/tool/drop and optional interaction/light/station/comfort. Add new tiles to `game/world/tiles.ts` and painters to `rendering/TexturePainter.ts`; modeled shapes belong in `world/shapes.ts`. Add a placeable item and an obtainable recipe or natural source. Never renumber existing blocks.

**Items/recipes:** use `data/items.ts` and `recipes.ts`. Crafting state handles locked level, station, ingredients and output capacity. Put rules in `CraftingSystem`, not only the UI. The obtainability validator should still prove a path to every survival item.

**Creatures:** add data in `data/creatures.ts`, the model/animation in `rendering/Models.ts`, and optional synth voice in `AudioManager`. Check habitat/spawning, feeding, damage, journal and companion serialization where relevant.

**Creative furniture:** define model/material data and catalog references using existing patterns in `data/furniture.ts`, `data/buildCatalog.ts` and `game/build/ObjectGeometry.ts`. Check rotations, bounds, collision, instancing, interactions, openings, undo and save/reload. A pretty model alone does not establish these rules.

Furniture rest actions live in `game/player/FurnitureInteraction.ts` and `ui/HUD/RestActions.tsx`. Voxel `bed`/`sit` interactions and object `bed`/`sit` interactions share proximity checks, including walls and furniture obstructions. Object seating uses `seatHeight`; voxel rotation is opposite to THREE object rotation. Nearby furniture is sampled four times per second. Seating is temporary: move, jump, Interact, damage, deletion, movement of the chair or teleport can release it. A safe exit is checked against both voxel and object collision; save snapshots use an exit position. Keep boat seating and Build camera/Photo behavior in mind when extending this system.

Creature defeat always runs the definition's drop table, except for protected tamed companions. `data/creatureFood.ts` supplies matching raw/cooked species items and Cooking Fire recipes. Keep guaranteed loot separate from optional bonus drops, and keep wildlife kills out of hostile-defeat progress and dawn scores. Zombies and skeletons reuse existing night AI, spawn restrictions and dawn retreat. Normal groups and midnight waves share nearby hostile caps.

World-room countdowns are disabled; `PvpSettings.minutes` and wire `left` remain for compatibility but normalize to zero/null. Takedown-based Battle wins remain supported. Deathmatch owns its separate timer. Guest sleep sends `sleep`; the host validates player, bed, distance, night and nearby creatures, broadcasts world time, and acknowledges with `awake`. Rest recovery is applied once after acceptance; unanswered requests expire after ten seconds.

Survival deaths run difficulty-specific drops and record the old-position satchel marker before `playerDied`, then immediately call the existing `Game.respawn` at Home or camp. A toast reports the cause and drops instead of opening the death overlay. PvP publishes loot, the kill event and a dead state before immediately respawning with its kit and publishing the alive state; a host's round-ending death stays dead on results. `applyHit` sets credit before synchronous lethal damage and restores previous credit for blocked/protected hits. Do not set credit again after `hurt`, since respawn has cleared it. Both respawn paths set `waitingForGround` immediately and retain existing protection. Lethal void damage must not trigger a second safe rescue after a home/camp respawn. Creative Build Home stays invulnerable; Deathmatch's referee and five-second delay remain separate. Regressions live in `core/respawn.test.ts`, `pvp/rooms.test.ts` and `deathmatch/deathmatch.test.ts`.

Pause panels share `ui/PauseMenu/QuickRespawnButton.tsx` and call `Game.quickRespawn` for living-player rescue. Survival reuses the home/camp teleport without death, loss, health refill or progression changes; boats are dismounted before moving. Build Home reuses `BuildNavigation` at the entrance, preserving whole-body/furniture collision checks, terrain loading, timeout and both-camera updates. Shared survival/Battle reuses `PvpSession.quickRespawn`, preserving its combat and cooldown rules; rescue now dismounts boats, waits for terrain, repeats the safety check after loading and retains longer existing protection. Failed requests leave Pause open with a status message. Deathmatch has neither a Pause rescue button nor an engine rescue route. Pause button containers can shrink on narrow screens, and the rescue target stays at least 44 pixels high.

**Controls/help:** put shared Build Home controls in `data/buildControls.ts`; add rebindable actions/defaults/labels in `stores/settingsStore.ts`. Fixed tool/weapon shortcuts must be documented as fixed. Update `playerGuide.ts`, then run `npm run docs:players` so the UI and manual match.

## Measure performance

Use a fixed seed, route, populated project, graphics profile and device/browser. Warm up before comparing. Separate initial download/startup from steady play and streaming spikes. F3 shows available engine statistics; browser Performance tools can record long tasks and frame timings. Capture memory/GPU-resource trends over repeated entry/exit and travel rather than judging a single count.

Low-end starting profile: distance 3–4, DPR cap 1, resolution scale 0.5–0.75, low particles, clouds/shadows off, optionally Auto. This sacrifices visual distance/sharpness but keeps inventory, combat and saved-world rules. Physical device thermals, RAM, drivers and tab suspension still matter.

Use the acceptance matrix in the audit before release, including cross-browser storage, touch/gyro, real online multiplayer and voice. Node tests and emulated Chrome layouts cannot establish real-phone FPS or microphone behavior.
