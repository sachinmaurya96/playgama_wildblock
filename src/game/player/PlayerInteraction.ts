import * as THREE from 'three';
import { BLOCK_DEFS } from '../../data/blocks';
import { HAND_TOOL, itemDef, itemForBlock } from '../../data/items';
import { STATION_NAMES } from '../../data/recipes';
import { useGameStore } from '../../stores/gameStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { B, blockId, SHAPE, TILE_SIDE, TILE_TOP } from '../world/BlockRegistry';
import { isTrunk } from '../world/TreeGenerator';
import { hash3 } from '../core/random';
import { blocksPlayer, canPlaceAt, placeBlock, toggleDoor } from '../systems/BuildingSystem';
import { ContainerSystem } from '../systems/ContainerSystem';
import { makeStack } from '../systems/InventoryLogic';
import type { Game } from '../Game';
import type { Creature } from '../entities/EntityManager';
import { PLAYER_HALF_W, PLAYER_HEIGHT } from './Player';
import { raycastBlocks, selectionBox, type BlockHit } from './Raycast';
import type { HandAction } from '../rendering/FirstPersonViewModel';

const REACH = 5.2;

/**
 * Targeting, breaking (hardness × tool effectiveness), placing, using items,
 * interacting with blocks/creatures and melee attacks.
 */
export class PlayerInteraction {
  target: BlockHit | null = null;
  targetCreature: Creature | null = null;
  targetBoat: Parameters<Game['boats']['hit']>[0] | null = null;
  /** PvP: the other player under the crosshair (in melee reach). */
  targetRemote: string | null = null;
  private noArrowsHint = 0;
  private breaking: { x: number; y: number; z: number; progress: number; time: number } | null = null;
  private hitSoundTimer = 0;
  private chipTimer = 0;
  private placeTimer = 0;
  private attackCooldown = 0;
  private useCooldown = 0;
  private eye = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private game: Game) {}

  /** Break time in seconds for a block with the currently held tool, and whether it drops. */
  breakInfo(id: number): { time: number; drops: boolean } {
    const def = BLOCK_DEFS[id];
    const stack = useInventoryStore.getState().selectedStack();
    const tool = stack ? itemDef(stack.item).tool ?? HAND_TOOL : HAND_TOOL;
    let time = def.hardness;
    const matches = def.tool && tool.kind === def.tool;
    if (matches) time /= tool.speed;
    else if (tool.kind !== 'hand' && tool.kind !== 'weapon' && def.tool) time /= 1.15;
    let drops = true;
    if (def.minTier !== undefined) {
      const ok = matches && tool.tier >= def.minTier;
      if (!ok) {
        time *= 2.5;
        drops = false;
      }
    }
    if (this.game.player.energy < 8) time *= 1.3;
    if (this.game.player.inWater) time *= 1.5;
    return { time: Math.max(0.05, time), drops };
  }

  update(dt: number, simulate: boolean): void {
    const g = this.game;
    const input = g.input;
    const inv = useInventoryStore.getState();
    const gs = useGameStore.getState();
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.useCooldown = Math.max(0, this.useCooldown - dt);
    this.placeTimer = Math.max(0, this.placeTimer - dt);

    if (!simulate || input.cursorFree || g.player.dead) {
      this.breaking = null;
      gs.setBreakProgress(0);
      g.outline.hide();
      return;
    }
    if (g.rest.seated) {
      this.breaking = null;
      gs.setBreakProgress(0);
      gs.setPrompt('Jump / Interact / Move  Stand up');
      g.outline.hide();
      return;
    }

    // hotbar selection
    for (let i = 0; i < 9; i++) if (input.keyPressed(`Digit${i + 1}`)) inv.select(i);
    if (input.wheel) inv.cycle(input.wheel);
    if (input.wasPressed('drop')) {
      const s = inv.selectedStack();
      if (s) {
        const all = input.isDown('crouch');
        const n = all ? s.count : 1;
        g.drops.throwFromPlayer({ ...s, count: n });
        inv.consumeSelected(n);
      }
    }

    // in a boat: look around, row, F / ✋ / Jump steps out — no digging or building from the seat
    if (g.boats.riding) {
      this.breaking = null;
      this.targetCreature = null;
      this.target = null;
      this.targetBoat = null;
      gs.setBreakProgress(0);
      g.outline.show(null, 0, 0, 0, 0, g.time);
      g.outline.showGhost(false);
      gs.setPrompt('Space  Step out of the boat');
      if (input.wasPressed('interact') || input.touch.interactPressed || input.touch.tapPressed) g.boats.dismount();
      return;
    }

    // targeting
    const p = g.player;
    p.eyePosition(this.eye);
    p.lookDirection(this.dir);
    if (p.cameraMode === 'third') {
      // aim from the camera through the crosshair
      this.eye.copy(g.camera.position);
      g.camera.getWorldDirection(this.dir);
    }
    const blockHit = raycastBlocks(g.world, this.eye, this.dir, REACH + (p.cameraMode === 'third' ? 4 : 0));
    const held = inv.selectedStack();
    const heldDef = held ? itemDef(held.item) : null;
    const reachE = heldDef?.icon && 'shape' in heldDef.icon && heldDef.icon.shape === 'spear' ? 4.6 : 3.6;
    const ent = g.entities.raycast(this.eye, this.dir, reachE + (p.cameraMode === 'third' ? 4 : 0));
    const boat = g.boats.raycast(this.eye, this.dir, REACH + (p.cameraMode === 'third' ? 4 : 0));
    this.targetBoat = null;
    this.targetRemote = null;
    // grass, flowers and crops don't shield creatures or boats from you
    const softHit = !!blockHit && SHAPE[blockHit.id] === 2;
    const rem = g.pvp?.raycast(this.eye, this.dir, reachE + 0.4 + (p.cameraMode === 'third' ? 4 : 0)) ?? null;
    if (rem && (!blockHit || softHit || rem.dist < blockHit.dist) && (!ent || rem.dist < ent.dist) && (!boat || rem.dist < boat.dist)) {
      this.targetRemote = rem.id;
      this.targetCreature = null;
      this.target = null;
    } else if (boat && (!blockHit || softHit || boat.dist < blockHit.dist) && (!ent || boat.dist < ent.dist)) {
      this.targetBoat = boat.boat;
      this.targetCreature = null;
      this.target = null;
    } else if (ent && (!blockHit || softHit || ent.dist < blockHit.dist)) {
      this.targetCreature = ent.c;
      this.target = null;
    } else {
      this.targetCreature = null;
      this.target = blockHit;
    }

    this.updatePrompt(held?.item ?? null);

    const lmb = input.mouseLeft || input.touch.breakHeld;
    const lmbPressed = input.mouseLeftPressed || (input.touch.breakHeld && !this.breaking && this.attackCooldown <= 0);
    const rmbPressed = input.mouseRightPressed || input.touch.placePressed;
    const rmbHeld = input.mouseRight || input.touch.placeHeld;

    // ---- attack / break
    const noBuild = !!g.pvp && !g.pvp.settings.building;
    if (this.targetRemote && lmbPressed && this.attackCooldown <= 0) {
      this.attackPlayer(this.targetRemote);
    } else if (this.targetBoat && lmbPressed && this.attackCooldown <= 0) {
      this.attackCooldown = 0.3;
      this.swingAnim('attack');
      g.boats.hit(this.targetBoat);
    } else if (this.targetCreature && lmbPressed && this.attackCooldown <= 0) {
      this.attack(this.targetCreature);
    } else if (lmb && this.target && !noBuild) {
      this.progressBreak(dt, this.target);
    } else {
      if (lmbPressed && this.attackCooldown <= 0) {
        this.attackCooldown = 0.35;
        this.swingAnim('attack');
        g.audio.play('swing');
      }
      this.breaking = null;
    }
    if (!lmb) this.breaking = null;
    gs.setBreakProgress(this.breaking ? Math.min(1, this.breaking.progress / this.breaking.time) : 0);

    // ---- touch: a quick tap on the open screen does the obvious thing for what you aim at
    if (input.touch.tapPressed) this.tap();
    // ---- interact (F) / use (RMB)
    if (input.wasPressed('interact') || input.touch.interactPressed) this.interact();
    if (rmbPressed || (rmbHeld && this.placeTimer <= 0 && this.lastRightWasPlace)) this.use(rmbPressed);

    // outline + ghost
    const t = this.target;
    const settings = useSettingsStore.getState();
    g.outline.setHighContrast(settings.accessibility.highContrastOutline);
    if (t) {
      const box = selectionBox(t.id, t.meta);
      const prog = this.breaking && this.breaking.x === t.x && this.breaking.y === t.y && this.breaking.z === t.z ? this.breaking.progress / this.breaking.time : 0;
      g.outline.show(box, t.x, t.y, t.z, prog, g.time);
      const placeable = heldDef?.placeBlock;
      if (placeable && settings.gameplay.ghostPreview && !BLOCK_DEFS[t.id].interact) {
        const c = this.placementCell(t);
        g.outline.showGhost(!!c, c?.[0], c?.[1], c?.[2]);
      } else g.outline.showGhost(false);
    } else {
      g.outline.show(null, 0, 0, 0, 0, g.time);
      g.outline.showGhost(false);
    }
  }

  private lastRightWasPlace = false;

  /**
   * Touch tap: attack a hostile creature, pet / feed a friendly one, open doors,
   * chests and stations, harvest ripe crops — otherwise use the held item
   * (place a block, eat, till, plant, water).
   */
  private tap() {
    if (this.targetRemote) {
      if (this.attackCooldown <= 0) this.attackPlayer(this.targetRemote);
      return;
    }
    if (this.targetBoat) {
      this.game.boats.board(this.targetBoat);
      return;
    }
    const c = this.targetCreature;
    if (c) {
      if (c.def.hostile) {
        if (this.attackCooldown <= 0) this.attack(c);
      } else this.interact();
      return;
    }
    const t = this.target;
    if (t) {
      const def = BLOCK_DEFS[t.id];
      const ripe = (def.growth && this.game.farming.isRipe(this.game.world, t.x, t.y, t.z)) || (t.id === B.BERRY_BUSH && (t.meta >> 3) & 1);
      if ((def.interact && def.interact !== 'harvest') || ripe) {
        this.interact();
        return;
      }
    }
    this.use(true);
  }

  /**
   * Play a hand action on the first-person view model and the third-person
   * avatar. Breaking picks the arc from the held tool (axes chop diagonally,
   * picks/shovels/hands mine with a short downward arc).
   */
  private swingAnim(kind: 'chop' | 'place' | 'attack' | 'eat' | 'interact') {
    const g = this.game;
    let hand: HandAction = kind === 'chop' ? 'mine' : kind;
    if (kind === 'chop') {
      const s = useInventoryStore.getState().selectedStack();
      const tk = s ? itemDef(s.item).tool?.kind : undefined;
      hand = tk === 'axe' ? 'chop' : tk === 'weapon' ? 'attack' : 'mine';
    }
    g.viewModel.trigger(hand);
    if (kind === 'interact') return;
    if (g.player.swing <= 0.15 || kind === 'eat') {
      g.player.swing = 1;
      g.player.swingKind = kind === 'eat' ? 'place' : kind;
    }
  }

  private updatePrompt(held: string | null) {
    const gs = useGameStore.getState();
    const c = this.targetCreature;
    const heldDef = held ? itemDef(held) : null;
    if (this.targetBoat) {
      gs.setPrompt('F  Climb into the boat');
      return;
    }
    if (c) {
      if (c.def.hostile) gs.setPrompt(`LMB  Attack ${c.def.name}`);
      else if (heldDef && c.def.favoriteFood?.includes(held!)) gs.setPrompt(`F  Feed ${c.def.name}`);
      else if (c.tamed) gs.setPrompt(`F  ${c.sitting ? 'Call' : 'Sit'} ${c.def.name}`);
      else gs.setPrompt(`F  Pet ${c.def.name}`);
      return;
    }
    const t = this.target;
    if (!t) {
      gs.setPrompt(heldDef?.food ? `RMB  Eat ${heldDef.name}` : held === 'boat' ? 'RMB  Set the boat on water' : null);
      return;
    }
    if (held === 'boat') return gs.setPrompt('RMB  Set the boat down');
    const def = BLOCK_DEFS[t.id];
    const f = this.game.farming;
    if (def.interact === 'container') return gs.setPrompt(`F  Open ${def.name}`);
    if (def.interact === 'station') return gs.setPrompt(`F  Use ${STATION_NAMES[def.station!] ?? def.name}`);
    if (def.interact === 'bed') return gs.setPrompt('F  Rest / Set Home');
    if (def.interact === 'sit') return gs.setPrompt('F  Sit');
    if (def.interact === 'door') return gs.setPrompt(`F  ${t.meta & 4 ? 'Close' : 'Open'} Door`);
    if (def.interact === 'lore') return gs.setPrompt('F  Read the Whisper Stele');
    if (t.id === B.BERRY_BUSH && (t.meta >> 3) & 1) return gs.setPrompt('F  Pick Berries');
    if (def.growth && f.isRipe(this.game.world, t.x, t.y, t.z)) return gs.setPrompt(`F  Harvest ${def.name}`);
    if (heldDef?.food) return gs.setPrompt(`RMB  Eat ${heldDef.name}`);
    if (heldDef?.plantsCrop && (t.id === B.TILLED || t.id === B.TILLED_MOIST)) return gs.setPrompt(`RMB  Plant ${heldDef.name}`);
    if (heldDef?.tool?.kind === 'hoe' && held !== 'watering_can' && (t.id === B.GRASS || t.id === B.DIRT || t.id === B.LEAF_LITTER)) return gs.setPrompt('RMB  Till Soil');
    if (held === 'watering_can' && t.id === B.TILLED) return gs.setPrompt('RMB  Water Soil');
    if (heldDef?.placeBlock) return gs.setPrompt(`RMB  Place ${heldDef.name}`);
    if (def.hardness === Infinity) return gs.setPrompt(null);
    const verb = def.tool === 'axe' ? (isTrunk(t.id) ? 'Chop' : 'Break') : def.tool === 'pick' ? 'Mine' : def.tool === 'shovel' ? 'Dig' : 'Break';
    gs.setPrompt(`Hold LMB  ${verb}`);
  }

  private progressBreak(dt: number, t: BlockHit) {
    const g = this.game;
    const def = BLOCK_DEFS[t.id];
    if (def.hardness === Infinity) return;
    const b = this.breaking;
    if (!b || b.x !== t.x || b.y !== t.y || b.z !== t.z) {
      this.breaking = { x: t.x, y: t.y, z: t.z, progress: 0, time: this.breakInfo(t.id).time };
      this.hitSoundTimer = 0;
    }
    const br = this.breaking!;
    br.progress += dt;
    this.hitSoundTimer -= dt;
    this.chipTimer -= dt;
    if (this.hitSoundTimer <= 0) {
      this.hitSoundTimer = 0.26;
      g.audio.play('hit', { material: def.sound, pos: t.point });
      this.swingAnim('chop');
    }
    if (this.chipTimer <= 0) {
      this.chipTimer = 0.12;
      const col = g.assets.tileColors[TILE_SIDE[t.id]] ?? [0.5, 0.5, 0.5];
      g.particles.emit('chip', t.point.x + t.nx * 0.05, t.point.y + t.ny * 0.05, t.point.z + t.nz * 0.05, 2, col, { spread: 0.15, speed: 2.2, size: 0.06, life: 0.5 });
    }
    if (br.progress >= br.time) {
      this.breaking = null;
      this.breakBlock(t.x, t.y, t.z, true);
    }
  }

  /** Break a block: drops, special cases (doors, containers, crops, trees). */
  breakBlock(x: number, y: number, z: number, byPlayer: boolean): void {
    const g = this.game;
    const w = g.world;
    const id = w.get(x, y, z);
    const meta = w.getMeta(x, y, z);
    const def = BLOCK_DEFS[id];
    if (!id || def.hardness === Infinity) return;
    const info = this.breakInfo(id);
    const col = g.assets.tileColors[TILE_TOP[id]] ?? [0.5, 0.5, 0.5];
    g.particles.emit('chip', x + 0.5, y + 0.5, z + 0.5, 14, col, { spread: 0.7, speed: 3, size: 0.09, life: 0.7 });
    g.audio.play('break', { material: def.sound, pos: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5) });

    // doors: remove both halves
    if (id === B.DOOR_LOWER || id === B.DOOR_UPPER) {
      const by = id === B.DOOR_UPPER ? y - 1 : y;
      w.beginBatch();
      w.set(x, by, z, 0);
      if (w.get(x, by + 1, z) === B.DOOR_UPPER) w.set(x, by + 1, z, 0);
      w.endBatch();
      g.drops.spawn(makeStack('door'), x + 0.5, by + 0.5, z + 0.5);
      this.afterBreak(x, y, z, id, byPlayer);
      return;
    }

    // containers spill their contents
    if (def.interact === 'container') {
      for (const s of g.containers.take(ContainerSystem.key(x, y, z))) if (s) g.drops.spawn(s, x + 0.5, y + 0.6, z + 0.5);
    }

    w.set(x, y, z, 0);

    const felled = isTrunk(id) && g.trees.tryFell(x, y, z, id);

    // drops
    if (info.drops) {
      const drop = (item: string, n: number) => n > 0 && g.drops.spawn(makeStack(item, n), x + 0.5, y + 0.5, z + 0.5);
      if (def.growth) {
        const ripe = ((meta >> 3) & 7) >= def.growth.stages - 1;
        if (ripe) {
          const [lo, hi] = def.growth.harvestCount;
          drop(def.growth.harvest, lo + Math.floor(Math.random() * (hi - lo + 1)));
          drop(def.growth.seed, def.growth.seed === def.growth.harvest ? 0 : 1 + (Math.random() < 0.5 ? 1 : 0));
          g.bus.emit('cropHarvested', { crop: def.key });
        } else drop(def.growth.seed, 1);
      } else if (id === B.BERRY_BUSH) {
        if ((meta >> 3) & 1) drop('bramble_berries', 2 + Math.floor(Math.random() * 2));
      } else {
        const item = def.arch ? itemForBlock(def.key, meta) : def.drop === undefined ? def.key : def.drop;
        if (item) {
          const [lo, hi] = def.dropCount ?? [1, 1];
          drop(item, lo + Math.floor(Math.random() * (hi - lo + 1)));
        }
        for (const b of def.bonusDrops ?? []) {
          if (Math.random() < b.chance) drop(b.item, b.count ? b.count[0] + Math.floor(Math.random() * (b.count[1] - b.count[0] + 1)) : 1);
        }
      }
    } else if (byPlayer && def.minTier !== undefined) {
      useGameStore.getState().toast(`You need a better ${def.tool} to collect ${def.name}.`, 'warn', '⛏️');
    }
    // tool wear
    if (byPlayer) {
      const s = useInventoryStore.getState().selectedStack();
      if (s && itemDef(s.item).tool && def.hardness > 0.2) {
        const broke = useInventoryStore.getState().wearSelected(1);
        if (broke) {
          g.audio.play('toolBreak');
          useGameStore.getState().toast(`Your ${itemDef(s.item).name} broke!`, 'warn', '💔');
        }
      }
      g.player.energy = Math.max(0, g.player.energy - 0.15);
    }
    void felled;
    this.afterBreak(x, y, z, id, byPlayer);
  }

  private afterBreak(x: number, y: number, z: number, id: number, byPlayer: boolean) {
    const g = this.game;
    g.farming.removed(x, y, z);
    g.bus.emit('blockBroken', { x, y, z, id, byPlayer });
    // things that need support above fall off
    const above = g.world.get(x, y + 1, z);
    const adef = BLOCK_DEFS[above];
    if (above && (adef.needsSupport || SHAPE[above] === 2)) this.breakBlock(x, y + 1, z, false);
    // soil under a crop stays; tilled soil broken turns crops above into seeds (handled by support)
  }

  private placementCell(t: BlockHit): [number, number, number] | null {
    const def = BLOCK_DEFS[t.id];
    if (def.replaceable && t.id !== B.WATER) return [t.x, t.y, t.z];
    return [t.x + t.nx, t.y + t.ny, t.z + t.nz];
  }

  /** Right click: eat, till, water, plant, interact with doors/containers, or place. */
  private use(pressed: boolean) {
    const g = this.game;
    const inv = useInventoryStore.getState();
    const held = inv.selectedStack();
    const def = held ? itemDef(held.item) : null;
    const t = this.target;
    this.lastRightWasPlace = false;

    if (pressed && this.targetBoat) {
      g.boats.board(this.targetBoat);
      return;
    }
    // interacting blocks take priority unless crouching (build against them)
    if (pressed && t && BLOCK_DEFS[t.id].interact && !g.player.crouching && BLOCK_DEFS[t.id].interact !== 'harvest') {
      this.interact();
      return;
    }
    // bows: right click / tap to loose an arrow (hold to keep shooting)
    if (def?.ranged) {
      this.shoot(def.ranged);
      return;
    }
    if (pressed && this.targetCreature) {
      this.interact();
      return;
    }
    if (!def || !held) return;
    if (def.placeBlock && g.pvp && !g.pvp.settings.building) return;

    if (held.item === 'boat') {
      if (!pressed) return;
      if (this.targetBoat) return g.boats.board(this.targetBoat);
      // aim through to the water surface (water isn't a normal target)
      const hit = raycastBlocks(g.world, this.eye, this.dir, REACH + 2, true);
      if (hit && g.boats.placeAt(hit.x, hit.y, hit.z, hit.id === B.WATER, g.player.yaw)) {
        inv.consumeSelected(1);
        this.swingAnim('place');
        if (hit.id === B.WATER) useGameStore.getState().toast('Boat in the water! Aim at it and press F (✋ on touch) to climb in.', 'info', '⛵');
      } else useGameStore.getState().toast('Aim at water (or open ground) to set the boat down.', 'info', '⛵');
      return;
    }

    if (def.food) {
      if (!pressed || this.useCooldown > 0) return;
      const p = g.player;
      if (p.vitality >= p.maxVitality && p.energy >= 99 && !def.food.buff) {
        useGameStore.getState().toast("You're not hungry right now.", 'info', '🍎');
        return;
      }
      this.useCooldown = 0.9;
      inv.consumeSelected(1);
      p.heal(def.food.vitality, def.food.energy);
      if (def.food.buff) p.addBuff(def.food.buff.id, def.food.buff.seconds);
      g.audio.play('eat');
      this.swingAnim('eat');
      const eye = p.eyePosition();
      const d = p.lookDirection();
      g.particles.emit('chip', eye.x + d.x * 0.5, eye.y - 0.2, eye.z + d.z * 0.5, 6, [0.9, 0.7, 0.5], { spread: 0.1, speed: 1.2, size: 0.04, life: 0.4 });
      g.bus.emit('ateFood', { item: held.item });
      return;
    }
    if (!t) return;

    // Aiming at tall grass / flowers while farming means "the soil under it".
    if ((def.tool?.kind === 'hoe' || def.plantsCrop) && BLOCK_DEFS[t.id].replaceable && SHAPE[t.id] === 2) {
      const below = g.world.get(t.x, t.y - 1, t.z);
      if (below === B.GRASS || below === B.DIRT || below === B.LEAF_LITTER || below === B.TILLED || below === B.TILLED_MOIST) {
        if (def.tool?.kind === 'hoe') g.world.set(t.x, t.y, t.z, 0);
        t.y -= 1;
        t.id = below;
      }
    }

    // hoe → till
    if (def.tool?.kind === 'hoe' && held.item !== 'watering_can' && pressed) {
      if ((t.id === B.GRASS || t.id === B.DIRT || t.id === B.LEAF_LITTER) && !g.world.isSolid(t.x, t.y + 1, t.z)) {
        const above = g.world.get(t.x, t.y + 1, t.z);
        if (above && BLOCK_DEFS[above].replaceable) g.world.set(t.x, t.y + 1, t.z, 0);
        g.world.set(t.x, t.y, t.z, B.TILLED, 0);
        g.farming.moistenIfNearWater(g.world, t.x, t.y, t.z);
        g.audio.play('till', { material: 'dirt', pos: t.point });
        g.particles.emit('chip', t.x + 0.5, t.y + 1, t.z + 0.5, 8, [0.45, 0.32, 0.2], { spread: 0.6, speed: 2, size: 0.07 });
        inv.wearSelected(1);
        this.swingAnim('chop');
        g.bus.emit('soilTilled', {});
        return;
      }
    }
    // watering can
    if (held.item === 'watering_can' && pressed) {
      const targets = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
      let any = false;
      for (const [dx, dz] of targets) {
        for (const dy of [0, -1]) {
          const x = t.x + dx, y = t.y + dy, z = t.z + dz;
          if (g.world.get(x, y, z) === B.TILLED) {
            g.world.set(x, y, z, B.TILLED_MOIST, 0);
            any = true;
          }
        }
      }
      if (any) {
        g.audio.play('water', { pos: t.point });
        g.particles.emit('splash', t.x + 0.5, t.y + 1.2, t.z + 0.5, 14, [0.5, 0.75, 0.95], { spread: 1.2, speed: 1.5, size: 0.06, life: 0.6 });
        inv.wearSelected(1);
        this.swingAnim('place');
      }
      return;
    }
    // planting
    if (def.plantsCrop && pressed) {
      const soilHit = t.id === B.TILLED || t.id === B.TILLED_MOIST;
      const cx = t.x, cy = soilHit ? t.y + 1 : t.y, cz = t.z;
      if (g.farming.plant(g.world, cx, cy, cz, def.plantsCrop, g.clock.time)) {
        inv.consumeSelected(1);
        g.audio.play('place', { material: 'plant', pos: t.point });
        this.swingAnim('place');
        g.bus.emit('cropPlanted', { crop: def.plantsCrop });
        return;
      }
      if (!def.placeBlock && !def.food) {
        useGameStore.getState().toast('Seeds need tilled soil — use a hoe on grass first.', 'info', '🌱');
        return;
      }
    }
    // placing blocks
    if (def.placeBlock) {
      if (!pressed && this.placeTimer > 0) return;
      const cell = this.placementCell(t);
      if (!cell) return;
      const [x, y, z] = cell;
      const id = blockId(def.placeBlock);
      const pp = g.player.position;
      if (blocksPlayer(x, y, z, pp.x, pp.y, pp.z, PLAYER_HALF_W, PLAYER_HEIGHT, id)) return;
      if (id === B.DOOR_LOWER && blocksPlayer(x, y + 1, z, pp.x, pp.y, pp.z, PLAYER_HALF_W, PLAYER_HEIGHT, id)) return;
      for (const c of g.entities.creatures) {
        const cp = c.body.pos;
        if (x + 1 > cp.x - c.body.halfW && x < cp.x + c.body.halfW && z + 1 > cp.z - c.body.halfW && z < cp.z + c.body.halfW && y + 1 > cp.y && y < cp.y + c.def.height) return;
      }
      if (!canPlaceAt(g.world, x, y, z, id).ok) {
        if (pressed) g.audio.play('error');
        return;
      }
      const placed = placeBlock(g.world, { x, y, z, block: def.placeBlock, yaw: g.player.yaw, ny: t.ny, meta: def.placeMeta });
      if (!placed) return;
      inv.consumeSelected(1);
      this.placeTimer = 0.22;
      this.lastRightWasPlace = true;
      g.audio.play('place', { material: BLOCK_DEFS[id].sound, pos: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5) });
      this.swingAnim('place');
      if (BLOCK_DEFS[id].interact === 'container') g.containers.get(ContainerSystem.key(x, y, z), g.world.seed, false);
      if (id === B.SAPLING) g.bus.emit('saplingPlanted', {});
      for (const c of placed) g.bus.emit('blockPlaced', { x: c.x, y: c.y, z: c.z, id: c.id });
    }
  }

  /** F key: creatures, containers, stations, beds, doors, lore, harvest. */
  interact(): void {
    const g = this.game;
    this.swingAnim('interact');
    if (this.targetBoat) {
      g.boats.board(this.targetBoat);
      return;
    }
    if (this.targetCreature) {
      const msg = g.entities.interact(this.targetCreature);
      if (msg) useGameStore.getState().toast(msg, 'info', '💚');
      return;
    }
    const t = this.target;
    if (!t) { g.rest.interactNearby(); return; }
    const def = BLOCK_DEFS[t.id];
    const gs = useGameStore.getState();
    switch (def.interact) {
      case 'container': {
        const key = ContainerSystem.key(t.x, t.y, t.z);
        const slots = g.containers.get(key, g.world.seed, !g.containers.containers.has(key));
        useInventoryStore.getState().openContainer(key, def.name, slots);
        g.audio.play('open');
        g.openOverlay('container');
        return;
      }
      case 'station':
        g.audio.play('open');
        g.openOverlay('inventory', def.station ?? null);
        return;
      case 'bed':
        g.pendingBed = { x: t.x, y: t.y, z: t.z };
        g.openOverlay('sleep');
        return;
      case 'sit':
        g.rest.activate('sit');
        return;
      case 'door': {
        const open = toggleDoor(g.world, t.x, t.y, t.z);
        g.audio.play('door', { pos: t.point, pitch: open ? 1 : 0.85 });
        return;
      }
      case 'lore': {
        const idx = Math.floor(hash3(t.x, t.y, t.z, g.world.seed) * 1000);
        g.progress.readLore(idx);
        g.audio.play('discover');
        g.releasePointer();
        return;
      }
      default:
        break;
    }
    if (t.id === B.BERRY_BUSH && g.farming.harvestBush(g.world, t.x, t.y, t.z, g.clock.time)) {
      g.drops.spawn(makeStack('bramble_berries', 2 + Math.floor(Math.random() * 3)), t.x + 0.5, t.y + 0.8, t.z + 0.5, 0.5);
      g.audio.play('break', { material: 'plant', pos: t.point });
      return;
    }
    if (def.growth && g.farming.isRipe(g.world, t.x, t.y, t.z)) {
      const [lo, hi] = def.growth.harvestCount;
      g.drops.spawn(makeStack(def.growth.harvest, lo + Math.floor(Math.random() * (hi - lo + 1))), t.x + 0.5, t.y + 0.6, t.z + 0.5, 0.5);
      g.farming.replant(t.x, t.y, t.z, g.clock.time, g.world);
      g.audio.play('break', { material: 'plant', pos: t.point });
      g.bus.emit('cropHarvested', { crop: def.key });
      gs.toast(`Harvested ${def.name} — replanted automatically.`, 'info', '🌾');
      return;
    }
    g.rest.interactNearby();
  }

  /** Loose an arrow along the crosshair. */
  private shoot(r: { damage: number; speed: number; cooldown: number }) {
    const g = this.game;
    const inv = useInventoryStore.getState();
    this.lastRightWasPlace = true;
    if (this.useCooldown > 0) return;
    if (inv.count('arrow') <= 0) {
      this.useCooldown = 0.4;
      this.placeTimer = 0.4;
      g.audio.play('error');
      if (g.time - this.noArrowsHint > 6) {
        this.noArrowsHint = g.time;
        useGameStore.getState().toast('No arrows! Craft them from sticks, flint and fiber.', 'warn', '🏹');
      }
      return;
    }
    inv.remove('arrow', 1);
    this.useCooldown = r.cooldown;
    this.placeTimer = r.cooldown;
    const origin = this.eye.clone().addScaledVector(this.dir, 0.6);
    origin.y -= 0.12;
    const dir = this.dir.clone();
    dir.y += 0.035; // a little loft: arrows drop over distance
    dir.normalize();
    const dmg = r.damage * (g.player.energy < 8 ? 0.8 : 1);
    g.arrows.shoot(origin, dir, r.speed, dmg);
    g.pvp?.sendArrow(origin, dir.clone().multiplyScalar(r.speed));
    this.swingAnim('place');
    g.audio.play('bow', { pos: origin });
    inv.wearSelected(1);
  }

  /** PvP melee: same weapon numbers as against creatures; the other player's armor & shield apply on their side. */
  private attackPlayer(id: string) {
    const g = this.game;
    const pvp = g.pvp;
    if (!pvp) return;
    const inv = useInventoryStore.getState();
    const s = inv.selectedStack();
    const tool = s ? itemDef(s.item).tool ?? HAND_TOOL : HAND_TOOL;
    this.attackCooldown = tool.sweep ? 0.4 : tool.kind === 'weapon' ? 0.45 : 0.55;
    this.swingAnim('attack');
    g.audio.play('swing');
    let dmg = tool.damage * (g.player.energy < 8 ? 0.8 : 1);
    if (tool.kind === 'weapon') dmg *= 1.1;
    const b = g.player.body;
    const crit = !b.grounded && b.vel.y < -1 && !g.player.inWater;
    if (crit) dmg *= 1.5;
    pvp.hitPlayer(id, dmg, 'melee', crit);
    if (tool.sweep) for (const o of pvp.inSweep(g.player.position, g.player.yaw, id)) pvp.hitPlayer(o, dmg * 0.6, 'melee');
    if (s && itemDef(s.item).tool) inv.wearSelected(1);
    g.player.shake = Math.min(1, g.player.shake + (crit ? 0.3 : 0.15));
  }

  private attack(c: Creature) {
    const g = this.game;
    const inv = useInventoryStore.getState();
    const s = inv.selectedStack();
    const tool = s ? itemDef(s.item).tool ?? HAND_TOOL : HAND_TOOL;
    this.attackCooldown = tool.kind === 'weapon' ? 0.45 : 0.55;
    this.swingAnim('attack');
    g.audio.play('swing');
    if (c.tamed) {
      // Keep the existing saved companion protection.
      g.entities.damage(c, 1, g.player.position);
      return;
    }
    let dmg = tool.damage * (g.player.energy < 8 ? 0.8 : 1);
    if (tool.kind === 'weapon') dmg *= 1.1;
    // critical hit: strike while falling (jump, then attack on the way down)
    const b = g.player.body;
    const crit = !b.grounded && b.vel.y < -1 && !g.player.inWater;
    if (crit) {
      dmg *= 1.5;
      g.particles.emit('sparkle', c.body.pos.x, c.body.pos.y + c.def.height * 0.8, c.body.pos.z, 12, [1, 0.85, 0.35], { spread: 0.6, speed: 2.4, size: 0.09, life: 0.55, glow: true });
    }
    g.entities.damage(c, dmg, g.player.position, crit);
    if (tool.sweep) {
      this.attackCooldown = 0.4;
      // sword sweep: catch other hostiles in a wide arc in front of you
      const p = g.player.position;
      const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
      for (const o of g.entities.creatures) {
        if (o === c || !o.def.hostile || o.fade) continue;
        const dx = o.body.pos.x - p.x, dz = o.body.pos.z - p.z, dy = o.body.pos.y - p.y;
        const d = Math.hypot(dx, dz);
        if (d > 3.2 || Math.abs(dy) > 2 || (dx * fx + dz * fz) / (d || 1) < 0.25) continue;
        g.entities.damage(o, dmg * 0.6, p);
      }
      const e = g.player.eyePosition();
      for (let k = -2; k <= 2; k++) {
        const a = g.player.yaw + k * 0.32;
        g.particles.emit('sparkle', e.x - Math.sin(a) * 1.6, e.y - 0.35 - Math.abs(k) * 0.06, e.z - Math.cos(a) * 1.6, 2, [1, 1, 0.9], { spread: 0.12, speed: 0.4, size: 0.07, life: 0.25 });
      }
    }
    if (s && itemDef(s.item).tool) inv.wearSelected(1);
    g.player.shake = Math.min(1, g.player.shake + (crit ? 0.3 : 0.15));
    if (crit) g.audio.play('enemyHit', { pos: c.body.pos, pitch: 1.4 });
  }
}
