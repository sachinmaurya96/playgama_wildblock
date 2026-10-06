import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREATURES, type CreatureKind } from '../../data/creatures';
import { CREATURE_MEAT } from '../../data/creatureFood';
import { itemDef } from '../../data/items';
import { RECIPES } from '../../data/recipes';
import { useGameStore } from '../../stores/gameStore';
import { useWorldStore } from '../../stores/worldStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import type { Game } from '../Game';
import { B } from '../world/BlockRegistry';
import { Chunk } from '../world/Chunk';
import { World } from '../world/World';
import { EntityManager, type Creature } from './EntityManager';
import { PlayerInteraction } from '../player/PlayerInteraction';
import { makeStack } from '../systems/InventoryLogic';

const oldGame = useGameStore.getState(), oldWorld = useWorldStore.getState(), oldInventory = useInventoryStore.getState();
afterEach(() => { vi.restoreAllMocks(); useGameStore.setState(oldGame); useWorldStore.setState(oldWorld); useInventoryStore.setState(oldInventory); });

function setup() {
  const world = new World(123);
  world.addChunk(Chunk.empty(0, 0));
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.set(x, 10, z, B.STONE);
  const game = {
    scene: new THREE.Scene(), world, clock: { daylight: 0, day: 2, dayFraction: 0.95 }, time: 1,
    chunks: { isReady: () => true }, difficulty: 'explorer', peacefulCreatures: false,
    player: { position: new THREE.Vector3(8, 11, 8), dead: false, creative: false, hurt: vi.fn() },
    particles: { emit: vi.fn() }, audio: { play: vi.fn(), creature: vi.fn() },
    bus: { emit: vi.fn() }, drops: { spawn: vi.fn() },
  } as unknown as Game;
  const entities = new EntityManager(game);
  const ai = entities as unknown as {
    think(c: Creature, dist: number, held?: string): void;
    move(c: Creature, dt: number, dist: number): void;
    spawnWave(night: number): void;
    nightDirector(dt: number): void;
  };
  return { game, entities, ai };
}

describe('creature loot and dangerous nights', () => {
  it.each(Object.keys(CREATURES) as CreatureKind[])('%s always leaves loot on defeat, exactly once', (kind) => {
    const { game, entities } = setup();
    const c = entities.spawn(kind, 8, 11, 8);
    vi.spyOn(Math, 'random').mockReturnValue(0.99999); // every optional drop misses
    entities.damage(c, c.def.health + 1, new THREE.Vector3(7, 11, 8));
    expect(game.drops.spawn).toHaveBeenCalled();
    expect(c.fade).toBe(1);
    const count = vi.mocked(game.drops.spawn).mock.calls.length;
    entities.damage(c, 100, new THREE.Vector3());
    expect(game.drops.spawn).toHaveBeenCalledTimes(count);
    expect(game.bus.emit).toHaveBeenCalledWith('creatureHit', expect.objectContaining({ killed: true }));
  });

  it('keeps the saved companion alive and does not award hostile takedowns for wildlife', () => {
    const { game, entities } = setup();
    const fenn = entities.spawn('fenn', 8, 11, 8);
    fenn.tamed = true;
    entities.damage(fenn, 100, new THREE.Vector3());
    expect(fenn.health).toBe(1);
    expect(fenn.fade).toBe(0);
    expect(game.drops.spawn).not.toHaveBeenCalled();
    const animal = entities.spawn('mudsnout', 8, 11, 8);
    entities.damage(animal, 100, new THREE.Vector3());
    expect(game.bus.emit).not.toHaveBeenCalledWith('creatureDefeated', expect.anything());
    expect(entities.nightKills).toBe(0);
  });

  it('melee weapons deal their normal damage to wildlife while a tamed Fenn still receives a nudge', () => {
    const { game, entities } = setup();
    Object.assign(game, { entities, viewModel: { trigger: vi.fn() } });
    Object.assign(game.player, { energy: 100, swing: 0, shake: 0, body: { grounded: true, vel: new THREE.Vector3() } });
    const slots = [...useInventoryStore.getState().slots]; slots[0] = makeStack('copper_axe', 1);
    useInventoryStore.setState({ slots, selected: 0 });
    const interaction = new PlayerInteraction(game) as unknown as { attack(c: Creature): void };
    const animal = entities.spawn('mudsnout', 8, 11, 8);
    interaction.attack(animal);
    expect(animal.health).toBe(CREATURES.mudsnout.health - itemDef('copper_axe').tool!.damage);
    const fenn = entities.spawn('fenn', 8, 11, 8); fenn.tamed = true;
    interaction.attack(fenn);
    expect(fenn.health).toBe(CREATURES.fenn.health - 1);
  });

  it('every species meat cooks into an edible meal with greater recovery', () => {
    for (const [kind] of CREATURE_MEAT) {
      const raw = itemDef(`raw_${kind}_meat`), cooked = itemDef(`cooked_${kind}_meat`);
      expect(CREATURES[kind].drops).toContainEqual(expect.objectContaining({ item: raw.key, chance: 1 }));
      expect(RECIPES).toContainEqual(expect.objectContaining({
        output: { item: cooked.key, count: 1 }, inputs: [{ item: raw.key, count: 1 }], station: 'cooking_fire',
      }));
      expect(cooked.food!.energy).toBeGreaterThan(raw.food!.energy);
      expect(cooked.food!.vitality).toBeGreaterThan(raw.food!.vitality);
    }
  });

  it.each(['zombie', 'skeleton'] as const)('%s chases, attacks, and retreats at dawn', (kind) => {
    const { game, entities, ai } = setup();
    const c = entities.spawn(kind, 8, 11, 9);
    ai.think(c, 8);
    expect(c.state).toBe('chase');
    ai.think(c, 1);
    ai.move(c, 0.1, 1);
    expect(game.player.hurt).toHaveBeenCalledWith(CREATURES[kind].damage, CREATURES[kind].name, c.body.pos);
    game.clock.time = 1;
    Object.assign(game.clock, { daylight: 1 });
    ai.think(c, 1);
    expect(c.fade).toBe(1);
  });

  it('midnight waves cannot exceed the normal nearby hostile cap', () => {
    const { entities, ai } = setup();
    for (let i = 0; i < 12; i++) entities.spawn('zombie', 8, 11, 8);
    const spawn = vi.spyOn(entities, 'spawn');
    ai.spawnWave(10);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([['zombie', 0.6], ['skeleton', 0.8]] as const)('midnight waves can spawn %s on dark loaded ground', (kind, random) => {
    const { game, entities, ai } = setup();
    vi.spyOn(Math, 'random').mockReturnValue(random);
    vi.spyOn(game.world, 'standableY').mockReturnValue(10);
    vi.spyOn(game.world, 'isSolid').mockReturnValue(true);
    vi.spyOn(game.world, 'lightAt').mockReturnValue(0);
    const spawn = vi.spyOn(entities, 'spawn');
    ai.spawnWave(2);
    expect(spawn).toHaveBeenCalled();
    expect(entities.creatures.every((c) => c.kind === kind)).toBe(true);
    expect(entities.creatures.length).toBeLessThanOrEqual(5);
  });

  it.each(['peaceful', 'peaceful-creatures', 'creative'])('suppresses midnight waves in %s', (mode) => {
    const { game, entities, ai } = setup();
    if (mode === 'peaceful') game.difficulty = 'peaceful';
    if (mode === 'peaceful-creatures') game.peacefulCreatures = true;
    if (mode === 'creative') game.player.creative = true;
    const wave = vi.spyOn(ai, 'spawnWave');
    ai.nightDirector(0.1);
    ai.nightDirector(0.1);
    expect(wave).not.toHaveBeenCalled();
    expect(entities.creatures).toHaveLength(0);
  });
});
