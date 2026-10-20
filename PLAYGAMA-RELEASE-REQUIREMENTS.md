# Playgama release requirements — Vite + React

Reusable implementation brief for a coding AI • researched 7 October 2026

## How to use this file

Put this file in the completed game's repository and give your coding AI this instruction:

> Read PLAYGAMA-RELEASE-REQUIREMENTS.md and implement it in this existing Vite + React game. Inspect the project first, preserve its gameplay and design, integrate the current Playgama Bridge correctly, and create the release pipeline described here. Work through implementation and verification; do not stop at a plan. After setup, `npm run release` must produce a validated upload ZIP and a truthful release report. Fix failures you can reproduce. Clearly identify checks that still require Playgama's QA Tool or human review. Do not claim moderation approval or publish the game automatically.

This is a requirements file, not an already-installed plugin. The command becomes available after the AI implements it in each repository. Reuse the resulting integration across later games, adapting the gameplay hooks.

## 1. Scope, authority and status labels

Target: an existing client-side Vite + React game, JavaScript or TypeScript, optionally using Three.js / React Three Fiber. Preserve mechanics, existing modes, controls, balancing, assets, save compatibility and working development commands. Make focused changes and explain any unavoidable behavior change.

Use these labels in the implementation checklist:

- **PLATFORM:** an official Playgama requirement summarized here.
- **PARTNER:** applies only to a selected distribution platform.
- **PROJECT:** an engineering requirement of this reusable release workflow.
- **RECOMMENDED:** a quality improvement, not a universal acceptance rule.

Read the current official sources in section 15 before implementation. Record the check date, actual installed SDK version and selected targets. If a current source changes a requirement, update the project checklist and explain the difference. Do not silently upgrade the game's entire toolchain. Never mix Bridge v1 examples with v2 APIs or invent SDK methods, configuration fields, platform IDs, ad IDs or credentials.

Passing the local release checks means the artifact is packaged and locally verified. Platform behavior, content review, distribution selection and final acceptance still require Playgama review. No script can guarantee acceptance, ad fill, revenue or partner placement.

## 2. First inspect the game

Before changing code, identify:

1. Framework versions, scripts, lockfile, engine, renderer, entry point and deployment assumptions.
2. Loading flow and the first genuinely interactive screen.
3. Every simulation loop, timer, input source and audio path.
4. Existing persistence, saved data schema and upgrade/migration needs.
5. Menus, levels/rounds, death/restart paths and suitable ad breakpoints.
6. Translations, supported devices, orientations and minimum practical browser capabilities.
7. External assets, fonts, APIs, analytics, networking, purchases and outgoing links.
8. Existing SDK code: repair/reuse it instead of initializing a second instance.

Create `docs/playgama-integration-audit.md` with findings and changes. Choose sensible defaults where the code answers a question. Missing platform-issued identifiers should be reported as specific blockers only when genuinely required for the selected target.

For multiplayer games, document servers, signaling/STUN/TURN and third-party dependencies. A static ZIP does not supply a multiplayer backend. Do not remove an existing mode to manufacture a passing report; flag incompatible distribution targets.

## 3. Required file responsibilities

Adapt filenames to an established architecture if necessary, but implement every responsibility below.

| File or area | Responsibility |
| --- | --- |
| `vite.config.ts` or `.js` | Relative deployment base, React plugin preserved, one Bridge loading strategy |
| `public/playgama-bridge-config.json` | Valid official SDK configuration copied beside output `index.html` |
| `src/platform/playgama.ts` | Singleton SDK initialization and typed application-facing adapter |
| `src/platform/lifecycle.ts` | Centralized pause, visibility, input and audio coordination |
| `src/platform/storage.ts` | Versioned save parsing, migration and serialized writes |
| `src/platform/ads.ts` | Ad request state machine, placements and reward handling |
| Existing localization layer | Platform language selection and supported translations |
| `playgama.release.json` | Project-owned packaging policy; never presented as a Playgama SDK file |
| `scripts/release.mjs` | Cross-platform release orchestration |
| `scripts/validate-playgama.mjs` | Static artifact validation and size checks |
| `tests/playgama/` | Meaningful integration and built-artifact smoke tests |
| `docs/PLAYGAMA-SUBMISSION.md` | Metadata, real-device and QA Tool checklist |
| `release/` | Generated upload ZIP and separate reports; ignored by Git |

## 4. Install and configure Bridge

**PLATFORM:** initialize Bridge before using its services. Official v2 setup supports `@playgama/bridge`, a Vite plugin, and a CDN script. Unsupported environments use Bridge's mock behavior. [S1]

**PROJECT:** use the npm package and official Vite plugin, checking the installed package's exports first. Pin the tested dependency and retain the lockfile. Install with `npm install --save-exact @playgama/bridge`; do not hardcode an unverified version number.

Merge this shape into the existing configuration:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import playgamaBridge from '@playgama/bridge/vite';

export default defineConfig({
  base: './',
  plugins: [react(), playgamaBridge({ mode: 'local' })],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
```

The local mode is this project's preferred packaging choice. The docs recommend CDN generally; local mode is documented for self-contained SDK loading. It does **not** guarantee that platform adapters and host services make no network calls. Never add a second manual script when the plugin already injects one. If the installed version lacks this plugin, follow that version's documented setup and record the deviation. [S1]

Use `import bridge from '@playgama/bridge'` in the adapter. Initialize through one shared promise outside React component render paths. StrictMode, remounts and repeated button clicks must not duplicate initialization or subscriptions. Handle initialization failure with a recoverable loading/error screen; do not display a fake SDK-success state.

**PLATFORM:** the configuration filename is `playgama-bridge-config.json` and it belongs beside `index.html` in the built game. The official config editor is linked in [S2].

Minimal project example, choosing 90 seconds as a product default rather than claiming an official minimum:

```json
{
  "advertisement": {
    "minimumDelayBetweenInterstitial": 90,
    "interstitial": {
      "placements": [
        { "id": "round_end" }
      ]
    },
    "rewarded": {
      "placements": [
        { "id": "bonus_reward" }
      ]
    }
  }
}
```

Replace placement names with actual game events; remove rewarded configuration if unused. Add `platforms` overrides only when required and use genuine assigned values. Do not fabricate a universal `playgama.gameId`, public token, app ID or API key. This file and every `VITE_*` variable shipped to the browser are public. Keep secrets out. Validate against the current config editor/schema where available, not merely JSON syntax. [S2]

## 5. Startup, language, lifecycle and sound

**PLATFORM:** after initialization, read `bridge.platform.language`; respect `bridge.platform.isAudioEnabled`; subscribe to `bridge.EVENT_NAME.AUDIO_STATE_CHANGED` and `bridge.EVENT_NAME.PAUSE_STATE_CHANGED`. Send `bridge.platform.sendMessage('game_ready')` when loading has finished and the player can interact. Additional level/loading lifecycle messages are recommended. [S3]

**PROJECT implementation:**

1. Initialize SDK; install lifecycle listeners immediately.
2. Resolve the supported language and load translations.
3. Load saved state and essential first-screen assets.
4. Render an interactive menu or playable first screen.
5. Send Game Ready once for this page session, after actual render readiness.

Do not tie readiness to a random timeout, first network response or React mount alone. For WebGL, confirm the renderer and necessary scene resources are ready. Avoid waiting for later levels that are not needed to interact.

Maintain independent pause reasons such as `user`, `platform`, `hidden`, `loading` and any confirmed ad overlay state. Clearing one reason must not clear another. Stop simulation, input processing and game timers while paused; reset accumulated delta time when resuming. Release stuck keyboard/touch states on interruption. Do not automatically close a user-opened pause menu when an ad ends.

Compute effective audio permission from user preference AND platform permission AND current interruption state. Cover music, SFX, HTML media, Web Audio, positional audio and UI sounds. Resume browser AudioContext only when permitted, handling gesture restrictions. Use document visibility as an additional safeguard without fighting SDK events. Remove listeners using the installed SDK's documented cleanup API.

**PLATFORM UX:** include sound and a mute control, stop sound in the background, save progression or high scores as appropriate, and provide meaningful interaction with a clear setting and increasing challenge. Make language selection understandable using icons/native language names. [S8]

Translate all player-facing strings for every declared language, including ad offers, errors, tutorials and loading screens. English fallback is the project default; English plus Russian is recommended for wider distribution, not a universal Playgama language requirement. Do not overwrite a deliberate saved language choice on every render.

## 6. Storage and save integrity

**PLATFORM:** use Bridge Storage for player progress and settings, rather than direct browser persistence. Load before gameplay; write after meaningful changes. Missing keys can be null; cloud routing is handled by Bridge. Array calls are supported. [S4]

Example API shape, with application validation omitted here:

```ts
const [raw] = await bridge.storage.get(['save_v1']);
// Parse and validate raw before applying it; null means no stored value.
await bridge.storage.set(['save_v1'], [JSON.stringify(nextSave)]);
```

**PROJECT:** use a small versioned JSON document containing only persistent state: progress, unlocks, economy, best score, tutorial completion, audio/language preferences. Never serialize renderer objects or React state wholesale.

Serialize writes so an older async save cannot overwrite newer progress. Debounce frequent changes and checkpoint purchases/rewards/round outcomes. Do not rely on unload-time asynchronous requests. A load error is different from a missing save: do not overwrite unknown remote progress with fresh defaults. Offer retry or clearly identified temporary play, and reconcile safely later. Validate malformed data and migrate known old versions without wiping valid progress. Retain existing saves; if a one-time legacy migration needs direct local reads, document that exception and verify platform compatibility. All continuing persistence must use Bridge.

## 7. Ads and monetization

**PLATFORM:** interstitial integration at natural breaks is required for revenue sharing. [S5] Use only Bridge ads/payments. Full-screen ads must pause gameplay and sound; retain game state. Rewarded offers must be voluntary, explain the ad and reward, and leave ordinary play possible. Do not offer a +1-life rewarded ad after every lost life. Additional banner placements must be sticky; custom RTB advertising is prohibited. Avoid ad placement over intended game clicks. [S6]

**Interstitial API:** inspect `isInterstitialSupported`; request `showInterstitial(placement)`. Track `INTERSTITIAL_STATE_CHANGED`: `loading`, `opened`, `closed`, `failed`. The documented default interval is 60 seconds; this guide chooses 90 seconds initially. Honor SDK/platform restrictions. Universal platform audio/pause events are the preferred pause mechanism. [S7]

**Rewarded API:** inspect `isRewardedSupported`; call `showRewarded(placement)` from a player action. Listen to `REWARDED_STATE_CHANGED`, which includes `rewarded`. Grant only on that success state; `closed` alone is not proof of earning a reward. `rewardedPlacement` identifies the relevant placement. [S9]

**PROJECT ad state machine:**

- Permit only one active full-screen ad request. Disable repeated taps while it is pending.
- Capture an immutable reward context before requesting: placement, round/entity, exact reward and a request token.
- Apply the reward at most once, including duplicate-event and React-remount cases. Preserve context through the documented event ordering; do not discard it prematurely on close.
- Separate reward fulfillment from releasing the ad overlay. A reward event must not resume simulation while a host overlay remains open.
- Handle unsupported ads, no fill, rejection, synchronous errors and asynchronous failures. Continue ordinary play without consuming the reward or pretending a video was watched.
- Handle promise/return behavior according to the installed SDK types. Do not assume `await showRewarded()` means a reward was earned.
- Use bounded recovery for a request that never opens. A timeout must never unpause an actually visible ad or clear a platform pause. Test missing-event scenarios explicitly.
- Persist earned rewards and maintain a recoverable result if saving fails.
- For multiplayer, place ads between matches or safe lobby phases. A local pause does not pause the remote match.

Recommended initial design: interstitial opportunities after a completed/failed round; one useful optional bonus offer where it fits. No automatic ad on the initial menu. Banner and purchase features are optional; do not add them solely to satisfy this guide.

## 8. Layout, controls, browsers and performance

**PLATFORM technical summary:** match declared devices; support touch on mobile and keyboard/mouse on desktop. Fit the viewport without distortion, clipped controls, overlapping text or page scroll; make dialogs dismissible. Preserve progress on orientation changes. Mobile gameplay should fill the available screen, with declared orientation. Do not require external registration, URL-lock the game, or add external analytics. Names must use Latin characters, the ZIP root must contain `index.html`, and total game files must not exceed 300 MB. The official browser/OS list includes legacy systems; review it directly and report compatibility gaps rather than assuming modern Vite satisfies it. [S10]

**PROJECT implementation:**

- Size from the actual iframe/container, using ResizeObserver where useful. Respect safe-area insets and mobile browser height changes; use `100dvh` with a fallback.
- Interpret fullscreen as fitting the host's game surface. Do not block startup awaiting browser fullscreen permission; request browser fullscreen only where supported and gesture-allowed.
- For 3D, resize canvas and camera projection together. Cap device pixel ratio and provide lower quality settings when needed.
- Avoid browser gestures/scrolling on the game interaction surface without breaking text inputs or accessible menus elsewhere.
- Keep controls reachable and readable on narrow screens and short landscape layouts. Avoid hover-only actions on touch devices.
- Use imported assets or base-aware URLs; audit dynamic fetches, audio, GLB textures, workers, decoders and lazy chunks. Do not assume `base: './'` repairs every hardcoded `/asset` string. [S15]
- Prefer in-app state or hash routing for menus. Do not require host-side history rewrites.
- Remove unused assets/dependencies and remote fonts where practical; compress textures/audio with visible quality checks. Retain licenses and credits where required.
- Set project performance targets such as 60 FPS desktop and 30 FPS low-end mobile, but report measured hardware/browser results. These are engineering goals, not claimed platform thresholds.
- Avoid unnecessary service workers. Existing workers must not serve stale releases.
- Test actual iOS/Android devices for claimed support. Browser emulation alone is insufficient.

## 9. Content and external service review

**PLATFORM content summary:** distribute only material you are authorized to use; avoid copied games, protected characters/branding and duplicate reskins. The rules exclude political/religious references, realistic child/animal abuse, life/health predictions, real-money prizes/gambling, external purchases and embedded video interfaces that send players elsewhere. AI-assisted development is allowed, but low-quality wholly generated titles without meaningful refinement may be rejected. [S11]

Other rules prohibit impersonation, misleading/illegal material, realistic violence, sexual content, offensive language, hate/extremism and suicide instructions/incitement. Obtain explicit permission for actions involving user data. Home/pause buttons and both orientations are recommendations in the general rules. [S12]

**PROJECT:** provide a human-review checklist for asset rights, originality, content and data handling. Do not auto-certify these from a code scan. Disable third-party analytics in this build; use Bridge analytics if needed and supported. Inventory outbound requests and links, distinguish platform-managed traffic from game-owned traffic, and explain each dependency. Do not claim every external request is universally banned; some partners impose stricter restrictions.

## 10. Distribution profiles

These are brief Playgama-published partner criteria, not a replacement for the linked current page or partner moderation. [S13]

| Target | Additional considerations |
| --- | --- |
| Playgama | General requirements; 300 MB total game files |
| YouTube Playables | Initial build ≤30 MB; both orientations, all device types, no sidebars or external calls; ≤8,000 files, safe filenames; selective placement |
| Playhop / Yandex | Russian; enough content for more than 10 minutes |
| Facebook | ≤200 MB, ≤500 files; cross-device; at least two of purchases, leaderboards, multiplayer, social sharing; no startup ads |
| MSN | Under 50 MB; landscape or both orientations; selective placement |
| Xiaomi | ≤100 MB; Android; load under 15 seconds |
| Discord | Multiplayer and in-game purchases |
| GameSnacks | Each file <10 MiB, game ≤100 MiB, initial download <15 MiB; portrait 9:16, iOS/Android; saves <3 MiB; no external calls |

The page currently marks CrazyGames/VK distribution unavailable and TikTok publishing paused. Recheck availability when choosing targets. Do not infer eligibility from Bridge adapter support alone.

For an external-call-restricted target, verify the platform-approved SDK delivery path with Playgama. Bundling Bridge locally alone does not prove compliance. Keep unsupported network-dependent modes explicitly flagged. Selected partner profiles should tighten validation without silently claiming certification.

## 11. `npm run release` contract

**PROJECT:** implement the command once per repository. It must work on macOS, Windows and Linux with the documented supported Node version. Prefer Node filesystem/process APIs and a pinned JS ZIP library; do not depend on a global `zip` executable, Bash, or system-specific environment assignments.

Keep existing `dev`, `build` and test scripts working. Add scripts with these responsibilities:

```json
{
  "scripts": {
    "release": "node scripts/release.mjs",
    "validate:playgama": "node scripts/validate-playgama.mjs",
    "test:playgama": "playwright test tests/playgama",
    "preview:release": "vite preview --host 0.0.0.0"
  }
}
```

This is a merge fragment, not a replacement `package.json`. Add the chosen test/archive dependencies and setup instructions. Do not add nonexistent script names to an apparently complete pipeline.

Create a project-owned policy such as:

```json
{
  "schemaVersion": 1,
  "gameSlug": "my-game",
  "targets": ["playgama"],
  "distDir": "dist",
  "releaseDir": "release",
  "maxUncompressedBytes": 300000000,
  "zipTargetBytes": 5000000,
  "enforceZipTarget": false,
  "safeFileNames": true
}
```

Validate this configuration yourself. The decimal 300,000,000-byte ceiling is a conservative local interpretation of the published 300 MB limit. The 5,000,000-byte ZIP target is a lightweight-game preference, **not** Playgama's universal limit. Turn `enforceZipTarget` on if this project requires it. Report ZIP size, total uncompressed size and initial-load transfer separately. ZIP compression does not reduce the browser's uncompressed runtime memory needs.

Required execution sequence:

1. Resolve repository paths and validate configuration. Reject unsafe output paths (repository root, filesystem root, home, `src`, or paths outside the project). Never clean arbitrary directories supplied through config.
2. Clean only owned build/staging outputs; prevent an old ZIP from looking like the new successful release.
3. Run the project's real typecheck/lint gates where applicable and meaningful integration tests. TypeScript checking must match its tsconfig/project references. Do not suppress existing failures.
4. Produce the production Vite build with `base: './'`.
5. Validate emitted files/config/assets and size policy.
6. Serve the built artifact over HTTP from a nested path and inside an iframe; run smoke tests against it, not the dev server. Ensure missing files return errors instead of an SPA fallback hiding broken assets.
7. Archive the **contents** of the build directory. Root entries must include `index.html` and `playgama-bridge-config.json`, with emitted assets beside them. Never wrap them in `dist/`, `build/`, or another parent folder.
8. Read back the ZIP directory, verify safe paths and sizes, extract into a temporary test directory, and confirm packaged files match the validated output. Hash the final ZIP.
9. Publish final artifact names atomically only after automated gates pass; write separate JSON and Markdown reports. On failure, exit nonzero and record a useful failure report without declaring an upload-ready release.

Expected outputs:

- `release/<gameSlug>-<version>-playgama.zip` — upload this file.
- `release/release-report.json` — machine-readable evidence.
- `release/release-report.md` — readable checks and remaining manual tasks.

Keep reports, screenshots and source archives outside the upload ZIP. Never include `node_modules`, source trees, `.git`, environment files, test fixtures, private keys, or `.DS_Store`. Keep attribution files required by asset/dependency licenses. Do not strip runtime assets merely because their extension looks unfamiliar.

Report: game/version, build time, commit if available, Node/npm/SDK versions, config hash, targets, artifact name/hash, compressed/uncompressed bytes, file count, largest files, executed checks, warnings and manual-QA status. Use PASS / FAIL / NOT RUN / MANUAL REQUIRED / NOT APPLICABLE; never turn NOT RUN into PASS.

## 12. Automated validation requirements

**PROJECT structural checks:**

- Root HTML/config exist; config parses and required placements match the adapter.
- Exactly one intended SDK delivery strategy; local mode includes its runtime and any required emitted files.
- Referenced local files exist with matching case. Validate HTML/CSS references and runtime-discovered assets; strings in bundles alone are not sufficient evidence.
- Safe relative ZIP paths, no traversal, symlinks or case-colliding names. Use filename characters `[A-Za-z0-9._-]` for each path segment as a strict project convention.
- No localhost/dev-server URLs, source imports in production HTML, known analytics integrations, secrets or forced mock/test switches. Report ambiguous URL matches for review rather than deleting them blindly.
- Uncompressed size, ZIP budget and selected target limits checked with explicit units.

**PROJECT integration tests:**

| Scenario | Required evidence |
| --- | --- |
| Cold boot / refresh | Working interactive screen, one initialization, one readiness event, no uncaught app error |
| Nested URL and iframe | HTML, config, audio, models and lazy chunks load without missing resources |
| Saved progress | Earn progress, save, reload and restore; malformed data handled; failed load does not erase unknown save |
| Competing pauses | User pause + host pause + hidden tab cannot incorrectly resume each other |
| Audio | User mute survives ad close; host mute and hidden-tab mute affect every audio path |
| Interstitial | Successful close, failure, unsupported and no-fill paths do not soft-lock |
| Rewarded | Earned reward once; no reward for close/failure; repeated clicks/events and remounts safe |
| Layout | Representative phone portrait/landscape, tablet and desktop; no clipped essential actions |
| Regression | Existing start, controls, win/lose, retry, settings and all retained modes still work |

Mocks are appropriate for deterministic event sequences, but test-only overrides must be excluded from production. Local mock success is not proof of live ads/cloud saving. Keep host validation explicitly pending. If browser binaries/tools are unavailable, stop the default full release gate with setup instructions; never silently skip its tests.

## 13. Manual acceptance and submission

Create `docs/PLAYGAMA-SUBMISSION.md` with unchecked items until a person or actual host test supplies evidence:

- [ ] Latest requirements reviewed; target devices, languages and distribution choices accurate.
- [ ] Real desktop/mobile gameplay tested, including resize, rotation, long press, backgrounding and return.
- [ ] Playgama QA Tool recognizes initialization and Game Ready at the correct time.
- [ ] Host storage persists the intended progress/settings across a new session.
- [ ] Interstitial behavior checked in host test mode, including pause/audio and return.
- [ ] Reward success/skip/failure checked where rewarded ads are implemented.
- [ ] No endless loaders, crashes, missing assets, hidden controls or unexpected outbound navigation.
- [ ] Rights, originality, content and AI-asset refinement reviewed by the developer.
- [ ] Any partner-specific incompatibility is fixed or that target excluded.

**Submission metadata:** prepare matching game title, engine, concise description, how-to-play instructions, supported devices, orientation, features, languages, distribution choices and optional existing-game link. Prepare useful screenshots/covers/icons/videos; inspect the live upload form for current dimensions and formats rather than inventing universal media sizes. Upload the ZIP, run Test Game, then Submit Game when satisfied. QA and moderation are separate from local packaging. [S14]

Publishing is a separate user action. Do not ask for developer-account credentials or upload automatically as part of `npm run release`.

## 14. Required final response from the implementing AI

When finished, report:

1. What changed and which existing gameplay behavior was preserved or necessarily adjusted.
2. Exact setup commands for a fresh checkout (`npm ci`, any browser-test installation, then `npm run release`).
3. Actual generated ZIP path and both size measurements.
4. Automated checks that really ran and their results.
5. Remaining Playgama QA, device, content or platform-ID blockers with precise actions.
6. Tested dependency versions and date of source verification.

Do not say “approved by Playgama,” “guaranteed acceptance,” “revenue verified,” or “all platforms supported” based on a successful Vite build. If you could not run a check, say so plainly.

## 15. Official references

Reviewed 7 October 2026. These links are the source of the PLATFORM/PARTNER summaries; PROJECT instructions are this guide's engineering design. Check full current pages before each integration, particularly where a legacy compatibility requirement conflicts with the game's technology.

- **S1 — Bridge setup:** https://wiki.playgama.com/playgama/bridge-sdk/setup
- **S2 — Bridge configuration:** https://wiki.playgama.com/playgama/bridge-sdk/config
- **Config editor:** https://playgama.github.io/bridge-config-editor/
- **S3 — Platform API / lifecycle:** https://wiki.playgama.com/playgama/bridge-sdk/api/platform
- **S4 — Storage API:** https://wiki.playgama.com/playgama/bridge-sdk/api/storage
- **S5 — Advertising overview:** https://wiki.playgama.com/playgama/bridge-sdk/api/advertisement
- **S6 — Advertising acceptance:** https://wiki.playgama.com/playgama/game-requirements/advertising-requirements
- **S7 — Interstitial API:** https://wiki.playgama.com/playgama/bridge-sdk/api/advertisement/interstitial
- **S8 — User experience:** https://wiki.playgama.com/playgama/game-requirements/user-experience-requirements
- **S9 — Rewarded API:** https://wiki.playgama.com/playgama/bridge-sdk/api/advertisement/rewarded
- **S10 — Technical requirements:** https://wiki.playgama.com/playgama/game-requirements/technical-requirements
- **S11 — Content requirements:** https://wiki.playgama.com/playgama/game-requirements/content-requirements
- **S12 — Other requirements:** https://wiki.playgama.com/playgama/game-requirements/other-requirements
- **S13 — Partner requirements:** https://wiki.playgama.com/playgama/game-requirements/platform-specific-requirements
- **S14 — Submission:** https://wiki.playgama.com/playgama/submitting-a-game
- **S15 — Vite base/public assets:** https://vite.dev/config/shared-options and https://vite.dev/guide/assets
- **Self-check:** https://wiki.playgama.com/playgama/game-requirements/game-self-check
- **SDK changelog:** https://wiki.playgama.com/playgama/bridge-sdk/changelog
- **Full documentation index:** https://wiki.playgama.com/playgama/llms.txt
- **Developer portal:** https://developer.playgama.com/
