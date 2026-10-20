# WildBlocks Playgama integration audit

Source verification: 7 October 2026. Target: **Playgama only**. Complete language: **English**; other platform languages resolve to English. Intended controls: desktop keyboard/mouse and mobile/tablet touch, landscape. Physical devices and host review remain pending.

## Existing game inspected

- Vite 7.3.6 / React 19.3.0 / TypeScript 6.0.3, Three.js 0.185.1 / R3F 9.8.1, Zustand 5, npm lockfile. Node >=20.19 (tested Node 24.13.0). Existing commands retained; no framework upgrade.
- `src/main.tsx` → `PlatformGate` → `App`. The first interactive screen is a React menu. WebGL, procedural textures/models/icons and the worker load lazily when a world starts. Menu readiness therefore does not wait for later worlds. R3F controls canvas/container resize, camera projection and capped DPR; existing quality presets remain.
- Simulation: `Game.update`, Build Home, survival entities/projectiles/crops, PvP and deathmatch sessions. Platform/hidden/ad interruption freezes local frames, clears input and drops the first resume delta. Solo pause/settings/death/sleep also freeze the local simulation. Multiplayer authorities and transport heartbeats continue: pausing a client cannot stop a remote match.
- Timers: audio scheduling, UI toasts/tips/score refresh, chunk/worker loading and network heartbeats. Presentation/loading/network timers can continue; gameplay timers advance with game delta. Delayed weapon/quest actions are coordinated with the pause scheduler. Keyboard/mouse, pointer lock, touch joystick/actions and gyro remain.
- Audio: all music, ambience, creature/positional sounds, UI effects and gun sounds use the shared synthesized Web Audio engine. Voice has a separate AudioContext and muted media transport elements. Permission combines saved master volume, platform audio and interruption reasons; voice is suspended with game audio. Browser autoplay restrictions remain gesture based and caught.
- Saves: IndexedDB `wildblocks` v2; sparse block edits, world metadata/state, previous autosave backup, map bytes and blueprints. Existing world save v1→v2 migrations are retained. Settings v1/v2, Build Home favorites/tutorial, multiplayer and voice preferences are migrated once when the Bridge key is absent. Legacy originals are retained. New saves use Bridge only.
- Release tools tested: Playwright 1.63.0 (Chromium 153), fflate 0.8.3, Vitest 3.2.7.
- All four modes remain: survival, Build Home, PvP/build together, deathmatch. Existing controls, mechanics, balance and procedural visual design remain. Ordinary Homestead progress still earns every scarf.
- No external asset/font downloads, external registration, purchases, analytics, URL locks, service worker, or external outgoing navigation. Fonts use local/system fallbacks. Assets and worker/lazy chunk URLs are emitted by Vite with relative base.

## Changes and engineering choices

| Label | Item | Status/evidence |
|---|---|---|
| PLATFORM | Bridge initializes before platform/storage services | Singleton promise and recoverable startup gate; no fake browser-success fallback |
| PROJECT | Pinned current npm SDK and official local Vite plugin | `@playgama/bridge` **2.3.1**; inspected npm exports, types, event cleanup and actual void ad methods |
| PLATFORM | SDK configuration beside root HTML | Minimal documented ad configuration, two game placement names, no invented platform IDs |
| PLATFORM | Language/audio/pause/Game Ready | English fallback; native English language setting; initial permissions and SDK events; ready once after committed menu and paint opportunity |
| PROJECT | Competing pauses and input release | Independent user/platform/hidden/loading/ad reasons; keyboard, mouse and touch clearing; resume delta discarded |
| PLATFORM | Progress/settings through Bridge | Versioned JSON checkpoint, ordered writes, debounced preferences, world/reward checkpoints and explicit save retry alert |
| PROJECT | Legacy compatibility and integrity | Read-only IndexedDB/local/session migration; typed map bytes restored; retained sparse schemas and autosave backup recovery |
| PLATFORM | Interstitial natural breaks | `return_to_menu` after leaving a played world/match; no initial menu ad; 90-second project cooldown plus SDK interval |
| PROJECT | Multiplayer ad safety | Ads only after local play ends and network teardown; never on a running multiplayer round |
| RECOMMENDED | Optional cosmetic rewarded offer | Survival backpack: watch to unlock Starlight scarf account-wide; ordinary progression still available |
| PROJECT | Reward event integrity | Frozen world/reward/token context; duplicate grants ignored; matching SDK placement required; reward/close independent; late-close ordering window tested |
| PROJECT | Missing ad events | 15-second recovery only for never-opened requests; no release of host/user pauses; opened ads wait for terminal host event; expired SDK request quarantined until terminal event |
| PROJECT | Portable release artifact | Owned outputs only, real type/data/tests/build gates, strict HTTP nested/iframe tests, root-content ZIP, extract/hash verification and separate failure/success reports |
| RECOMMENDED | Russian localization | Not implemented/declared; complete English preserved. Playhop/Yandex excluded |
| PARTNER | Other distribution profiles | Excluded; validator rejects unaudited target selections rather than manufacturing eligibility |

The guide's raw-string storage example needs `bridge.storage.get(keys, false)` with SDK 2.3.1: the installed SDK defaults to automatic JSON parsing. This integration explicitly disables it and performs its own validated parsing. SDK Storage can route through local fallback internally when cloud is unavailable; a successful write is **not** evidence of cloud confirmation. App-level read errors/malformed envelopes block loading and cause no default writes. Cloud fallback/reconciliation must be verified in the host.

World saves necessarily contain the existing sparse worlds, blueprints and map tiles, beyond the guide's generic small score document. One JSON checkpoint preserves atomic existing saves. Large edited worlds/blueprints may exceed a host's per-player quota; write failures keep the current snapshot in memory and show Retry saving. No strict-save-size partner is claimed. Do not close the page until retry succeeds. Multi-tab/cloud conflict merging is not provided; test host/session reconciliation before submission.

The SDK emits no request token with ad events. Requests are serialized, late-close reward context retained for two seconds, and never-opened expired requests quarantined to prevent attributing a stale reward to a new request. A missing terminal event after an opened ad stays paused until the host recovers; a watchdog cannot safely infer that the overlay disappeared. SDK listener cleanup uses the installed `off(event, callback)` API; React subscriptions dispose on unmount.

Fullscreen is optional from the explicit rotate/fullscreen button. The game fills the iframe without needing fullscreen permission. Portrait shows the existing rotation prompt; landscape is the declared gameplay orientation. Both-orientation partners are excluded.

## Multiplayer and outbound dependency inventory

| Owner/path | Dependency | Purpose/limits |
|---|---|---|
| Game: `src/net/transport.ts` | PeerJS lazy bundle, default PeerJS cloud signaling (`0.peerjs.com`) | Player hosts authoritative sessions; static ZIP supplies no guaranteed backend uptime |
| Game: transport and voice | Google STUN `stun.l.google.com:19302`, `stun1.l.google.com:19302`; Cloudflare STUN `stun.cloudflare.com:3478` | WebRTC NAT traversal; peer traffic is direct; some networks need separately configured TURN |
| Game: optional public deployment env | `VITE_PEER_*`, optional `VITE_TURN_*` | Public browser values; no credentials/secret settings supplied for this build. Do not put private long-lived secrets into VITE variables |
| Game: multiplayer | BroadcastChannel for same-device rooms; WebRTC data/audio; clipboard invite links | Explicit create/join and voice actions; no external navigation; microphone requires explicit player action/browser consent |
| Platform: Bridge | Platform SDK/ad/cloud services and Bridge-managed analytics | Local delivery packages the runtime; adapters/host services may still use network. Not evidence of external-call-free eligibility |

Game-owned analytics: none. Bundle URL scans include Three.js/React specifications/error docs, SVG namespaces and PeerJS diagnostics; these are reviewed strings, not automatically network requests. Browser smoke records actual local resources. Online PvP, co-op, voice and deathmatch require two-player/network QA; no GameSnacks/YouTube external-call claim is made.

## Compatibility and verification limits

The published technical list includes Windows Vista/7/8, macOS 10.6, Android 5 and iOS 9. Existing ES2022, React 19, modules/workers, WebGL2/texture arrays and modern browser APIs do **not** establish support on those legacy systems. This release retains the engine; discuss compatible catalog filters with Playgama. Current Chromium automation is local evidence only. Safari/Firefox/Edge, iOS/Android devices, resize/rotation, voice permission, long sessions and actual 60 FPS desktop / 30 FPS mobile engineering targets remain manual measurements.

`npm audit` on this checkout found existing development-only Vitest/mocker/tinypool advisories (1 moderate, 2 critical aggregate). npm proposes a major Vitest upgrade; the game toolchain was retained as requested. These packages are not shipped in the ZIP. Review a separate tested tooling upgrade before exposing Vitest development servers. Release reports include this finding; `npm audit --omit=dev` reported zero known runtime vulnerabilities on 7 October 2026.

## Reviewed official sources

- [Setup](https://wiki.playgama.com/playgama/bridge-sdk/setup), [config](https://wiki.playgama.com/playgama/bridge-sdk/config), [config editor](https://playgama.github.io/bridge-config-editor/).
- [Platform](https://wiki.playgama.com/playgama/bridge-sdk/api/platform), [Storage](https://wiki.playgama.com/playgama/bridge-sdk/api/storage), [advertisement](https://wiki.playgama.com/playgama/bridge-sdk/api/advertisement), [interstitial](https://wiki.playgama.com/playgama/bridge-sdk/api/advertisement/interstitial), [rewarded](https://wiki.playgama.com/playgama/bridge-sdk/api/advertisement/rewarded).
- [Advertising requirements](https://wiki.playgama.com/playgama/game-requirements/advertising-requirements), [UX](https://wiki.playgama.com/playgama/game-requirements/user-experience-requirements), [technical](https://wiki.playgama.com/playgama/game-requirements/technical-requirements), [content](https://wiki.playgama.com/playgama/game-requirements/content-requirements), [other](https://wiki.playgama.com/playgama/game-requirements/other-requirements), [partners](https://wiki.playgama.com/playgama/game-requirements/platform-specific-requirements), [submission](https://wiki.playgama.com/playgama/submitting-a-game).
- [Vite base](https://vite.dev/config/shared-options), [assets](https://vite.dev/guide/assets). SDK API behavior additionally checked against installed 2.3.1 types/runtime and official Bridge source.

Automated results and artifact hashes/sizes live in `release/release-report.json` and `release/release-report.md`. PASS means locally packaged/tested, not platform approval.
