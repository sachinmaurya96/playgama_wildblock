import { OBJECT_DEFS, objectDef } from './furniture';
import { registerValidator } from './validation';
/**
 * Optional Build Home design challenges: a short brief plus a checklist that
 * is measured from what is actually placed (objects by tag / id, and a few
 * block counts). Purely for fun — nothing is locked behind them.
 */
export interface ChallengeGoal {
  label: string;
  /** Count objects whose model id is in this list… */
  items?: string[];
  /** …or whose tags include this tag. */
  tag?: string;
  /** Count water blocks inside the lot (pools / ponds). */
  water?: boolean;
  count: number;
}

export interface Challenge {
  id: string;
  title: string;
  brief: string;
  goals: ChallengeGoal[];
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'starter', title: 'Cozy Starter Home', brief: 'A compact home for one: somewhere to sleep, cook and relax.',
    goals: [
      { label: 'A bed', tag: 'bed', count: 1 },
      { label: 'A kitchen sink', items: ['kitchen_sink'], count: 1 },
      { label: 'A stove', items: ['stove'], count: 1 },
      { label: 'A sofa or armchair', items: ['sofa_2', 'sofa_3', 'armchair', 'lounge_chair', 'sofa_section', 'sofa_section_corner', 'sofa_section_end'], count: 1 },
      { label: 'A front door', tag: 'door', count: 1 },
      { label: '3 windows', tag: 'window', count: 3 },
    ],
  },
  {
    id: 'family', title: 'Family House', brief: 'Room for a family of four with a proper dining table and two bathrooms.',
    goals: [
      { label: '3 beds', tag: 'bed', count: 3 },
      { label: 'A dining table for 4+', items: ['table_dining_4', 'table_dining_6', 'table_dining_8'], count: 1 },
      { label: '4 dining chairs', items: ['dining_chair', 'dining_chair_upholstered'], count: 4 },
      { label: '2 toilets', items: ['toilet'], count: 2 },
      { label: 'A shower or bathtub', items: ['shower', 'bathtub_freestanding', 'bathtub_builtin'], count: 1 },
      { label: '6 windows', tag: 'window', count: 6 },
      { label: '4 room labels', items: ['room_label'], count: 4 },
    ],
  },
  {
    id: 'pool', title: 'Summer Pool House', brief: 'An outdoor living space built around a swimming pool.',
    goals: [
      { label: 'A pool (20+ water blocks)', water: true, count: 20 },
      { label: '2 sun loungers', items: ['lounge_bed'], count: 2 },
      { label: 'A parasol', items: ['umbrella'], count: 1 },
      { label: 'An outdoor table', items: ['outdoor_table'], count: 1 },
      { label: 'A barbecue', items: ['bbq_grill'], count: 1 },
      { label: '4 outdoor lights', items: ['lamp_post', 'path_light', 'exterior_wall_light', 'pool_light'], count: 4 },
    ],
  },
  {
    id: 'glass', title: 'Glass Pavilion', brief: 'A light-filled modern pavilion: more glass than wall.',
    goals: [
      { label: '6 large windows or glass panels', items: ['window_tall', 'window_tall_wide', 'window_wide', 'glass_panel_2x2', 'glass_panel_2x3', 'glass_panel_1x3', 'window_corner'], count: 6 },
      { label: 'A sliding or glass door', items: ['door_sliding', 'door_glass'], count: 1 },
      { label: 'A lounge area (sofa + coffee table)', items: ['coffee_table', 'coffee_table_round'], count: 1 },
      { label: '4 indoor plants', tag: 'plant', count: 4 },
      { label: '5 lights', tag: 'light', count: 5 },
    ],
  },
  {
    id: 'office', title: 'Home Office Makeover', brief: 'A calm place to work from home.',
    goals: [
      { label: 'A desk', items: ['office_desk'], count: 1 },
      { label: 'An office chair', items: ['office_chair'], count: 1 },
      { label: 'A computer or laptop', items: ['computer_tower', 'laptop', 'monitor'], count: 1 },
      { label: 'A bookshelf', items: ['bookshelf'], count: 1 },
      { label: 'A desk lamp', items: ['desk_lamp'], count: 1 },
      { label: 'A plant', tag: 'plant', count: 1 },
    ],
  },
];

export function challengeById(id: string | null | undefined): Challenge | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

registerValidator('build-challenges', (rep) => {
  for (const c of CHALLENGES)
    for (const g of c.goals) {
      for (const id of g.items ?? []) if (!objectDef(id)) rep.errors.push(`challenge ${c.id}: unknown object ${id}`);
      if (g.tag && !OBJECT_DEFS.some((d) => d.tags.includes(g.tag!) || (g.tag === 'light' && d.light))) rep.errors.push(`challenge ${c.id}: no object has tag ${g.tag}`);
      if (!g.items && !g.tag && !g.water) rep.errors.push(`challenge ${c.id}: goal "${g.label}" measures nothing`);
    }
});
