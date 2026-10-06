import { mkdir, writeFile } from 'node:fs/promises';
import { PLAYER_GUIDE, guideControls } from '../src/data/playerGuide';
import { DEFAULT_KEYS } from '../src/stores/settingsStore';

const escapeCell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [
  '# WildBlocks player guide', '',
  'Desktop, laptop, phone and tablet instructions for Survival, Build Home, PvP and Deathmatch.', '',
  'This manual is generated from the same content as the in-game **How to Play**. Keyboard tables show default bindings; the in-game guide shows your current bindings. Regenerate with `npm run docs:players` after editing `src/data/playerGuide.ts` or the control definitions.', '',
  '## Contents', '',
  ...PLAYER_GUIDE.map((s) => `- [${s.title}](#${s.id})`), '',
];
for (const section of PLAYER_GUIDE) {
  lines.push(`<a id="${section.id}"></a>`, '', `## ${section.title}`, '');
  for (const card of section.cards) lines.push(`### ${card.icon} ${card.title}`, '', card.text, '');
  if (['survival', 'build', 'pvp', 'deathmatch'].includes(section.id)) {
    lines.push('### Keyboard and mouse controls', '', '| Key / mouse | Action |', '| --- | --- |',
      ...guideControls(section.id, DEFAULT_KEYS).map(([key, action]) => `| ${escapeCell(key)} | ${escapeCell(action)} |`), '',
      'Settings → Controls rebinds supported actions. Build-tool and Deathmatch weapon shortcuts have fixed keys. See Devices & smooth play for touch input.', '');
  }
}
await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/PLAYER_GUIDE.md', import.meta.url), lines.join('\n'));
console.log(`Generated player guide: ${PLAYER_GUIDE.length} topics, ${PLAYER_GUIDE.reduce((n, s) => n + s.cards.length, 0)} entries.`);
