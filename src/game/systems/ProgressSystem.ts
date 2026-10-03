import { BIOMES } from '../../data/biomes';
import { BLOCK_DEFS } from '../../data/blocks';
import { CREATURES } from '../../data/creatures';
import { itemDef } from '../../data/items';
import { ACHIEVEMENTS, HOMESTEAD_UNLOCKS, LORE, QUESTS, type StatKey } from '../../data/progression';
import { LANDMARK_NAMES, type LandmarkType } from '../world/StructureGenerator';
import { useGameStore } from '../../stores/gameStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { levelForPoints, useWorldStore } from '../../stores/worldStore';
import { makeStack } from './InventoryLogic';
import type { Game } from '../Game';

const COOKING_STATIONS = new Set(['cooking_fire', 'stone_oven', 'kitchen_table']);
const AXES = new Set(['scrap_axe', 'copper_axe', 'tempered_axe', 'crystal_axe']);

/**
 * Quests, achievements, the Discovery Journal, Homestead points and Nature
 * Harmony — all driven by gameplay events on the EventBus, never by polling.
 */
export class ProgressSystem {
  private offs: (() => void)[] = [];

  constructor(private game: Game) {
    const bus = game.bus;
    const ws = () => useWorldStore.getState();
    const on = bus.on.bind(bus);
    this.offs.push(
      on('itemCollected', ({ item, count }) => {
        const def = itemDef(item);
        if (item === 'log' || item === 'birch_log') this.stat('wood', count);
        if (item === 'glow_crystal') this.stat('crystals', count);
        if (def.journal && ws().discover(def.journal, item)) this.journalToast(def.journal === 'plants' ? 'Plant' : 'Material', def.name);
      }),
      on('itemCrafted', ({ item, count, station }) => {
        this.stat('crafted', count);
        if (AXES.has(item)) this.stat('craftedAxe');
        if (item === 'explorer_pack') this.stat('backpack');
        if (station && COOKING_STATIONS.has(station) && itemDef(item).food) this.stat('cooked');
        ws().discover('recipes', item);
      }),
      on('blockPlaced', ({ id, x, z }) => {
        this.stat('placed');
        const def = BLOCK_DEFS[id];
        if (def.key === 'workbench') this.stat('workbench');
        if (def.homestead && this.nearHome(x, z)) this.homestead(def.homestead);
      }),
      on('treeFelled', () => {
        this.stat('trees');
        ws().addHarmony(-0.6);
      }),
      on('saplingPlanted', () => ws().addHarmony(1.2)),
      on('creatureFed', () => {
        this.stat('animalsFed');
        ws().addHarmony(1);
        this.homestead(2);
      }),
      on('creatureDefeated', () => this.stat('defeated')),
      on('creatureSeen', ({ kind }) => {
        if (ws().discover('animals', kind)) this.journalToast('Creature', CREATURES[kind].name);
      }),
      on('biomeEntered', ({ biome }) => {
        if (ws().discover('biomes', BIOMES[biome].id)) {
          useGameStore.getState().toast(`Discovered: ${BIOMES[biome].name}`, 'discovery', '🗺️');
          game.audio.discoveryStinger();
          ws().addHarmony(0.5);
        }
        useWorldStore.setState({ biomeName: BIOMES[biome].name });
      }),
      on('landmarkFound', ({ type, x, z }) => {
        const key = `${type}@${x},${z}`;
        if (!ws().discover('landmarks', key)) return;
        this.stat('landmarks');
        const name = type === 'waterfall' ? 'Tumbling Waterfall' : LANDMARK_NAMES[type as LandmarkType] ?? type;
        useGameStore.getState().toast(`Landmark discovered: ${name}`, 'discovery', '✨');
        game.audio.discoveryStinger();
        this.homestead(5);
        ws().addHarmony(1);
      }),
      on('loreRead', ({ index }) => {
        if (ws().discover('lore', String(index))) {
          this.stat('lore');
          this.homestead(3);
        }
      }),
      on('sheltered', ({ value }) => {
        if (value && !(ws().stats.sheltered ?? 0)) this.stat('sheltered');
      }),
      on('riverFound', () => {
        if (!(ws().stats.river ?? 0)) {
          this.stat('river');
          useGameStore.getState().toast('You found a river! Follow it to see where it leads.', 'discovery', '🌊');
        }
      }),
      on('caveEntered', () => {
        if (!(ws().stats.cave ?? 0)) this.stat('cave');
      }),
      on('cropPlanted', () => {
        this.stat('planted');
        ws().addHarmony(0.3);
      }),
      on('cropHarvested', () => {
        this.stat('harvested');
        this.homestead(1);
      }),
      on('soilTilled', () => this.stat('tilled')),
      on('slept', () => this.stat('slept')),
    );
  }

  private nearHome(x: number, z: number): boolean {
    const w = useWorldStore.getState();
    const anchor = w.home ?? w.camp;
    return Math.hypot(anchor.x - x, anchor.z - z) < 40;
  }

  private journalToast(kind: string, name: string) {
    useGameStore.getState().toast(`Journal: new ${kind.toLowerCase()} — ${name}`, 'discovery', '📖');
  }

  homestead(points: number): void {
    const ws = useWorldStore.getState();
    const before = levelForPoints(ws.homesteadPoints);
    ws.addHomestead(points);
    const after = levelForPoints(useWorldStore.getState().homesteadPoints);
    if (after > before) {
      useGameStore.getState().toast(`Homestead level ${after}! Unlocked: ${HOMESTEAD_UNLOCKS[after] ?? 'new things'}`, 'achievement', '🏡');
      this.game.audio.play('levelUp');
    }
  }

  stat(key: StatKey, n = 1): void {
    const v = useWorldStore.getState().bump(key, n);
    this.checkQuest();
    for (const a of ACHIEVEMENTS) {
      if (a.stat !== key || v < a.goal) continue;
      const ws = useWorldStore.getState();
      if (ws.achievements.includes(a.id)) continue;
      useWorldStore.setState({ achievements: [...ws.achievements, a.id] });
      useGameStore.getState().toast(`Achievement: ${a.title}`, 'achievement', '🏅');
      this.game.audio.play('chime');
    }
  }

  checkQuest(): void {
    const ws = useWorldStore.getState();
    const q = QUESTS[ws.questIndex];
    if (!q) return;
    if ((ws.stats[q.stat] ?? 0) < q.goal) return;
    // complete!
    const inv = useInventoryStore.getState();
    for (const r of q.reward) {
      const left = inv.add(r.item, r.count);
      if (left > 0) {
        const p = this.game.player.position;
        this.game.drops.spawn(makeStack(r.item, left), p.x, p.y + 1, p.z);
      }
    }
    useWorldStore.setState({ questIndex: ws.questIndex + 1 });
    this.homestead(q.homestead);
    const rewardText = q.reward.map((r) => `${r.count} ${itemDef(r.item).name}`).join(', ');
    useGameStore.getState().toast(`Quest complete: ${q.title} — reward: ${rewardText}`, 'quest', '✅');
    this.game.audio.play('chime');
    // chain: the next quest may already be satisfied
    setTimeout(() => this.checkQuest(), 1500);
  }

  readLore(index: number): void {
    const l = LORE[index % LORE.length];
    useGameStore.setState({ lore: { ...l, index: index % LORE.length }, overlay: 'lore' });
    this.game.bus.emit('loreRead', { index: index % LORE.length });
  }

  dispose(): void {
    for (const o of this.offs) o();
  }
}
