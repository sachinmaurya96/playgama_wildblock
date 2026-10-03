/**
 * Build Home objects: furniture, appliances, doors, windows, lights and decor.
 *
 * Every object is a small procedural model made of boxes / cylinders (a few
 * hundred triangles each — no model files), with named colour SLOTS so one
 * definition supports many colour variants (a sofa is one catalog entry with
 * Cream / Gray / Sage / Blue / Terracotta, not five).
 *
 * Local space: 1 unit = 1 block. Origin = centre of the footprint at floor
 * level. +Z is the FRONT (faces into the room / toward the player); wall
 * objects have their back at z = -depth/2 against the wall. Openings (doors,
 * windows) sit centred in the wall thickness (z = 0).
 */

export type V3 = [number, number, number];

export type PartMaterial = 'solid' | 'glass' | 'emissive';

export interface ObjPart {
  kind: 'box' | 'cyl' | 'sphere';
  /** Min / max corners (cylinders & spheres fill this box). */
  a: V3;
  b: V3;
  /** Colour slot name, or a literal '#rrggbb'. */
  slot: string;
  mat?: PartMaterial;
  /** Cylinder axis (default y). */
  axis?: 'x' | 'y' | 'z';
  seg?: number;
  /** Animated sub-group this part belongs to (see ObjectDef.anims). */
  anim?: string;
}

export interface ObjAnim {
  name: string;
  /** swing = rotate around Y at pivot; slide = move along local X; lift = move up; tilt = rotate around X at pivot. */
  type: 'swing' | 'slide' | 'lift' | 'tilt';
  pivot: V3;
  /** Radians for swing/tilt, blocks for slide/lift (at state = 1). */
  amount: number;
}

export type ObjectPlacement = 'floor' | 'wall' | 'ceiling' | 'surface' | 'opening' | 'skylight';

export type ObjectInteraction = 'door' | 'light' | 'tv' | 'appliance' | 'shower' | 'curtain' | 'switch' | 'label';

export interface ObjectDef {
  id: string;
  name: string;
  /** Footprint width (x), height (y), depth (z) in blocks. */
  size: V3;
  /** Local bounds when the model isn't centred on its origin (corner windows). */
  bounds?: [V3, V3];
  placement: ObjectPlacement;
  parts: ObjPart[];
  /** Default colours per slot. */
  slots: Record<string, string>;
  /** Colour variants (only the slots they change). First entry = default. */
  variants?: { id: string; name: string; colors: Record<string, string> }[];
  anims?: ObjAnim[];
  interaction?: ObjectInteraction;
  /** Emits light when on: colour, strength, range (blocks), local offset. */
  light?: { color: string; intensity: number; range: number; offset: V3 };
  /** Wall cells cleared for doors & windows: width × height (in blocks), starting y0 blocks above the object origin. */
  opening?: { w: number; h: number; y0?: number };
  /** Collision: 'box' = footprint bounds, 'none', or explicit local boxes. Doors only collide while closed. */
  collision?: 'box' | 'none' | [V3, V3][];
  /** Other objects can be placed on top (tables, counters, desks). */
  surface?: number;
  /** Height above the floor for wall-mounted objects (bottom edge). */
  mount?: number;
  /** Floor objects that push back against the nearest wall behind them. */
  againstWall?: boolean;
  /** Allows 15° rotation steps (decor). */
  freeRotate?: boolean;
  tags: string[];
}

// ---------------------------------------------------------------- DSL

const B = (a: V3, b: V3, slot: string, extra: Partial<ObjPart> = {}): ObjPart => ({ kind: 'box', a, b, slot, ...extra });
const C = (a: V3, b: V3, slot: string, extra: Partial<ObjPart> = {}): ObjPart => ({ kind: 'cyl', a, b, slot, seg: 14, ...extra });
const S = (a: V3, b: V3, slot: string, extra: Partial<ObjPart> = {}): ObjPart => ({ kind: 'sphere', a, b, slot, ...extra });

/** Four legs inset from a w×d footprint. */
function legs(w: number, d: number, h: number, t: number, slot: string, inset = 0.04): ObjPart[] {
  const x = w / 2 - inset - t, z = d / 2 - inset - t;
  return [
    B([-x - t, 0, -z - t], [-x, h, -z], slot), B([x, 0, -z - t], [x + t, h, -z], slot),
    B([-x - t, 0, z], [-x, h, z + t], slot), B([x, 0, z], [x + t, h, z + t], slot),
  ];
}

/** A drawer / door front seam line (thin dark inset) on the +Z face. */
function seamsFront(x0: number, x1: number, y0: number, y1: number, z: number, slot = 'seam'): ObjPart[] {
  return [B([x0, y0, z], [x1, y1, z + 0.008], slot)];
}

/** Handle bar on the front face. */
function handle(x: number, y0: number, y1: number, z: number, slot = 'handle', horizontal = false): ObjPart {
  return horizontal ? B([x - (y1 - y0) / 2, y0, z], [x + (y1 - y0) / 2, y0 + 0.025, z + 0.035], slot) : B([x - 0.012, y0, z], [x + 0.012, y1, z + 0.035], slot);
}

const FABRIC_VARIANTS = [
  { id: 'cream', name: 'Cream', colors: { fabric: '#e7dcc8', cushion: '#f2eadb' } },
  { id: 'gray', name: 'Gray', colors: { fabric: '#8d9194', cushion: '#a4a8ab' } },
  { id: 'sage', name: 'Sage', colors: { fabric: '#93a684', cushion: '#a9ba9a' } },
  { id: 'blue', name: 'Blue', colors: { fabric: '#5f7ea3', cushion: '#7896b8' } },
  { id: 'terracotta', name: 'Terracotta', colors: { fabric: '#bf6a47', cushion: '#d0805e' } },
];

const WOOD_VARIANTS = [
  { id: 'oak', name: 'Oak', colors: { wood: '#c49563' } },
  { id: 'walnut', name: 'Walnut', colors: { wood: '#6f4a33' } },
  { id: 'white', name: 'White', colors: { wood: '#efede7' } },
  { id: 'black', name: 'Black', colors: { wood: '#2c2c30' } },
];

const FRAME_VARIANTS = [
  { id: 'black', name: 'Black Frame', colors: { frame: '#232428' } },
  { id: 'white', name: 'White Frame', colors: { frame: '#f1efe9' } },
  { id: 'wood', name: 'Wood Frame', colors: { frame: '#a8784c' } },
  { id: 'aluminum', name: 'Aluminum', colors: { frame: '#a9b0b6' } },
];

const BEDDING_VARIANTS = [
  { id: 'white', name: 'White', colors: { bedding: '#f3f1ec', pillow: '#ffffff' } },
  { id: 'gray', name: 'Gray', colors: { bedding: '#9a9ea2', pillow: '#d8dadc' } },
  { id: 'beige', name: 'Beige', colors: { bedding: '#d9c8a8', pillow: '#efe6d4' } },
  { id: 'blue', name: 'Blue', colors: { bedding: '#6d8cb0', pillow: '#e3ebf3' } },
  { id: 'green', name: 'Green', colors: { bedding: '#8aa27a', pillow: '#eef2e8' } },
];

const APPLIANCE_VARIANTS = [
  { id: 'white', name: 'White', colors: { body: '#f2f2f0' } },
  { id: 'steel', name: 'Stainless', colors: { body: '#c3c8cc' } },
  { id: 'dark', name: 'Dark', colors: { body: '#303235' } },
];

const COUNTER_VARIANTS = [
  { id: 'white_stone', name: 'White Stone / White', colors: { top: '#f2f1ed', cab: '#f0eee8' } },
  { id: 'black_stone', name: 'Black Stone / Oak', colors: { top: '#2b2b2e', cab: '#c49563' } },
  { id: 'wood', name: 'Wood / Sage', colors: { top: '#b98a5a', cab: '#9fb190' } },
  { id: 'marble', name: 'Marble / Navy', colors: { top: '#eceae6', cab: '#34465f' } },
  { id: 'concrete', name: 'Concrete / Charcoal', colors: { top: '#a5a39e', cab: '#46494e' } },
];

const METAL_VARIANTS = [
  { id: 'black', name: 'Black', colors: { metal: '#232428' } },
  { id: 'brass', name: 'Brass', colors: { metal: '#c9a45c' } },
  { id: 'chrome', name: 'Chrome', colors: { metal: '#cfd4d8' } },
  { id: 'white', name: 'White', colors: { metal: '#f0efea' } },
];

// ---------------------------------------------------------------- builders for repeated shapes

function sofa(id: string, name: string, w: number, tags: string[], opts: { armL?: boolean; armR?: boolean; corner?: boolean } = {}): ObjectDef {
  const d = 0.95, armL = opts.armL ?? true, armR = opts.armR ?? true;
  const x0 = -w / 2, x1 = w / 2;
  const parts: ObjPart[] = [
    B([x0 + 0.02, 0.06, -d / 2 + 0.02], [x1 - 0.02, 0.4, d / 2 - 0.02], 'fabric'),
    B([x0 + (armL ? 0.16 : 0.02), 0.4, -d / 2 + 0.24], [x1 - (armR ? 0.16 : 0.02), 0.52, d / 2 - 0.04], 'cushion'),
    B([x0 + 0.02, 0.4, -d / 2 + 0.02], [x1 - 0.02, 0.86, -d / 2 + 0.24], 'fabric'),
    ...legs(w - 0.08, d - 0.08, 0.07, 0.05, 'leg', 0.04),
  ];
  // seat cushion seams
  const seats = Math.max(1, Math.round(w / 0.9));
  for (let i = 1; i < seats; i++) {
    const x = x0 + (w / seats) * i;
    parts.push(B([x - 0.008, 0.4, -d / 2 + 0.24], [x + 0.008, 0.525, d / 2 - 0.03], 'seam'));
  }
  if (armL) parts.push(B([x0, 0.06, -d / 2], [x0 + 0.16, 0.66, d / 2], 'fabric'));
  if (armR) parts.push(B([x1 - 0.16, 0.06, -d / 2], [x1, 0.66, d / 2], 'fabric'));
  if (opts.corner) parts.push(B([x0 + 0.02, 0.4, -d / 2 + 0.02], [x0 + 0.24, 0.86, d / 2 - 0.02], 'fabric'));
  // back cushions
  for (let i = 0; i < seats; i++) {
    const a = x0 + (armL ? 0.18 : 0.04) + ((w - (armL ? 0.18 : 0.04) - (armR ? 0.18 : 0.04)) / seats) * i;
    const b = a + (w - (armL ? 0.18 : 0.04) - (armR ? 0.18 : 0.04)) / seats - 0.03;
    parts.push(B([a, 0.5, -d / 2 + 0.22], [b, 0.82, -d / 2 + 0.36], 'cushion'));
  }
  return {
    id, name, size: [w, 0.86, d], placement: 'floor', parts, againstWall: false,
    slots: { fabric: '#e7dcc8', cushion: '#f2eadb', leg: '#2c2c30', seam: '#8a8379' }, variants: FABRIC_VARIANTS,
    surface: undefined, tags: ['sofa', 'seat', 'couch', 'living', ...tags],
  };
}

function bed(id: string, name: string, w: number, l: number, tags: string[], platform = false): ObjectDef {
  const x0 = -w / 2, x1 = w / 2, z0 = -l / 2, z1 = l / 2;
  const base = platform ? 0.22 : 0.3;
  const parts: ObjPart[] = [
    // frame / platform
    B([x0, platform ? 0.02 : 0.1, z0 + 0.06], [x1, base, z1], 'frame'),
    // headboard at the back (-Z)
    B([x0 - (platform ? 0.12 : 0), 0, z0], [x1 + (platform ? 0.12 : 0), platform ? 0.9 : 1.05, z0 + 0.1], 'frame'),
    // mattress + duvet
    B([x0 + 0.04, base, z0 + 0.12], [x1 - 0.04, base + 0.2, z1 - 0.03], 'mattress'),
    B([x0 + 0.02, base + 0.14, z0 + 0.62], [x1 - 0.02, base + 0.26, z1 - 0.01], 'bedding'),
    B([x0 + 0.02, base + 0.2, z0 + 0.62], [x1 - 0.02, base + 0.27, z0 + 0.82], 'bedding2'),
  ];
  if (!platform) parts.push(...legs(w, l - 0.06, 0.12, 0.06, 'frame', 0.02).map((p) => ({ ...p, a: [p.a[0], p.a[1], p.a[2] + 0.03] as V3, b: [p.b[0], p.b[1], p.b[2] + 0.03] as V3 })));
  const pillows = w > 1.2 ? 2 : 1;
  for (let i = 0; i < pillows; i++) {
    const pw = (w - 0.2) / pillows;
    const a = x0 + 0.1 + pw * i + 0.04, b = a + pw - 0.08;
    parts.push(B([a, base + 0.2, z0 + 0.16], [b, base + 0.34, z0 + 0.52], 'pillow'));
  }
  return {
    id, name, size: [w + (platform ? 0.24 : 0), platform ? 0.9 : 1.05, l], placement: 'floor', parts, againstWall: true,
    slots: { frame: platform ? '#8a6444' : '#c49563', mattress: '#f4f2ee', bedding: '#f3f1ec', bedding2: '#e2ded6', pillow: '#ffffff' },
    variants: BEDDING_VARIANTS.map((v) => ({ ...v, colors: { ...v.colors, bedding2: shade(v.colors.bedding, 0.9) } })),
    surface: undefined, collision: [[[-w / 2, 0, -l / 2], [w / 2, base + 0.25, l / 2]], [[-w / 2, 0, -l / 2], [w / 2, 1, -l / 2 + 0.12]]],
    tags: ['bed', 'bedroom', 'sleep', ...tags],
  };
}

function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((v >> 16) & 255) * k)), g = Math.min(255, Math.round(((v >> 8) & 255) * k)), b = Math.min(255, Math.round((v & 255) * k));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function diningTable(id: string, name: string, w: number, d: number, seats: number): ObjectDef {
  return {
    id, name, size: [w, 0.76, d], placement: 'floor', surface: 0.76,
    parts: [B([-w / 2, 0.72, -d / 2], [w / 2, 0.76, d / 2], 'wood'), ...legs(w, d, 0.72, 0.06, 'leg', 0.08)],
    slots: { wood: '#c49563', leg: '#2c2c30' }, variants: WOOD_VARIANTS,
    tags: ['table', 'dining', 'kitchen', `${seats} seat`, `${seats}-seat`],
  };
}

function windowDef(id: string, name: string, w: number, h: number, sill: number, tags: string[], opts: { mullionX?: number; mullionY?: boolean } = {}): ObjectDef {
  const t = 0.07, d = 0.16;
  const x0 = -w / 2, x1 = w / 2, y0 = sill, y1 = sill + h;
  const parts: ObjPart[] = [
    B([x0, y0, -d / 2], [x1, y0 + t, d / 2], 'frame'),
    B([x0, y1 - t, -d / 2], [x1, y1, d / 2], 'frame'),
    B([x0, y0, -d / 2], [x0 + t, y1, d / 2], 'frame'),
    B([x1 - t, y0, -d / 2], [x1, y1, d / 2], 'frame'),
    B([x0 + t, y0 + t, -0.012], [x1 - t, y1 - t, 0.012], 'glass', { mat: 'glass' }),
    // sill
    B([x0 - 0.03, y0 - 0.03, -d / 2 - 0.02], [x1 + 0.03, y0 + 0.01, d / 2 + 0.06], 'sill'),
  ];
  const mx = opts.mullionX ?? 0;
  for (let i = 1; i <= mx; i++) {
    const x = x0 + (w / (mx + 1)) * i;
    parts.push(B([x - 0.025, y0, -0.03], [x + 0.025, y1, 0.03], 'frame'));
  }
  if (opts.mullionY) parts.push(B([x0, (y0 + y1) / 2 - 0.025, -0.03], [x1, (y0 + y1) / 2 + 0.025, 0.03], 'frame'));
  return {
    id, name, size: [w, y1, d], placement: 'opening', opening: { w: Math.round(w), h: Math.round(h), y0: Math.round(sill) }, parts,
    // bounds start at the sill so the wall below a window is not "in the way"
    bounds: [[x0 - 0.03, Math.max(0, y0 - 0.03), -d / 2 - 0.02], [x1 + 0.03, y1, d / 2 + 0.06]],
    slots: { frame: '#232428', glass: '#cfe6ee', sill: '#e8e6e0' }, variants: FRAME_VARIANTS,
    collision: [[[x0, 0, -d / 2], [x1, y1, d / 2]]], tags: ['window', 'glass', ...tags],
  };
}

function glassPanel(id: string, name: string, w: number, h: number): ObjectDef {
  const d = 0.1;
  return {
    id, name, size: [w, h, d], placement: 'opening', opening: { w, h },
    parts: [
      B([-w / 2 + 0.01, 0.03, -0.015], [w / 2 - 0.01, h - 0.03, 0.015], 'glass', { mat: 'glass' }),
      B([-w / 2, 0, -0.04], [w / 2, 0.03, 0.04], 'frame'),
      B([-w / 2, h - 0.03, -0.04], [w / 2, h, 0.04], 'frame'),
    ],
    slots: { frame: '#9aa1a8', glass: '#d8ecf2' },
    variants: [{ id: 'frameless', name: 'Frameless', colors: { frame: '#9aa1a8' } }, { id: 'dark', name: 'Dark Frame', colors: { frame: '#232428' } }],
    collision: [[[-w / 2, 0, -d / 2], [w / 2, h, d / 2]]], tags: ['glass', 'panel', 'window', 'wall', 'modern', `${w}x${h}`],
  };
}

function door(id: string, name: string, kind: 'modern' | 'wood' | 'glass' | 'interior', tags: string[]): ObjectDef {
  const w = 1, h = 2, t = 0.06, d = 0.18;
  const lw = w - 0.12, lh = h - 0.06;
  const hx = -w / 2 + 0.06;
  const leaf: ObjPart[] = [];
  if (kind === 'glass') {
    leaf.push(
      B([hx, 0.02, -0.03], [hx + lw, 0.12, 0.03], 'leaf', { anim: 'leaf' }),
      B([hx, lh - 0.08, -0.03], [hx + lw, lh, 0.03], 'leaf', { anim: 'leaf' }),
      B([hx, 0.02, -0.03], [hx + 0.08, lh, 0.03], 'leaf', { anim: 'leaf' }),
      B([hx + lw - 0.08, 0.02, -0.03], [hx + lw, lh, 0.03], 'leaf', { anim: 'leaf' }),
      B([hx + 0.08, 0.12, -0.01], [hx + lw - 0.08, lh - 0.08, 0.01], 'glass', { mat: 'glass', anim: 'leaf' }),
    );
  } else {
    leaf.push(B([hx, 0.02, -0.03], [hx + lw, lh, 0.03], 'leaf', { anim: 'leaf' }));
    if (kind === 'wood') {
      for (const [y0, y1] of [[0.2, 0.95], [1.1, 1.8]]) {
        leaf.push(B([hx + 0.12, y0, 0.03], [hx + lw - 0.12, y1, 0.045], 'panel', { anim: 'leaf' }));
        leaf.push(B([hx + 0.12, y0, -0.045], [hx + lw - 0.12, y1, -0.03], 'panel', { anim: 'leaf' }));
      }
    }
    if (kind === 'modern') leaf.push(B([hx + lw * 0.62, 0.06, 0.03], [hx + lw * 0.64, lh - 0.06, 0.036], 'seam', { anim: 'leaf' }));
  }
  // handle (vertical bar for modern, lever otherwise) on both faces
  const hxp = hx + lw - 0.1;
  if (kind === 'modern') {
    leaf.push(B([hxp - 0.012, 0.7, 0.03], [hxp + 0.012, 1.4, 0.07], 'handle', { anim: 'leaf' }), B([hxp - 0.012, 0.7, -0.07], [hxp + 0.012, 1.4, -0.03], 'handle', { anim: 'leaf' }));
  } else {
    leaf.push(B([hxp - 0.1, 0.98, 0.03], [hxp, 1.01, 0.07], 'handle', { anim: 'leaf' }), B([hxp - 0.1, 0.98, -0.07], [hxp, 1.01, -0.03], 'handle', { anim: 'leaf' }));
  }
  return {
    id, name, size: [w, h, d], placement: 'opening', opening: { w: 1, h: 2 }, interaction: 'door',
    parts: [
      B([-w / 2, 0, -d / 2], [-w / 2 + t, h, d / 2], 'frame'),
      B([w / 2 - t, 0, -d / 2], [w / 2, h, d / 2], 'frame'),
      B([-w / 2, h - t, -d / 2], [w / 2, h, d / 2], 'frame'),
      ...leaf,
    ],
    anims: [{ name: 'leaf', type: 'swing', pivot: [hx, 0, 0], amount: -Math.PI / 2 }],
    slots: {
      frame: kind === 'wood' ? '#8a5e3c' : '#f0eee8', leaf: kind === 'modern' ? '#2f3134' : kind === 'wood' ? '#a4744a' : kind === 'glass' ? '#232428' : '#f3f1ec',
      panel: '#946842', handle: '#b9bec4', glass: '#d6ebf2', seam: '#1e1f22',
    },
    variants: kind === 'interior'
      ? [{ id: 'white', name: 'White', colors: { leaf: '#f3f1ec' } }, { id: 'oak', name: 'Oak', colors: { leaf: '#c49563' } }, { id: 'gray', name: 'Gray', colors: { leaf: '#9a9ea2' } }, { id: 'sage', name: 'Sage', colors: { leaf: '#a8b898' } }]
      : kind === 'modern'
        ? [{ id: 'charcoal', name: 'Charcoal', colors: { leaf: '#2f3134' } }, { id: 'walnut', name: 'Walnut', colors: { leaf: '#6f4a33' } }, { id: 'white', name: 'White', colors: { leaf: '#f1efe9' } }, { id: 'terracotta', name: 'Terracotta', colors: { leaf: '#b8603f' } }]
        : undefined,
    collision: [[[-w / 2, 0, -d / 2], [-w / 2 + t, h, d / 2]], [[w / 2 - t, 0, -d / 2], [w / 2, h, d / 2]]],
    tags: ['door', ...tags],
  };
}

// ---------------------------------------------------------------- the object list

export const OBJECT_DEFS: ObjectDef[] = [
  // ================================================================ doors
  door('door_modern', 'Modern Door', 'modern', ['exterior', 'front', 'entrance', 'modern']),
  door('door_wood', 'Wood Panel Door', 'wood', ['exterior', 'interior', 'wood']),
  door('door_glass', 'Glass Door', 'glass', ['exterior', 'glass', 'patio']),
  door('door_interior', 'Interior Door', 'interior', ['interior', 'bedroom', 'bathroom']),
  {
    id: 'door_double', name: 'Double Doors', size: [2, 2, 0.18], placement: 'opening', opening: { w: 2, h: 2 }, interaction: 'door',
    parts: [
      B([-1, 0, -0.09], [-0.94, 2, 0.09], 'frame'), B([0.94, 0, -0.09], [1, 2, 0.09], 'frame'), B([-1, 1.94, -0.09], [1, 2, 0.09], 'frame'),
      B([-0.94, 0.02, -0.03], [-0.01, 1.94, 0.03], 'leaf', { anim: 'left' }),
      B([-0.8, 0.25, 0.03], [-0.15, 1.75, 0.045], 'panel', { anim: 'left' }),
      B([-0.14, 0.9, 0.03], [-0.11, 1.3, 0.07], 'handle', { anim: 'left' }),
      B([0.01, 0.02, -0.03], [0.94, 1.94, 0.03], 'leaf', { anim: 'right' }),
      B([0.15, 0.25, 0.03], [0.8, 1.75, 0.045], 'panel', { anim: 'right' }),
      B([0.11, 0.9, 0.03], [0.14, 1.3, 0.07], 'handle', { anim: 'right' }),
    ],
    anims: [{ name: 'left', type: 'swing', pivot: [-0.94, 0, 0], amount: -Math.PI / 2 }, { name: 'right', type: 'swing', pivot: [0.94, 0, 0], amount: Math.PI / 2 }],
    slots: { frame: '#f0eee8', leaf: '#6f4a33', panel: '#5e3f2c', handle: '#c9a45c' },
    variants: [{ id: 'walnut', name: 'Walnut', colors: { leaf: '#6f4a33', panel: '#5e3f2c' } }, { id: 'white', name: 'White', colors: { leaf: '#f1efe9', panel: '#e6e3dc' } }, { id: 'black', name: 'Black', colors: { leaf: '#2c2c30', panel: '#232327' } }],
    collision: [[[-1, 0, -0.09], [-0.94, 2, 0.09]], [[0.94, 0, -0.09], [1, 2, 0.09]]],
    tags: ['door', 'double', 'entrance', 'front', 'exterior'],
  },
  {
    id: 'door_sliding', name: 'Sliding Glass Door', size: [2, 2, 0.18], placement: 'opening', opening: { w: 2, h: 2 }, interaction: 'door',
    parts: [
      B([-1, 0, -0.09], [1, 0.04, 0.09], 'frame'), B([-1, 1.94, -0.09], [1, 2, 0.09], 'frame'),
      B([-1, 0, -0.09], [-0.95, 2, 0.09], 'frame'), B([0.95, 0, -0.09], [1, 2, 0.09], 'frame'),
      // fixed pane (back track)
      B([0, 0.04, -0.06], [0.95, 1.94, -0.02], 'frame'), B([0.05, 0.1, -0.05], [0.9, 1.88, -0.03], 'glass', { mat: 'glass' }),
      // sliding leaf (front track)
      B([-0.95, 0.04, 0.02], [0.02, 1.94, 0.06], 'frame', { anim: 'leaf' }),
      B([-0.9, 0.1, 0.03], [-0.03, 1.88, 0.05], 'glass', { mat: 'glass', anim: 'leaf' }),
      B([-0.1, 0.8, 0.06], [-0.07, 1.25, 0.09], 'handle', { anim: 'leaf' }),
    ],
    anims: [{ name: 'leaf', type: 'slide', pivot: [0, 0, 0], amount: 0.9 }],
    slots: { frame: '#2b2c30', glass: '#d6ebf2', handle: '#b9bec4' }, variants: FRAME_VARIANTS,
    collision: [[[-1, 0, -0.09], [-0.95, 2, 0.09]], [[0, 0, -0.09], [1, 2, 0.09]]],
    tags: ['door', 'sliding', 'glass', 'patio', 'exterior', 'modern'],
  },
  {
    id: 'door_entrance', name: 'Front Entrance with Sidelight', size: [2, 3, 0.2], placement: 'opening', opening: { w: 2, h: 3 }, interaction: 'door',
    parts: [
      B([-1, 0, -0.1], [-0.94, 3, 0.1], 'frame'), B([0.94, 0, -0.1], [1, 3, 0.1], 'frame'), B([-1, 2.94, -0.1], [1, 3, 0.1], 'frame'),
      B([-1, 2.1, -0.1], [1, 2.16, 0.1], 'frame'), B([0.1, 0, -0.1], [0.16, 2.1, 0.1], 'frame'),
      B([-0.94, 2.16, -0.01], [0.94, 2.94, 0.01], 'glass', { mat: 'glass' }),
      B([0.16, 0.02, -0.01], [0.94, 2.1, 0.01], 'glass', { mat: 'glass' }),
      B([-0.93, 0.02, -0.035], [0.09, 2.08, 0.035], 'leaf', { anim: 'leaf' }),
      B([-0.1, 0.6, 0.035], [-0.075, 1.6, 0.08], 'handle', { anim: 'leaf' }),
      B([-0.1, 0.6, -0.08], [-0.075, 1.6, -0.035], 'handle', { anim: 'leaf' }),
    ],
    anims: [{ name: 'leaf', type: 'swing', pivot: [-0.93, 0, 0], amount: -Math.PI / 2 }],
    slots: { frame: '#232428', leaf: '#6f4a33', handle: '#c9d0d6', glass: '#d6ebf2' },
    variants: [{ id: 'walnut', name: 'Walnut', colors: { leaf: '#6f4a33' } }, { id: 'charcoal', name: 'Charcoal', colors: { leaf: '#2f3134' } }, { id: 'oak', name: 'Oak', colors: { leaf: '#c49563' } }, { id: 'sage', name: 'Sage', colors: { leaf: '#8ea27f' } }],
    collision: [[[-1, 0, -0.1], [-0.94, 3, 0.1]], [[0.1, 0, -0.1], [1, 3, 0.1]]],
    tags: ['door', 'front', 'entrance', 'exterior', 'modern', 'glass'],
  },
  {
    id: 'garage_door', name: 'Garage Door', size: [3, 2, 0.2], placement: 'opening', opening: { w: 3, h: 2 }, interaction: 'door',
    parts: [
      B([-1.5, 0, -0.1], [-1.42, 2, 0.1], 'frame'), B([1.42, 0, -0.1], [1.5, 2, 0.1], 'frame'), B([-1.5, 1.92, -0.1], [1.5, 2, 0.1], 'frame'),
      ...[0, 1, 2, 3].map((i) => B([-1.42, 0.02 + i * 0.475, -0.04], [1.42, 0.02 + (i + 1) * 0.475 - 0.02, 0.04], 'leaf', { anim: 'leaf' })),
      B([-1.42, 1.3, 0.04], [1.42, 1.6, 0.05], 'window', { anim: 'leaf', mat: 'glass' }),
    ],
    anims: [{ name: 'leaf', type: 'lift', pivot: [0, 0, 0], amount: 1.85 }],
    slots: { frame: '#232428', leaf: '#d9dcdf', window: '#9fb7c4' },
    variants: [{ id: 'light', name: 'Light Gray', colors: { leaf: '#d9dcdf' } }, { id: 'dark', name: 'Charcoal', colors: { leaf: '#3a3c40' } }, { id: 'wood', name: 'Wood', colors: { leaf: '#a8784c' } }],
    collision: [[[-1.5, 0, -0.1], [-1.42, 2, 0.1]], [[1.42, 0, -0.1], [1.5, 2, 0.1]]],
    tags: ['garage', 'door', 'exterior'],
  },
  {
    id: 'garden_gate', name: 'Garden Gate', size: [1, 1.2, 0.12], placement: 'floor', interaction: 'door',
    parts: [
      B([-0.5, 0, -0.05], [-0.44, 1.25, 0.05], 'wood'), B([0.44, 0, -0.05], [0.5, 1.25, 0.05], 'wood'),
      B([-0.43, 0.15, -0.03], [0.43, 0.25, 0.03], 'wood', { anim: 'leaf' }), B([-0.43, 0.95, -0.03], [0.43, 1.05, 0.03], 'wood', { anim: 'leaf' }),
      ...[0, 1, 2, 3, 4].map((i) => B([-0.4 + i * 0.18, 0.08, -0.02], [-0.32 + i * 0.18, 1.15, 0.02], 'wood', { anim: 'leaf' })),
    ],
    anims: [{ name: 'leaf', type: 'swing', pivot: [-0.44, 0, 0], amount: -Math.PI / 2 }],
    slots: { wood: '#f1efe9' }, variants: WOOD_VARIANTS,
    collision: [[[-0.5, 0, -0.05], [-0.44, 1.5, 0.05]], [[0.44, 0, -0.05], [0.5, 1.5, 0.05]]],
    tags: ['gate', 'fence', 'garden', 'outdoor'],
  },

  // ================================================================ windows & glass
  // Windows fill whole wall cells (integer sill + height) so no gaps are left in voxel walls.
  windowDef('window_small', 'Small Window', 1, 1, 1, ['small']),
  windowDef('window_standard', 'Standard Window', 1, 2, 1, ['standard']),
  windowDef('window_wide', 'Wide Window', 3, 2, 1, ['wide', 'large'], { mullionX: 2 }),
  windowDef('window_double', 'Double Window', 2, 2, 1, ['double'], { mullionX: 1 }),
  windowDef('window_tall', 'Floor-to-Ceiling Window', 1, 3, 0, ['tall', 'floor to ceiling', 'large', 'modern']),
  windowDef('window_tall_wide', 'Floor-to-Ceiling Window (2 wide)', 2, 3, 0, ['tall', 'floor to ceiling', 'large', 'modern'], { mullionX: 1 }),
  windowDef('window_horizontal', 'Horizontal Ribbon Window', 3, 1, 2, ['horizontal', 'ribbon', 'modern', 'kitchen'], { mullionX: 2 }),
  {
    // Wraps a building corner: pane A along the wall (local X) + pane B turning along local +Z at the corner cell (x = 1.5).
    id: 'window_corner', name: 'Corner Window', size: [3, 3, 1.6], bounds: [[-1, 1, -0.1], [1.6, 3, 1.5]], placement: 'opening', opening: { w: 2, h: 2, y0: 1 },
    parts: [
      B([-1, 1, -0.08], [1.58, 1.06, 0.08], 'frame'), B([-1, 2.94, -0.08], [1.58, 3, 0.08], 'frame'),
      B([-1, 1.06, -0.012], [1.42, 2.94, 0.012], 'glass', { mat: 'glass' }),
      B([1.42, 1, -0.08], [1.58, 3, 0.08], 'frame'),
      B([1.42, 1, 0.08], [1.58, 1.06, 1.5], 'frame'), B([1.42, 2.94, 0.08], [1.58, 3, 1.5], 'frame'),
      B([1.488, 1.06, 0.08], [1.512, 2.94, 1.5], 'glass', { mat: 'glass' }),
      B([-1.04, 0.97, -0.1], [1.62, 1.01, 0.14], 'sill'),
    ],
    slots: { frame: '#232428', glass: '#cfe6ee', sill: '#e8e6e0' }, variants: FRAME_VARIANTS,
    collision: [[[-1, 1, -0.08], [1.58, 3, 0.08]], [[1.42, 1, 0.08], [1.58, 3, 1.5]]],
    tags: ['window', 'corner', 'glass', 'modern'],
  },
  {
    id: 'skylight', name: 'Skylight', size: [1, 0.2, 1], placement: 'skylight', opening: { w: 1, h: 1 },
    parts: [
      B([-0.5, 0, -0.5], [0.5, 0.12, -0.44], 'frame'), B([-0.5, 0, 0.44], [0.5, 0.12, 0.5], 'frame'),
      B([-0.5, 0, -0.44], [-0.44, 0.12, 0.44], 'frame'), B([0.44, 0, -0.44], [0.5, 0.12, 0.44], 'frame'),
      B([-0.44, 0.08, -0.44], [0.44, 0.1, 0.44], 'glass', { mat: 'glass' }),
    ],
    slots: { frame: '#232428', glass: '#cfe6ee' }, variants: FRAME_VARIANTS, collision: 'box',
    tags: ['skylight', 'roof', 'window', 'glass', 'ceiling'],
  },
  glassPanel('glass_panel_1x2', 'Glass Panel 1×2', 1, 2),
  glassPanel('glass_panel_2x2', 'Glass Panel 2×2', 2, 2),
  glassPanel('glass_panel_1x3', 'Glass Panel 1×3', 1, 3),
  glassPanel('glass_panel_2x3', 'Glass Panel 2×3', 2, 3),
  {
    id: 'curtains', name: 'Curtains', size: [2, 2.2, 0.16], placement: 'wall', mount: 0.3, interaction: 'curtain', freeRotate: false,
    parts: [
      C([-1.05, 2.18, -0.03], [1.05, 2.22, 0.01], 'rod', { axis: 'x', seg: 8 }),
      B([-1.0, 0.02, 0.0], [-0.55, 2.16, 0.08], 'fabric', { anim: 'left' }),
      B([0.55, 0.02, 0.0], [1.0, 2.16, 0.08], 'fabric', { anim: 'right' }),
    ],
    anims: [{ name: 'left', type: 'slide', pivot: [0, 0, 0], amount: 0.42 }, { name: 'right', type: 'slide', pivot: [0, 0, 0], amount: -0.42 }],
    slots: { fabric: '#e9e2d4', rod: '#2c2c30' },
    variants: [{ id: 'linen', name: 'Linen', colors: { fabric: '#e9e2d4' } }, { id: 'gray', name: 'Gray', colors: { fabric: '#9da1a4' } }, { id: 'sage', name: 'Sage', colors: { fabric: '#9fb192' } }, { id: 'navy', name: 'Navy', colors: { fabric: '#3d5270' } }, { id: 'terracotta', name: 'Terracotta', colors: { fabric: '#c27352' } }],
    collision: 'none', tags: ['curtains', 'drapes', 'window', 'decor', 'fabric'],
  },

  // ================================================================ kitchen
  {
    id: 'kitchen_base', name: 'Base Cabinet', size: [1, 0.92, 0.62], placement: 'floor', againstWall: true, surface: 0.92,
    parts: [
      B([-0.5, 0.08, -0.31], [0.5, 0.88, 0.29], 'cab'), B([-0.48, 0, -0.29], [0.48, 0.08, 0.26], 'plinth'),
      B([-0.5, 0.88, -0.31], [0.5, 0.92, 0.31], 'top'),
      ...seamsFront(-0.004, 0.004, 0.1, 0.86, 0.29), handle(-0.08, 0.62, 0.8, 0.29), handle(0.08, 0.62, 0.8, 0.29),
    ],
    slots: { cab: '#f0eee8', top: '#f2f1ed', plinth: '#2c2c30', seam: '#6b6b6b', handle: '#2c2c30' }, variants: COUNTER_VARIANTS,
    tags: ['kitchen', 'cabinet', 'counter', 'base'],
  },
  {
    id: 'kitchen_drawers', name: 'Drawer Cabinet', size: [1, 0.92, 0.62], placement: 'floor', againstWall: true, surface: 0.92,
    parts: [
      B([-0.5, 0.08, -0.31], [0.5, 0.88, 0.29], 'cab'), B([-0.48, 0, -0.29], [0.48, 0.08, 0.26], 'plinth'),
      B([-0.5, 0.88, -0.31], [0.5, 0.92, 0.31], 'top'),
      ...seamsFront(-0.49, 0.49, 0.36, 0.368, 0.29), ...seamsFront(-0.49, 0.49, 0.62, 0.628, 0.29),
      handle(0, 0.25, 0.25 + 0.3, 0.29, 'handle', true), handle(0, 0.52, 0.52 + 0.3, 0.29, 'handle', true), handle(0, 0.78, 0.78 + 0.3, 0.29, 'handle', true),
    ],
    slots: { cab: '#f0eee8', top: '#f2f1ed', plinth: '#2c2c30', seam: '#6b6b6b', handle: '#2c2c30' }, variants: COUNTER_VARIANTS,
    tags: ['kitchen', 'cabinet', 'counter', 'drawers'],
  },
  {
    id: 'kitchen_sink', name: 'Sink Cabinet', size: [1, 0.92, 0.62], placement: 'floor', againstWall: true, surface: 0.92, interaction: 'appliance',
    parts: [
      B([-0.5, 0.08, -0.31], [0.5, 0.88, 0.29], 'cab'), B([-0.48, 0, -0.29], [0.48, 0.08, 0.26], 'plinth'),
      B([-0.5, 0.88, -0.31], [-0.34, 0.92, 0.31], 'top'), B([0.34, 0.88, -0.31], [0.5, 0.92, 0.31], 'top'),
      B([-0.34, 0.88, -0.31], [0.34, 0.92, -0.2], 'top'), B([-0.34, 0.88, 0.2], [0.34, 0.92, 0.31], 'top'),
      B([-0.34, 0.72, -0.2], [0.34, 0.76, 0.2], 'basin'),
      B([-0.34, 0.76, -0.2], [-0.32, 0.9, 0.2], 'basin'), B([0.32, 0.76, -0.2], [0.34, 0.9, 0.2], 'basin'),
      B([-0.32, 0.76, -0.2], [0.32, 0.9, -0.18], 'basin'), B([-0.32, 0.76, 0.18], [0.32, 0.9, 0.2], 'basin'),
      C([-0.02, 0.92, -0.27], [0.02, 1.2, -0.23], 'faucet', { seg: 8 }), B([-0.02, 1.16, -0.25], [0.02, 1.2, -0.08], 'faucet'),
      B([-0.02, 0.98, -0.1], [0.02, 1.02, -0.08], 'water', { anim: 'water', mat: 'glass' }),
      ...seamsFront(-0.004, 0.004, 0.1, 0.86, 0.29), handle(-0.08, 0.62, 0.8, 0.29), handle(0.08, 0.62, 0.8, 0.29),
    ],
    anims: [{ name: 'water', type: 'lift', pivot: [0, 0, 0], amount: -0.2 }],
    slots: { cab: '#f0eee8', top: '#f2f1ed', plinth: '#2c2c30', basin: '#c9ced2', faucet: '#d0d5d9', water: '#a8d8f0', seam: '#6b6b6b', handle: '#2c2c30' },
    variants: COUNTER_VARIANTS, tags: ['kitchen', 'sink', 'cabinet', 'counter', 'faucet'],
  },
  {
    id: 'kitchen_corner', name: 'Corner Counter', size: [1, 0.92, 1], placement: 'floor', surface: 0.92,
    parts: [
      B([-0.5, 0.08, -0.5], [0.5, 0.88, 0.48], 'cab'), B([-0.48, 0, -0.48], [0.46, 0.08, 0.46], 'plinth'),
      B([-0.5, 0.88, -0.5], [0.5, 0.92, 0.5], 'top'), handle(0.3, 0.62, 0.8, 0.48),
    ],
    slots: { cab: '#f0eee8', top: '#f2f1ed', plinth: '#2c2c30', handle: '#2c2c30' }, variants: COUNTER_VARIANTS,
    tags: ['kitchen', 'corner', 'counter', 'cabinet'],
  },
  {
    id: 'kitchen_upper', name: 'Upper Cabinet', size: [1, 0.72, 0.36], placement: 'wall', mount: 1.45,
    parts: [B([-0.5, 0, -0.18], [0.5, 0.72, 0.16], 'cab'), ...seamsFront(-0.004, 0.004, 0.02, 0.7, 0.16), handle(-0.07, 0.04, 0.2, 0.16), handle(0.07, 0.04, 0.2, 0.16)],
    slots: { cab: '#f0eee8', seam: '#6b6b6b', handle: '#2c2c30' },
    variants: COUNTER_VARIANTS.map((v) => ({ id: v.id, name: v.name.split(' / ')[1] ?? v.name, colors: { cab: v.colors.cab } })),
    tags: ['kitchen', 'cabinet', 'upper', 'wall'],
  },
  {
    id: 'kitchen_upper_double', name: 'Upper Cabinet (Double)', size: [2, 0.72, 0.36], placement: 'wall', mount: 1.45,
    parts: [B([-1, 0, -0.18], [1, 0.72, 0.16], 'cab'), ...seamsFront(-0.504, -0.496, 0.02, 0.7, 0.16), ...seamsFront(-0.004, 0.004, 0.02, 0.7, 0.16), ...seamsFront(0.496, 0.504, 0.02, 0.7, 0.16), handle(-0.57, 0.04, 0.2, 0.16), handle(-0.43, 0.04, 0.2, 0.16), handle(0.43, 0.04, 0.2, 0.16), handle(0.57, 0.04, 0.2, 0.16)],
    slots: { cab: '#f0eee8', seam: '#6b6b6b', handle: '#2c2c30' },
    variants: COUNTER_VARIANTS.map((v) => ({ id: v.id, name: v.name.split(' / ')[1] ?? v.name, colors: { cab: v.colors.cab } })),
    tags: ['kitchen', 'cabinet', 'upper', 'wall', 'double'],
  },
  {
    id: 'kitchen_upper_glass', name: 'Glass-Front Upper Cabinet', size: [1, 0.72, 0.36], placement: 'wall', mount: 1.45,
    parts: [
      B([-0.5, 0, -0.18], [0.5, 0.72, -0.14], 'cab'), B([-0.5, 0, -0.14], [-0.47, 0.72, 0.16], 'cab'), B([0.47, 0, -0.14], [0.5, 0.72, 0.16], 'cab'),
      B([-0.47, 0, -0.14], [0.47, 0.03, 0.16], 'cab'), B([-0.47, 0.69, -0.14], [0.47, 0.72, 0.16], 'cab'), B([-0.47, 0.35, -0.14], [0.47, 0.37, 0.14], 'cab'),
      B([-0.46, 0.04, 0.13], [0.46, 0.68, 0.15], 'glass', { mat: 'glass' }),
      B([-0.3, 0.37, -0.1], [-0.18, 0.47, 0.02], 'dish'), B([-0.1, 0.37, -0.1], [0.02, 0.5, 0.02], 'dish'), B([0.14, 0.03, -0.1], [0.3, 0.13, 0.04], 'dish'),
    ],
    slots: { cab: '#f0eee8', glass: '#dcecf2', dish: '#fafafa' },
    variants: COUNTER_VARIANTS.map((v) => ({ id: v.id, name: v.name.split(' / ')[1] ?? v.name, colors: { cab: v.colors.cab } })),
    tags: ['kitchen', 'cabinet', 'upper', 'glass', 'display'],
  },
  {
    id: 'kitchen_upper_corner', name: 'Upper Corner Cabinet', size: [0.7, 0.72, 0.7], placement: 'wall', mount: 1.45,
    parts: [B([-0.35, 0, -0.35], [0.35, 0.72, 0.33], 'cab'), handle(0.2, 0.04, 0.2, 0.33)],
    slots: { cab: '#f0eee8', handle: '#2c2c30' },
    variants: COUNTER_VARIANTS.map((v) => ({ id: v.id, name: v.name.split(' / ')[1] ?? v.name, colors: { cab: v.colors.cab } })),
    tags: ['kitchen', 'cabinet', 'upper', 'corner'],
  },
  ...[2, 3, 4].map((n): ObjectDef => ({
    id: `kitchen_island_${n}`, name: `Kitchen Island (${n} long)`, size: [n, 0.94, 1.1], placement: 'floor', surface: 0.94,
    parts: [
      B([-n / 2 + 0.02, 0.08, -0.5], [n / 2 - 0.02, 0.9, 0.3], 'cab'), B([-n / 2 + 0.05, 0, -0.47], [n / 2 - 0.05, 0.08, 0.27], 'plinth'),
      B([-n / 2, 0.9, -0.55], [n / 2, 0.94, 0.55], 'top'),
      ...Array.from({ length: n - 1 }, (_, k) => seamsFront(-n / 2 + k + 0.996, -n / 2 + k + 1.004, 0.1, 0.88, -0.508)[0]),
    ],
    slots: { cab: '#f0eee8', top: '#f2f1ed', plinth: '#2c2c30', seam: '#6b6b6b' }, variants: COUNTER_VARIANTS,
    tags: ['kitchen', 'island', 'counter', 'breakfast'],
  })),
  {
    id: 'fridge', name: 'Refrigerator', size: [1, 2, 0.72], placement: 'floor', againstWall: true, interaction: 'appliance',
    parts: [
      B([-0.48, 0, -0.36], [0.48, 1.95, 0.3], 'body'),
      B([-0.48, 0.02, 0.3], [0.48, 1.2, 0.36], 'body', { anim: 'lower' }),
      B([-0.48, 1.23, 0.3], [0.48, 1.95, 0.36], 'body', { anim: 'upper' }),
      B([0.36, 0.5, 0.36], [0.39, 1.1, 0.4], 'handle', { anim: 'lower' }), B([0.36, 1.3, 0.36], [0.39, 1.7, 0.4], 'handle', { anim: 'upper' }),
      B([-0.44, 0.1, -0.3], [0.44, 1.12, 0.28], 'inside', { mat: 'emissive' }),
    ],
    anims: [{ name: 'lower', type: 'swing', pivot: [-0.48, 0, 0.33], amount: -1.9 }, { name: 'upper', type: 'swing', pivot: [-0.48, 0, 0.33], amount: -1.9 }],
    slots: { body: '#f2f2f0', handle: '#b9bec4', inside: '#f4f8fb' }, variants: APPLIANCE_VARIANTS,
    tags: ['kitchen', 'fridge', 'refrigerator', 'appliance'],
  },
  {
    id: 'stove', name: 'Stove & Oven', size: [1, 0.92, 0.64], placement: 'floor', againstWall: true, surface: 0.92, interaction: 'appliance',
    parts: [
      B([-0.5, 0, -0.32], [0.5, 0.88, 0.3], 'body'), B([-0.5, 0.88, -0.32], [0.5, 0.92, 0.32], 'cooktop'),
      ...[[-0.24, -0.14], [0.24, -0.14], [-0.24, 0.14], [0.24, 0.14]].map(([x, z]) => C([x - 0.1, 0.92, z - 0.1], [x + 0.1, 0.93, z + 0.1], 'burner', { seg: 12 })),
      B([-0.42, 0.14, 0.3], [0.42, 0.64, 0.32], 'door'), B([-0.34, 0.24, 0.32], [0.34, 0.56, 0.325], 'ovenglow', { mat: 'emissive' }),
      B([-0.3, 0.68, 0.3], [0.3, 0.7, 0.35], 'handle'),
      ...[-0.3, -0.1, 0.1, 0.3].map((x) => C([x - 0.025, 0.78, 0.3], [x + 0.025, 0.83, 0.34], 'handle', { axis: 'z', seg: 8 })),
    ],
    slots: { body: '#c3c8cc', cooktop: '#1e1f22', burner: '#3a3b3f', door: '#26272a', ovenglow: '#ff9a4a', handle: '#d0d5d9' },
    variants: APPLIANCE_VARIANTS, light: { color: '#ff9a4a', intensity: 0.6, range: 3, offset: [0, 0.4, 0.5] },
    tags: ['kitchen', 'stove', 'oven', 'cooktop', 'range', 'appliance'],
  },
  {
    id: 'wall_oven', name: 'Oven Tower', size: [1, 2, 0.64], placement: 'floor', againstWall: true, interaction: 'appliance',
    parts: [
      B([-0.5, 0, -0.32], [0.5, 2, 0.3], 'cab'),
      B([-0.42, 0.8, 0.3], [0.42, 1.3, 0.32], 'door'), B([-0.34, 0.88, 0.32], [0.34, 1.18, 0.325], 'ovenglow', { mat: 'emissive' }),
      B([-0.42, 1.36, 0.3], [0.42, 1.66, 0.32], 'door'), B([-0.36, 1.4, 0.32], [0.18, 1.62, 0.325], 'screen'),
      B([-0.3, 1.24, 0.32], [0.3, 1.26, 0.35], 'handle'),
    ],
    slots: { cab: '#f0eee8', door: '#26272a', ovenglow: '#ff9a4a', screen: '#11131a', handle: '#d0d5d9' },
    variants: COUNTER_VARIANTS.map((v) => ({ id: v.id, name: v.name.split(' / ')[1] ?? v.name, colors: { cab: v.colors.cab } })),
    tags: ['kitchen', 'oven', 'microwave', 'tower', 'appliance'],
  },
  {
    id: 'microwave', name: 'Microwave', size: [0.5, 0.3, 0.36], placement: 'surface', interaction: 'appliance',
    parts: [B([-0.25, 0, -0.18], [0.25, 0.3, 0.16], 'body'), B([-0.22, 0.04, 0.16], [0.1, 0.26, 0.17], 'screen', { mat: 'emissive' }), B([0.13, 0.04, 0.16], [0.22, 0.26, 0.17], 'panel')],
    slots: { body: '#c3c8cc', screen: '#2a2d33', panel: '#1e1f22' }, variants: APPLIANCE_VARIANTS, freeRotate: true,
    tags: ['kitchen', 'microwave', 'appliance'],
  },
  {
    id: 'dishwasher', name: 'Dishwasher', size: [1, 0.92, 0.62], placement: 'floor', againstWall: true, surface: 0.92,
    parts: [
      B([-0.5, 0.06, -0.31], [0.5, 0.88, 0.29], 'body'), B([-0.48, 0, -0.29], [0.48, 0.06, 0.26], 'plinth'), B([-0.5, 0.88, -0.31], [0.5, 0.92, 0.31], 'top'),
      B([-0.44, 0.76, 0.29], [0.44, 0.84, 0.31], 'panel'), B([-0.3, 0.7, 0.29], [0.3, 0.72, 0.34], 'handle'),
    ],
    slots: { body: '#c3c8cc', top: '#f2f1ed', plinth: '#2c2c30', panel: '#26272a', handle: '#d0d5d9' }, variants: APPLIANCE_VARIANTS,
    tags: ['kitchen', 'dishwasher', 'appliance'],
  },
  {
    id: 'range_hood', name: 'Extractor Hood', size: [1, 0.9, 0.5], placement: 'wall', mount: 1.55,
    parts: [B([-0.45, 0, -0.25], [0.45, 0.12, 0.25], 'body'), B([-0.12, 0.12, -0.25], [0.12, 0.9, -0.05], 'body'), B([-0.4, -0.005, -0.2], [0.4, 0, 0.2], 'light', { mat: 'emissive' })],
    slots: { body: '#c3c8cc', light: '#fff2d8' }, variants: APPLIANCE_VARIANTS, interaction: 'light',
    light: { color: '#fff0d6', intensity: 0.5, range: 3, offset: [0, -0.3, 0.1] },
    tags: ['kitchen', 'hood', 'extractor', 'vent', 'appliance'],
  },
  {
    id: 'bar_stool', name: 'Bar Stool', size: [0.42, 0.78, 0.42], placement: 'floor', freeRotate: true,
    parts: [C([-0.2, 0.7, -0.2], [0.2, 0.78, 0.2], 'seat'), C([-0.03, 0.05, -0.03], [0.03, 0.7, 0.03], 'metal', { seg: 8 }), C([-0.18, 0, -0.18], [0.18, 0.04, 0.18], 'metal'), C([-0.15, 0.3, -0.15], [0.15, 0.32, 0.15], 'metal')],
    slots: { seat: '#c49563', metal: '#232428' }, variants: WOOD_VARIANTS.map((v) => ({ ...v, colors: { seat: v.colors.wood } })),
    tags: ['stool', 'bar', 'kitchen', 'seat', 'island'],
  },
  {
    id: 'kitchen_shelf', name: 'Open Kitchen Shelf', size: [1, 0.3, 0.26], placement: 'wall', mount: 1.5,
    parts: [B([-0.5, 0, -0.13], [0.5, 0.04, 0.13], 'wood'), B([-0.4, 0.04, -0.08], [-0.28, 0.2, 0.04], 'jar'), B([-0.2, 0.04, -0.08], [-0.1, 0.16, 0.04], 'jar2'), B([0.1, 0.04, -0.1], [0.36, 0.08, 0.08], 'dish'), B([0.1, 0.08, -0.1], [0.36, 0.11, 0.08], 'dish')],
    slots: { wood: '#c49563', jar: '#e8e2d2', jar2: '#6b8f5a', dish: '#fafafa' }, variants: WOOD_VARIANTS,
    tags: ['kitchen', 'shelf', 'wall', 'open shelving'],
  },
  diningTable('table_dining_2', 'Bistro Table (2 seats)', 0.9, 0.9, 2),
  diningTable('table_dining_4', 'Dining Table (4 seats)', 1.6, 0.9, 4),
  diningTable('table_dining_6', 'Dining Table (6 seats)', 2.2, 1.0, 6),
  diningTable('table_dining_8', 'Dining Table (8 seats)', 3.0, 1.1, 8),
  {
    id: 'dining_chair', name: 'Dining Chair', size: [0.46, 0.9, 0.5], placement: 'floor', freeRotate: true,
    parts: [B([-0.22, 0.44, -0.22], [0.22, 0.49, 0.24], 'wood'), B([-0.22, 0.49, -0.25], [0.22, 0.9, -0.21], 'wood'), ...legs(0.44, 0.47, 0.44, 0.04, 'wood', 0.02)],
    slots: { wood: '#c49563' }, variants: WOOD_VARIANTS,
    tags: ['chair', 'dining', 'kitchen', 'seat'],
  },
  {
    id: 'dining_chair_upholstered', name: 'Upholstered Dining Chair', size: [0.5, 0.92, 0.54], placement: 'floor', freeRotate: true,
    parts: [B([-0.24, 0.42, -0.24], [0.24, 0.52, 0.26], 'fabric'), B([-0.24, 0.5, -0.27], [0.24, 0.92, -0.18], 'fabric'), ...legs(0.46, 0.5, 0.42, 0.035, 'leg', 0.02)],
    slots: { fabric: '#e7dcc8', leg: '#2c2c30' }, variants: FABRIC_VARIANTS.map((v) => ({ id: v.id, name: v.name, colors: { fabric: v.colors.fabric } })),
    tags: ['chair', 'dining', 'seat', 'upholstered'],
  },

  // ================================================================ living room
  sofa('sofa_2', '2-Seat Sofa', 1.7, ['2 seat', 'loveseat']),
  sofa('sofa_3', '3-Seat Sofa', 2.4, ['3 seat']),
  sofa('sofa_section', 'Sectional Sofa Module', 1, ['sectional', 'module'], { armL: false, armR: false }),
  sofa('sofa_section_corner', 'Sectional Sofa Corner', 1, ['sectional', 'corner'], { armL: false, armR: false, corner: true }),
  sofa('sofa_section_end', 'Sectional Sofa End', 1.1, ['sectional', 'end'], { armL: true, armR: false }),
  {
    id: 'armchair', name: 'Armchair', size: [0.9, 0.84, 0.88], placement: 'floor', freeRotate: true,
    parts: [
      B([-0.43, 0.08, -0.42], [0.43, 0.4, 0.42], 'fabric'), B([-0.3, 0.4, -0.2], [0.3, 0.52, 0.4], 'cushion'),
      B([-0.43, 0.4, -0.44], [0.43, 0.84, -0.22], 'fabric'), B([-0.45, 0.08, -0.42], [-0.3, 0.62, 0.42], 'fabric'), B([0.3, 0.08, -0.42], [0.45, 0.62, 0.42], 'fabric'),
      ...legs(0.84, 0.82, 0.08, 0.04, 'leg', 0.02),
    ],
    slots: { fabric: '#e7dcc8', cushion: '#f2eadb', leg: '#6f4a33' }, variants: FABRIC_VARIANTS,
    tags: ['chair', 'armchair', 'seat', 'living', 'lounge'],
  },
  {
    id: 'lounge_chair', name: 'Lounge Chair', size: [0.8, 0.8, 0.95], placement: 'floor', freeRotate: true,
    parts: [
      B([-0.36, 0.3, -0.3], [0.36, 0.4, 0.44], 'fabric'), B([-0.36, 0.38, -0.46], [0.36, 0.8, -0.3], 'fabric'),
      B([-0.38, 0.05, -0.44], [-0.34, 0.32, 0.44], 'wood'), B([0.34, 0.05, -0.44], [0.38, 0.32, 0.44], 'wood'),
      B([-0.38, 0.32, -0.1], [-0.3, 0.52, 0.4], 'wood'), B([0.3, 0.32, -0.1], [0.38, 0.52, 0.4], 'wood'),
    ],
    slots: { fabric: '#8d9194', wood: '#c49563' }, variants: FABRIC_VARIANTS.map((v) => ({ id: v.id, name: v.name, colors: { fabric: v.colors.fabric } })),
    tags: ['chair', 'lounge', 'reading', 'seat', 'living'],
  },
  {
    id: 'coffee_table', name: 'Coffee Table', size: [1.2, 0.42, 0.65], placement: 'floor', surface: 0.42, freeRotate: true,
    parts: [B([-0.6, 0.37, -0.32], [0.6, 0.42, 0.32], 'wood'), B([-0.55, 0.08, -0.28], [0.55, 0.11, 0.28], 'wood'), ...legs(1.2, 0.64, 0.37, 0.05, 'leg', 0.03)],
    slots: { wood: '#c49563', leg: '#232428' }, variants: WOOD_VARIANTS,
    tags: ['table', 'coffee table', 'living'],
  },
  {
    id: 'coffee_table_round', name: 'Round Coffee Table', size: [0.9, 0.4, 0.9], placement: 'floor', surface: 0.4,
    parts: [C([-0.45, 0.35, -0.45], [0.45, 0.4, 0.45], 'top', { seg: 20 }), C([-0.08, 0, -0.08], [0.08, 0.35, 0.08], 'leg', { seg: 10 }), C([-0.3, 0, -0.3], [0.3, 0.03, 0.3], 'leg', { seg: 16 })],
    slots: { top: '#eceae6', leg: '#232428' },
    variants: [{ id: 'marble', name: 'Marble', colors: { top: '#eceae6' } }, { id: 'oak', name: 'Oak', colors: { top: '#c49563' } }, { id: 'black', name: 'Black', colors: { top: '#2c2c30' } }],
    tags: ['table', 'coffee table', 'round', 'living'],
  },
  {
    id: 'side_table', name: 'Side Table', size: [0.5, 0.55, 0.5], placement: 'floor', surface: 0.55, freeRotate: true,
    parts: [B([-0.25, 0.5, -0.25], [0.25, 0.55, 0.25], 'wood'), B([-0.22, 0.2, -0.22], [0.22, 0.23, 0.22], 'wood'), ...legs(0.5, 0.5, 0.5, 0.035, 'leg', 0.02)],
    slots: { wood: '#c49563', leg: '#232428' }, variants: WOOD_VARIANTS,
    tags: ['table', 'side table', 'end table', 'living', 'bedroom', 'nightstand'],
  },
  {
    id: 'tv_console', name: 'Media Console', size: [2, 0.5, 0.45], placement: 'floor', againstWall: true, surface: 0.5,
    parts: [
      B([-1, 0.08, -0.22], [1, 0.5, 0.22], 'wood'), ...legs(1.96, 0.42, 0.08, 0.04, 'leg', 0.04),
      ...seamsFront(-0.334, -0.326, 0.1, 0.48, 0.22), ...seamsFront(0.326, 0.334, 0.1, 0.48, 0.22),
      B([-0.3, 0.14, 0.215], [0.3, 0.44, 0.225], 'dark'),
    ],
    slots: { wood: '#c49563', leg: '#232428', seam: '#5a4030', dark: '#3a2b20' }, variants: WOOD_VARIANTS,
    tags: ['tv', 'media', 'console', 'cabinet', 'living', 'tv unit'],
  },
  {
    id: 'tv_wall', name: 'Wall TV', size: [1.8, 1.05, 0.08], placement: 'wall', mount: 1.0, interaction: 'tv',
    parts: [B([-0.9, 0, -0.04], [0.9, 1.05, 0.03], 'bezel'), B([-0.87, 0.03, 0.03], [0.87, 1.02, 0.035], 'screen', { mat: 'emissive' })],
    slots: { bezel: '#18191c', screen: '#6f9cc9' }, light: { color: '#9cc4ff', intensity: 0.35, range: 3.5, offset: [0, 0.5, 0.6] },
    tags: ['tv', 'television', 'screen', 'living', 'wall'],
  },
  {
    id: 'tv_stand', name: 'TV on Stand', size: [1.4, 0.95, 0.35], placement: 'surface', interaction: 'tv',
    parts: [
      B([-0.7, 0.12, -0.03], [0.7, 0.92, 0.03], 'bezel'), B([-0.68, 0.14, 0.03], [0.68, 0.9, 0.035], 'screen', { mat: 'emissive' }),
      B([-0.05, 0.02, -0.05], [0.05, 0.14, 0.02], 'bezel'), B([-0.25, 0, -0.15], [0.25, 0.02, 0.12], 'bezel'),
    ],
    slots: { bezel: '#18191c', screen: '#6f9cc9' }, light: { color: '#9cc4ff', intensity: 0.3, range: 3, offset: [0, 0.5, 0.5] },
    tags: ['tv', 'television', 'screen', 'living'],
  },
  {
    id: 'bookshelf', name: 'Bookshelf', size: [1, 2, 0.35], placement: 'floor', againstWall: true,
    parts: [
      B([-0.5, 0, -0.17], [-0.46, 2, 0.17], 'wood'), B([0.46, 0, -0.17], [0.5, 2, 0.17], 'wood'), B([-0.46, 0, -0.17], [0.46, 2, -0.14], 'wood'),
      ...[0, 0.5, 1.0, 1.5, 1.96].map((y) => B([-0.46, y, -0.14], [0.46, y + 0.04, 0.17], 'wood')),
      ...[0.04, 0.54, 1.04, 1.54].flatMap((y, row) => [0, 1, 2, 3, 4, 5].map((k) => {
        const x = -0.42 + k * 0.13 + (row % 2) * 0.03;
        return B([x, y, -0.1], [x + 0.1, y + 0.3 + ((k + row) % 3) * 0.05, 0.12], ['book1', 'book2', 'book3'][(k + row) % 3]);
      })),
    ],
    slots: { wood: '#c49563', book1: '#b8603f', book2: '#34465f', book3: '#e2d6bc' }, variants: WOOD_VARIANTS,
    tags: ['bookshelf', 'books', 'shelf', 'storage', 'living', 'office', 'library'],
  },
  {
    id: 'wall_shelf', name: 'Floating Wall Shelf', size: [1, 0.25, 0.25], placement: 'wall', mount: 1.4, freeRotate: false,
    parts: [B([-0.5, 0, -0.12], [0.5, 0.04, 0.12], 'wood'), B([-0.35, 0.04, -0.06], [-0.1, 0.22, 0.06], 'book1'), B([0.15, 0.04, -0.05], [0.25, 0.2, 0.05], 'vase')],
    slots: { wood: '#c49563', book1: '#34465f', vase: '#e8e2d2' }, variants: WOOD_VARIANTS,
    tags: ['shelf', 'wall', 'decor', 'floating'],
  },
  ...([['rug_small', 'Small Rug', 1.2, 0.8], ['rug_medium', 'Medium Rug', 2, 1.4], ['rug_large', 'Large Rug', 3, 2.2], ['rug_runner', 'Runner Rug', 0.8, 2.6]] as [string, string, number, number][]).map(([id, name, w, d]): ObjectDef => ({
    id, name, size: [w, 0.02, d], placement: 'floor', freeRotate: true, collision: 'none',
    parts: [B([-w / 2, 0.003, -d / 2], [w / 2, 0.018, d / 2], 'rug'), B([-w / 2 + 0.1, 0.006, -d / 2 + 0.1], [w / 2 - 0.1, 0.02, d / 2 - 0.1], 'rug2')],
    slots: { rug: '#d9cdb4', rug2: '#ece3d0' },
    variants: [
      { id: 'natural', name: 'Natural', colors: { rug: '#c9b896', rug2: '#ece3d0' } },
      { id: 'gray', name: 'Gray', colors: { rug: '#7f8386', rug2: '#b4b7b9' } },
      { id: 'terracotta', name: 'Terracotta', colors: { rug: '#b8603f', rug2: '#e3b99c' } },
      { id: 'navy', name: 'Navy', colors: { rug: '#2f3f58', rug2: '#6b7f9c' } },
      { id: 'sage', name: 'Sage', colors: { rug: '#7f9270', rug2: '#c3cfb6' } },
    ],
    tags: ['rug', 'carpet', 'floor', 'decor', 'living', 'bedroom'],
  })),

  // ================================================================ bedroom
  bed('bed_single', 'Single Bed', 1, 2, ['single', 'kids']),
  bed('bed_double', 'Double Bed', 1.6, 2.1, ['double']),
  bed('bed_queen', 'Queen Bed', 1.8, 2.2, ['queen', 'master']),
  bed('bed_platform', 'Platform Bed', 1.7, 2.2, ['platform', 'low', 'modern'], true),
  {
    id: 'nightstand', name: 'Bedside Table', size: [0.5, 0.55, 0.42], placement: 'floor', againstWall: true, surface: 0.55,
    parts: [B([-0.25, 0.08, -0.21], [0.25, 0.55, 0.21], 'wood'), ...seamsFront(-0.24, 0.24, 0.33, 0.338, 0.21), handle(0, 0.42, 0.42 + 0.14, 0.21, 'handle', true), ...legs(0.5, 0.42, 0.08, 0.03, 'leg', 0.02)],
    slots: { wood: '#c49563', seam: '#6b5a48', handle: '#232428', leg: '#232428' }, variants: WOOD_VARIANTS,
    tags: ['nightstand', 'bedside', 'table', 'bedroom'],
  },
  {
    id: 'wardrobe_single', name: 'Wardrobe', size: [1, 2.1, 0.62], placement: 'floor', againstWall: true,
    parts: [B([-0.5, 0, -0.31], [0.5, 2.1, 0.29], 'wood'), B([-0.48, 0.04, 0.29], [0.48, 2.06, 0.31], 'door'), handle(0.38, 0.9, 1.3, 0.31)],
    slots: { wood: '#f0eee8', door: '#ebe8e1', handle: '#232428' }, variants: WOOD_VARIANTS.map((v) => ({ ...v, colors: { wood: v.colors.wood, door: shade(v.colors.wood, 0.97) } })),
    tags: ['wardrobe', 'closet', 'storage', 'bedroom'],
  },
  {
    id: 'wardrobe_double', name: 'Double Wardrobe', size: [2, 2.1, 0.62], placement: 'floor', againstWall: true,
    parts: [B([-1, 0, -0.31], [1, 2.1, 0.29], 'wood'), B([-0.98, 0.04, 0.29], [-0.01, 2.06, 0.31], 'door'), B([0.01, 0.04, 0.29], [0.98, 2.06, 0.31], 'door'), handle(-0.1, 0.9, 1.3, 0.31), handle(0.1, 0.9, 1.3, 0.31)],
    slots: { wood: '#f0eee8', door: '#ebe8e1', handle: '#232428' }, variants: WOOD_VARIANTS.map((v) => ({ ...v, colors: { wood: v.colors.wood, door: shade(v.colors.wood, 0.97) } })),
    tags: ['wardrobe', 'closet', 'storage', 'bedroom', 'double'],
  },
  {
    id: 'wardrobe_sliding', name: 'Sliding-Door Wardrobe', size: [2, 2.2, 0.66], placement: 'floor', againstWall: true, interaction: 'door',
    parts: [
      B([-1, 0, -0.33], [1, 2.2, 0.25], 'wood'),
      B([-0.99, 0.03, 0.29], [0.02, 2.17, 0.31], 'door'), B([-0.02, 0.03, 0.25], [0.99, 2.17, 0.27], 'mirror', { anim: 'slide' }),
      B([-0.05, 0.8, 0.31], [-0.03, 1.4, 0.34], 'handle'),
    ],
    anims: [{ name: 'slide', type: 'slide', pivot: [0, 0, 0], amount: -0.95 }],
    slots: { wood: '#f0eee8', door: '#c49563', mirror: '#cfdde3', handle: '#232428' },
    variants: [{ id: 'oak', name: 'Oak & Mirror', colors: { door: '#c49563' } }, { id: 'white', name: 'White & Mirror', colors: { door: '#f1efe9' } }, { id: 'walnut', name: 'Walnut & Mirror', colors: { door: '#6f4a33' } }],
    tags: ['wardrobe', 'closet', 'sliding', 'mirror', 'bedroom'],
  },
  {
    id: 'dresser', name: 'Dresser', size: [1.4, 0.85, 0.5], placement: 'floor', againstWall: true, surface: 0.85,
    parts: [
      B([-0.7, 0.1, -0.25], [0.7, 0.85, 0.24], 'wood'), ...legs(1.36, 0.46, 0.1, 0.04, 'leg', 0.02),
      ...[0.34, 0.58].flatMap((y) => seamsFront(-0.69, 0.69, y, y + 0.008, 0.24)), ...seamsFront(-0.004, 0.004, 0.12, 0.84, 0.24),
      ...[0.22, 0.46, 0.7].flatMap((y) => [handle(-0.35, y, y + 0.16, 0.24, 'handle', true), handle(0.35, y, y + 0.16, 0.24, 'handle', true)]),
    ],
    slots: { wood: '#c49563', leg: '#232428', seam: '#6b5a48', handle: '#232428' }, variants: WOOD_VARIANTS,
    tags: ['dresser', 'drawers', 'chest of drawers', 'storage', 'bedroom'],
  },
  {
    id: 'mirror_wall', name: 'Wall Mirror', size: [0.7, 1, 0.04], placement: 'wall', mount: 1.0,
    parts: [B([-0.35, 0, -0.02], [0.35, 1, 0.01], 'frame'), B([-0.32, 0.03, 0.01], [0.32, 0.97, 0.015], 'mirror')],
    slots: { frame: '#c9a45c', mirror: '#d9e6ea' }, variants: METAL_VARIANTS.map((v) => ({ ...v, colors: { frame: v.colors.metal } })),
    collision: 'none', tags: ['mirror', 'wall', 'bedroom', 'bathroom', 'hallway'],
  },
  {
    id: 'mirror_floor', name: 'Floor Mirror', size: [0.6, 1.8, 0.3], placement: 'floor', againstWall: true,
    parts: [B([-0.3, 0, -0.04], [0.3, 1.8, 0.02], 'frame'), B([-0.27, 0.04, 0.02], [0.27, 1.76, 0.025], 'mirror'), B([-0.25, 0, -0.15], [0.25, 0.03, -0.04], 'frame')],
    slots: { frame: '#c49563', mirror: '#d9e6ea' }, variants: WOOD_VARIANTS.map((v) => ({ ...v, colors: { frame: v.colors.wood } })),
    tags: ['mirror', 'floor mirror', 'bedroom'],
  },

  // ================================================================ bathroom
  {
    id: 'toilet', name: 'Toilet', size: [0.42, 0.8, 0.7], placement: 'floor', againstWall: true, freeRotate: false,
    parts: [
      B([-0.19, 0.3, -0.35], [0.19, 0.78, -0.18], 'ceramic'), B([-0.2, 0.76, -0.36], [0.2, 0.8, -0.16], 'ceramic'),
      C([-0.18, 0, -0.2], [0.18, 0.38, 0.28], 'ceramic', { seg: 16 }), C([-0.2, 0.38, -0.2], [0.2, 0.42, 0.32], 'seat', { seg: 16 }),
      B([-0.03, 0.8, -0.3], [0.03, 0.81, -0.24], 'chrome'),
    ],
    slots: { ceramic: '#f7f7f5', seat: '#f1f1ef', chrome: '#d0d5d9' },
    tags: ['toilet', 'wc', 'bathroom'],
  },
  {
    id: 'bath_sink', name: 'Pedestal Sink', size: [0.55, 0.9, 0.45], placement: 'floor', againstWall: true, interaction: 'appliance',
    parts: [
      C([-0.1, 0, -0.18], [0.1, 0.78, 0.02], 'ceramic', { seg: 12 }),
      B([-0.27, 0.78, -0.22], [0.27, 0.9, 0.22], 'ceramic'), B([-0.2, 0.82, -0.14], [0.2, 0.905, 0.16], 'basin'),
      C([-0.018, 0.9, -0.2], [0.018, 1.06, -0.164], 'chrome', { seg: 8 }), B([-0.018, 1.03, -0.19], [0.018, 1.06, -0.08], 'chrome'),
      B([-0.012, 0.93, -0.1], [0.012, 1.03, -0.085], 'water', { anim: 'water', mat: 'glass' }),
    ],
    anims: [{ name: 'water', type: 'lift', pivot: [0, 0, 0], amount: -0.1 }],
    slots: { ceramic: '#f7f7f5', basin: '#e4e7e8', chrome: '#d0d5d9', water: '#a8d8f0' },
    tags: ['sink', 'basin', 'bathroom', 'washbasin'],
  },
  ...[1, 2].map((n): ObjectDef => ({
    id: n === 1 ? 'vanity' : 'vanity_double', name: n === 1 ? 'Bathroom Vanity' : 'Double Vanity', size: [n, 0.88, 0.5], placement: 'floor', againstWall: true, surface: 0.88, interaction: 'appliance',
    parts: [
      B([-n / 2, 0.2, -0.25], [n / 2, 0.8, 0.23], 'cab'), B([-n / 2, 0.8, -0.25], [n / 2, 0.84, 0.25], 'top'),
      ...Array.from({ length: n }, (_, k) => {
        const cx = -n / 2 + 0.5 + k;
        return [
          C([cx - 0.2, 0.84, -0.12], [cx + 0.2, 0.96, 0.16], 'basin', { seg: 16 }),
          C([cx - 0.015, 0.84, -0.22], [cx + 0.015, 1.02, -0.19], 'chrome', { seg: 8 }), B([cx - 0.015, 0.99, -0.21], [cx + 0.015, 1.02, -0.1], 'chrome'),
          ...seamsFront(cx - 0.004, cx + 0.004, 0.22, 0.78, 0.23),
          handle(cx - 0.07, 0.62, 0.74, 0.23), handle(cx + 0.07, 0.62, 0.74, 0.23),
        ];
      }).flat(),
    ],
    slots: { cab: '#c49563', top: '#f2f1ed', basin: '#f7f7f5', chrome: '#d0d5d9', seam: '#6b5a48', handle: '#232428' }, variants: COUNTER_VARIANTS,
    tags: ['vanity', 'sink', 'bathroom', 'cabinet'],
  })),
  {
    id: 'bath_mirror', name: 'Bathroom Mirror Cabinet', size: [0.8, 0.7, 0.14], placement: 'wall', mount: 1.25,
    parts: [B([-0.4, 0, -0.07], [0.4, 0.7, 0.05], 'cab'), B([-0.38, 0.02, 0.05], [0.38, 0.68, 0.06], 'mirror'), B([-0.4, 0.7, -0.07], [0.4, 0.72, 0.07], 'light', { mat: 'emissive' })],
    slots: { cab: '#f0eee8', mirror: '#d9e6ea', light: '#fff3dc' }, interaction: 'light',
    light: { color: '#fff3dc', intensity: 0.5, range: 3, offset: [0, 0.8, 0.3] },
    collision: 'none', tags: ['mirror', 'cabinet', 'bathroom', 'medicine cabinet'],
  },
  {
    id: 'shower', name: 'Walk-in Shower', size: [1, 2.2, 1], placement: 'floor', interaction: 'shower',
    parts: [
      B([-0.5, 0, -0.5], [0.5, 0.06, 0.5], 'base'), B([-0.1, 0.005, -0.1], [0.1, 0.065, 0.1], 'chrome'),
      B([0.48, 0.06, -0.5], [0.5, 2.05, 0.5], 'glass', { mat: 'glass' }), B([0.47, 2.03, -0.5], [0.5, 2.06, 0.5], 'chrome'),
      C([-0.03, 0.06, -0.49], [0.03, 2.0, -0.45], 'chrome', { seg: 8 }), B([-0.03, 1.94, -0.46], [0.03, 1.98, -0.25], 'chrome'),
      C([-0.13, 1.9, -0.36], [0.13, 1.94, -0.12], 'chrome', { seg: 14 }),
      B([-0.12, 0.4, -0.1], [0.12, 1.88, 0.14], 'water', { anim: 'water', mat: 'glass' }),
      B([-0.07, 1.0, -0.5], [0.07, 1.2, -0.46], 'chrome'),
    ],
    anims: [{ name: 'water', type: 'lift', pivot: [0, 0, 0], amount: -3 }],
    slots: { base: '#f1f1ee', chrome: '#d0d5d9', glass: '#d6ebf2', water: '#b8e2f4' },
    collision: [[[-0.5, 0, -0.5], [0.5, 0.06, 0.5]], [[0.46, 0, -0.5], [0.5, 2.06, 0.5]]],
    tags: ['shower', 'bathroom', 'glass', 'walk-in'],
  },
  {
    id: 'shower_screen', name: 'Glass Shower Screen', size: [1, 2, 0.06], placement: 'floor',
    parts: [B([-0.5, 0, -0.012], [0.5, 2, 0.012], 'glass', { mat: 'glass' }), B([-0.5, 1.97, -0.02], [0.5, 2, 0.02], 'chrome'), B([-0.5, 0, -0.02], [-0.47, 2, 0.02], 'chrome')],
    slots: { glass: '#d6ebf2', chrome: '#d0d5d9' }, tags: ['shower', 'screen', 'glass', 'bathroom', 'panel'],
  },
  {
    id: 'bathtub_freestanding', name: 'Freestanding Bathtub', size: [0.85, 0.62, 1.7], placement: 'floor', freeRotate: true,
    parts: [
      C([-0.42, 0.04, -0.85], [0.42, 0.62, 0.85], 'ceramic', { seg: 20 }), C([-0.36, 0.3, -0.78], [0.36, 0.625, 0.78], 'inner', { seg: 20 }),
      ...[[-0.3, -0.7], [0.3, -0.7], [-0.3, 0.7], [0.3, 0.7]].map(([x, z]) => B([x - 0.04, 0, z - 0.04], [x + 0.04, 0.06, z + 0.04], 'chrome')),
      C([-0.02, 0.62, -0.84], [0.02, 0.95, -0.8], 'chrome', { seg: 8 }), B([-0.02, 0.92, -0.82], [0.02, 0.95, -0.7], 'chrome'),
    ],
    slots: { ceramic: '#f7f7f5', inner: '#e8eced', chrome: '#c9a45c' },
    collision: [[[-0.42, 0, -0.85], [0.42, 0.62, 0.85]]], tags: ['bathtub', 'tub', 'bath', 'bathroom', 'freestanding'],
  },
  {
    id: 'bathtub_builtin', name: 'Built-in Bathtub', size: [0.9, 0.58, 1.8], placement: 'floor', againstWall: true,
    parts: [
      B([-0.45, 0, -0.9], [0.45, 0.52, 0.9], 'panel'), B([-0.45, 0.52, -0.9], [0.45, 0.58, 0.9], 'rim'),
      B([-0.36, 0.3, -0.8], [0.36, 0.585, 0.8], 'inner'),
      C([-0.02, 0.58, -0.88], [0.02, 0.85, -0.84], 'chrome', { seg: 8 }), B([-0.02, 0.82, -0.86], [0.02, 0.85, -0.74], 'chrome'),
    ],
    slots: { panel: '#f7f7f5', rim: '#f1f1ee', inner: '#e8eced', chrome: '#d0d5d9' },
    variants: [{ id: 'white', name: 'White', colors: { panel: '#f7f7f5' } }, { id: 'wood', name: 'Wood Panel', colors: { panel: '#c49563' } }, { id: 'tile', name: 'Dark Tile', colors: { panel: '#4b4c50' } }],
    tags: ['bathtub', 'tub', 'bath', 'bathroom', 'built-in'],
  },
  {
    id: 'bath_cabinet', name: 'Bathroom Wall Cabinet', size: [0.5, 0.8, 0.25], placement: 'wall', mount: 1.2,
    parts: [B([-0.25, 0, -0.12], [0.25, 0.8, 0.11], 'cab'), B([-0.23, 0.02, 0.11], [0.23, 0.78, 0.125], 'door'), handle(0.16, 0.3, 0.5, 0.125)],
    slots: { cab: '#f0eee8', door: '#ebe8e1', handle: '#d0d5d9' }, variants: WOOD_VARIANTS.map((v) => ({ ...v, colors: { cab: v.colors.wood, door: shade(v.colors.wood, 0.97) } })),
    tags: ['cabinet', 'bathroom', 'storage', 'wall'],
  },
  {
    id: 'towel_rack', name: 'Towel Rack', size: [0.6, 0.5, 0.12], placement: 'wall', mount: 1.0, collision: 'none',
    parts: [
      C([-0.3, 0.44, -0.02], [0.3, 0.47, 0.01], 'chrome', { axis: 'x', seg: 8 }), B([-0.3, 0.4, -0.06], [-0.28, 0.48, 0.0], 'chrome'), B([0.28, 0.4, -0.06], [0.3, 0.48, 0.0], 'chrome'),
      B([-0.22, 0.02, -0.02], [0.22, 0.47, 0.03], 'towel'),
    ],
    slots: { chrome: '#d0d5d9', towel: '#f1ece2' },
    variants: [{ id: 'white', name: 'White Towel', colors: { towel: '#f1ece2' } }, { id: 'gray', name: 'Gray Towel', colors: { towel: '#9da1a4' } }, { id: 'sage', name: 'Sage Towel', colors: { towel: '#a8b898' } }, { id: 'blue', name: 'Blue Towel', colors: { towel: '#7d99b9' } }],
    tags: ['towel', 'rack', 'rail', 'bathroom'],
  },

  // ================================================================ office
  {
    id: 'office_desk', name: 'Desk', size: [1.6, 0.76, 0.75], placement: 'floor', againstWall: true, surface: 0.76,
    parts: [B([-0.8, 0.72, -0.37], [0.8, 0.76, 0.37], 'wood'), B([-0.8, 0, -0.35], [-0.76, 0.72, 0.35], 'leg'), B([0.76, 0, -0.35], [0.8, 0.72, 0.35], 'leg'), B([0.3, 0.45, -0.34], [0.76, 0.72, 0.32], 'wood')],
    slots: { wood: '#c49563', leg: '#232428' }, variants: WOOD_VARIANTS,
    tags: ['desk', 'office', 'study', 'work', 'bedroom'],
  },
  {
    id: 'office_chair', name: 'Office Chair', size: [0.6, 1.05, 0.6], placement: 'floor', freeRotate: true,
    parts: [
      B([-0.24, 0.44, -0.22], [0.24, 0.52, 0.24], 'fabric'), B([-0.22, 0.56, -0.28], [0.22, 1.05, -0.2], 'fabric'),
      B([-0.03, 0.52, -0.26], [0.03, 0.62, -0.2], 'metal'),
      C([-0.03, 0.08, -0.03], [0.03, 0.44, 0.03], 'metal', { seg: 8 }),
      ...[0, 1, 2, 3, 4].map((k) => {
        const a = (k / 5) * Math.PI * 2;
        const x = Math.cos(a) * 0.22, z = Math.sin(a) * 0.22;
        return B([Math.min(0, x) - 0.02, 0.04, Math.min(0, z) - 0.02], [Math.max(0, x) + 0.02, 0.08, Math.max(0, z) + 0.02], 'metal');
      }),
    ],
    slots: { fabric: '#34363a', metal: '#232428' },
    variants: [{ id: 'black', name: 'Black', colors: { fabric: '#34363a' } }, { id: 'gray', name: 'Gray', colors: { fabric: '#8d9194' } }, { id: 'blue', name: 'Blue', colors: { fabric: '#5f7ea3' } }, { id: 'white', name: 'White', colors: { fabric: '#e8e6e0' } }],
    tags: ['chair', 'office', 'desk chair', 'seat'],
  },
  {
    id: 'monitor', name: 'Monitor', size: [0.6, 0.45, 0.2], placement: 'surface', interaction: 'tv', freeRotate: true,
    parts: [B([-0.3, 0.1, -0.02], [0.3, 0.45, 0.02], 'bezel'), B([-0.285, 0.115, 0.02], [0.285, 0.435, 0.024], 'screen', { mat: 'emissive' }), B([-0.03, 0, -0.06], [0.03, 0.12, -0.02], 'bezel'), B([-0.12, 0, -0.1], [0.12, 0.015, 0.04], 'bezel')],
    slots: { bezel: '#18191c', screen: '#7aa6d6' },
    tags: ['monitor', 'screen', 'computer', 'office'],
  },
  {
    id: 'computer_tower', name: 'Computer Tower', size: [0.22, 0.46, 0.45], placement: 'floor', freeRotate: true,
    parts: [B([-0.11, 0, -0.22], [0.11, 0.46, 0.22], 'body'), B([-0.08, 0.38, 0.22], [0.08, 0.4, 0.225], 'led', { mat: 'emissive' })],
    slots: { body: '#1e1f22', led: '#7ff0d0' }, tags: ['computer', 'pc', 'tower', 'office'],
  },
  {
    id: 'laptop', name: 'Laptop', size: [0.34, 0.24, 0.26], placement: 'surface', freeRotate: true,
    parts: [B([-0.17, 0, -0.12], [0.17, 0.018, 0.12], 'body'), B([-0.17, 0.018, -0.13], [0.17, 0.24, -0.115], 'body'), B([-0.155, 0.03, -0.114], [0.155, 0.225, -0.112], 'screen', { mat: 'emissive' })],
    slots: { body: '#b9bec4', screen: '#8fb4de' }, tags: ['laptop', 'computer', 'office'],
  },
  {
    id: 'desk_lamp', name: 'Desk Lamp', size: [0.25, 0.5, 0.3], placement: 'surface', interaction: 'light', freeRotate: true,
    parts: [C([-0.08, 0, -0.08], [0.08, 0.02, 0.08], 'metal', { seg: 12 }), B([-0.012, 0.02, -0.012], [0.012, 0.4, 0.012], 'metal'), B([-0.012, 0.38, -0.012], [0.012, 0.4, 0.16], 'metal'), C([-0.07, 0.3, 0.1], [0.07, 0.4, 0.24], 'shade', { seg: 12 }), C([-0.05, 0.3, 0.12], [0.05, 0.31, 0.22], 'bulb', { mat: 'emissive', seg: 10 })],
    slots: { metal: '#232428', shade: '#232428', bulb: '#fff1d0' }, variants: METAL_VARIANTS.map((v) => ({ ...v, colors: { metal: v.colors.metal, shade: v.colors.metal } })),
    light: { color: '#ffe2b0', intensity: 0.8, range: 4, offset: [0, 0.2, 0.17] },
    tags: ['lamp', 'desk lamp', 'light', 'office', 'reading'],
  },
  {
    id: 'filing_cabinet', name: 'Office Cabinet', size: [0.5, 0.7, 0.55], placement: 'floor', againstWall: true, surface: 0.7,
    parts: [B([-0.25, 0.03, -0.27], [0.25, 0.7, 0.26], 'body'), ...seamsFront(-0.24, 0.24, 0.26, 0.268, 0.26), ...seamsFront(-0.24, 0.24, 0.48, 0.488, 0.26), handle(0, 0.18, 0.18 + 0.14, 0.26, 'handle', true), handle(0, 0.4, 0.4 + 0.14, 0.26, 'handle', true), handle(0, 0.6, 0.6 + 0.14, 0.26, 'handle', true)],
    slots: { body: '#f0eee8', seam: '#8a8a8a', handle: '#232428' }, variants: WOOD_VARIANTS.map((v) => ({ ...v, colors: { body: v.colors.wood } })),
    tags: ['cabinet', 'filing', 'office', 'storage', 'drawers'],
  },

  // ================================================================ lighting
  {
    id: 'ceiling_light', name: 'Ceiling Light', size: [0.5, 0.1, 0.5], placement: 'ceiling', interaction: 'light', collision: 'none',
    parts: [C([-0.25, 0.04, -0.25], [0.25, 0.1, 0.25], 'metal', { seg: 18 }), C([-0.22, 0, -0.22], [0.22, 0.04, 0.22], 'bulb', { mat: 'emissive', seg: 18 })],
    slots: { metal: '#f0efea', bulb: '#fff4dc' }, variants: METAL_VARIANTS,
    light: { color: '#fff0d6', intensity: 1.3, range: 8, offset: [0, -0.2, 0] },
    tags: ['light', 'ceiling light', 'lamp', 'lighting'],
  },
  {
    id: 'recessed_light', name: 'Recessed Light', size: [0.2, 0.02, 0.2], placement: 'ceiling', interaction: 'light', collision: 'none',
    parts: [C([-0.1, 0.005, -0.1], [0.1, 0.02, 0.1], 'metal', { seg: 14 }), C([-0.07, 0, -0.07], [0.07, 0.006, 0.07], 'bulb', { mat: 'emissive', seg: 14 })],
    slots: { metal: '#f0efea', bulb: '#fff6e6' }, variants: METAL_VARIANTS,
    light: { color: '#fff2dc', intensity: 1.0, range: 6, offset: [0, -0.3, 0] },
    tags: ['light', 'recessed', 'spot', 'downlight', 'ceiling', 'lighting'],
  },
  {
    id: 'pendant_light', name: 'Pendant Light', size: [0.4, 0.9, 0.4], placement: 'ceiling', interaction: 'light', collision: 'none',
    parts: [C([-0.006, 0.3, -0.006], [0.006, 0.9, 0.006], 'metal', { seg: 6 }), C([-0.2, 0.08, -0.2], [0.2, 0.32, 0.2], 'shade', { seg: 16 }), C([-0.07, 0.05, -0.07], [0.07, 0.1, 0.07], 'bulb', { mat: 'emissive', seg: 12 })],
    slots: { metal: '#232428', shade: '#232428', bulb: '#ffe8bf' },
    variants: [{ id: 'black', name: 'Black', colors: { shade: '#232428' } }, { id: 'brass', name: 'Brass', colors: { shade: '#c9a45c' } }, { id: 'white', name: 'White', colors: { shade: '#f0efea' } }, { id: 'sage', name: 'Sage', colors: { shade: '#8ea27f' } }],
    light: { color: '#ffe6b8', intensity: 1.1, range: 6, offset: [0, 0, 0] },
    tags: ['light', 'pendant', 'hanging', 'kitchen', 'dining', 'lighting'],
  },
  {
    id: 'chandelier', name: 'Modern Chandelier', size: [1.0, 1.0, 1.0], placement: 'ceiling', interaction: 'light', collision: 'none',
    parts: [
      C([-0.006, 0.45, -0.006], [0.006, 1.0, 0.006], 'metal', { seg: 6 }),
      C([-0.48, 0.42, -0.48], [0.48, 0.46, 0.48], 'metal', { seg: 24 }), C([-0.44, 0.42, -0.44], [0.44, 0.461, 0.44], 'hole', { seg: 24 }),
      ...[0, 1, 2, 3, 4, 5].map((k) => {
        const a = (k / 6) * Math.PI * 2;
        const x = Math.cos(a) * 0.46, z = Math.sin(a) * 0.46;
        return S([x - 0.06, 0.34, z - 0.06], [x + 0.06, 0.46, z + 0.06], 'bulb', { mat: 'emissive' });
      }),
    ],
    slots: { metal: '#c9a45c', hole: '#c9a45c', bulb: '#fff0cc' }, variants: METAL_VARIANTS,
    light: { color: '#ffe8c0', intensity: 1.6, range: 9, offset: [0, 0.3, 0] },
    tags: ['light', 'chandelier', 'ceiling', 'dining', 'luxury', 'lighting'],
  },
  {
    id: 'wall_light', name: 'Wall Sconce', size: [0.2, 0.3, 0.16], placement: 'wall', mount: 1.7, interaction: 'light', collision: 'none',
    parts: [B([-0.05, 0, -0.08], [0.05, 0.3, -0.06], 'metal'), C([-0.07, 0.03, -0.06], [0.07, 0.27, 0.08], 'shade', { seg: 12 }), C([-0.05, 0.28, -0.04], [0.05, 0.281, 0.06], 'bulb', { mat: 'emissive', seg: 10 }), C([-0.05, 0.019, -0.04], [0.05, 0.02, 0.06], 'bulb', { mat: 'emissive', seg: 10 })],
    slots: { metal: '#232428', shade: '#232428', bulb: '#ffe8c0' }, variants: METAL_VARIANTS.map((v) => ({ ...v, colors: { metal: v.colors.metal, shade: v.colors.metal } })),
    light: { color: '#ffe2b0', intensity: 0.9, range: 5, offset: [0, 0.15, 0.3] },
    tags: ['light', 'wall light', 'sconce', 'lighting'],
  },
  {
    id: 'exterior_wall_light', name: 'Exterior Wall Light', size: [0.18, 0.36, 0.2], placement: 'wall', mount: 2.0, interaction: 'light', collision: 'none',
    parts: [B([-0.09, 0, -0.1], [0.09, 0.36, 0.1], 'metal'), B([-0.07, 0.02, 0.1], [0.07, 0.34, 0.101], 'bulb', { mat: 'emissive' }), B([-0.1, -0.01, -0.1], [0.1, 0.0, 0.11], 'metal')],
    slots: { metal: '#232428', bulb: '#ffdca0' }, variants: METAL_VARIANTS,
    light: { color: '#ffd9a0', intensity: 1.0, range: 6, offset: [0, -0.2, 0.4] },
    tags: ['light', 'outdoor', 'exterior', 'wall light', 'porch', 'lighting'],
  },
  {
    id: 'floor_lamp', name: 'Floor Lamp', size: [0.4, 1.65, 0.4], placement: 'floor', interaction: 'light', freeRotate: true,
    parts: [C([-0.15, 0, -0.15], [0.15, 0.03, 0.15], 'metal', { seg: 14 }), C([-0.012, 0.03, -0.012], [0.012, 1.4, 0.012], 'metal', { seg: 6 }), C([-0.2, 1.3, -0.2], [0.2, 1.65, 0.2], 'shade', { seg: 16 }), C([-0.08, 1.32, -0.08], [0.08, 1.33, 0.08], 'bulb', { mat: 'emissive', seg: 10 })],
    slots: { metal: '#232428', shade: '#efe7d6', bulb: '#ffe8c0' }, variants: METAL_VARIANTS,
    light: { color: '#ffe0a8', intensity: 1.0, range: 6, offset: [0, 1.4, 0] },
    collision: [[[-0.12, 0, -0.12], [0.12, 1.65, 0.12]]], tags: ['lamp', 'floor lamp', 'light', 'living', 'reading', 'lighting'],
  },
  {
    id: 'table_lamp', name: 'Table Lamp', size: [0.3, 0.5, 0.3], placement: 'surface', interaction: 'light', freeRotate: true,
    parts: [C([-0.08, 0, -0.08], [0.08, 0.22, 0.08], 'base', { seg: 12 }), C([-0.15, 0.22, -0.15], [0.15, 0.48, 0.15], 'shade', { seg: 16 }), C([-0.06, 0.23, -0.06], [0.06, 0.24, 0.06], 'bulb', { mat: 'emissive', seg: 10 })],
    slots: { base: '#c9b8a0', shade: '#f2ebdd', bulb: '#ffe8c0' },
    variants: [{ id: 'ceramic', name: 'Ceramic', colors: { base: '#c9b8a0' } }, { id: 'black', name: 'Black', colors: { base: '#232428' } }, { id: 'brass', name: 'Brass', colors: { base: '#c9a45c' } }, { id: 'sage', name: 'Sage', colors: { base: '#8ea27f' } }],
    light: { color: '#ffe0a8', intensity: 0.8, range: 5, offset: [0, 0.4, 0] },
    tags: ['lamp', 'table lamp', 'light', 'bedroom', 'living', 'lighting'],
  },
  {
    id: 'led_strip', name: 'LED Strip', size: [1, 0.03, 0.03], placement: 'wall', mount: 0.05, interaction: 'light', collision: 'none',
    parts: [B([-0.5, 0, -0.015], [0.5, 0.03, 0.015], 'led', { mat: 'emissive' })],
    slots: { led: '#fff1d6' },
    variants: [{ id: 'warm', name: 'Warm White', colors: { led: '#fff1d6' } }, { id: 'cool', name: 'Cool White', colors: { led: '#e8f3ff' } }, { id: 'blue', name: 'Blue', colors: { led: '#8fc4ff' } }, { id: 'amber', name: 'Amber', colors: { led: '#ffb866' } }],
    light: { color: '#fff1d6', intensity: 0.45, range: 3, offset: [0, 0, 0.2] },
    tags: ['led', 'strip', 'light', 'accent', 'lighting'],
  },
  {
    id: 'light_switch', name: 'Light Switch', size: [0.1, 0.12, 0.03], placement: 'wall', mount: 1.1, interaction: 'switch', collision: 'none',
    parts: [B([-0.05, 0, -0.015], [0.05, 0.12, 0.012], 'plate'), B([-0.02, 0.04, 0.012], [0.02, 0.08, 0.022], 'plate')],
    slots: { plate: '#f4f3ef' }, tags: ['switch', 'light switch', 'electrical'],
  },

  // ================================================================ decoration
  ...([['art_abstract', 'Abstract Painting', ['#c8704c', '#e6c68a', '#34465f']], ['art_landscape', 'Landscape Painting', ['#7fa6c9', '#8aa27a', '#e8dcc0']], ['art_minimal', 'Minimal Line Art', ['#f4f2ec', '#232428', '#d9c4a2']]] as [string, string, string[]][]).map(([id, name, c]): ObjectDef => ({
    id, name, size: [1, 0.75, 0.05], placement: 'wall', mount: 1.25, collision: 'none',
    parts: [
      B([-0.5, 0, -0.025], [0.5, 0.75, 0.01], 'frame'), B([-0.46, 0.04, 0.01], [0.46, 0.71, 0.015], 'canvas'),
      B([-0.4, 0.1, 0.015], [0.05, 0.45, 0.02], 'a'), B([-0.1, 0.3, 0.016], [0.35, 0.65, 0.021], 'b'), B([0.12, 0.12, 0.017], [0.4, 0.26, 0.022], 'c'),
    ],
    slots: { frame: '#232428', canvas: '#f4f1ea', a: c[0], b: c[1], c: c[2] },
    variants: [{ id: 'black', name: 'Black Frame', colors: { frame: '#232428' } }, { id: 'oak', name: 'Oak Frame', colors: { frame: '#c49563' } }, { id: 'white', name: 'White Frame', colors: { frame: '#f1efe9' } }],
    tags: ['art', 'painting', 'artwork', 'picture', 'wall', 'decor'],
  })),
  {
    id: 'photo_frames', name: 'Photo Frames', size: [0.9, 0.5, 0.04], placement: 'wall', mount: 1.35, collision: 'none',
    parts: [
      B([-0.45, 0.1, -0.02], [-0.15, 0.5, 0.01], 'frame'), B([-0.42, 0.13, 0.01], [-0.18, 0.47, 0.014], 'p1'),
      B([-0.1, 0, -0.02], [0.2, 0.3, 0.01], 'frame'), B([-0.07, 0.03, 0.01], [0.17, 0.27, 0.014], 'p2'),
      B([0.25, 0.15, -0.02], [0.45, 0.45, 0.01], 'frame'), B([0.28, 0.18, 0.01], [0.42, 0.42, 0.014], 'p3'),
    ],
    slots: { frame: '#232428', p1: '#b9c8d4', p2: '#d9c4a2', p3: '#a8b898' },
    variants: [{ id: 'black', name: 'Black', colors: { frame: '#232428' } }, { id: 'oak', name: 'Oak', colors: { frame: '#c49563' } }, { id: 'white', name: 'White', colors: { frame: '#f1efe9' } }],
    tags: ['frames', 'photos', 'pictures', 'wall', 'decor'],
  },
  {
    id: 'wall_clock', name: 'Wall Clock', size: [0.4, 0.4, 0.05], placement: 'wall', mount: 1.6, collision: 'none',
    parts: [C([-0.2, 0, -0.025], [0.2, 0.4, 0.02], 'frame', { axis: 'z', seg: 20 }), C([-0.18, 0.02, 0.02], [0.18, 0.38, 0.024], 'face', { axis: 'z', seg: 20 }), B([-0.006, 0.2, 0.024], [0.006, 0.34, 0.03], 'hand'), B([0.0, 0.194, 0.024], [0.1, 0.206, 0.03], 'hand')],
    slots: { frame: '#232428', face: '#f7f5ef', hand: '#232428' }, variants: METAL_VARIANTS.map((v) => ({ ...v, colors: { frame: v.colors.metal } })),
    tags: ['clock', 'wall', 'decor', 'time'],
  },
  {
    id: 'vase', name: 'Vase with Stems', size: [0.25, 0.65, 0.25], placement: 'surface', freeRotate: true, collision: 'none',
    parts: [C([-0.1, 0, -0.1], [0.1, 0.3, 0.1], 'vase', { seg: 12 }), C([-0.05, 0.3, -0.05], [0.05, 0.36, 0.05], 'vase', { seg: 10 }), B([-0.01, 0.34, -0.01], [0.01, 0.65, 0.01], 'stem'), B([0.03, 0.34, -0.01], [0.05, 0.6, 0.01], 'stem'), S([-0.05, 0.55, -0.05], [0.05, 0.66, 0.05], 'bloom'), S([0.0, 0.52, -0.04], [0.09, 0.61, 0.05], 'bloom')],
    slots: { vase: '#e8e2d2', stem: '#5f7a4a', bloom: '#f2efe6' },
    variants: [{ id: 'cream', name: 'Cream', colors: { vase: '#e8e2d2' } }, { id: 'terracotta', name: 'Terracotta', colors: { vase: '#c27352' } }, { id: 'black', name: 'Black', colors: { vase: '#2c2c30' } }, { id: 'blue', name: 'Blue', colors: { vase: '#5f7ea3' } }],
    tags: ['vase', 'flowers', 'decor'],
  },
  {
    id: 'books_stack', name: 'Book Stack', size: [0.3, 0.16, 0.22], placement: 'surface', freeRotate: true, collision: 'none',
    parts: [B([-0.14, 0, -0.1], [0.14, 0.05, 0.1], 'b1'), B([-0.12, 0.05, -0.09], [0.13, 0.1, 0.09], 'b2'), B([-0.13, 0.1, -0.1], [0.11, 0.15, 0.08], 'b3')],
    slots: { b1: '#34465f', b2: '#b8603f', b3: '#e2d6bc' }, tags: ['books', 'decor', 'reading'],
  },
  {
    id: 'plant_floor', name: 'Floor Plant', size: [0.6, 1.4, 0.6], placement: 'floor', freeRotate: true,
    parts: [
      C([-0.2, 0, -0.2], [0.2, 0.4, 0.2], 'pot', { seg: 14 }), C([-0.18, 0.38, -0.18], [0.18, 0.4, 0.18], 'soil', { seg: 12 }),
      B([-0.02, 0.4, -0.02], [0.02, 1.0, 0.02], 'stem'),
      S([-0.3, 0.7, -0.25], [0.15, 1.15, 0.2], 'leaf'), S([-0.1, 0.9, -0.1], [0.3, 1.4, 0.3], 'leaf2'), S([-0.25, 1.0, -0.05], [0.1, 1.35, 0.3], 'leaf'),
    ],
    slots: { pot: '#e8e2d2', soil: '#4a3526', stem: '#5f7a4a', leaf: '#4f7f3a', leaf2: '#6a9a4a' },
    variants: [{ id: 'cream', name: 'Cream Pot', colors: { pot: '#e8e2d2' } }, { id: 'terracotta', name: 'Terracotta Pot', colors: { pot: '#c27352' } }, { id: 'black', name: 'Black Pot', colors: { pot: '#2c2c30' } }, { id: 'basket', name: 'Woven Basket', colors: { pot: '#b99a6a' } }],
    collision: [[[-0.2, 0, -0.2], [0.2, 1.2, 0.2]]], tags: ['plant', 'greenery', 'indoor', 'decor', 'living'],
  },
  {
    id: 'plant_small', name: 'Small Plant', size: [0.25, 0.35, 0.25], placement: 'surface', freeRotate: true, collision: 'none',
    parts: [C([-0.08, 0, -0.08], [0.08, 0.12, 0.08], 'pot', { seg: 12 }), S([-0.12, 0.1, -0.12], [0.12, 0.35, 0.12], 'leaf')],
    slots: { pot: '#c27352', leaf: '#5f8f45' },
    variants: [{ id: 'terracotta', name: 'Terracotta', colors: { pot: '#c27352' } }, { id: 'white', name: 'White', colors: { pot: '#f1efe9' } }, { id: 'black', name: 'Black', colors: { pot: '#2c2c30' } }],
    tags: ['plant', 'succulent', 'decor', 'shelf'],
  },
  {
    id: 'cushions', name: 'Throw Cushions', size: [0.6, 0.3, 0.25], placement: 'surface', freeRotate: true, collision: 'none',
    parts: [B([-0.28, 0, -0.1], [0.0, 0.28, 0.06], 'c1'), B([0.02, 0, -0.08], [0.28, 0.25, 0.08], 'c2')],
    slots: { c1: '#c8704c', c2: '#e6c68a' },
    variants: [{ id: 'warm', name: 'Warm', colors: { c1: '#c8704c', c2: '#e6c68a' } }, { id: 'cool', name: 'Cool', colors: { c1: '#34465f', c2: '#aac4d9' } }, { id: 'neutral', name: 'Neutral', colors: { c1: '#d9c4a2', c2: '#f3efe6' } }],
    tags: ['cushion', 'pillow', 'sofa', 'decor'],
  },
  {
    id: 'sculpture', name: 'Sculpture', size: [0.3, 0.55, 0.3], placement: 'surface', freeRotate: true, collision: 'none',
    parts: [B([-0.12, 0, -0.12], [0.12, 0.06, 0.12], 'base'), S([-0.09, 0.06, -0.09], [0.09, 0.3, 0.09], 'form'), S([-0.06, 0.28, -0.06], [0.06, 0.52, 0.06], 'form')],
    slots: { base: '#2c2c30', form: '#e8e2d2' },
    variants: [{ id: 'stone', name: 'Stone', colors: { form: '#e8e2d2' } }, { id: 'bronze', name: 'Bronze', colors: { form: '#9a6e3c' } }, { id: 'black', name: 'Black', colors: { form: '#2c2c30' } }],
    tags: ['sculpture', 'art', 'decor', 'statue'],
  },

  // ================================================================ utility / garage
  {
    id: 'washer', name: 'Washing Machine', size: [0.7, 0.9, 0.65], placement: 'floor', againstWall: true, surface: 0.9, interaction: 'appliance',
    parts: [B([-0.35, 0, -0.32], [0.35, 0.9, 0.3], 'body'), C([-0.22, 0.2, 0.3], [0.22, 0.64, 0.33], 'door', { axis: 'z', seg: 18 }), C([-0.17, 0.25, 0.33], [0.17, 0.59, 0.335], 'glass', { axis: 'z', seg: 18, mat: 'glass' }), B([-0.3, 0.78, 0.3], [0.3, 0.86, 0.31], 'panel')],
    slots: { body: '#f2f2f0', door: '#b9bec4', glass: '#6f8a99', panel: '#d8dadc' }, variants: APPLIANCE_VARIANTS,
    tags: ['washer', 'washing machine', 'laundry', 'utility', 'appliance'],
  },
  {
    id: 'dryer', name: 'Dryer', size: [0.7, 0.9, 0.65], placement: 'floor', againstWall: true, surface: 0.9, interaction: 'appliance',
    parts: [B([-0.35, 0, -0.32], [0.35, 0.9, 0.3], 'body'), C([-0.22, 0.2, 0.3], [0.22, 0.64, 0.33], 'door', { axis: 'z', seg: 18 }), B([-0.3, 0.78, 0.3], [0.3, 0.86, 0.31], 'panel')],
    slots: { body: '#f2f2f0', door: '#d8dadc', panel: '#d8dadc' }, variants: APPLIANCE_VARIANTS,
    tags: ['dryer', 'laundry', 'utility', 'appliance'],
  },
  {
    id: 'water_heater', name: 'Water Heater', size: [0.6, 1.5, 0.6], placement: 'floor', againstWall: true,
    parts: [C([-0.28, 0.05, -0.28], [0.28, 1.4, 0.28], 'body', { seg: 16 }), C([-0.26, 1.4, -0.26], [0.26, 1.46, 0.26], 'cap', { seg: 16 }), C([-0.03, 1.46, -0.03], [0.03, 1.6, 0.03], 'pipe', { seg: 8 })],
    slots: { body: '#f0efea', cap: '#b9bec4', pipe: '#b87a4a' }, tags: ['water heater', 'boiler', 'utility'],
  },
  {
    id: 'storage_shelf', name: 'Storage Shelving', size: [1.2, 1.8, 0.45], placement: 'floor', againstWall: true,
    parts: [
      ...[[-0.58, -0.2], [0.55, -0.2], [-0.58, 0.19], [0.55, 0.19]].map(([x, z]) => B([x, 0, z], [x + 0.03, 1.8, z + 0.03], 'metal')),
      ...[0.1, 0.65, 1.2, 1.75].map((y) => B([-0.6, y, -0.22], [0.6, y + 0.03, 0.22], 'metal')),
      B([-0.5, 0.13, -0.15], [-0.1, 0.43, 0.15], 'box1'), B([0.0, 0.68, -0.15], [0.45, 0.98, 0.15], 'box2'), B([-0.45, 1.23, -0.15], [-0.05, 1.45, 0.15], 'box1'),
    ],
    slots: { metal: '#8d9194', box1: '#c9a878', box2: '#6f8a99' }, tags: ['shelf', 'shelving', 'storage', 'garage', 'utility'],
  },
  {
    id: 'utility_sink', name: 'Utility Sink', size: [0.7, 0.9, 0.55], placement: 'floor', againstWall: true, interaction: 'appliance',
    parts: [B([-0.35, 0.55, -0.27], [0.35, 0.9, 0.27], 'basin'), B([-0.3, 0.7, -0.22], [0.3, 0.905, 0.22], 'inner'), ...legs(0.7, 0.54, 0.55, 0.04, 'metal', 0.02), C([-0.02, 0.9, -0.26], [0.02, 1.1, -0.22], 'metal', { seg: 8 }), B([-0.02, 1.07, -0.24], [0.02, 1.1, -0.1], 'metal')],
    slots: { basin: '#f0efea', inner: '#d8dadc', metal: '#b9bec4' }, tags: ['sink', 'utility sink', 'laundry', 'garage', 'utility'],
  },
  {
    id: 'electrical_panel', name: 'Electrical Panel', size: [0.45, 0.65, 0.12], placement: 'wall', mount: 1.2, collision: 'none',
    parts: [B([-0.22, 0, -0.06], [0.22, 0.65, 0.05], 'body'), B([-0.2, 0.02, 0.05], [0.2, 0.63, 0.06], 'door'), B([0.14, 0.28, 0.06], [0.17, 0.36, 0.07], 'handle')],
    slots: { body: '#c9ccce', door: '#d8dadc', handle: '#232428' }, tags: ['electrical', 'panel', 'breaker', 'utility'],
  },
  {
    id: 'tool_cabinet', name: 'Tool Cabinet', size: [1, 1.0, 0.5], placement: 'floor', againstWall: true, surface: 1.0,
    parts: [B([-0.5, 0.06, -0.25], [0.5, 1.0, 0.24], 'body'), ...[0.3, 0.5, 0.7, 0.85].flatMap((y) => [...seamsFront(-0.49, 0.49, y, y + 0.01, 0.24), handle(0, y - 0.09, y - 0.09 + 0.3, 0.24, 'handle', true)]), ...[[-0.4, -0.18], [0.4, -0.18], [-0.4, 0.18], [0.4, 0.18]].map(([x, z]) => C([x - 0.04, 0, z - 0.04], [x + 0.04, 0.06, z + 0.04], 'wheel', { axis: 'x', seg: 8 }))],
    slots: { body: '#b8423a', seam: '#6a2a24', handle: '#d0d5d9', wheel: '#232428' },
    variants: [{ id: 'red', name: 'Red', colors: { body: '#b8423a' } }, { id: 'black', name: 'Black', colors: { body: '#2c2c30' } }, { id: 'blue', name: 'Blue', colors: { body: '#3d6a9a' } }],
    tags: ['tools', 'cabinet', 'garage', 'workshop', 'utility'],
  },
  {
    id: 'garage_workbench', name: 'Garage Workbench', size: [2, 0.95, 0.7], placement: 'floor', againstWall: true, surface: 0.95,
    parts: [B([-1, 0.9, -0.35], [1, 0.95, 0.35], 'wood'), ...legs(2, 0.7, 0.9, 0.06, 'metal', 0.04), B([-0.96, 0.25, -0.3], [0.96, 0.28, 0.3], 'wood'), B([-1, 0.95, -0.35], [1, 1.6, -0.32], 'pegboard'), B([-0.6, 1.2, -0.32], [-0.58, 1.45, -0.28], 'metal'), B([-0.3, 1.25, -0.32], [-0.1, 1.28, -0.28], 'metal')],
    slots: { wood: '#b98a5a', metal: '#3a3c40', pegboard: '#c9a878' }, tags: ['workbench', 'garage', 'workshop', 'utility'],
  },
  {
    id: 'bicycle', name: 'Bicycle', size: [0.3, 1.0, 1.7], placement: 'floor', freeRotate: true,
    parts: [
      C([-0.02, 0.02, -0.82], [0.02, 0.7, -0.14], 'tire', { axis: 'x', seg: 18 }), C([-0.02, 0.02, 0.14], [0.02, 0.7, 0.82], 'tire', { axis: 'x', seg: 18 }),
      B([-0.02, 0.36, -0.48], [0.02, 0.4, 0.48], 'frame'), B([-0.02, 0.4, -0.2], [0.02, 0.8, -0.16], 'frame'), B([-0.02, 0.4, 0.4], [0.02, 0.92, 0.44], 'frame'),
      B([-0.08, 0.8, -0.26], [0.08, 0.84, -0.1], 'seat'), B([-0.25, 0.92, 0.4], [0.25, 0.95, 0.44], 'frame'),
    ],
    slots: { tire: '#1e1f22', frame: '#3d6a9a', seat: '#232428' },
    variants: [{ id: 'blue', name: 'Blue', colors: { frame: '#3d6a9a' } }, { id: 'red', name: 'Red', colors: { frame: '#b8423a' } }, { id: 'mint', name: 'Mint', colors: { frame: '#8fcfb4' } }, { id: 'black', name: 'Black', colors: { frame: '#232428' } }],
    tags: ['bicycle', 'bike', 'garage', 'outdoor'],
  },
  {
    id: 'car', name: 'Family Car (placeholder)', size: [1.9, 1.5, 4.2], placement: 'floor', freeRotate: false,
    parts: [
      B([-0.95, 0.3, -2.1], [0.95, 0.9, 2.1], 'body'), B([-0.85, 0.9, -1.1], [0.85, 1.45, 1.0], 'body'),
      B([-0.8, 0.92, -1.12], [0.8, 1.4, -1.1], 'glass', { mat: 'glass' }), B([-0.8, 0.92, 1.0], [0.8, 1.4, 1.02], 'glass', { mat: 'glass' }),
      B([-0.852, 0.95, -1.0], [-0.85, 1.4, 0.9], 'glass', { mat: 'glass' }), B([0.85, 0.95, -1.0], [0.852, 1.4, 0.9], 'glass', { mat: 'glass' }),
      ...[[-0.8, -1.3], [0.8, -1.3], [-0.8, 1.3], [0.8, 1.3]].map(([x, z]) => C([x - 0.14, 0, z - 0.36], [x + 0.14, 0.72, z + 0.36], 'tire', { axis: 'x', seg: 16 })),
      B([-0.8, 0.55, 2.1], [-0.5, 0.7, 2.12], 'lamp', { mat: 'emissive' }), B([0.5, 0.55, 2.1], [0.8, 0.7, 2.12], 'lamp', { mat: 'emissive' }),
      B([-0.8, 0.6, -2.12], [-0.5, 0.72, -2.1], 'rear', { mat: 'emissive' }), B([0.5, 0.6, -2.12], [0.8, 0.72, -2.1], 'rear', { mat: 'emissive' }),
    ],
    slots: { body: '#e6e8ea', glass: '#3b4852', tire: '#1e1f22', lamp: '#fff6de', rear: '#e2453a' },
    variants: [{ id: 'white', name: 'White', colors: { body: '#e6e8ea' } }, { id: 'red', name: 'Red', colors: { body: '#b8423a' } }, { id: 'blue', name: 'Blue', colors: { body: '#3d6a9a' } }, { id: 'black', name: 'Black', colors: { body: '#232428' } }, { id: 'sage', name: 'Sage', colors: { body: '#8ea27f' } }],
    tags: ['car', 'vehicle', 'garage', 'driveway'],
  },

  // ================================================================ outdoor
  {
    id: 'outdoor_table', name: 'Outdoor Dining Table', size: [1.8, 0.75, 0.9], placement: 'floor', surface: 0.75,
    parts: [...[0, 1, 2, 3, 4, 5].map((k) => B([-0.9, 0.71, -0.45 + k * 0.15], [0.9, 0.75, -0.32 + k * 0.15], 'wood')), ...legs(1.8, 0.9, 0.71, 0.06, 'metal', 0.08)],
    slots: { wood: '#b98a5a', metal: '#2c2c30' }, variants: WOOD_VARIANTS.slice(0, 2).concat([{ id: 'teak', name: 'Teak', colors: { wood: '#a0703f' } }]),
    tags: ['outdoor', 'table', 'patio', 'dining', 'garden'],
  },
  {
    id: 'outdoor_chair', name: 'Outdoor Chair', size: [0.55, 0.85, 0.6], placement: 'floor', freeRotate: true,
    parts: [...[0, 1, 2, 3].map((k) => B([-0.26, 0.42, -0.26 + k * 0.13], [0.26, 0.45, -0.16 + k * 0.13], 'wood')), B([-0.26, 0.45, -0.3], [0.26, 0.85, -0.26], 'wood'), ...legs(0.54, 0.58, 0.42, 0.04, 'metal', 0.02)],
    slots: { wood: '#b98a5a', metal: '#2c2c30' }, tags: ['outdoor', 'chair', 'patio', 'garden', 'seat'],
  },
  {
    id: 'outdoor_sofa', name: 'Outdoor Sofa', size: [2, 0.75, 0.9], placement: 'floor',
    parts: [B([-1, 0.05, -0.45], [1, 0.35, 0.45], 'frame'), B([-0.9, 0.35, -0.2], [0.9, 0.48, 0.42], 'cushion'), B([-1, 0.35, -0.45], [1, 0.75, -0.25], 'frame'), B([-1, 0.35, -0.45], [-0.88, 0.58, 0.45], 'frame'), B([0.88, 0.35, -0.45], [1, 0.58, 0.45], 'frame'), B([-0.86, 0.45, -0.25], [0.86, 0.72, -0.12], 'cushion')],
    slots: { frame: '#8a8579', cushion: '#ece6da' },
    variants: [{ id: 'sand', name: 'Sand', colors: { cushion: '#ece6da' } }, { id: 'gray', name: 'Gray', colors: { cushion: '#9da1a4' } }, { id: 'navy', name: 'Navy', colors: { cushion: '#3d5270' } }, { id: 'terracotta', name: 'Terracotta', colors: { cushion: '#c27352' } }],
    tags: ['outdoor', 'sofa', 'patio', 'lounge', 'garden'],
  },
  {
    id: 'bench', name: 'Garden Bench', size: [1.5, 0.8, 0.55], placement: 'floor',
    parts: [...[0, 1, 2].map((k) => B([-0.75, 0.42, -0.24 + k * 0.17], [0.75, 0.46, -0.1 + k * 0.17], 'wood')), B([-0.75, 0.5, -0.27], [0.75, 0.8, -0.23], 'wood'), B([-0.72, 0, -0.26], [-0.66, 0.42, 0.26], 'metal'), B([0.66, 0, -0.26], [0.72, 0.42, 0.26], 'metal')],
    slots: { wood: '#b98a5a', metal: '#2c2c30' }, tags: ['bench', 'outdoor', 'garden', 'seat', 'patio'],
  },
  {
    id: 'lounge_bed', name: 'Pool Lounge Chair', size: [0.7, 0.8, 1.9], placement: 'floor', freeRotate: true,
    parts: [B([-0.35, 0.25, -0.35], [0.35, 0.33, 0.95], 'frame'), B([-0.33, 0.33, -0.3], [0.33, 0.4, 0.92], 'cushion'), B([-0.33, 0.33, -0.95], [0.33, 0.8, -0.8], 'cushion'), B([-0.35, 0.25, -0.95], [0.35, 0.33, -0.35], 'frame'), ...legs(0.7, 1.9, 0.25, 0.05, 'frame', 0.04)],
    slots: { frame: '#f1efe9', cushion: '#e9e3d6' },
    variants: [{ id: 'white', name: 'White', colors: { frame: '#f1efe9', cushion: '#e9e3d6' } }, { id: 'teak', name: 'Teak', colors: { frame: '#a0703f', cushion: '#f1ece2' } }, { id: 'stripe', name: 'Navy Cushion', colors: { frame: '#f1efe9', cushion: '#3d5270' } }],
    tags: ['lounge', 'sun lounger', 'pool', 'outdoor', 'chair'],
  },
  {
    id: 'umbrella', name: 'Patio Umbrella', size: [2.4, 2.5, 2.4], placement: 'floor', freeRotate: true,
    parts: [C([-0.25, 0, -0.25], [0.25, 0.06, 0.25], 'base', { seg: 14 }), C([-0.025, 0.06, -0.025], [0.025, 2.4, 0.025], 'pole', { seg: 8 }), C([-1.2, 2.1, -1.2], [1.2, 2.3, 1.2], 'canopy', { seg: 16 }), C([-0.3, 2.3, -0.3], [0.3, 2.42, 0.3], 'canopy', { seg: 12 })],
    slots: { base: '#2c2c30', pole: '#e8e6e0', canopy: '#ece6da' },
    variants: [{ id: 'sand', name: 'Sand', colors: { canopy: '#ece6da' } }, { id: 'terracotta', name: 'Terracotta', colors: { canopy: '#c27352' } }, { id: 'navy', name: 'Navy', colors: { canopy: '#3d5270' } }, { id: 'sage', name: 'Sage', colors: { canopy: '#9fb192' } }],
    collision: [[[-0.1, 0, -0.1], [0.1, 2.4, 0.1]]], tags: ['umbrella', 'parasol', 'patio', 'pool', 'outdoor', 'shade'],
  },
  {
    id: 'pergola', name: 'Pergola', size: [3, 2.8, 3], placement: 'floor',
    parts: [
      ...[[-1.45, -1.45], [1.35, -1.45], [-1.45, 1.35], [1.35, 1.35]].map(([x, z]) => B([x, 0, z], [x + 0.1, 2.6, z + 0.1], 'post')),
      B([-1.5, 2.5, -1.45], [1.5, 2.66, -1.37], 'beam'), B([-1.5, 2.5, 1.37], [1.5, 2.66, 1.45], 'beam'),
      ...[0, 1, 2, 3, 4, 5, 6].map((k) => B([-1.45 + k * 0.47, 2.66, -1.55], [-1.39 + k * 0.47, 2.8, 1.55], 'beam')),
    ],
    slots: { post: '#232428', beam: '#b98a5a' },
    variants: [{ id: 'black_wood', name: 'Black & Wood', colors: { post: '#232428', beam: '#b98a5a' } }, { id: 'white', name: 'White', colors: { post: '#f1efe9', beam: '#f1efe9' } }, { id: 'wood', name: 'All Wood', colors: { post: '#a0703f', beam: '#b98a5a' } }],
    collision: [[[-1.45, 0, -1.45], [-1.35, 2.6, -1.35]], [[1.35, 0, -1.45], [1.45, 2.6, -1.35]], [[-1.45, 0, 1.35], [-1.35, 2.6, 1.45]], [[1.35, 0, 1.35], [1.45, 2.6, 1.45]]],
    tags: ['pergola', 'outdoor', 'patio', 'garden', 'shade', 'beams'],
  },
  {
    id: 'planter_box', name: 'Planter Box', size: [1, 0.6, 0.5], placement: 'floor',
    parts: [B([-0.5, 0, -0.25], [0.5, 0.5, 0.25], 'box'), B([-0.46, 0.44, -0.21], [0.46, 0.5, 0.21], 'soil'), S([-0.45, 0.4, -0.22], [-0.05, 0.75, 0.2], 'leaf'), S([-0.1, 0.42, -0.2], [0.3, 0.72, 0.22], 'leaf2'), S([0.15, 0.4, -0.22], [0.47, 0.7, 0.2], 'leaf')],
    slots: { box: '#46494e', soil: '#4a3526', leaf: '#4f7f3a', leaf2: '#7fa85a' },
    variants: [{ id: 'charcoal', name: 'Charcoal', colors: { box: '#46494e' } }, { id: 'wood', name: 'Wood', colors: { box: '#a0703f' } }, { id: 'concrete', name: 'Concrete', colors: { box: '#a5a39e' } }, { id: 'white', name: 'White', colors: { box: '#f1efe9' } }],
    tags: ['planter', 'plants', 'garden', 'outdoor', 'patio'],
  },
  {
    id: 'bbq_grill', name: 'BBQ Grill', size: [1.1, 1.0, 0.6], placement: 'floor', interaction: 'appliance',
    parts: [B([-0.4, 0.55, -0.25], [0.4, 0.95, 0.25], 'body'), B([-0.55, 0.78, -0.24], [-0.4, 0.8, 0.24], 'shelf'), B([0.4, 0.78, -0.24], [0.55, 0.8, 0.24], 'shelf'), ...legs(0.8, 0.5, 0.55, 0.04, 'leg', 0.02), B([-0.3, 0.97, 0.18], [0.3, 1.0, 0.21], 'handle'), B([-0.35, 0.94, -0.2], [0.35, 0.95, 0.2], 'coals', { mat: 'emissive' })],
    slots: { body: '#2c2c30', shelf: '#b9bec4', leg: '#2c2c30', handle: '#b9bec4', coals: '#ff7a3a' },
    variants: [{ id: 'black', name: 'Black', colors: { body: '#2c2c30' } }, { id: 'steel', name: 'Stainless', colors: { body: '#b9bec4' } }, { id: 'red', name: 'Red', colors: { body: '#a83a32' } }],
    tags: ['bbq', 'grill', 'barbecue', 'outdoor', 'patio', 'cooking'],
  },
  {
    id: 'lamp_post', name: 'Outdoor Lamp Post', size: [0.35, 2.4, 0.35], placement: 'floor', interaction: 'light',
    parts: [C([-0.14, 0, -0.14], [0.14, 0.1, 0.14], 'metal', { seg: 12 }), C([-0.04, 0.1, -0.04], [0.04, 2.0, 0.04], 'metal', { seg: 8 }), B([-0.15, 2.0, -0.15], [0.15, 2.35, 0.15], 'bulb', { mat: 'emissive' }), B([-0.18, 2.35, -0.18], [0.18, 2.42, 0.18], 'metal')],
    slots: { metal: '#232428', bulb: '#ffe0a0' }, variants: METAL_VARIANTS.slice(0, 3),
    light: { color: '#ffd9a0', intensity: 1.2, range: 8, offset: [0, 2.1, 0] },
    collision: [[[-0.1, 0, -0.1], [0.1, 2.4, 0.1]]], tags: ['light', 'lamp post', 'street light', 'outdoor', 'garden', 'lighting'],
  },
  {
    id: 'path_light', name: 'Path Light', size: [0.18, 0.55, 0.18], placement: 'floor', interaction: 'light', collision: 'none',
    parts: [B([-0.07, 0, -0.07], [0.07, 0.45, 0.07], 'metal'), B([-0.06, 0.45, -0.06], [0.06, 0.52, 0.06], 'bulb', { mat: 'emissive' }), B([-0.09, 0.52, -0.09], [0.09, 0.55, 0.09], 'metal')],
    slots: { metal: '#232428', bulb: '#ffe0a0' },
    light: { color: '#ffd9a0', intensity: 0.6, range: 3.5, offset: [0, 0.4, 0] },
    tags: ['light', 'path light', 'bollard', 'garden', 'outdoor', 'lighting'],
  },
  {
    id: 'pool_light', name: 'Pool Light', size: [0.3, 0.3, 0.05], placement: 'wall', interaction: 'light', collision: 'none',
    parts: [C([-0.15, 0, -0.025], [0.15, 0.3, 0.02], 'rim', { axis: 'z', seg: 16 }), C([-0.12, 0.03, 0.02], [0.12, 0.27, 0.025], 'bulb', { axis: 'z', seg: 16, mat: 'emissive' })],
    slots: { rim: '#d0d5d9', bulb: '#bfefff' },
    light: { color: '#8fe0ff', intensity: 1.0, range: 5, offset: [0, 0.15, 0.6] },
    tags: ['pool', 'light', 'underwater', 'lighting'],
  },
  {
    id: 'pool_ladder', name: 'Pool Ladder', size: [0.6, 1.3, 0.5], placement: 'wall', collision: 'none',
    parts: [
      C([-0.28, 0, 0.1], [-0.24, 1.3, 0.14], 'chrome', { seg: 8 }), C([0.24, 0, 0.1], [0.28, 1.3, 0.14], 'chrome', { seg: 8 }),
      B([-0.28, 1.26, -0.2], [-0.24, 1.3, 0.14], 'chrome'), B([0.24, 1.26, -0.2], [0.28, 1.3, 0.14], 'chrome'),
      ...[0.2, 0.5, 0.8].map((y) => B([-0.24, y, 0.06], [0.24, y + 0.04, 0.18], 'step')),
    ],
    slots: { chrome: '#d0d5d9', step: '#e8ecee' }, tags: ['pool', 'ladder', 'steps', 'outdoor'],
  },
  {
    id: 'fountain', name: 'Garden Fountain', size: [1.6, 1.4, 1.6], placement: 'floor', interaction: 'shower',
    parts: [
      C([-0.8, 0, -0.8], [0.8, 0.45, 0.8], 'stone', { seg: 20 }), C([-0.7, 0.3, -0.7], [0.7, 0.46, 0.7], 'water', { seg: 20, mat: 'glass' }),
      C([-0.12, 0.45, -0.12], [0.12, 1.0, 0.12], 'stone', { seg: 12 }), C([-0.4, 1.0, -0.4], [0.4, 1.12, 0.4], 'stone', { seg: 16 }),
      C([-0.33, 1.05, -0.33], [0.33, 1.13, 0.33], 'water', { seg: 16, mat: 'glass' }),
      C([-0.04, 1.12, -0.04], [0.04, 1.4, 0.04], 'spray', { seg: 8, mat: 'glass', anim: 'water' }),
    ],
    anims: [{ name: 'water', type: 'lift', pivot: [0, 0, 0], amount: -0.3 }],
    slots: { stone: '#cfcac0', water: '#7fc4e0', spray: '#dff4ff' },
    collision: [[[-0.8, 0, -0.8], [0.8, 0.45, 0.8]], [[-0.4, 0, -0.4], [0.4, 1.12, 0.4]]], tags: ['fountain', 'water', 'garden', 'outdoor', 'feature'],
  },
  {
    id: 'decorative_rocks', name: 'Decorative Rocks', size: [1.2, 0.5, 1.0], placement: 'floor', freeRotate: true,
    parts: [S([-0.6, 0, -0.4], [0.05, 0.45, 0.3], 'rock'), S([-0.05, 0, -0.1], [0.45, 0.32, 0.4], 'rock2'), S([0.2, 0, -0.5], [0.6, 0.22, -0.1], 'rock')],
    slots: { rock: '#a6a39b', rock2: '#8d8a82' }, tags: ['rocks', 'stones', 'boulder', 'garden', 'landscaping'],
  },
  {
    id: 'bush_round', name: 'Round Bush', size: [1, 0.9, 1], placement: 'floor', freeRotate: true,
    parts: [S([-0.5, 0, -0.5], [0.5, 0.85, 0.5], 'leaf'), S([-0.35, 0.3, -0.3], [0.2, 0.9, 0.3], 'leaf2')],
    slots: { leaf: '#4f7f3a', leaf2: '#6a9a4a' },
    variants: [{ id: 'green', name: 'Green', colors: { leaf: '#4f7f3a', leaf2: '#6a9a4a' } }, { id: 'flowering', name: 'Flowering', colors: { leaf: '#5f8f45', leaf2: '#e7a0b8' } }, { id: 'dark', name: 'Boxwood', colors: { leaf: '#35602c', leaf2: '#457238' } }],
    tags: ['bush', 'shrub', 'garden', 'landscaping', 'plant'],
  },
  {
    id: 'flower_bed', name: 'Flower Bed', size: [1, 0.4, 1], placement: 'floor', collision: 'none',
    parts: [
      B([-0.5, 0, -0.5], [0.5, 0.06, 0.5], 'soil'),
      ...[[-0.3, -0.3], [0.1, -0.25], [0.3, 0.1], [-0.2, 0.2], [0.05, 0.3], [-0.35, 0.0]].flatMap(([x, z], k) => [
        B([x - 0.01, 0.06, z - 0.01], [x + 0.01, 0.3, z + 0.01], 'stem'),
        S([x - 0.07, 0.26, z - 0.07], [x + 0.07, 0.4, z + 0.07], k % 2 ? 'f1' : 'f2'),
      ]),
    ],
    slots: { soil: '#4a3526', stem: '#5f7a4a', f1: '#f2c94c', f2: '#e0775a' },
    variants: [{ id: 'sunny', name: 'Sunny', colors: { f1: '#f2c94c', f2: '#e0775a' } }, { id: 'cool', name: 'Cool', colors: { f1: '#9fb7f0', f2: '#f4f1ea' } }, { id: 'pink', name: 'Pink', colors: { f1: '#f0a0c0', f2: '#c85a8a' } }],
    tags: ['flowers', 'flower bed', 'garden', 'landscaping'],
  },

  // ================================================================ farm
  {
    id: 'scarecrow', name: 'Scarecrow', size: [1.1, 2.1, 0.4], placement: 'floor', freeRotate: true,
    parts: [
      B([-0.04, 0, -0.04], [0.04, 1.7, 0.04], 'pole'), B([-0.55, 1.18, -0.03], [0.55, 1.24, 0.03], 'pole'),
      B([-0.24, 0.85, -0.12], [0.24, 1.42, 0.12], 'shirt'), B([-0.5, 1.12, -0.09], [-0.24, 1.32, 0.09], 'shirt'), B([0.24, 1.12, -0.09], [0.5, 1.32, 0.09], 'shirt'),
      B([-0.26, 0.82, -0.13], [0.26, 0.9, 0.13], 'belt'),
      S([-0.17, 1.42, -0.16], [0.17, 1.76, 0.16], 'sack'),
      B([-0.09, 1.56, 0.15], [-0.04, 1.61, 0.17], 'eye'), B([0.04, 1.56, 0.15], [0.09, 1.61, 0.17], 'eye'), B([-0.07, 1.48, 0.15], [0.07, 1.5, 0.17], 'eye'),
      C([-0.3, 1.72, -0.3], [0.3, 1.75, 0.3], 'hat', { seg: 12 }), C([-0.15, 1.75, -0.15], [0.15, 1.95, 0.15], 'hat', { seg: 12 }),
      B([-0.6, 1.14, -0.04], [-0.5, 1.3, 0.04], 'straw'), B([0.5, 1.14, -0.04], [0.6, 1.3, 0.04], 'straw'), B([-0.18, 0.72, -0.08], [0.18, 0.82, 0.08], 'straw'),
    ],
    slots: { pole: '#7a5230', shirt: '#b8603f', belt: '#5a3a22', sack: '#d8c08a', eye: '#2a1e18', hat: '#c9a65a', straw: '#e8c86a' },
    variants: [{ id: 'red', name: 'Red Shirt', colors: { shirt: '#b8603f' } }, { id: 'blue', name: 'Blue Shirt', colors: { shirt: '#4f6f9a' } }, { id: 'plaid', name: 'Green Shirt', colors: { shirt: '#5f8a4a' } }],
    collision: [[[-0.06, 0, -0.06], [0.06, 1.8, 0.06]]], tags: ['scarecrow', 'farm', 'field', 'garden', 'crops'],
  },
  {
    id: 'water_trough', name: 'Water Trough', size: [1.6, 0.6, 0.6], placement: 'floor',
    parts: [
      B([-0.8, 0.08, -0.3], [0.8, 0.14, 0.3], 'wood'), B([-0.8, 0.14, -0.3], [0.8, 0.55, -0.24], 'wood'), B([-0.8, 0.14, 0.24], [0.8, 0.55, 0.3], 'wood'),
      B([-0.8, 0.14, -0.24], [-0.74, 0.55, 0.24], 'wood'), B([0.74, 0.14, -0.24], [0.8, 0.55, 0.24], 'wood'),
      B([-0.74, 0.14, -0.24], [0.74, 0.46, 0.24], 'water', { mat: 'glass' }),
      B([-0.75, 0, -0.32], [-0.6, 0.08, 0.32], 'leg'), B([0.6, 0, -0.32], [0.75, 0.08, 0.32], 'leg'),
      B([-0.82, 0.3, -0.31], [0.82, 0.34, -0.3], 'band'), B([-0.82, 0.3, 0.3], [0.82, 0.34, 0.31], 'band'),
    ],
    slots: { wood: '#8a5e3c', water: '#6fb3d9', leg: '#6b4424', band: '#3a3a3e' },
    variants: [{ id: 'wood', name: 'Wood', colors: { wood: '#8a5e3c' } }, { id: 'stone', name: 'Stone', colors: { wood: '#9b9a94', leg: '#7a7974' } }, { id: 'metal', name: 'Galvanised', colors: { wood: '#a9b0b6', leg: '#7d848a' } }],
    tags: ['trough', 'water', 'farm', 'animals', 'barn'],
  },
  {
    id: 'wheelbarrow', name: 'Wheelbarrow', size: [0.7, 0.6, 1.3], placement: 'floor', freeRotate: true,
    parts: [
      B([-0.32, 0.3, -0.35], [0.32, 0.34, 0.3], 'tub'), B([-0.34, 0.34, -0.37], [0.34, 0.56, -0.33], 'tub'), B([-0.34, 0.34, 0.26], [0.34, 0.56, 0.3], 'tub'),
      B([-0.34, 0.34, -0.37], [-0.3, 0.56, 0.3], 'tub'), B([0.3, 0.34, -0.37], [0.34, 0.56, 0.3], 'tub'),
      B([-0.3, 0.34, -0.33], [0.3, 0.5, 0.26], 'load'),
      C([-0.04, 0, -0.62], [0.04, 0.26, -0.36], 'wheel', { seg: 12 }),
      B([-0.28, 0.24, 0.3], [-0.24, 0.3, 0.65], 'handle'), B([0.24, 0.24, 0.3], [0.28, 0.3, 0.65], 'handle'),
      B([-0.26, 0, 0.18], [-0.22, 0.3, 0.22], 'handle'), B([0.22, 0, 0.18], [0.26, 0.3, 0.22], 'handle'),
    ],
    slots: { tub: '#4f7f8a', load: '#c99a4a', wheel: '#2c2c30', handle: '#8a5e3c' },
    variants: [{ id: 'hay', name: 'With Hay', colors: { load: '#d9b354' } }, { id: 'soil', name: 'With Soil', colors: { load: '#5a3f2a' } }, { id: 'veg', name: 'With Harvest', colors: { load: '#e0753a' } }],
    tags: ['wheelbarrow', 'farm', 'garden', 'tools', 'cart'],
  },
  {
    id: 'beehive', name: 'Beehive', size: [0.6, 1.0, 0.6], placement: 'floor',
    parts: [
      ...legs(0.5, 0.5, 0.25, 0.05, 'stand', 0.02),
      B([-0.27, 0.25, -0.27], [0.27, 0.48, 0.27], 'box'), B([-0.27, 0.5, -0.27], [0.27, 0.72, 0.27], 'box2'), B([-0.27, 0.74, -0.27], [0.27, 0.86, 0.27], 'box'),
      B([-0.31, 0.86, -0.31], [0.31, 0.92, 0.31], 'roof'),
      B([-0.1, 0.27, 0.27], [0.1, 0.3, 0.29], 'door'),
      S([0.18, 0.55, 0.3], [0.23, 0.6, 0.35], 'bee'), S([-0.22, 0.7, 0.29], [-0.17, 0.75, 0.34], 'bee'),
    ],
    slots: { stand: '#6b4424', box: '#f1efe9', box2: '#e8d9a8', roof: '#8a8f96', door: '#3a2c22', bee: '#f2c94c' },
    variants: [{ id: 'white', name: 'White', colors: { box: '#f1efe9', box2: '#e8d9a8' } }, { id: 'honey', name: 'Honey', colors: { box: '#e0a83a', box2: '#f2c94c' } }, { id: 'sage', name: 'Sage', colors: { box: '#a8b898', box2: '#c4d0b6' } }],
    tags: ['beehive', 'bees', 'honey', 'farm', 'garden'],
  },
  {
    id: 'compost_bin', name: 'Compost Bin', size: [1.0, 0.8, 1.0], placement: 'floor',
    parts: [
      ...[0, 1, 2, 3].map((k) => B([-0.5, 0.05 + k * 0.19, -0.5], [0.5, 0.2 + k * 0.19, -0.44], 'slat')),
      ...[0, 1, 2, 3].map((k) => B([-0.5, 0.05 + k * 0.19, 0.44], [0.5, 0.2 + k * 0.19, 0.5], 'slat')),
      ...[0, 1, 2, 3].map((k) => B([-0.5, 0.05 + k * 0.19, -0.44], [-0.44, 0.2 + k * 0.19, 0.44], 'slat')),
      ...[0, 1, 2].map((k) => B([0.44, 0.05 + k * 0.19, -0.44], [0.5, 0.2 + k * 0.19, 0.44], 'slat')),
      B([-0.44, 0, -0.44], [0.44, 0.55, 0.44], 'compost'), S([-0.3, 0.45, -0.3], [0.1, 0.7, 0.1], 'compost2'),
    ],
    slots: { slat: '#8a5e3c', compost: '#4a3526', compost2: '#5f7a3a' },
    variants: [{ id: 'wood', name: 'Wood', colors: { slat: '#8a5e3c' } }, { id: 'gray', name: 'Weathered', colors: { slat: '#8d8a82' } }],
    tags: ['compost', 'garden', 'farm', 'soil'],
  },
  {
    id: 'produce_crate', name: 'Harvest Crate', size: [0.7, 0.45, 0.5], placement: 'floor', freeRotate: true, surface: 0.42,
    parts: [
      B([-0.35, 0, -0.25], [0.35, 0.04, 0.25], 'wood'),
      B([-0.35, 0.04, -0.25], [0.35, 0.36, -0.21], 'wood'), B([-0.35, 0.04, 0.21], [0.35, 0.36, 0.25], 'wood'),
      B([-0.35, 0.04, -0.21], [-0.31, 0.36, 0.21], 'wood'), B([0.31, 0.04, -0.21], [0.35, 0.36, 0.21], 'wood'),
      ...[[-0.2, -0.08], [0, -0.1], [0.18, -0.06], [-0.12, 0.08], [0.1, 0.09], [0.24, 0.1], [-0.25, 0.1]].map(([x, z], k) => S([x - 0.08, 0.26, z - 0.08], [x + 0.08, 0.42, z + 0.08], k % 3 === 0 ? 'p1' : k % 3 === 1 ? 'p2' : 'p3')),
    ],
    slots: { wood: '#c49563', p1: '#e0453a', p2: '#f0983b', p3: '#f2cf4a' },
    variants: [{ id: 'mixed', name: 'Mixed Harvest', colors: { p1: '#e0453a', p2: '#f0983b', p3: '#f2cf4a' } }, { id: 'apples', name: 'Sunapples', colors: { p1: '#f2b233', p2: '#d65a2e', p3: '#f2b233' } }, { id: 'greens', name: 'Greens', colors: { p1: '#5fa848', p2: '#7fb04f', p3: '#4f8f3a' } }],
    tags: ['crate', 'harvest', 'vegetables', 'farm', 'market', 'produce'],
  },
  {
    id: 'chicken_coop', name: 'Chicken Coop', size: [1.6, 1.6, 1.2], placement: 'floor',
    parts: [
      ...legs(1.4, 1.0, 0.45, 0.07, 'post', 0.02),
      B([-0.7, 0.45, -0.5], [0.7, 1.15, 0.5], 'wall'),
      B([-0.8, 1.15, -0.6], [0.8, 1.25, 0.6], 'roof'), B([-0.6, 1.25, -0.45], [0.6, 1.4, 0.45], 'roof'), B([-0.35, 1.4, -0.25], [0.35, 1.52, 0.25], 'roof'),
      B([-0.18, 0.5, 0.5], [0.18, 0.85, 0.52], 'door'),
      B([-0.5, 0.75, 0.5], [-0.3, 0.95, 0.52], 'window'), B([0.3, 0.75, 0.5], [0.5, 0.95, 0.52], 'window'),
      B([-0.15, 0.05, 0.5], [0.15, 0.08, 1.0], 'ramp'),
      S([0.35, 0, 0.75], [0.55, 0.22, 0.95], 'hen'), S([0.42, 0.18, 0.88], [0.52, 0.3, 0.98], 'hen'), B([0.45, 0.22, 0.97], [0.49, 0.25, 1.0], 'beak'),
    ],
    slots: { post: '#6b4424', wall: '#b8603f', roof: '#5a4a3e', door: '#7a5230', window: '#3a2c22', ramp: '#8a5e3c', hen: '#f6efe6', beak: '#e0a83a' },
    variants: [{ id: 'barn', name: 'Barn Red', colors: { wall: '#b8603f' } }, { id: 'white', name: 'White', colors: { wall: '#f1efe9' } }, { id: 'sage', name: 'Sage', colors: { wall: '#93a684' } }],
    collision: [[[-0.75, 0, -0.55], [0.75, 1.5, 0.55]]], tags: ['chicken', 'coop', 'hen', 'farm', 'animals', 'barn'],
  },
  {
    id: 'farm_stand', name: 'Farm Stand', size: [1.6, 1.9, 0.8], placement: 'floor', surface: 0.85,
    parts: [
      B([-0.8, 0.8, -0.4], [0.8, 0.86, 0.4], 'wood'), B([-0.8, 0, -0.4], [0.8, 0.8, -0.34], 'wood'),
      B([-0.78, 0, -0.38], [-0.7, 1.8, -0.3], 'post'), B([0.7, 0, -0.38], [0.78, 1.8, -0.3], 'post'), B([-0.78, 0, 0.3], [-0.7, 0.8, 0.38], 'post'), B([0.7, 0, 0.3], [0.78, 0.8, 0.38], 'post'),
      B([-0.9, 1.8, -0.5], [0.9, 1.88, 0.45], 'awning'), B([-0.6, 1.4, -0.36], [0.6, 1.7, -0.32], 'sign'),
      ...[-0.5, -0.15, 0.2, 0.5].map((x, k) => S([x - 0.12, 0.86, -0.15], [x + 0.12, 1.06, 0.15], k % 2 ? 'p1' : 'p2')),
    ],
    slots: { wood: '#c49563', post: '#8a5e3c', awning: '#b8603f', sign: '#f1efe9', p1: '#e0453a', p2: '#f2cf4a' },
    variants: [{ id: 'red', name: 'Red Awning', colors: { awning: '#b8603f' } }, { id: 'green', name: 'Green Awning', colors: { awning: '#4f7f3a' } }, { id: 'blue', name: 'Blue Awning', colors: { awning: '#4f6f9a' } }],
    tags: ['farm stand', 'market', 'stall', 'farm', 'shop', 'produce'],
  },
  {
    id: 'barn_door', name: 'Sliding Barn Door', size: [2, 2, 0.18], placement: 'opening', opening: { w: 2, h: 2 }, interaction: 'door',
    parts: [
      B([-1, 0, -0.09], [-0.94, 2, 0.09], 'frame'), B([0.94, 0, -0.09], [1, 2, 0.09], 'frame'), B([-1, 1.94, -0.09], [1, 2, 0.09], 'frame'),
      B([-1.0, 2.0, 0.04], [1.0, 2.06, 0.1], 'rail'),
      B([-0.94, 0.02, 0.02], [0.94, 1.94, 0.07], 'leaf', { anim: 'leaf' }),
      B([-0.9, 0.9, 0.07], [0.9, 1.0, 0.1], 'brace', { anim: 'leaf' }), B([-0.9, 0.1, 0.07], [-0.8, 1.84, 0.1], 'brace', { anim: 'leaf' }), B([0.8, 0.1, 0.07], [0.9, 1.84, 0.1], 'brace', { anim: 'leaf' }),
      B([-0.86, 0.14, 0.07], [0.86, 0.24, 0.1], 'brace', { anim: 'leaf' }), B([-0.86, 1.72, 0.07], [0.86, 1.82, 0.1], 'brace', { anim: 'leaf' }),
      B([0.6, 0.8, 0.1], [0.66, 1.2, 0.13], 'handle', { anim: 'leaf' }),
    ],
    anims: [{ name: 'leaf', type: 'slide', pivot: [0, 0, 0], amount: 1.85 }],
    slots: { frame: '#6b4424', rail: '#2c2c30', leaf: '#a8442e', brace: '#f1efe9', handle: '#2c2c30' },
    variants: [{ id: 'red', name: 'Barn Red', colors: { leaf: '#a8442e' } }, { id: 'wood', name: 'Natural Wood', colors: { leaf: '#a4744a', brace: '#6b4424' } }, { id: 'black', name: 'Black', colors: { leaf: '#2c2c30', brace: '#8a8f96' } }],
    collision: [[[-1, 0, -0.09], [-0.94, 2, 0.09]], [[0.94, 0, -0.09], [1, 2, 0.09]]],
    tags: ['door', 'barn', 'sliding', 'farm', 'rustic', 'exterior'],
  },

  // ================================================================ special
  {
    id: 'room_label', name: 'Room Label', size: [0.6, 0.3, 0.6], placement: 'floor', interaction: 'label', collision: 'none',
    parts: [B([-0.04, 0, -0.04], [0.04, 0.02, 0.04], 'dot')],
    slots: { dot: '#e0b23d' }, tags: ['label', 'room', 'name', 'sign'],
  },
];

const DEF_MAP = new Map(OBJECT_DEFS.map((d) => [d.id, d]));

export function objectDef(id: string): ObjectDef | undefined {
  return DEF_MAP.get(id);
}

/** Resolve colours for a variant (falls back to the default slots). */
export function objectColors(def: ObjectDef, variant?: string): Record<string, string> {
  const v = def.variants?.find((x) => x.id === variant) ?? def.variants?.[0];
  return { ...def.slots, ...(v?.colors ?? {}) };
}

export function defaultVariant(def: ObjectDef): string {
  return def.variants?.[0]?.id ?? 'default';
}
