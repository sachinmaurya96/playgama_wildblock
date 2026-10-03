# Asset Licenses

WildBlocks ships **no external art, texture, model, font, sound or music files**. Every asset is generated procedurally at runtime by original code in this repository.

| Asset | Source | License | Modifications |
| --- | --- | --- | --- |
| Block textures (88 tiles: grass, stone, ores, planks, crops, furniture materials…) | `src/game/rendering/TexturePainter.ts` — painted with noise, strokes and shapes at startup | Original work, same license as this project | — |
| Item icons (tools, food, materials) | `src/game/rendering/IconPainter.ts` (2D canvas) and 3D renders of blocks in `src/game/core/AssetManager.ts` | Original work | — |
| Explorer, creatures, held tools | `src/game/rendering/Models.ts` — box-built procedural models | Original work | — |
| Furniture / station / shape models | `src/game/world/shapes.ts` | Original work | — |
| Sky, clouds, water, particles, crack effect | Shaders in `src/game/rendering/*` | Original work | — |
| Sound effects, ambience, creature voices, music | `src/game/core/AudioManager.ts` — synthesised with the Web Audio API | Original work | — |
| Menu diorama, loading island, portrait, HUD icons | SVG/CSS in `src/ui/**` | Original work | — |
| Build Home furniture, doors, windows, lights, appliances (≈145 models) | `src/data/furniture.ts` — procedural box / cylinder parts with colour slots, meshed by `src/game/build/ObjectGeometry.ts` | Original work | — |
| Architecture materials & shapes (60 materials, slopes, stairs, panels, trims, railings) | `src/data/architecture.ts`, `src/game/world/ArchShapes.ts`, tiles painted in `TexturePainter.ts` | Original work | — |
| Build Catalog thumbnails | Rendered at runtime from the models above (`src/game/build/BuildIcons.ts`) | Original work | — |
| Build Home menu illustration, plot scenery backdrops | SVG in `src/ui/MainMenu/BuildHomePreview.tsx`; procedural silhouettes in `src/game/rendering/PlotBackdrop.ts` | Original work | — |
| Favicon | `public/favicon.svg` | Original work | — |
| Fonts | System font stack (no font files bundled) | — | — |

## Code libraries (npm)

| Package | License |
| --- | --- |
| three | MIT |
| react, react-dom | MIT |
| @react-three/fiber | MIT |
| zustand | MIT |
| idb | ISC |
| vite, @vitejs/plugin-react, vitest | MIT |
| typescript | Apache-2.0 |
| fake-indexeddb (tests only) | Apache-2.0 |
| tsx (dev only, runs `validate:data`) | MIT |

Simplex noise in `src/game/world/noise.ts` is a TypeScript implementation of Stefan Gustavson's public-domain algorithm.

If you add external assets later, list each one here with its source URL, license and any changes you made.
