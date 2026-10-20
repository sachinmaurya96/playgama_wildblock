# WildBlocks submission and manual QA

Upload `release/wildblocks-1.3.0-playgama.zip` only after `npm run release` succeeds. Reports, test screenshots and source stay outside the ZIP. No upload or publishing is performed automatically.

Copy-ready descriptions, how-to-play text, and the three publishing covers are in
[PLAYGAMA-UPLOAD-CONTENT.md](../publishing/PLAYGAMA-UPLOAD-CONTENT.md).

## Fresh checkout

Use Node >=20.19 (tested 24.13.0), then:

```sh
npm ci
npx playwright install chromium
npm run release
```

`npm run realese` also works as an alias. Both commands generate the upload ZIP at
`release/wildblocks-1.3.0-playgama.zip` after all automated checks pass.

On Linux CI, install the required browser system libraries with `npx playwright install --with-deps chromium` using appropriate system permissions. Missing browsers or failed tests stop release with a nonzero exit and failure report. `npm run test:playgama` requires an existing production `dist/`; its own strict HTTP server serves nested paths/iframe without SPA fallback. `npm run preview:release` is for interactive local review.

## Draft metadata

- Title: WildBlocks — A Tiny Living World.
- Engine: Three.js + React (Vite/TypeScript), custom voxel engine.
- Description: Explore a living voxel world, gather and craft, befriend wildlife, build a home, or design freely in Build Home. Invite friends to build together or compete in team battles.
- How to play: Desktop: WASD to move, mouse to look, Space to jump, Shift to sprint, left mouse to break/attack, right mouse to place/use, E for backpack/crafting, F to interact, J for journal, M for map, Esc for pause. Mobile: landscape joystick and onscreen action controls. Follow quests and improve your Homestead; Build Home has unlimited materials and dedicated building tools.
- Language: English only. Platform language is read; unsupported languages fall back to English.
- Orientation: landscape. Portrait shows a rotation prompt.
- Intended devices: desktop, Android phone/tablet and iOS phone/tablet **pending physical testing**. Select only devices actually validated in the portal.
- Features: survival, crafting, creative building, saved worlds/blueprints/settings, optional cosmetic rewarded ad, interstitial on return to menu, multiplayer/co-op/team battles and optional voice. No purchases, banners, leaderboard or external analytics.
- Distribution: Playgama only. No Playhop/Yandex/Russian, GameSnacks/portrait/save-size/no-network, YouTube/both-orientations/no-network, Facebook/two-feature or Discord/purchase eligibility claimed.
- Existing-game URL: add only if actually published. Prepare screenshots/icon/cover/video from real gameplay; inspect the current upload form for media dimensions and formats.

## Manual acceptance (all pending)

- [ ] PLATFORM: Recheck current requirements and intended device/language/distribution metadata.
- [ ] PLATFORM: Run Test Game in Playgama QA Tool. Confirm one initialization and Game Ready after the usable menu, including cold boot, refresh, load retry and in-host iframe sizing.
- [ ] PLATFORM: Verify actual host/cloud storage across a new session/device: settings/mute, survival inventory/quests/block edits, Build Home objects/blueprints, previous-save recovery and legacy migration. Test storage-denied/failed/large-save cases and retry without erasing unknown progress.
- [ ] PLATFORM: Play for at least 90 seconds, then Save & Quit/leave completed play to menu; verify `return_to_menu` interstitial success, close, skip/no-fill/failure. Confirm state/input/audio pause and return. No initial menu ad or ad during a live match.
- [ ] PLATFORM: In survival backpack, explicitly choose Starlight scarf ad. Verify rewarded success exactly once, skip/close/failure grants nothing, repeated taps disabled, user mute and manual pause survive, and unlock persists next session. Also confirm ordinary Homestead unlocking still works.
- [ ] PLATFORM: Background/foreground and host audio/pause changes affect synthesized sound, positional effects, guns, UI and voice. Combine user pause, platform pause, ad open and hidden state; none should clear another. Check gestures resume audio when allowed.
- [ ] PLATFORM: Test real Chrome/Edge/Firefox/Safari desktops and physical Android/iOS phones/tablets. Check launch, touch/keyboard/mouse/gyro, resize, short landscape, portrait prompt/rotate back, safe areas, long press, keyboard in forms and return from background. Record device/browser versions, load time and measured FPS.
- [ ] PROJECT: Run full survival quests/crafting/combat/death/respawn/retry; Build Home tools/doors/farming/undo/blueprints/autosave; two-player PvP/co-op/deathmatch win/loss/retry and host departure. Automated lobby/unit checks do not replace a real remote match.
- [ ] PROJECT: Die in Survival, shared-world PvP and Deathmatch; wait without pressing Respawn and confirm the player stays defeated. Check Home/Camp choices, saved defeated Survival reloads, Deathmatch's five-second button cooldown, and reconnecting while defeated. Respawn only after the player's explicit choice.
- [ ] PROJECT: Check signaling/STUN/peer audio/data under target networks; test TURN if required. Confirm user microphone consent and handling of voice/player names. A ZIP does not include a signaling/relay server.
- [ ] PLATFORM: Human review of original/procedural asset rights, dependency licenses, AI-assisted refinement, all content/animal-combat/weapons/violence and data handling. Verify originality and age/content classification; no automated certification.
- [ ] PLATFORM: No crashes, endless loaders, missing assets, clipped essential actions, unwanted scrolling or outbound navigation. Inspect actual host network traffic separately from bundle URL strings.
- [ ] PARTNER: Exclude incompatible partners; get Playgama guidance on legacy OS/browser expectations and catalog device filtering. No partner-issued IDs are needed for the selected Playgama config; request assigned IDs only if changing distribution.
- [ ] PLATFORM: Fill current media/metadata form, upload the ZIP, Test Game, then Submit Game manually when satisfied. QA, moderation and publication are separate from local release PASS.
