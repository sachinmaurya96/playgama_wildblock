import { ARCH_MATERIALS, archIndex, archMaterial, GLASS_VARIANTS } from './architecture';
import { BLOCK_DEFS } from './blocks';
import { ITEM_DEFS } from './items';
import { OBJECT_DEFS, objectDef, type ObjectDef } from './furniture';
import { registerValidator } from './validation';
import type { TreeKind } from './biomes';

/**
 * Build Home catalog: every placeable thing in Build Home mode, with
 * unlimited quantity. Defined once here (never scattered through React
 * components). Blocks carry a list of material variants (the Paint tool and
 * the catalog's swatches use the same list), objects carry colour variants.
 */
export type BuildCategory =
  | 'Structure' | 'Doors & Windows' | 'Kitchen' | 'Living Room' | 'Bedroom' | 'Bathroom' | 'Office' | 'Outdoor'
  | 'Landscaping' | 'Farming' | 'Lighting' | 'Decoration' | 'Utility' | 'Modern Architecture' | 'Tools' | 'Presets';

export const BUILD_CATEGORIES: { id: BuildCategory; icon: string }[] = [
  { id: 'Structure', icon: '🧱' },
  { id: 'Modern Architecture', icon: '🏙️' },
  { id: 'Doors & Windows', icon: '🚪' },
  { id: 'Kitchen', icon: '🍳' },
  { id: 'Living Room', icon: '🛋️' },
  { id: 'Bedroom', icon: '🛏️' },
  { id: 'Bathroom', icon: '🛁' },
  { id: 'Office', icon: '💻' },
  { id: 'Lighting', icon: '💡' },
  { id: 'Decoration', icon: '🖼️' },
  { id: 'Outdoor', icon: '⛱️' },
  { id: 'Landscaping', icon: '🌳' },
  { id: 'Farming', icon: '🌾' },
  { id: 'Utility', icon: '🧺' },
  { id: 'Tools', icon: '🛠️' },
  { id: 'Presets', icon: '🏡' },
];

export type PlacementType = 'block' | 'object' | 'stamp' | 'tool' | 'preset';

export type ToolId =
  | 'place' | 'select' | 'remove' | 'paint' | 'pick' | 'wall' | 'room' | 'floor' | 'foundation' | 'roof' | 'pool'
  | 'stairs' | 'raise' | 'lower' | 'flatten' | 'paint_ground' | 'measure' | 'copy' | 'water' | 'farm';

export type StampKind = TreeKind | 'bush_small' | 'hedge_row';

export interface BuildVariant {
  id: string;
  name: string;
  /** Swatch colour for the UI. */
  swatch: string;
  /** Block meta (material index) or object colour-variant id. */
  meta?: number;
  objectVariant?: string;
}

export interface BuildCatalogItem {
  id: string;
  name: string;
  category: BuildCategory;
  sub: string;
  /** Emoji icon for tools / presets (blocks and objects get rendered icons). */
  icon?: string;
  /** Block key for voxel items. */
  block?: string;
  /** How the item's variants map onto block meta (see data/architecture.ts). */
  metaKind?: 'cube' | 'slab' | 'rotated' | 'panel_h' | 'glass' | 'fixed';
  /** Object model id. */
  object?: string;
  stamp?: StampKind;
  tool?: ToolId;
  preset?: string;
  variants: BuildVariant[];
  defaultVariant?: string;
  tags: string[];
  placementType: PlacementType;
  description?: string;
}

// ---------------------------------------------------------------- material groups

const mats = (keys: string[]): number[] => keys.map((k) => archIndex(k));
const byGroup = (...groups: string[]): number[] => ARCH_MATERIALS.map((m, i) => (groups.includes(m.group) ? i : -1)).filter((i) => i >= 0);

export const WALL_MATERIALS = [...byGroup('paint'), ...byGroup('concrete'), ...byGroup('masonry'), ...byGroup('wood'), ...byGroup('metal'), ...mats(['tile_white', 'marble'])];
export const FLOOR_MATERIALS = [...byGroup('floor'), ...mats(['marble', 'marble_black', 'terrazzo', 'tile_beige', 'tile_dark', 'tile_white', 'pool_tile']), ...byGroup('fabric'), ...mats(['concrete_light', 'concrete_gray', 'concrete_dark', 'stone_cut', 'stone_dark', 'decking', 'decking_gray', 'pavers', 'pavers_dark', 'studio_white'])];
export const ROOF_MATERIALS = [...byGroup('roof'), ...mats(['concrete_gray', 'concrete_dark', 'metal_dark', 'thatch', 'wood_cladding', 'plaster_white'])];
export const STRUCT_MATERIALS = [...mats(['plaster_white', 'concrete_light', 'concrete_gray', 'concrete_dark', 'stone_cut', 'stone_dark', 'sandstone', 'brick_red', 'brick_white']), ...byGroup('floor'), ...mats(['wood_cladding', 'wood_cladding_dark', 'metal_black', 'metal_silver', 'marble', 'paint_charcoal', 'paint_black'])];
export const TRIM_MATERIALS = [...mats(['plaster_white', 'paint_lightgray', 'paint_charcoal', 'paint_black', 'floor_oak', 'floor_walnut', 'floor_light', 'floor_dark', 'metal_black', 'metal_silver', 'marble'])];
export const GROUND_MATERIALS = [...byGroup('ground'), ...mats(['concrete_light', 'concrete_gray', 'stone_cut', 'stone_dark', 'pool_tile'])];
export const RAILING_MATERIALS = mats(['metal_black', 'metal_silver', 'plaster_white', 'floor_oak', 'floor_walnut', 'wood_white']);
export const FENCE_MATERIALS = mats(['wood_white', 'wood_cladding', 'wood_cladding_dark', 'metal_black', 'metal_silver', 'floor_oak', 'paint_sage', 'paint_charcoal']);
export const GARDEN_WALL_MATERIALS = mats(['fieldstone', 'stone_cut', 'stone_dark', 'sandstone', 'brick_red', 'brick_white', 'concrete_gray', 'plaster_white']);

function matVariants(list: number[]): BuildVariant[] {
  return [...new Set(list)].map((i) => ({ id: ARCH_MATERIALS[i].key, name: ARCH_MATERIALS[i].name, swatch: ARCH_MATERIALS[i].tint === '#ffffff' ? fallbackSwatch(ARCH_MATERIALS[i].tile) : ARCH_MATERIALS[i].tint, meta: i }));
}

function fallbackSwatch(tile: string): string {
  switch (tile) {
    case 'brick': return '#b35a42';
    case 'gravel': return '#9a948b';
    case 'planks': return '#b3844f';
    case 'fieldstone': return '#a6a39b';
    case 'thatch': return '#d8b45a';
    default: return '#cccccc';
  }
}

function objVariants(def: ObjectDef): BuildVariant[] {
  if (!def.variants?.length) return [{ id: 'default', name: 'Default', swatch: Object.values(def.slots)[0] ?? '#cccccc', objectVariant: 'default' }];
  return def.variants.map((v) => ({ id: v.id, name: v.name, swatch: Object.values(v.colors)[0] ?? '#cccccc', objectVariant: v.id }));
}

// ---------------------------------------------------------------- builders

const items: BuildCatalogItem[] = [];

function block(id: string, name: string, category: BuildCategory, sub: string, blockKey: string, metaKind: BuildCatalogItem['metaKind'], variants: BuildVariant[], tags: string[], defaultVariant?: string, description?: string) {
  items.push({ id, name, category, sub, block: blockKey, metaKind, variants, tags, placementType: 'block', defaultVariant, description });
}

function obj(id: string, category: BuildCategory, sub: string, extraTags: string[] = [], opts: { name?: string; defaultVariant?: string; catalogId?: string } = {}) {
  const def = objectDef(id);
  if (!def) throw new Error(`catalog: unknown object ${id}`);
  items.push({
    id: opts.catalogId ?? `obj:${id}`, name: opts.name ?? def.name, category, sub, object: id, variants: objVariants(def), defaultVariant: opts.defaultVariant,
    tags: [...def.tags, ...extraTags], placementType: 'object',
  });
}

function tool(tl: ToolId, name: string, icon: string, sub: string, tags: string[], description: string) {
  items.push({ id: `tool:${tl}`, name, category: 'Tools', sub, icon, tool: tl, variants: [], tags: ['tool', ...tags], placementType: 'tool', description });
}

function stamp(kind: StampKind, name: string, sub: string, tags: string[]) {
  items.push({ id: `stamp:${kind}`, name, category: 'Landscaping', sub, stamp: kind, variants: [], tags: ['tree', 'garden', 'landscaping', ...tags], placementType: 'stamp', icon: kind === 'palm' ? '🌴' : kind === 'pine' ? '🌲' : kind === 'bush_small' ? '🌿' : kind === 'orchard' ? '🌸' : '🌳' });
}

// ---------------------------------------------------------------- Structure
block('wall', 'Wall Block', 'Structure', 'Walls', 'arch_block', 'cube', matVariants(WALL_MATERIALS), ['wall', 'block', 'paint', 'plaster', 'brick', 'concrete', 'stone', 'wood', 'exterior', 'interior'], 'plaster_white', 'Solid wall block. Choose any wall material; repaint later with the Paint tool.');
block('floor', 'Floor Block', 'Structure', 'Floors', 'arch_block', 'cube', matVariants(FLOOR_MATERIALS), ['floor', 'flooring', 'wood', 'tile', 'marble', 'carpet', 'concrete'], 'floor_oak');
block('foundation', 'Foundation Block', 'Structure', 'Foundation', 'arch_block', 'cube', matVariants(mats(['concrete_gray', 'concrete_light', 'concrete_dark', 'stone_cut', 'stone_dark', 'fieldstone'])), ['foundation', 'concrete', 'base'], 'concrete_gray');
block('ceiling', 'Ceiling Panel', 'Structure', 'Ceilings', 'arch_panel_h', 'panel_h', matVariants([...byGroup('paint'), ...byGroup('floor'), ...mats(['wood_panel', 'wood_slats', 'concrete_light'])]), ['ceiling', 'panel', 'interior'], 'plaster_white', 'A thin panel that hugs the underside of the block above.');
block('slab', 'Slab', 'Structure', 'Floors', 'arch_slab', 'slab', matVariants(STRUCT_MATERIALS), ['slab', 'half', 'step', 'floor', 'countertop'], 'concrete_light');
block('roof_slope', 'Roof Slope', 'Structure', 'Roofs', 'arch_slope', 'rotated', matVariants(ROOF_MATERIALS), ['roof', 'slope', 'gable', 'pitched'], 'shingles_dark');
block('roof_outer', 'Roof Outer Corner', 'Structure', 'Roofs', 'arch_slope_outer', 'rotated', matVariants(ROOF_MATERIALS), ['roof', 'corner', 'hip'], 'shingles_dark');
block('roof_inner', 'Roof Inner Corner', 'Structure', 'Roofs', 'arch_slope_inner', 'rotated', matVariants(ROOF_MATERIALS), ['roof', 'corner', 'valley'], 'shingles_dark');
block('roof_low1', 'Low Roof Slope (lower half)', 'Structure', 'Roofs', 'arch_slope_low1', 'rotated', matVariants(ROOF_MATERIALS), ['roof', 'slope', 'low pitch', 'shed', 'modern'], 'roof_metal');
block('roof_low2', 'Low Roof Slope (upper half)', 'Structure', 'Roofs', 'arch_slope_low2', 'rotated', matVariants(ROOF_MATERIALS), ['roof', 'slope', 'low pitch', 'shed', 'modern'], 'roof_metal');
block('roof_flat', 'Flat Roof', 'Structure', 'Roofs', 'arch_block', 'cube', matVariants(mats(['concrete_light', 'concrete_gray', 'concrete_dark', 'roof_metal', 'plaster_white', 'shingles_dark'])), ['roof', 'flat', 'modern', 'concrete'], 'concrete_light');
block('roof_overhang', 'Thin Roof Overhang', 'Structure', 'Roofs', 'arch_panel_h', 'panel_h', matVariants([...ROOF_MATERIALS, ...mats(['plaster_white', 'wood_slats', 'metal_black'])]), ['roof', 'overhang', 'eave', 'canopy', 'modern'], 'plaster_white');
block('column', 'Square Column', 'Structure', 'Columns', 'arch_column', 'rotated', matVariants(STRUCT_MATERIALS), ['column', 'pillar', 'post'], 'plaster_white');
block('column_round', 'Round Column', 'Structure', 'Columns', 'arch_column_round', 'rotated', matVariants(STRUCT_MATERIALS), ['column', 'pillar', 'round'], 'stone_cut');
block('beam', 'Beam', 'Structure', 'Beams', 'arch_beam', 'rotated', matVariants(mats(['floor_oak', 'floor_walnut', 'floor_dark', 'floor_light', 'wood_cladding', 'metal_black', 'metal_silver', 'plaster_white', 'concrete_gray'])), ['beam', 'wood', 'steel', 'exposed', 'pergola'], 'floor_walnut', 'Horizontal beam at the top of the block (hold Shift while placing for a low beam).');
block('stairs', 'Stairs', 'Structure', 'Stairs', 'arch_stairs', 'rotated', matVariants(STRUCT_MATERIALS), ['stairs', 'steps', 'staircase'], 'floor_oak');
block('stairs_float', 'Floating Stairs', 'Structure', 'Stairs', 'arch_stairs_float', 'rotated', matVariants(STRUCT_MATERIALS), ['stairs', 'floating', 'modern', 'steps'], 'floor_walnut');
block('railing_glass', 'Glass Railing', 'Structure', 'Railings', 'arch_railing_glass', 'rotated', matVariants(RAILING_MATERIALS), ['railing', 'glass', 'balcony', 'balustrade'], 'metal_black');
block('railing_bars', 'Modern Railing', 'Structure', 'Railings', 'arch_railing_bars', 'rotated', matVariants(RAILING_MATERIALS), ['railing', 'metal', 'balcony', 'balustrade'], 'metal_black');
block('wall_panel', 'Wall Panel', 'Structure', 'Walls', 'arch_panel_v', 'rotated', matVariants(WALL_MATERIALS), ['panel', 'cladding', 'accent', 'wall'], 'wood_slats', 'A thin cladding panel placed against a wall face.');
block('baseboard', 'Baseboard', 'Structure', 'Trim', 'arch_baseboard', 'rotated', matVariants(TRIM_MATERIALS), ['baseboard', 'skirting', 'trim', 'interior'], 'plaster_white');
block('crown', 'Ceiling Trim', 'Structure', 'Trim', 'arch_crown', 'rotated', matVariants(TRIM_MATERIALS), ['crown', 'cornice', 'ceiling trim', 'trim', 'interior'], 'plaster_white');

// ---------------------------------------------------------------- Modern Architecture (curated kit)
block('ma_white_wall', 'White Wall', 'Modern Architecture', 'Walls', 'arch_block', 'cube', matVariants(WALL_MATERIALS), ['modern', 'white', 'wall'], 'plaster_white');
block('ma_concrete_wall', 'Concrete Wall', 'Modern Architecture', 'Walls', 'arch_block', 'cube', matVariants(WALL_MATERIALS), ['modern', 'concrete', 'wall'], 'concrete_light');
block('ma_wood_panel', 'Vertical Wood Panel', 'Modern Architecture', 'Walls', 'arch_block', 'cube', matVariants(WALL_MATERIALS), ['modern', 'wood', 'slats', 'wall'], 'wood_slats');
block('ma_dark_stone', 'Dark Stone', 'Modern Architecture', 'Walls', 'arch_block', 'cube', matVariants(WALL_MATERIALS), ['modern', 'stone', 'dark', 'wall'], 'stone_dark');
block('glass_wall', 'Large Glass Wall', 'Modern Architecture', 'Glass', 'arch_glass', 'glass', GLASS_VARIANTS.map((g, i) => ({ id: g.key, name: g.name, swatch: g.tint, meta: i })), ['glass', 'wall', 'window', 'modern', 'curtain wall'], 'clear');
block('ma_flat_roof', 'Flat Roof', 'Modern Architecture', 'Roof', 'arch_block', 'cube', matVariants(mats(['concrete_light', 'concrete_gray', 'concrete_dark', 'roof_metal', 'plaster_white'])), ['modern', 'roof', 'flat'], 'concrete_light');
block('ma_overhang', 'Thin Roof Overhang', 'Modern Architecture', 'Roof', 'arch_panel_h', 'panel_h', matVariants([...ROOF_MATERIALS, ...mats(['plaster_white', 'wood_slats', 'metal_black'])]), ['modern', 'overhang', 'canopy'], 'plaster_white');
obj('window_tall', 'Modern Architecture', 'Windows', ['modern'], { name: 'Black Frame Window', catalogId: 'ma:window', defaultVariant: 'black' });
obj('glass_panel_2x3', 'Modern Architecture', 'Windows', ['modern'], { name: 'Frameless Glass Panel', catalogId: 'ma:glass_panel' });
block('ma_floating_stair', 'Floating Stair', 'Modern Architecture', 'Stairs', 'arch_stairs_float', 'rotated', matVariants(STRUCT_MATERIALS), ['modern', 'stairs', 'floating'], 'floor_walnut');
block('ma_railing', 'Modern Railing', 'Modern Architecture', 'Stairs', 'arch_railing_glass', 'rotated', matVariants(RAILING_MATERIALS), ['modern', 'railing', 'glass'], 'metal_black');
block('ma_deck', 'Wood Deck', 'Modern Architecture', 'Outdoor', 'arch_block', 'cube', matVariants(GROUND_MATERIALS), ['modern', 'deck', 'wood', 'patio'], 'decking');
block('ma_pergola_beam', 'Pergola Beam', 'Modern Architecture', 'Outdoor', 'arch_beam', 'rotated', matVariants(mats(['metal_black', 'floor_walnut', 'floor_oak', 'plaster_white'])), ['modern', 'pergola', 'beam'], 'metal_black');
obj('exterior_wall_light', 'Modern Architecture', 'Outdoor', ['modern'], { catalogId: 'ma:wall_light' });
obj('planter_box', 'Modern Architecture', 'Outdoor', ['modern'], { catalogId: 'ma:planter' });

// ---------------------------------------------------------------- Doors & Windows
for (const id of ['door_modern', 'door_entrance', 'door_double']) obj(id, 'Doors & Windows', 'Exterior Doors');
for (const id of ['door_interior', 'door_wood']) obj(id, 'Doors & Windows', 'Interior Doors');
obj('door_sliding', 'Doors & Windows', 'Sliding Doors');
obj('door_glass', 'Doors & Windows', 'Glass Doors');
obj('garage_door', 'Doors & Windows', 'Garage Doors');
for (const id of ['window_small', 'window_standard', 'window_double', 'window_wide']) obj(id, 'Doors & Windows', 'Standard Windows');
for (const id of ['window_tall', 'window_tall_wide', 'window_horizontal']) obj(id, 'Doors & Windows', 'Tall Windows');
obj('window_corner', 'Doors & Windows', 'Corner Windows');
obj('skylight', 'Doors & Windows', 'Skylights');
for (const id of ['glass_panel_1x2', 'glass_panel_2x2', 'glass_panel_1x3', 'glass_panel_2x3']) obj(id, 'Doors & Windows', 'Glass Panels');
block('dw_glass_wall', 'Glass Wall Block', 'Doors & Windows', 'Glass Panels', 'arch_glass', 'glass', GLASS_VARIANTS.map((g, i) => ({ id: g.key, name: g.name, swatch: g.tint, meta: i })), ['glass', 'wall', 'window'], 'clear');
obj('curtains', 'Doors & Windows', 'Curtains');

// ---------------------------------------------------------------- Kitchen
for (const id of ['kitchen_base', 'kitchen_drawers', 'kitchen_sink', 'kitchen_corner']) obj(id, 'Kitchen', 'Cabinets & Counters');
for (const id of ['kitchen_upper', 'kitchen_upper_double', 'kitchen_upper_glass', 'kitchen_upper_corner']) obj(id, 'Kitchen', 'Upper Cabinets');
for (const id of ['kitchen_island_2', 'kitchen_island_3', 'kitchen_island_4']) obj(id, 'Kitchen', 'Islands');
for (const id of ['fridge', 'stove', 'wall_oven', 'microwave', 'dishwasher', 'range_hood']) obj(id, 'Kitchen', 'Appliances');
obj('kitchen_shelf', 'Kitchen', 'Shelves');
for (const id of ['table_dining_2', 'table_dining_4', 'table_dining_6', 'table_dining_8', 'dining_chair', 'dining_chair_upholstered', 'bar_stool']) obj(id, 'Kitchen', 'Dining Furniture');

// ---------------------------------------------------------------- Living Room
for (const id of ['sofa_2', 'sofa_3', 'sofa_section', 'sofa_section_corner', 'sofa_section_end']) obj(id, 'Living Room', 'Sofas');
for (const id of ['armchair', 'lounge_chair']) obj(id, 'Living Room', 'Chairs');
for (const id of ['coffee_table', 'coffee_table_round', 'side_table']) obj(id, 'Living Room', 'Coffee Tables');
obj('tv_console', 'Living Room', 'TV Units');
for (const id of ['tv_wall', 'tv_stand']) obj(id, 'Living Room', 'TVs');
for (const id of ['bookshelf', 'wall_shelf']) obj(id, 'Living Room', 'Shelves');
for (const id of ['rug_small', 'rug_medium', 'rug_large', 'rug_runner']) obj(id, 'Living Room', 'Rugs');
for (const id of ['floor_lamp', 'table_lamp']) obj(id, 'Living Room', 'Lamps', [], { catalogId: `living:${id}` });
obj('plant_floor', 'Living Room', 'Plants', [], { catalogId: 'living:plant_floor' });
obj('art_abstract', 'Living Room', 'Artwork', [], { catalogId: 'living:art' });

// ---------------------------------------------------------------- Bedroom
for (const id of ['bed_single', 'bed_double', 'bed_queen', 'bed_platform']) obj(id, 'Bedroom', 'Beds');
obj('nightstand', 'Bedroom', 'Side Tables');
for (const id of ['wardrobe_single', 'wardrobe_double', 'wardrobe_sliding']) obj(id, 'Bedroom', 'Wardrobes');
obj('dresser', 'Bedroom', 'Dressers');
obj('office_desk', 'Bedroom', 'Desks', [], { catalogId: 'bedroom:desk' });
obj('office_chair', 'Bedroom', 'Chairs', [], { catalogId: 'bedroom:chair' });
for (const id of ['mirror_wall', 'mirror_floor']) obj(id, 'Bedroom', 'Mirrors');
obj('table_lamp', 'Bedroom', 'Lamps', [], { catalogId: 'bedroom:lamp' });
obj('rug_medium', 'Bedroom', 'Rugs', [], { catalogId: 'bedroom:rug' });

// ---------------------------------------------------------------- Bathroom
obj('toilet', 'Bathroom', 'Toilet');
obj('bath_sink', 'Bathroom', 'Sink');
for (const id of ['vanity', 'vanity_double']) obj(id, 'Bathroom', 'Vanity');
for (const id of ['shower', 'shower_screen']) obj(id, 'Bathroom', 'Shower');
for (const id of ['bathtub_freestanding', 'bathtub_builtin']) obj(id, 'Bathroom', 'Bathtub');
obj('bath_mirror', 'Bathroom', 'Mirror');
obj('bath_cabinet', 'Bathroom', 'Cabinets');
obj('towel_rack', 'Bathroom', 'Towel Rack');

// ---------------------------------------------------------------- Office
obj('office_desk', 'Office', 'Desk');
obj('office_chair', 'Office', 'Office Chair');
for (const id of ['computer_tower', 'laptop']) obj(id, 'Office', 'Computer');
obj('monitor', 'Office', 'Monitor');
obj('bookshelf', 'Office', 'Bookshelf', [], { catalogId: 'office:bookshelf' });
obj('desk_lamp', 'Office', 'Lamp');
obj('filing_cabinet', 'Office', 'Cabinet');

// ---------------------------------------------------------------- Lighting
obj('ceiling_light', 'Lighting', 'Ceiling Light');
obj('recessed_light', 'Lighting', 'Ceiling Light');
obj('pendant_light', 'Lighting', 'Pendant Light');
obj('chandelier', 'Lighting', 'Pendant Light');
obj('wall_light', 'Lighting', 'Wall Light');
obj('floor_lamp', 'Lighting', 'Floor Lamp');
obj('table_lamp', 'Lighting', 'Table Lamp');
obj('exterior_wall_light', 'Lighting', 'Outdoor Light');
obj('lamp_post', 'Lighting', 'Outdoor Light');
obj('path_light', 'Lighting', 'Path Light');
obj('led_strip', 'Lighting', 'LED Strip');
obj('light_switch', 'Lighting', 'Switches');

// ---------------------------------------------------------------- Decoration
for (const id of ['art_abstract', 'art_landscape', 'art_minimal']) obj(id, 'Decoration', 'Paintings');
obj('photo_frames', 'Decoration', 'Frames');
obj('wall_clock', 'Decoration', 'Clock');
obj('vase', 'Decoration', 'Vases');
obj('books_stack', 'Decoration', 'Books');
obj('plant_small', 'Decoration', 'Plants');
obj('plant_floor', 'Decoration', 'Plants');
obj('curtains', 'Decoration', 'Curtains', [], { catalogId: 'deco:curtains' });
obj('cushions', 'Decoration', 'Cushions');
obj('sculpture', 'Decoration', 'Sculptures');
obj('wall_shelf', 'Decoration', 'Shelves', [], { catalogId: 'deco:shelf' });
obj('room_label', 'Decoration', 'Room Labels', ['kitchen', 'bedroom', 'office']);

// ---------------------------------------------------------------- Outdoor
block('patio', 'Patio Paving', 'Outdoor', 'Patio', 'arch_block', 'cube', matVariants(GROUND_MATERIALS), ['patio', 'paving', 'pavers', 'outdoor'], 'pavers');
block('deck', 'Deck', 'Outdoor', 'Deck', 'arch_block', 'cube', matVariants(GROUND_MATERIALS), ['deck', 'decking', 'wood', 'outdoor'], 'decking');
block('fence_modern', 'Fence', 'Outdoor', 'Fence', 'arch_fence', 'cube', matVariants(FENCE_MATERIALS), ['fence', 'garden', 'boundary', 'wood', 'metal', 'white'], 'wood_white');
block('fence_glass', 'Glass Fence', 'Outdoor', 'Fence', 'arch_fence_glass', 'cube', matVariants(RAILING_MATERIALS), ['fence', 'glass', 'pool fence'], 'metal_black');
block('fence_picket', 'Picket Fence', 'Outdoor', 'Fence', 'fence', 'fixed', [{ id: 'default', name: 'Wood', swatch: '#b3844f', meta: 0 }], ['fence', 'picket', 'wood', 'cottage']);
block('garden_wall', 'Stone Garden Wall', 'Outdoor', 'Fence', 'arch_wall_low', 'cube', matVariants(GARDEN_WALL_MATERIALS), ['wall', 'stone', 'garden', 'boundary'], 'fieldstone');
obj('garden_gate', 'Outdoor', 'Gate');
obj('bench', 'Outdoor', 'Bench');
obj('outdoor_table', 'Outdoor', 'Outdoor Table');
obj('outdoor_chair', 'Outdoor', 'Outdoor Chairs');
obj('outdoor_sofa', 'Outdoor', 'Outdoor Chairs');
obj('pergola', 'Outdoor', 'Pergola');
tool('pool', 'Pool Builder', '🏊', 'Pool', ['pool', 'swimming', 'water'], 'Drag a rectangle on the ground: digs, tiles and fills a swimming pool.');
obj('pool_ladder', 'Outdoor', 'Pool');
obj('pool_light', 'Outdoor', 'Pool');
obj('lounge_bed', 'Outdoor', 'Pool');
obj('umbrella', 'Outdoor', 'Pool');
obj('planter_box', 'Outdoor', 'Planters');
obj('bbq_grill', 'Outdoor', 'BBQ');
obj('exterior_wall_light', 'Outdoor', 'Outdoor Lights', [], { catalogId: 'outdoor:wall_light' });
obj('lamp_post', 'Outdoor', 'Outdoor Lights', [], { catalogId: 'outdoor:lamp_post' });
obj('path_light', 'Outdoor', 'Outdoor Lights', [], { catalogId: 'outdoor:path_light' });
obj('fountain', 'Outdoor', 'Water Features');

// ---------------------------------------------------------------- Landscaping
const natural = (key: string, name: string, sub: string, tags: string[], swatch: string) =>
  block(`land:${key}`, name, 'Landscaping', sub, key, 'fixed', [{ id: 'default', name, swatch, meta: 0 }], ['landscaping', 'ground', ...tags]);
natural('grass', 'Grass', 'Ground', ['grass', 'lawn', 'turf'], '#7fb24c');
natural('dirt', 'Soil', 'Ground', ['dirt', 'soil', 'earth'], '#7a5a3a');
natural('sand', 'Sand', 'Ground', ['sand', 'beach'], '#e3cf98');
natural('gravel', 'Gravel', 'Ground', ['gravel', 'path', 'driveway'], '#9a948b');
natural('stone', 'Stone', 'Ground', ['stone', 'rock'], '#9b9a94');
natural('water', 'Water', 'Water', ['water', 'pond', 'pool', 'stream'], '#4f95c6');
block('land:path', 'Path Pavers', 'Landscaping', 'Path', 'arch_block', 'cube', matVariants(GROUND_MATERIALS), ['path', 'pavers', 'walkway', 'driveway'], 'pavers');
natural('hedge', 'Hedge', 'Hedges', ['hedge', 'boundary', 'bush'], '#4f7f3a');
natural('hedge_low', 'Low Hedge', 'Hedges', ['hedge', 'low', 'border', 'small'], '#5f8f45');
for (const [k, n] of [['flower_sun', 'Sunpetal Flowers'], ['flower_sky', 'Skybell Flowers'], ['flower_ember', 'Emberbloom Flowers']] as const) natural(k, n, 'Flowers', ['flower', 'garden'], '#f2c94c');
natural('tall_grass', 'Tall Grass', 'Flowers', ['grass', 'meadow'], '#8ab45a');
obj('flower_bed', 'Landscaping', 'Flowers');
stamp('broadleaf', 'Small Deciduous Tree', 'Trees', ['deciduous', 'small', 'oak']);
stamp('jungle', 'Large Deciduous Tree', 'Trees', ['deciduous', 'large', 'shade']);
stamp('pine', 'Pine Tree', 'Trees', ['pine', 'conifer', 'evergreen']);
stamp('palm', 'Palm Tree', 'Trees', ['palm', 'tropical', 'beach']);
stamp('birch', 'Ornamental Tree', 'Trees', ['ornamental', 'birch', 'slim']);
stamp('orchard', 'Flowering Tree', 'Trees', ['flowering', 'blossom', 'fruit']);
stamp('bush_small', 'Leafy Bush', 'Bushes', ['bush', 'shrub']);
obj('bush_round', 'Landscaping', 'Bushes');
obj('decorative_rocks', 'Landscaping', 'Decorative Rocks');
tool('water', 'Pond / Stream Tool', '💧', 'Water', ['pond', 'stream', 'water', 'landscaping'], 'Drag a rectangle to dig a shallow natural pond or stream bed filled with water.');

// ---------------------------------------------------------------- Farming
/** Crops in Build Home: pick a growth stage, or "Growing 🌱" to plant a seedling that grows (and can be harvested) live. */
export const FARM_CROPS: { key: string; name: string; swatch: string; icon: string }[] = [
  { key: 'crop_wheat', name: 'Sunwheat', swatch: '#e6c35a', icon: '🌾' },
  { key: 'crop_corn', name: 'Skycorn', swatch: '#f2cf4a', icon: '🌽' },
  { key: 'crop_tomato', name: 'Blushberry', swatch: '#e0453a', icon: '🍅' },
  { key: 'crop_root', name: 'Emberroot', swatch: '#d8493a', icon: '🥕' },
  { key: 'crop_gourd', name: 'Puffgourd', swatch: '#f0983b', icon: '🎃' },
  { key: 'crop_mint', name: 'Brookmint', swatch: '#5fcf8a', icon: '🌿' },
];
/** Block meta bit marking a Build Home crop that grows live (stage lives in bits 3-5). */
export const LIVE_CROP_BIT = 1;
const cropStages = (swatch: string): BuildVariant[] => [
  { id: 'live', name: 'Growing 🌱 (grows live)', swatch: '#7fd36a', meta: LIVE_CROP_BIT },
  { id: 'seedling', name: 'Seedling', swatch: '#9cc46a', meta: 0 },
  { id: 'young', name: 'Young', swatch: '#7fb04f', meta: 1 << 3 },
  { id: 'growing', name: 'Growing', swatch: '#5f9a3a', meta: 2 << 3 },
  { id: 'ripe', name: 'Ripe', swatch, meta: 3 << 3 },
];
items.push({
  id: 'farm:plot', name: 'Farm Plot Tool', category: 'Farming', sub: 'Fields', icon: '🚜', tool: 'farm', variants: [], placementType: 'tool',
  tags: ['farm', 'field', 'plot', 'crops', 'tool', 'rows', 'irrigation'],
  description: 'Click two corners: tills the soil, plants neat crop rows, adds water channels and an optional fence — one undo step.',
});
for (const c of FARM_CROPS) {
  block(`farm:${c.key}`, c.name, 'Farming', 'Crops', c.key, 'fixed', cropStages(c.swatch), ['crop', 'farm', 'vegetable', 'harvest', c.name.toLowerCase()], 'live', `${c.icon} Plant on soil. "Growing" seedlings grow on their own — tap / click them when ripe to harvest.`);
}
block('farm:tilled', 'Tilled Soil', 'Farming', 'Soil', 'tilled', 'fixed', [{ id: 'default', name: 'Tilled Soil', swatch: '#6b4a2e', meta: 0 }], ['soil', 'tilled', 'farm', 'field', 'dirt']);
block('farm:tilled_moist', 'Watered Soil', 'Farming', 'Soil', 'tilled_moist', 'fixed', [{ id: 'default', name: 'Watered Soil', swatch: '#4a321e', meta: 0 }], ['soil', 'watered', 'moist', 'farm', 'field']);
block('farm:water', 'Irrigation Water', 'Farming', 'Soil', 'water', 'fixed', [{ id: 'default', name: 'Water', swatch: '#4f95c6', meta: 0 }], ['water', 'irrigation', 'channel', 'farm']);
block('farm:berry_bush', 'Berry Bush', 'Farming', 'Orchard', 'berry_bush', 'fixed', [{ id: 'ripe', name: 'With berries', swatch: '#9b3c6b', meta: 1 << 3 }, { id: 'bare', name: 'Picked', swatch: '#5f8f45', meta: 0 }], ['berries', 'bush', 'fruit', 'farm', 'orchard']);
block('farm:hay_bale', 'Hay Bale', 'Farming', 'Barn', 'hay_bale', 'fixed', [{ id: 'default', name: 'Hay Bale', swatch: '#e6c35a', meta: 0 }], ['hay', 'straw', 'bale', 'barn', 'farm']);
block('farm:fence', 'Picket Fence', 'Farming', 'Fences', 'fence', 'fixed', [{ id: 'default', name: 'Wood', swatch: '#b3844f', meta: 0 }], ['fence', 'picket', 'farm', 'field', 'pen']);
obj('garden_gate', 'Farming', 'Fences', ['farm'], { catalogId: 'farm:gate' });
for (const id of ['scarecrow', 'water_trough', 'wheelbarrow', 'beehive', 'compost_bin', 'produce_crate', 'chicken_coop', 'farm_stand']) obj(id, 'Farming', 'Farm Props');
obj('barn_door', 'Farming', 'Barn');
obj('barn_door', 'Doors & Windows', 'Sliding Doors', [], { catalogId: 'dw:barn_door' });
stamp('orchard', 'Fruit Tree', 'Orchard', ['fruit', 'apple', 'orchard', 'farm']);
items[items.length - 1] = { ...items[items.length - 1], id: 'farm:fruit_tree', category: 'Farming' };
items.push({ id: 'farm:preset_farmstead', name: 'Little Farmstead', category: 'Farming', sub: 'Templates', icon: '🏡', preset: 'farmstead', variants: [], tags: ['preset', 'template', 'farm', 'barn', 'field'], placementType: 'preset', description: 'A red barn with hay, a fenced field of growing crops, irrigation, a scarecrow and a farm stand.' });

// ---------------------------------------------------------------- Utility
for (const id of ['washer', 'dryer', 'water_heater', 'storage_shelf', 'utility_sink', 'electrical_panel']) obj(id, 'Utility', 'Laundry & Utility');
for (const id of ['tool_cabinet', 'garage_workbench', 'bicycle', 'car']) obj(id, 'Utility', 'Garage');
block('util_concrete_floor', 'Garage Concrete Floor', 'Utility', 'Garage', 'arch_block', 'cube', matVariants(FLOOR_MATERIALS), ['garage', 'concrete', 'floor'], 'concrete_gray');

// ---------------------------------------------------------------- Tools
tool('select', 'Select & Move', '👆', 'Edit', ['select', 'move', 'rotate', 'duplicate'], 'Click an object to select it, then move, rotate, recolour, duplicate or delete it.');
tool('remove', 'Remove', '🧹', 'Edit', ['delete', 'remove', 'demolish', 'erase'], 'One click removes a block or object. Hold to keep removing.');
tool('paint', 'Paint', '🖌️', 'Edit', ['paint', 'colour', 'color', 'material'], 'Repaint a block or object with the selected material or colour without replacing it.');
tool('pick', 'Pick Material', '💉', 'Edit', ['eyedropper', 'pick', 'copy material'], 'Aim at anything and pick its exact material or colour (also P or middle mouse).');
tool('wall', 'Wall Tool', '🧱', 'Build', ['wall', 'line'], 'Click a start and an end point to raise a whole wall (1–4 blocks high).');
tool('room', 'Room Tool', '🏠', 'Build', ['room', 'rectangle', 'box'], 'Click two corners: builds a floor and four walls (optional ceiling).');
tool('floor', 'Floor Fill', '⬛', 'Build', ['floor', 'fill', 'rectangle'], 'Click two corners to fill a rectangle of floor.');
tool('foundation', 'Foundation', '🧊', 'Build', ['foundation', 'slab', 'base'], 'Click two corners to pour a foundation slab (flat or raised).');
tool('roof', 'Roof Builder', '🏠', 'Build', ['roof', 'gable', 'hip', 'shed', 'flat'], 'Select a building footprint and generate a flat, gable, shed or hip roof.');
tool('stairs', 'Staircase Tool', '🪜', 'Build', ['stairs', 'staircase'], 'Click the bottom step, then the top: builds a straight staircase (1–3 wide).');
tool('raise', 'Raise Terrain', '⛰️', 'Landscape', ['terrain', 'raise', 'hill'], 'Raise the ground under the brush.');
tool('lower', 'Lower Terrain', '🕳️', 'Landscape', ['terrain', 'lower', 'dig'], 'Lower the ground under the brush.');
tool('flatten', 'Flatten Terrain', '➖', 'Landscape', ['terrain', 'flatten', 'level'], 'Level the ground to the height where you start.');
tool('paint_ground', 'Paint Ground', '🌱', 'Landscape', ['ground', 'paint', 'grass', 'sand', 'gravel', 'pavers'], 'Change the ground surface (grass, soil, sand, gravel, stone, pavers).');
tool('measure', 'Measure', '📏', 'Plan', ['measure', 'distance', 'ruler'], 'Click two points to measure the distance (1 block = 1 m).');
tool('copy', 'Copy / Blueprint', '📋', 'Plan', ['copy', 'paste', 'blueprint', 'duplicate', 'region'], 'Select a region to copy, paste elsewhere or save as a reusable blueprint.');
tool('farm', 'Farm Plot', '🚜', 'Build', ['farm', 'field', 'crops', 'plot', 'garden'], 'Click two corners: tilled soil, crop rows, water channels and an optional fence in one go.');

// ---------------------------------------------------------------- Presets
for (const [id, name, desc] of [
  ['starter_cabin', 'Starter Modern Cabin', 'A small one-room cabin with a shed roof and big windows.'],
  ['one_story', 'Modern One-Story Home', 'Open living/kitchen, two bedrooms, bathroom and a patio.'],
  ['two_story', 'Two-Story Family Home', 'Kitchen & living downstairs, bedrooms, office and balcony upstairs.'],
  ['glass_house', 'Lakeside Glass House', 'Open-plan glass pavilion with a deck and flat roof.'],
  ['farmstead', 'Little Farmstead', 'A red barn with hay, a fenced field of growing crops, irrigation, a scarecrow and a farm stand.'],
  ['cozy_cottage', 'Cozy Cottage', 'A cream cottage with a terracotta roof, brick chimney, reading nook and a fenced flower garden.'],
  ['beach_house', 'Beach House on Stilts', 'Raised on white stilts above the sand, with a wrap-around deck, glass railings and beach loungers.'],
  ['pool_villa', 'Modern Villa with Pool', 'Concrete L-shaped villa with a garage, open living, a bedroom wing and a raised pool terrace.'],
  ['aframe_chalet', 'Mountain A-Frame Chalet', 'A steep A-frame cabin in dark wood with a stone chimney and a front deck.'],
  ['tiny_house', 'Tiny Modern House', 'Everything you need in 7 × 5: bed, kitchen, sofa and a little deck.'],
] as const) {
  items.push({ id: `preset:${id}`, name, category: 'Presets', sub: 'House Templates', icon: '🏡', preset: id, variants: [], tags: ['preset', 'template', 'house', 'starter'], placementType: 'preset', description: desc });
}

export const BUILD_CATALOG: BuildCatalogItem[] = items;

const CAT_MAP = new Map(items.map((i) => [i.id, i]));

export function catalogItem(id: string): BuildCatalogItem | undefined {
  return CAT_MAP.get(id);
}

export function variantOf(item: BuildCatalogItem, id?: string): BuildVariant | undefined {
  return item.variants.find((v) => v.id === id) ?? item.variants.find((v) => v.id === item.defaultVariant) ?? item.variants[0];
}

export function catalogSearchText(i: BuildCatalogItem): string {
  return [i.name, i.category, i.sub, ...i.tags, ...i.variants.map((v) => v.name)].join(' ').toLowerCase();
}

/** Theme palettes: they don't build anything, they suggest matching materials and furniture colours. */
export const THEMES: { id: string; name: string; description: string; tags: string[] }[] = [
  { id: 'warm-minimal', name: 'Warm Minimal', description: 'White walls, oak floors, cream fabrics.', tags: ['warm-minimal', 'white', 'oak', 'cream', 'warm'] },
  { id: 'modern-dark', name: 'Modern Dark', description: 'Gray concrete, black frames, walnut.', tags: ['modern-dark', 'concrete', 'black', 'walnut', 'charcoal', 'dark'] },
  { id: 'scandinavian', name: 'Scandinavian', description: 'White, light wood and sage.', tags: ['scandinavian', 'white', 'light', 'sage'] },
  { id: 'tropical', name: 'Tropical Modern', description: 'White, wood, stone and lots of greenery.', tags: ['tropical', 'white', 'wood', 'stone', 'plant', 'teak'] },
];

/** Does an item / variant fit a theme? (used for the "Suggested" view) */
export function matchesTheme(item: BuildCatalogItem, theme: string): boolean {
  const t = THEMES.find((x) => x.id === theme);
  if (!t) return false;
  const text = catalogSearchText(item);
  if (item.variants.some((v) => v.meta !== undefined && item.metaKind !== 'glass' && item.metaKind !== 'fixed' && archMaterial(v.meta).tags.includes(theme))) return true;
  return t.tags.some((tag) => text.includes(tag));
}

// ---------------------------------------------------------------- validation hook

registerValidator('build-catalog', (rep) => {
  const err = (m: string) => rep.errors.push(m);
  const ids = new Set<string>();
  const blockKeys = new Set(BLOCK_DEFS.map((b) => b.key));
  for (const i of items) {
    if (ids.has(i.id)) err(`catalog ${i.id}: duplicate id`);
    ids.add(i.id);
    if (!i.name) err(`catalog ${i.id}: missing display name`);
    if (i.placementType === 'block') {
      if (!i.block || !blockKeys.has(i.block)) err(`catalog ${i.id}: unknown block ${i.block}`);
      if (!i.variants.length) err(`catalog ${i.id}: block item without variants`);
      const def = BLOCK_DEFS.find((b) => b.key === i.block);
      for (const v of i.variants) {
        if (v.meta === undefined) err(`catalog ${i.id}: variant ${v.id} has no meta`);
        else if (i.metaKind === 'glass' ? v.meta >= GLASS_VARIANTS.length : i.metaKind !== 'fixed' && v.meta >= ARCH_MATERIALS.length) err(`catalog ${i.id}: variant ${v.id} meta out of range`);
        if (def?.arch?.kind === 'rotated' && (v.meta ?? 0) > 63) err(`catalog ${i.id}: material ${v.id} does not fit a rotated shape`);
        if (def?.arch?.kind === 'slab' && (v.meta ?? 0) > 63) err(`catalog ${i.id}: material ${v.id} does not fit a slab`);
      }
      if (i.metaKind !== 'fixed' && !def?.arch) err(`catalog ${i.id}: variant materials on a non-architecture block`);
    }
    if (i.placementType === 'object') {
      const d = i.object ? objectDef(i.object) : undefined;
      if (!d) err(`catalog ${i.id}: unknown object model ${i.object}`);
      else for (const v of i.variants) if (d.variants && !d.variants.some((x) => x.id === v.objectVariant)) err(`catalog ${i.id}: variant ${v.id} missing on model`);
    }
    if (i.placementType === 'tool' && !i.tool) err(`catalog ${i.id}: tool item without tool id`);
    if (i.defaultVariant && !i.variants.some((v) => v.id === i.defaultVariant)) err(`catalog ${i.id}: default variant ${i.defaultVariant} not in its variants`);
    if (!i.tags.length) err(`catalog ${i.id}: no search tags`);
  }
  // required categories exist and are populated
  for (const c of BUILD_CATEGORIES) if (!items.some((i) => i.category === c.id)) err(`catalog category ${c.id} is empty`);
  rep.stats.catalog = items.length;

  // object models
  const objIds = new Set<string>();
  const hex = /^#[0-9a-f]{6}$/i;
  for (const d of OBJECT_DEFS) {
    if (objIds.has(d.id)) err(`object ${d.id}: duplicate id`);
    objIds.add(d.id);
    if (!d.parts.length) err(`object ${d.id}: no geometry`);
    if (d.size.some((v) => !(v > 0))) err(`object ${d.id}: size must be positive`);
    for (const p of d.parts) {
      const color = p.slot.startsWith('#') ? p.slot : d.slots[p.slot];
      if (!color) err(`object ${d.id}: part uses undefined colour slot "${p.slot}"`);
      else if (!hex.test(color)) err(`object ${d.id}: slot ${p.slot} colour ${color} is not #rrggbb`);
      if (p.anim && !d.anims?.some((a) => a.name === p.anim)) err(`object ${d.id}: part references missing animation ${p.anim}`);
      for (let k = 0; k < 3; k++) if (p.b[k] < p.a[k]) err(`object ${d.id}: inverted part bounds`);
    }
    for (const v of d.variants ?? []) for (const [slot, c] of Object.entries(v.colors)) {
      if (!(slot in d.slots)) err(`object ${d.id}: variant ${v.id} colours unknown slot ${slot}`);
      if (!hex.test(c)) err(`object ${d.id}: variant ${v.id} colour ${c} is not #rrggbb`);
    }
    if ((d.placement === 'opening' || d.placement === 'skylight') && !d.opening) err(`object ${d.id}: opening without opening size`);
    if (d.light && !(d.light.range > 0)) err(`object ${d.id}: light range must be > 0`);
    let tris = 0;
    for (const p of d.parts) tris += p.kind === 'box' ? 12 : p.kind === 'cyl' ? (p.seg ?? 14) * 4 : 160;
    if (tris > 4000) err(`object ${d.id}: ${tris} triangles exceeds the prop budget`);
  }
  rep.stats.objects = OBJECT_DEFS.length;
  // blocks shown in Build Home or survival: every block with a build category must be placeable somewhere
  for (const b of BLOCK_DEFS) {
    if (!b.category) continue;
    const inCatalog = items.some((i) => i.block === b.key);
    const hasItemDef = ITEM_DEFS.some((it) => it.placeBlock === b.key && rep.obtainable.has(it.key));
    if (!inCatalog && !hasItemDef && b.key !== 'door_upper') rep.warnings.push(`block ${b.key}: has a build category but is neither in the catalog nor a survival item`);
  }
});
