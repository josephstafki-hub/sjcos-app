// Plan §7.4–§7.11 templates, add-ons, derived quantities and the versioned scope-label registry.
import type { TemplateDef } from '../../form-types.ts';
import { ne, answered, any, eq, gt, isIn, tpl } from './helpers.ts';
import { CLOSING_JOE, OPENING_JOE } from './scripts.ts';
import { EXTERIOR_SYSTEMS } from './template-modules.ts';

const opening = OPENING_JOE.map((l) => l.text);
const closing = CLOSING_JOE.map((l) => l.text);
type Mod = TemplateDef['modules'][number];
const R = (module: string, extra: Partial<Mod> = {}): Mod => ({ module, required: true, ...extra });
const O = (module: string, extra: Partial<Mod> = {}): Mod => ({ module, required: false, ...extra });
const C = (module: string, required: Mod['required'], extra: Partial<Mod> = {}): Mod => ({ module, required, ...extra });
const m = (scope_key: string, quantity_label: string) => ({ scope_key, quantity_label, kind: 'measurement' as const });

// ───────── Versioned scope-label / mapping registry (§10.5: new labels only by explicit entry) ─────────
export const SCOPE_LABEL_REGISTRY_VERSION = 1;
export interface ScopeLabelEntry { scope_key: string; quantity_label: string | null; unit: 'sf' | 'lf' | 'ea' | null; origin: 'scope_rules' | 'consult_registry_v1' }
export const scopeLabelRegistry: ScopeLabelEntry[] = [
  { scope_key: 'kitchen.demo', quantity_label: 'Room floor area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'kitchen.cabinetry', quantity_label: 'Cabinet run', unit: 'lf', origin: 'scope_rules' },
  { scope_key: 'kitchen.countertops', quantity_label: 'Countertop area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'kitchen.backsplash', quantity_label: 'Backsplash area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'kitchen.flooring', quantity_label: 'Floor area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'kitchen.appliances', quantity_label: null, unit: null, origin: 'scope_rules' },
  { scope_key: 'bath.tile', quantity_label: 'Floor tile area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'bath.tile', quantity_label: 'Wall tile area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'deck.footings', quantity_label: 'Footing count', unit: 'ea', origin: 'scope_rules' },
  { scope_key: 'deck.framing', quantity_label: 'Deck area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'deck.decking', quantity_label: 'Deck area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'deck.railing', quantity_label: 'Railing length', unit: 'lf', origin: 'scope_rules' },
  { scope_key: 'deck.permit', quantity_label: null, unit: null, origin: 'scope_rules' },
  { scope_key: 'addition.foundation', quantity_label: 'Footprint', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'addition.framing', quantity_label: 'Footprint', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'addition.roofing', quantity_label: 'Roof area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'addition.siding', quantity_label: 'Wall area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'addition.drywall', quantity_label: 'Wall + ceiling area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'addition.windows_doors', quantity_label: 'Window count', unit: 'ea', origin: 'scope_rules' },
  { scope_key: 'basement.egress', quantity_label: null, unit: null, origin: 'scope_rules' },
  { scope_key: 'basement.flooring', quantity_label: 'Floor area', unit: 'sf', origin: 'consult_registry_v1' },
  { scope_key: 'basement.framing', quantity_label: 'Wall framing', unit: 'lf', origin: 'consult_registry_v1' },
  { scope_key: 'basement.drywall', quantity_label: 'Drywall area', unit: 'sf', origin: 'consult_registry_v1' },
  { scope_key: 'garage.slab', quantity_label: 'Slab area', unit: 'sf', origin: 'consult_registry_v1' },
  { scope_key: 'garage.overhead_door', quantity_label: 'Overhead door count', unit: 'ea', origin: 'consult_registry_v1' },
  { scope_key: 'windows.replace', quantity_label: 'Window count', unit: 'ea', origin: 'scope_rules' },
  { scope_key: 'doors.interior', quantity_label: 'Door count', unit: 'ea', origin: 'scope_rules' },
  { scope_key: 'flooring.install', quantity_label: 'Floor area', unit: 'sf', origin: 'scope_rules' },
  { scope_key: 'general.permits', quantity_label: null, unit: null, origin: 'scope_rules' },
];
/** `FormRegistry.mappings` shape for validate.ts. */
export const scopeMappings: Record<string, string[]> = scopeLabelRegistry.reduce<Record<string, string[]>>((acc, e) => {
  (acc[e.scope_key] ??= []);
  if (e.quantity_label) acc[e.scope_key].push(e.quantity_label);
  return acc;
}, {});

/** What each number feeds (template/add-on derived quantities and field-level mappings). */
export interface QuantityFeed { scope_key: string; quantity_label: string; unit: 'sf' | 'lf' | 'ea'; from: string; formula: string; counts_when?: string }
export const fieldQuantityFeeds: QuantityFeed[] = [
  { scope_key: 'windows.replace', quantity_label: 'Window count', unit: 'ea', from: 'window.plan', formula: '1 per window instance', counts_when: 'plan = Replace' },
  { scope_key: 'doors.interior', quantity_label: 'Door count', unit: 'ea', from: 'door.plan', formula: '1 per door instance', counts_when: 'type is interior (Interior passage, Bifold, Pocket, Barn, French) and plan ∈ {Replace, New}' },
];

// ───────── Selections lists (one `selections` instance per decision) ─────────
export const selectionDecisions = {
  bath: ['Vanity', 'Vanity top', 'Sink', 'Faucets', 'Toilet', 'Shower valve/trim', 'Floor tile', 'Wall/shower tile', 'Grout color', 'Shower glass', 'Mirror/medicine cabinet', 'Light fixtures', 'Fan', 'Paint colors', 'Hardware/accessories'],
  kitchen: ['Cabinet line/door style', 'Cabinet finish', 'Hardware', 'Countertop material', 'Edge profile', 'Backsplash tile', 'Grout color', 'Sink', 'Faucet', 'Disposal', 'Appliance package (each appliance)', 'Hood', 'Flooring material', 'Light fixtures', 'Paint colors'],
  addition: ['Window line', 'Exterior door', 'Siding product/color', 'Shingle/roofing product', 'Flooring material', 'Trim profile', 'Paint colors', 'Light fixtures'],
  basement: ['Flooring material', 'Ceiling treatment', 'Interior door style', 'Trim profile', 'Paint colors', 'Light fixtures'],
  deck: ['Decking material/color', 'Railing style', 'Stair style', 'Skirting', 'Lighting'],
} as const;
export const selectionRules = {
  basement: 'Flooring material, Ceiling treatment, Interior door style, Trim profile, Paint colors, Light fixtures; + bath list if a bath (basement_scope.rooms_wanted includes Bath)',
  whole: 'union of nested lists (the area templates on the visit)',
  general: 'free-form list the visitor adds',
  openings: 'Grids/color → selections',
} as const;

const hvacFans = C('hvac_exhaust_fan', gt('hvac.other_exhaust_fan_count', 0), { label: 'one row per other exhaust fan (when hood > 300 cfm)' });
const hvacVents = (required: Mod['required']) => C('hvac_vent', required === false ? false : ne('hvac.fuel_appliances', false), { min: 1, label: 'one row per fuel-burning appliance' });

export const bath: TemplateDef = {
  key: 'bath', version: 1, title: 'Bathroom', opening, closing,
  modules: [
    R('visit', { label: 'server-filled context, never shown' }), R('house'), R('access'), R('room', { min: 1, label: 'the bath' }), R('bath_scope', { min: 1 }),
    R('plumb_fixture', { min: 2, label: 'toilet + sink; + tub/shower' }), O('window', { label: '0+' }), R('door', { min: 1 }), R('water'),
    C('panel', any(eq('bath_scope.heated_floor', true), isIn('bath_scope.elec_dedicated_20a', ['No', 'Can\'t tell'])), { label: 'floor heat or new circuits' }),
    R('hvac'), hvacVents(true), hvacFans, R('structure', { min: 1, label: 'tile floor' }), R('moisture', { min: 1 }), R('era'),
    R('selections', { min: selectionDecisions.bath.length }), R('closing'),
  ],
  derived: [
    { key: 'room_floor_area', label: 'Room floor area (context)', formula: 'room.floor_area', maps_to: undefined },
    { key: 'floor_tile_area', label: 'Floor tile area', formula: 'room.floor_area - bath_scope.kept_tub_area - bath_scope.vanity_width * 21 / 144', maps_to: m('bath.tile', 'Floor tile area') },
    { key: 'wall_tile_area', label: 'Wall tile area', formula: 'bath_scope.wall_tile_area', maps_to: m('bath.tile', 'Wall tile area') },
  ],
};

export const kitchen: TemplateDef = {
  key: 'kitchen', version: 1, title: 'Kitchen', opening, closing,
  modules: [
    R('visit', { label: 'server-filled context, never shown' }), R('house'), R('access'), R('room', { min: 1, label: 'the kitchen; + adjoining rooms if the floor or walls continue' }), R('kitchen_scope'),
    R('kitchen_wall', { min: 2, label: 'one per wall with cabinets, clockwise from the entry: A, B, C, D' }),
    R('kitchen_appliance', { min: 1, label: 'one row each: range, cooktop, wall oven, microwave, hood, fridge, dishwasher, beverage fridge' }),
    O('window'), O('door'), R('plumb_fixture', { min: 1, label: 'kitchen sink; + dishwasher, fridge water' }), R('panel', { min: 1 }), R('hvac'), hvacVents(true), hvacFans, R('water'),
    C('structure', any(answered('kitchen_scope.walls_to_open'), eq('kitchen_scope.island', 'New')), { min: 1, label: 'walls open or island' }),
    O('moisture'), R('era'), R('selections', { min: selectionDecisions.kitchen.length }), R('closing'),
  ],
  derived: [
    { key: 'room_floor_area', label: 'Room floor area', formula: 'room.floor_area', maps_to: m('kitchen.demo', 'Room floor area') },
    { key: 'floor_area', label: 'Floor area', formula: 'room.floor_area', maps_to: m('kitchen.flooring', 'Floor area') },
    { key: 'cabinet_run', label: 'Cabinet run', formula: 'kitchen_wall.base_run / 12 + kitchen_scope.island_run / 12', maps_to: m('kitchen.cabinetry', 'Cabinet run') },
    { key: 'countertop_area', label: 'Countertop area — the fabricator templates after install; this is for pricing', formula: 'kitchen_wall.base_run * 25.5 / 144 + kitchen_scope.island_top_area', maps_to: m('kitchen.countertops', 'Countertop area') },
    { key: 'backsplash_area', label: 'Backsplash area', formula: 'kitchen_wall.base_run * kitchen_scope.backsplash_height_in / 144', maps_to: m('kitchen.backsplash', 'Backsplash area') },
  ],
};

export const addition: TemplateDef = {
  key: 'addition', version: 1, title: 'Addition', opening, closing,
  modules: [
    R('visit', { label: 'server-filled context, never shown' }), R('house'), R('access'), R('addition_scope'), R('exterior_site'), R('footing'),
    R('room', { min: 1, label: 'each new room as planned + the existing room it connects to' }),
    O('window', { label: 'new openings and the tie-in opening' }), O('door', { label: 'new openings and the tie-in opening' }),
    R('panel', { min: 1 }), R('hvac'), hvacVents(true), hvacFans,
    C('water', isIn('addition_scope.rooms', ['Bath', 'Kitchen extension']), { label: 'wet room' }),
    R('structure', { min: 1, label: 'tie-in' }), R('moisture', { min: 1 }), R('era'), R('selections', { min: selectionDecisions.addition.length }), R('closing'),
  ],
  derived: [
    { key: 'footprint_foundation', label: 'Footprint', formula: 'addition_scope.footprint_area', maps_to: m('addition.foundation', 'Footprint') },
    { key: 'footprint_framing', label: 'Footprint', formula: 'addition_scope.footprint_area', maps_to: m('addition.framing', 'Footprint') },
    { key: 'roof_area', label: 'Roof area', formula: 'addition_scope.footprint_area * exterior_site.pitch_factor + addition_scope.eave_overhang_area', maps_to: m('addition.roofing', 'Roof area') },
    { key: 'wall_area', label: 'Wall area', formula: '(addition_scope.footprint_along_house + 2 * addition_scope.footprint_out) * addition_scope.wall_height / 144 - window.size / 144 - door.slab_size / 144', maps_to: m('addition.siding', 'Wall area') },
    { key: 'wall_ceiling_area', label: 'Wall + ceiling area', formula: '2 * (addition_scope.footprint_along_house + addition_scope.footprint_out) * addition_scope.wall_height / 144 + addition_scope.footprint_area', maps_to: m('addition.drywall', 'Wall + ceiling area') },
    { key: 'window_count', label: 'Window count', formula: 'window.new_unit', maps_to: m('addition.windows_doors', 'Window count') },
  ],
};

export const basement: TemplateDef = {
  key: 'basement', version: 1, title: 'Basement finish', opening, closing,
  modules: [
    R('visit', { label: 'server-filled context, never shown' }), R('house'), R('access'), R('basement_scope'), R('room', { min: 1, label: 'each planned room + the whole space' }),
    C('egress', isIn('basement_scope.rooms_wanted', ['Bedroom']), { min: 1, label: 'one per planned bedroom' }),
    O('window'), O('door'), C('plumb_fixture', isIn('basement_scope.rooms_wanted', ['Bath', 'Bar']), { min: 1, label: 'bath/bar' }),
    R('water'), R('panel', { min: 1 }), R('hvac'), hvacVents(true), hvacFans, R('structure', { min: 1 }), R('moisture', { min: 1 }), R('era'),
    R('selections', { min: selectionDecisions.basement.length, label: 'plus the bath list if a bath' }), R('closing'),
  ],
  derived: [
    { key: 'floor_area', label: 'Floor area (all rooms)', formula: 'room.floor_area', maps_to: m('basement.flooring', 'Floor area') },
    { key: 'wall_framing', label: 'Wall framing', formula: '(basement_scope.exterior_wall_length + basement_scope.new_partitions) / 12', maps_to: m('basement.framing', 'Wall framing') },
    { key: 'drywall_area', label: 'Drywall area', formula: '(basement_scope.exterior_wall_length + 2 * basement_scope.new_partitions) * basement_scope.floor_to_joists / 144 + basement_scope.drywall_ceiling_area', maps_to: m('basement.drywall', 'Drywall area') },
  ],
};

export const deck: TemplateDef = {
  key: 'deck', version: 1, title: 'Deck', opening, closing,
  modules: [
    R('visit', { label: 'server-filled context, never shown' }), R('house'), R('access'), R('deck_scope'), R('exterior_site'), R('footing'), R('door', { min: 1, label: 'the door onto the deck' }),
    C('panel', any(isIn('deck_scope.lights_outlets', ['Lights', 'Outlets']), isIn('deck_scope.uses', ['Hot tub'])), { min: 1, label: 'lights/outlets/hot tub' }),
    C('era', any(isIn('deck_scope.ledger_siding', ['Wood', 'Fiber cement']), isIn('exterior_site.siding', ['Wood lap', 'Fiber cement'])), { label: 'we touch painted siding' }),
    R('selections', { min: selectionDecisions.deck.length }), R('closing'),
  ],
  derived: [
    { key: 'deck_area_framing', label: 'Deck area', formula: 'deck_scope.deck_area', maps_to: m('deck.framing', 'Deck area') },
    { key: 'deck_area_decking', label: 'Deck area', formula: 'deck_scope.deck_area', maps_to: m('deck.decking', 'Deck area') },
    { key: 'railing_length', label: 'Railing length', formula: 'deck_scope.railing_length', maps_to: m('deck.railing', 'Railing length') },
    { key: 'footing_count', label: 'Footing count (draft) — posts ≤ 8′ apart on each beam line; shown as a suggestion that the visitor confirms or corrects on the form', formula: 'deck_scope.footing_count', maps_to: m('deck.footings', 'Footing count') },
    { key: 'riser_count', label: 'Riser count — total rise ÷ 7.75 rounded up (context for stair pricing)', formula: 'ceil(deck_scope.total_rise / 7.75)', maps_to: undefined },
  ],
};

const exteriorWork = isIn('whole_scope.systems', EXTERIOR_SYSTEMS);
export const whole: TemplateDef = {
  key: 'whole', version: 1, title: 'Whole-home', opening, closing,
  modules: [
    R('visit', { label: 'server-filled context, never shown' }), R('house'), R('access'), R('whole_scope'), R('room', { min: 1, label: 'every room; min = rooms in scope' }),
    C('window', isIn('whole_scope.systems', ['Windows']), { min: 1, label: 'every one in scope' }), O('door', { label: 'every one in scope' }),
    C('kitchen_scope', tpl('kitchen'), { label: 'nested kitchen' }), C('kitchen_wall', tpl('kitchen'), { min: 2 }), C('kitchen_appliance', tpl('kitchen'), { min: 1 }),
    C('bath_scope', tpl('bath'), { min: 1, label: 'nested bath ×n' }),
    C('plumb_fixture', any(tpl('kitchen', 'bath'), isIn('whole_scope.systems', ['Re-pipe'])), { min: 1 }),
    C('basement_scope', tpl('basement'), { label: 'nested basement' }), C('egress', isIn('basement_scope.rooms_wanted', ['Bedroom']), { min: 1 }),
    R('panel', { min: 1 }), R('water'), R('hvac'), hvacVents(true), hvacFans, R('structure', { min: 1 }), R('moisture', { min: 1 }), R('era'),
    C('exterior_site', exteriorWork, { label: 'exterior work' }), R('selections', { min: 0, label: 'union of nested lists' }), R('closing'),
  ],
  derived: [
    { key: 'total_floor_area', label: 'Total floor area (all scope rules matched)', formula: 'room.floor_area', maps_to: undefined },
    { key: 'window_count', label: 'Window count (all scope rules matched; fed per window by window.plan)', formula: 'window.unit', maps_to: undefined },
    { key: 'door_count', label: 'Door count (all scope rules matched; fed per door by door.plan)', formula: 'door.unit', maps_to: undefined },
  ],
};

export const general: TemplateDef = {
  key: 'general', version: 1, title: 'General / other', opening, closing,
  modules: [
    R('visit', { label: 'server-filled context, never shown' }), R('house'), R('access'), R('general_scope'), R('room', { min: 1 }), R('era'), R('selections', { min: 0, label: 'free-form list the visitor adds' }), R('closing'),
    C('panel', isIn('general_scope.systems', ['Electrical']), { min: 1 }), C('plumb_fixture', isIn('general_scope.systems', ['Plumbing']), { min: 1 }),
    C('hvac', isIn('general_scope.systems', ['HVAC'])), O('hvac_vent'), C('structure', isIn('general_scope.systems', ['Structure']), { min: 1 }),
    C('exterior_site', isIn('general_scope.systems', ['Exterior'])),
  ],
  derived: [],
};

export const templates: TemplateDef[] = [bath, kitchen, addition, basement, deck, whole, general];

// ───────── Add-ons: ticked on top of a template; same TemplateDef shape, no scripts of their own ─────────
export const garageAddOn: TemplateDef = {
  key: 'garage', version: 1, title: 'Garage', opening: [], closing: [],
  modules: [
    R('garage'), R('garage_door', { min: 1, label: 'Overhead door(s), repeat' }),
    C('exterior_site', eq('garage.new_or_existing', 'New')), C('footing', eq('garage.new_or_existing', 'New')),
    C('panel', answered('garage.electrical_wanted'), { min: 1, label: '→ panel' }),
  ],
  derived: [
    { key: 'slab_area', label: 'Slab area', formula: 'garage.size / 144', maps_to: m('garage.slab', 'Slab area') },
    { key: 'overhead_door_count', label: 'Overhead door count', formula: 'garage_door.unit', maps_to: m('garage.overhead_door', 'Overhead door count') },
  ],
};
export const openingsAddOn: TemplateDef = {
  key: 'openings', version: 1, title: 'Windows & doors', opening: [], closing: [],
  modules: [R('window', { min: 1, label: 'every window being replaced' }), R('openings', { min: 1, label: 'one per replaced window' }), O('door', { label: 'every door being replaced' })],
  derived: [],
};
export const flooringAddOn: TemplateDef = {
  key: 'flooring', version: 1, title: 'Flooring', opening: [], closing: [],
  modules: [R('flooring'), R('room', { min: 1, label: 'room instances (reuse)' })],
  derived: [{ key: 'floor_area', label: 'Floor area (net, waste is estimating\'s)', formula: 'room.floor_area', maps_to: m('flooring.install', 'Floor area') }],
};
export const addOns: TemplateDef[] = [garageAddOn, openingsAddOn, flooringAddOn];

/** Child-row modules and the module instance they hang under (`consult_instances.parent_id`). */
export const moduleParents: Record<string, string> = {
  hvac_vent: 'hvac', hvac_exhaust_fan: 'hvac', kitchen_appliance: 'kitchen_scope', openings: 'window', garage_door: 'garage',
};

/** The plan's own formula text for every template/add-on derived quantity (§7.4–§7.11), beside the executable one. */
export const planFormulas: Record<string, string> = {
  'bath.room_floor_area': 'room.length × room.width ÷ 144',
  'bath.floor_tile_area': 'floor area − (tub footprint if the tub stays) − vanity width × 21″ ÷ 144',
  'bath.wall_tile_area': 'shower: (2 × depth + width) × wall tile height ÷ 144; tub: (2 × 30″ + length) × height ÷ 144; wainscot: perimeter × 36″ ÷ 144',
  'kitchen.room_floor_area': 'room.length × room.width ÷ 144',
  'kitchen.floor_area': 'room.length × room.width ÷ 144',
  'kitchen.cabinet_run': 'Σ kitchen_wall.base run ÷ 12 (+ island length ÷ 12)',
  'kitchen.countertop_area': 'Σ base run × 25.5″ ÷ 144 + island W × D ÷ 144',
  'kitchen.backsplash_area': 'Σ base run × backsplash height ÷ 144 − windows over counters',
  'addition.footprint_foundation': 'footprint W × L ÷ 144',
  'addition.footprint_framing': 'footprint W × L ÷ 144',
  'addition.roof_area': 'footprint × pitch factor (√(1 + (pitch/12)²)) + 12″ overhang on the eaves',
  'addition.wall_area': '(3 exposed sides) × wall height − openings',
  'addition.wall_ceiling_area': 'interior perimeter × ceiling + footprint',
  'addition.window_count': 'count of `window` Plan = New',
  'basement.floor_area': 'Floor area (all rooms)',
  'basement.wall_framing': 'perimeter + new partitions',
  'basement.drywall_area': 'walls × height + ceiling if drywall',
  'deck.deck_area_framing': 'size W × L ÷ 144',
  'deck.deck_area_decking': 'size W × L ÷ 144',
  'deck.railing_length': 'perimeter − house side − stair openings (when > 30″)',
  'deck.footing_count': 'posts ≤ 8′ apart on each beam line; shown as a suggestion that the visitor confirms or corrects on the form',
  'deck.riser_count': 'total rise ÷ 7.75 rounded up',
  'whole.total_floor_area': 'Total floor area (all scope rules matched)',
  'whole.window_count': 'Window count (all scope rules matched)',
  'whole.door_count': 'Door count (all scope rules matched)',
  'garage.slab_area': 'Size → garage.slab "Slab area" (sf, new label)',
  'garage.overhead_door_count': 'Overhead door(s) → garage.overhead_door "Overhead door count" (ea, new label)',
  'flooring.floor_area': 'Floor area (net, waste is estimating\'s)',
};

/** How the executable formulas read (formula.ts grammar: numbers, + − × ÷, parentheses, `field` / `module.field`). */
export const FORMULA_CONVENTIONS = [
  'A formula is a sum of top-level + / − terms; a term that names a field of a repeatable module is evaluated per live instance and summed (§10.5 sums disjoint areas, run lengths and counts). No term names two different repeatable modules.',
  'A length_pair reference stands for W × H in square inches (e.g. garage.size / 144 = slab sf).',
  'An input whose required-condition is false (not on this job) counts as 0; an applicable input that is missing or skipped makes the result a gap, never zero.',
  'Branches, yes/no tests and indicators come from `derivationCases` (first match wins; no match = gap).',
] as const;
