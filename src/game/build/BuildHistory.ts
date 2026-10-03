import type { BuildObjectSave } from '../../persistence/types';

/**
 * Undo / redo for Build Home (command pattern).
 *
 * Every edit is a BuildCommand with execute() and undo(). Large operations
 * (a whole wall, a room, a roof, a pool, a pasted blueprint) are ONE command,
 * and commands only store the cells/objects they changed — never the world.
 */
export interface BuildCommand {
  readonly label: string;
  execute(): void;
  undo(): void;
}

/** One voxel change: position + before/after (id, meta). */
export interface BlockChange {
  x: number;
  y: number;
  z: number;
  from: [number, number];
  to: [number, number];
}

/** What commands need from the world (implemented by BuildMode). */
export interface EditTarget {
  applyBlocks(changes: BlockChange[], dir: 'to' | 'from'): void;
  addObject(o: BuildObjectSave): void;
  removeObject(id: number): void;
  updateObject(o: BuildObjectSave): void;
}

export class BlockChangeCommand implements BuildCommand {
  constructor(private target: EditTarget, readonly changes: BlockChange[], readonly label: string) {}
  execute() {
    this.target.applyBlocks(this.changes, 'to');
  }
  undo() {
    this.target.applyBlocks(this.changes, 'from');
  }
}

export class ObjectChangeCommand implements BuildCommand {
  /** before/after snapshots; null before = added, null after = removed. */
  constructor(private target: EditTarget, readonly items: { before: BuildObjectSave | null; after: BuildObjectSave | null }[], readonly label: string) {}
  execute() {
    for (const it of this.items) apply(this.target, it.before, it.after);
  }
  undo() {
    for (const it of [...this.items].reverse()) apply(this.target, it.after, it.before);
  }
}

function apply(t: EditTarget, from: BuildObjectSave | null, to: BuildObjectSave | null) {
  if (from && !to) t.removeObject(from.id);
  else if (!from && to) t.addObject(to);
  else if (from && to) t.updateObject(to);
}

/** Several commands as one undo step (e.g. a window: wall cells removed + window object added). */
export class CompositeCommand implements BuildCommand {
  constructor(readonly parts: BuildCommand[], readonly label: string) {}
  execute() {
    for (const p of this.parts) p.execute();
  }
  undo() {
    for (const p of [...this.parts].reverse()) p.undo();
  }
}

// Named commands (thin wrappers so history entries read naturally).
export const PlaceBlockCommand = (t: EditTarget, c: BlockChange[]) => new BlockChangeCommand(t, c, c.length > 1 ? `Place ${c.length} blocks` : 'Place block');
export const RemoveBlockCommand = (t: EditTarget, c: BlockChange[]) => new BlockChangeCommand(t, c, c.length > 1 ? `Remove ${c.length} blocks` : 'Remove block');
export const PaintBlockCommand = (t: EditTarget, c: BlockChange[]) => new BlockChangeCommand(t, c, 'Paint');
export const TerrainCommand = (t: EditTarget, c: BlockChange[], what: string) => new BlockChangeCommand(t, c, what);
export const PlaceObjectCommand = (t: EditTarget, o: BuildObjectSave) => new ObjectChangeCommand(t, [{ before: null, after: o }], 'Place object');
export const RemoveObjectCommand = (t: EditTarget, o: BuildObjectSave) => new ObjectChangeCommand(t, [{ before: o, after: null }], 'Remove object');
export const MoveObjectCommand = (t: EditTarget, before: BuildObjectSave, after: BuildObjectSave) => new ObjectChangeCommand(t, [{ before, after }], 'Move object');
export const RotateObjectCommand = (t: EditTarget, before: BuildObjectSave, after: BuildObjectSave) => new ObjectChangeCommand(t, [{ before, after }], 'Rotate object');
export const RecolorObjectCommand = (t: EditTarget, before: BuildObjectSave, after: BuildObjectSave) => new ObjectChangeCommand(t, [{ before, after }], 'Change colour');

export class BuildHistory {
  private undoStack: BuildCommand[] = [];
  private redoStack: BuildCommand[] = [];
  onChange: (() => void) | null = null;

  constructor(readonly limit = 150) {}

  /** Execute and record. Empty block commands are ignored. */
  run(cmd: BuildCommand): boolean {
    if (cmd instanceof BlockChangeCommand && cmd.changes.length === 0) return false;
    if (cmd instanceof ObjectChangeCommand && cmd.items.length === 0) return false;
    if (cmd instanceof CompositeCommand && cmd.parts.length === 0) return false;
    cmd.execute();
    this.push(cmd);
    return true;
  }

  /** Record a command whose effect has already been applied (e.g. continuous strokes). */
  push(cmd: BuildCommand) {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange?.();
  }

  undo(): BuildCommand | null {
    const c = this.undoStack.pop();
    if (!c) return null;
    c.undo();
    this.redoStack.push(c);
    this.onChange?.();
    return c;
  }

  redo(): BuildCommand | null {
    const c = this.redoStack.pop();
    if (!c) return null;
    c.execute();
    this.undoStack.push(c);
    this.onChange?.();
    return c;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get size(): number {
    return this.undoStack.length;
  }
  peekUndo(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }
  peekRedo(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.();
  }
}
