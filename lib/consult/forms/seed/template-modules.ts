// Plan §7.4–§7.11 template-specific and add-on modules, as executable data.
import type { ModuleDef } from '../../form-types.ts';
import { all, answered, any, caseField, choice, count, date, derived, eq, gt, isIn, len, lt, multi, ne, not, num, pair, shot, text, year, yesno } from './helpers.ts';

// ───────────────────────── §7.4 Bathroom ─────────────────────────
export const BATH_SAY = [
  'Walk me through a normal morning in here — who uses it and when?',
  'What bugs you most about this bathroom?',
  'Is this the only bathroom in the house?',
  'Tub or shower — or both?',
  'Where do towels and everything else live now? Is that enough?',
  'Anyone in the house who\'ll need grab bars or a no-step shower, now or later?',
];
const shower = isIn('tub_shower_plan', ['Tub → shower', 'New tub-shower', 'Shower only']);
export const bath_scope: ModuleDef = {
  key: 'bath_scope', version: 1, title: 'Bathroom work', repeatable: true, instance_label: 'Bathroom work {n} — {bath_type}', say: BATH_SAY,
  fields: [
    choice('existing_tub_material', 'Existing tub material', ['Cast iron', 'Steel', 'Acrylic-fiberglass', 'Tile base', 'No tub'], true, {
      flag: { when: eq('existing_tub_material', 'Cast iron'), issue: 'cast iron: 2-person demo / break-up' },
    }),
    choice('tub_drain_end', 'Tub drain end', ['Left', 'Right'], all(ne('existing_tub_material', 'No tub'), isIn('tub_shower_plan', ['Keep tub', 'New tub-shower', 'Freestanding tub'])), { hint: 'Facing the tub, which end is the drain?', note: 'R? tub kept or replaced' }),
    pair('shower_drain_center', 'Shower drain center from back × side wall', shower),
    yesno('wet_wall_exterior', 'Wet wall exterior?', true, { flag: { when: eq('wet_wall_exterior', true), issue: 'Pipes in an outside wall can freeze in Minnesota — reroute or insulate them' } }),
    choice('wet_wall_framing', 'Wet wall framing', ['2×4', '2×6', 'Unknown'], any(eq('valve_plan', 'Replace'), answered('niche'), eq('toilet_plan', 'Wall-hung')), { note: 'R? new valve, niche or wall-hung toilet' }),
    text('valve_brand', 'Existing valve — brand', true),
    text('valve_cartridge', 'Existing valve — cartridge', true),
    choice('valve_plan', 'Existing valve — Keep/Replace/Unknown', ['Keep', 'Replace', 'Unknown'], true),
    text('vent_stack_route', 'Vent stack route', eq('plumb_fixture.plan', 'Move'), {
      note: 'R? fixture moves', shots: [shot('vent_stack', 'Vent stack route', eq('plumb_fixture.plan', 'Move'))],
    }),
    num('fan_label_cfm', 'Fan details — existing label cfm', 'cfm', ne('fan_now', 'None')),
    text('fan_route', 'Fan details — route', ne('fan_now', 'None')),
    len('fan_duct_length', 'Fan details — duct length', ne('fan_now', 'None'), {
      flag: { when: any(gt('fan_duct_length', 300), gt('fan_elbows', 3)), issue: '>25 ft or >3 elbows: sub checks rated duct performance and 1346/1322 airflow, not a universal length-code failure' },
    }),
    count('fan_elbows', 'Fan details — elbows', ne('fan_now', 'None')),
    choice('fan_exit', 'Fan details — roof/wall/soffit exit', ['Roof', 'Wall', 'Soffit', 'Into the attic', 'None'], ne('fan_now', 'None')),
    choice('fan_switch', 'Fan details — switch/timer', ['Switch', 'Timer'], ne('fan_now', 'None')),
    yesno('elec_gfci', 'Electrical in room — GFCI', true, { hint: 'Is there an outlet or breaker with Test/Reset buttons? The electrician confirms.', note: 'electrician verifies' }),
    count('elec_receptacles', 'Electrical in room — receptacle count', true),
    choice('elec_dedicated_20a', 'Electrical in room — dedicated 20 A', ['Yes', 'No', 'Can\'t tell'], true),
    text('elec_light_locations', 'Electrical in room — light locations', true),
    len('toilet_front_clearance', 'Toilet front clearance', answered('toilet_plan'), {
      note: 'R? toilet', hint: 'From the front of the bowl to the nearest wall, vanity, tub or door swing in front of it.',
      flag: { when: lt('toilet_front_clearance', 24), issue: '<24″; 4714/UPC; also 15″ each side, 30″ center-to-center' },
    }),
    len('threshold_thickness', 'Total floor thickness at threshold', true, { note: 'tile build-up / transition' }),
    num('heated_floor_area', 'Heated floor area', 'sf', eq('heated_floor', true), {
      note: 'derived sf = net heated polygon excluding fixed fixtures; confirm layout with electrician',
    }),
    choice('bath_type', 'Bath type', ['Full', '¾', 'Half', 'Primary'], true),
    yesno('only_bathroom', 'Only bathroom in the house?', true, { flag: { when: eq('only_bathroom', true), issue: 'plan a working toilet each night / portable toilet' } }),
    text('top_changes', 'Top things to change', true, { tier: 'record' }),
    num('new_tub_capacity', 'New tub capacity (gal)', 'gal', false),
    choice('tub_shower_plan', 'Tub / shower plan', ['Keep tub', 'Tub → shower', 'New tub-shower', 'Shower only', 'Freestanding tub', 'None — half bath'], true),
    len('existing_length', 'Existing tub/shower footprint — length', ne('tub_shower_plan', 'None — half bath'), { note: 'one W × L entry; the length feeds the tub wall-tile formula' }),
    len('existing_width', 'Existing tub/shower footprint — width', ne('tub_shower_plan', 'None — half bath')),
    len('new_shower_width', 'New shower size — width', shower, { range: [30, 96], note: 'one W × D entry, 30–96 in each' }),
    len('new_shower_depth', 'New shower size — depth', shower, { range: [30, 96] }),
    choice('curb', 'Curb or curbless', ['Curb', 'Curbless'], shower, { flag: { when: eq('curb', 'Curbless'), issue: 'recess the floor — check joists' } }),
    text('niche', 'Niche (how many, which wall)', false),
    yesno('bench', 'Bench', false),
    choice('glass', 'Glass', ['Frameless door', 'Framed', 'Curtain', 'Open'], shower),
    choice('valve_type', 'Valve type', ['Pressure-balance', 'Thermostatic', 'Digital'], false),
    multi('shower_extras', 'Handheld, body sprays, rain head', ['Handheld', 'Body sprays', 'Rain head'], false),
    choice('wall_tile_height', 'Wall tile height', ['To ceiling', '84″', '72″', 'Wainscot', 'None'], true),
    yesno('heated_floor', 'Heated floor', true, { note: 'yes → panel module required' }),
    len('vanity_wall', 'Wall available for the vanity', true, { range: [18, 144] }),
    len('vanity_width', 'New vanity width', true, { range: [18, 96], flag: { when: gt('vanity_excess', 0), issue: '> wall available' } }),
    derived('vanity_excess', 'New vanity width minus wall available', 'length', 'vanity_width - vanity_wall', { unit: 'in' }),
    choice('mirror', 'Mirror', ['Mirror', 'Recessed cabinet', 'Surface cabinet'], false),
    text('mirror_stud_bay', 'Mirror — stud bay clear of pipes?', eq('mirror', 'Recessed cabinet')),
    choice('toilet_plan', 'Toilet plan', ['Keep', 'New standard', 'Comfort height', 'Wall-hung'], true, { flag: { when: eq('toilet_plan', 'Wall-hung'), issue: 'carrier + 2×6 wall' } }),
    choice('fan_now', 'Fan now', ['Vents outside', 'Vents into attic', 'None'], true),
    yesno('window_in_shower', 'Window in the shower?', true, { flag: { when: eq('window_in_shower', true), issue: 'tempered + wet-wall window detail' } }),
    text('grab_bars', 'Grab bars / blocking / aging in place', false),
    text('storage_wanted', 'Storage wanted', false),
    caseField('tile_height_in', 'Wall tile height in inches', 'length', { unit: 'in' }),
    caseField('kept_tub_area', 'Tub footprint when the tub stays', 'number', { unit: 'sf' }),
    caseField('wall_tile_area', 'Wall tile area', 'number', { unit: 'sf' }),
  ],
  shots: [
    shot('room_from_door', 'Room from the door', true),
    shot('toilet_and_floor', 'Toilet and floor around it', true),
    shot('vanity_open', 'Vanity with doors open (drain and supplies)', true),
    shot('tub_valve_wall', 'Tub/shower and its valve wall', true),
    shot('ceiling_and_fan', 'Ceiling and fan', true),
    shot('floor_at_threshold', 'Floor at the threshold', true),
    shot('ceiling_below', 'Ceiling below the bath from the basement', eq('plumb_fixture.below', 'Unfinished basement'), undefined, 'R? basement unfinished'),
    shot('access_panel', 'Access panel behind the tub', false),
  ],
  coverage: [],
};

// ───────────────────────── §7.5 Kitchen ─────────────────────────
export const KITCHEN_SAY = [
  'Who cooks, and how much? Big holiday meals, baking, takeout?',
  'What\'s the one thing you\'d fix first if you could?',
  'If you could move the sink, the range or the fridge, would you?',
  'Island — yes, no, seating for how many?',
  'Are you keeping any appliances? Which are you buying yourselves?',
  'Where do the small appliances live now?',
  'Does the floor in here run into other rooms?',
];
const ducted = ne('hood_exit', 'None — recirculating');
const JOISTS = ['Front–back', 'Side–side'];
const CIRCUIT = ['Yes', 'No', 'Can\'t tell'];
export const kitchen_scope: ModuleDef = {
  key: 'kitchen_scope', version: 1, title: 'Kitchen work', repeatable: false, say: KITCHEN_SAY,
  fields: [
    choice('hood_exit', 'Hood duct route — exit', ['Wall', 'Roof', 'None — recirculating'], true, {
      note: '> 300 cfm → hvac makeup-air inputs (appliance venting, dryer, other fans, year) become required; HVAC sub calculates under Minn. R. 1346.0501, not an IRC mechanical rule',
    }),
    choice('hood_route', 'Hood duct route — upper cabinet/soffit/joist bay', ['Upper cabinet', 'Soffit', 'Joist bay'], ducted),
    choice('hood_joists', 'Hood duct route — joist direction', ['Duct runs with the joists', 'Duct crosses the joists'], ducted, {
      flag: { when: eq('hood_joists', 'Duct crosses the joists'), issue: 'crosses joists: framing work' },
    }),
    len('hood_duct_length', 'Hood duct route — length', ducted),
    count('hood_elbows', 'Hood duct route — elbows', ducted),
    len('hood_duct_size', 'Hood duct route — duct size', ducted),
    text('gas_line_location', 'Range gas line — location', isIn('kitchen_appliance.fuel', ['Gas', 'Dual fuel']), { note: 'R? gas range' }),
    text('gas_line_shutoff', 'Range gas line — shutoff', isIn('kitchen_appliance.fuel', ['Gas', 'Dual fuel'])),
    text('gas_line_size', 'Range gas line — visible line size/Unknown', isIn('kitchen_appliance.fuel', ['Gas', 'Dual fuel'])),
    text('floor_layers_height', 'Floor layers and height under new countertop', true),
    len('dw_opening_height', 'Floor layers and height under new countertop — clear dishwasher opening height', true, {
      flag: { when: lt('dw_opening_height', 34.5), issue: '<34½″ dishwasher clearance; verify selected model' },
    }),
    count('circuits_countertop_20a', 'Existing circuits — count of 20 A countertop circuits', true, { hint: 'From the panel labels. Can’t tell? Skip it with Sub/supplier will measure — the electrician counts.', note: 'electrician determines NEC scope' }),
    choice('circuit_dishwasher', 'Existing circuits — dedicated dishwasher', CIRCUIT, true),
    choice('circuit_disposal', 'Existing circuits — dedicated disposal', CIRCUIT, true),
    choice('circuit_microwave', 'Existing circuits — dedicated micro', CIRCUIT, true),
    choice('circuit_fridge', 'Existing circuits — dedicated fridge', CIRCUIT, true),
    choice('island_below', 'Island services below', ['Unfinished basement', 'Finished', 'Slab'], isIn('island', ['Keep', 'New']), {
      note: 'R? sink or outlets', flag: { when: eq('island_below', 'Slab'), issue: 'slab: drain/vent trench' },
    }),
    choice('island_below_joists', 'Island services below — joist direction', JOISTS, isIn('island', ['Keep', 'New'])),
    choice('recessed_above', 'Above recessed lights', ['Attic', 'Floor', 'Roof'], isIn('lights_wanted', ['Recessed'])),
    choice('recessed_above_joists', 'Above recessed lights — joist direction', JOISTS, isIn('lights_wanted', ['Recessed'])),
    text('how_they_cook', 'How they cook (cooks most, holidays, baking)', true, { tier: 'record' }),
    choice('layout', 'Layout', ['Same footprint', 'Some changes', 'New layout'], true),
    text('walls_to_open', 'Walls to open', isIn('layout', ['Some changes', 'New layout']), { note: '→ structure required' }),
    choice('island', 'Island', ['Keep', 'New', 'None'], true),
    len('island_length', 'Island size — length', eq('island', 'New'), { range: [24, 144], precision: 0.0625, note: 'one L × D entry: 24–144 × 24–72 in' }),
    len('island_depth', 'Island size — depth', eq('island', 'New'), { range: [24, 72], precision: 0.0625 }),
    count('island_seats', 'Island seats', false),
    choice('cabinets', 'Cabinets', ['Replace all', 'Reface', 'Paint', 'Some new'], true),
    choice('upper_height', 'Upper cabinet height', ['30″', '36″', '42″', 'To ceiling', 'Stacked'], true),
    choice('soffits', 'Soffits (and what\'s in them)', ['None', 'Empty', 'Duct', 'Plumbing vent', 'Unknown'], true, {
      flag: { when: isIn('soffits', ['Duct', 'Plumbing vent']), issue: 'can\'t remove soffit freely' },
    }),
    choice('backsplash_height', 'Backsplash height', ['4″', 'To the uppers', 'Full wall at range'], true),
    yesno('sink_stays', 'Sink stays where it is?', true, { note: 'no → plumb_fixture Move' }),
    len('sink_base_width', 'Sink base width now', true, { precision: 0.0625 }),
    multi('extras', 'Disposal / pot filler / filtered water', ['Disposal', 'Pot filler', 'Filtered water'], false),
    pair('fridge_space', 'Fridge space width × height', true),
    choice('range_width', 'Range width', ['30 in', '36 in', '48 in'], true),
    choice('hood_type', 'Hood type', ['Under-cabinet', 'Wall chimney', 'Island', 'Insert', 'Microwave'], true),
    multi('lights_wanted', 'Lights wanted', ['Recessed', 'Pendants', 'Under-cabinet', 'Toe-kick'], false),
    text('floor_continues', 'Floor continues into', true, { hint: 'Which rooms the kitchen floor runs into.', note: '→ flooring add-on suggestion' }),
    text('pantry', 'Pantry', false),
    len('backsplash_measured_height', 'Backsplash height along the counters (to the uppers)', isIn('backsplash_height', ['To the uppers','Full wall at range']), {range:[4,36]}),
    pair('range_wall_tile', 'Tile behind the range — width × height from the counter up', isIn('backsplash_height',['To the uppers','Full wall at range']), {range:[12,96], hint:'The range isn’t in the cabinet run. Measure the tile behind it, counter to the hood (or ceiling for a full wall). Cooktop in the island? Skip — Not applicable.'}),
    caseField('backsplash_height_in', 'Backsplash height in inches', 'length', { unit: 'in' }),
    caseField('island_run', 'Island length for the cabinet run', 'length', { unit: 'in' }),
    caseField('island_top_area', 'Island top area', 'number', { unit: 'sf' }),
  ],
  shots: [
    shot('sink_base_open', 'Sink base open', true),
    shot('range_hood_labels', 'Range/hood and the appliance labels', true),
    shot('fridge_space', 'Fridge space', true),
    shot('ceiling_and_soffits', 'Ceiling and soffits', true),
    shot('floor_transitions', 'Floor transitions', true),
    shot('basement_ceiling_under_sink', 'Basement ceiling under the sink', eq('sink_stays', false), undefined, 'R? sink moves'),
  ],
  coverage: [],
};

/** Child rows of `kitchen_scope` › "Appliances (one row each …)" with "New appliance details (each New row)". */
const newAppliance = eq('plan', 'New');
export const kitchen_appliance: ModuleDef = {
  key: 'kitchen_appliance', version: 1, title: 'Appliance', repeatable: true, instance_label: 'Appliance {n} — {appliance}', say: [],
  fields: [
    choice('appliance', 'Appliance', ['Range', 'Cooktop', 'Wall oven', 'Microwave', 'Hood', 'Fridge', 'Dishwasher', 'Beverage fridge'], true),
    text('type', 'Type', true),
    choice('fuel', 'Fuel', ['Gas', 'Electric', 'Induction', 'Dual fuel', 'None'], true),
    len('width', 'Width', true),
    choice('plan', 'Keep/New', ['Keep', 'New'], true),
    choice('who_buys', 'Who buys', ['SJC', 'Client'], true, {
      note: '→ "Appliance package" finish; client-bought → exclusion', maps_to: { scope_key: 'kitchen.appliances', kind: 'decision' },
    }),
    choice('model_status', 'New appliance details — model # if picked/Not picked', ['Picked', 'Not picked'], newAppliance, {
      note: 'unpicked cutouts are explicit assumptions; no cabinet order until verified',
    }),
    text('model_number', 'New appliance details — model #', all(newAppliance, eq('model_status', 'Picked'))),
    len('cutout_width', 'New appliance details — cutout W', newAppliance, { precision: 0.0625 }),
    len('cutout_height', 'New appliance details — cutout H', newAppliance, { precision: 0.0625 }),
    len('cutout_depth', 'New appliance details — cutout D', newAppliance, { precision: 0.0625 }),
    choice('voltage', 'New appliance details — 120/240 V', ['120 V', '240 V'], newAppliance),
    num('amps', 'New appliance details — amps', 'amp', newAppliance),
    yesno('gas', 'New appliance details — gas', newAppliance),
    yesno('panel_ready', 'New appliance details — panel-ready', newAppliance),
  ],
  shots: [],
  coverage: [],
};

export const kitchen_wall: ModuleDef = {
  key: 'kitchen_wall', version: 1, title: 'Kitchen wall', repeatable: true, instance_label: 'Wall {letter}', say: [],
  fields: [
    pair('soffit_size', 'Soffit depth × height', ne('kitchen_scope.soffits', 'None'), { hint: 'One entry per wall.', note: 'per wall' }),
    choice('letter', 'Wall letter', ['A', 'B', 'C', 'D'], true, { hint: 'Letter each wall with cabinets A, B, C, D, clockwise from the entry.', note: 'one per wall with cabinets, clockwise from the entry' }),
    len('length_counter', 'Length corner to corner at counter height (36″)', true, { precision: 0.0625 }),
    len('length_ceiling', 'Length at the ceiling', false, {
      precision: 0.0625, flag: { when: any(gt('plumb_difference', 0.25), lt('plumb_difference', -0.25)), issue: 'out of plumb if different by > 1/4″' },
    }),
    derived('plumb_difference', 'Length at the ceiling minus length at counter height', 'length', 'length_ceiling - length_counter', { unit: 'in' }),
    len('ceiling_height', 'Ceiling height at this wall', true),
    len('base_run', 'Base cabinet run (new)', true, { precision: 0.0625 }),
    len('upper_run', 'Upper cabinet run (new)', false, { precision: 0.0625, tier: 'price_critical' }),
    text('wall_items', 'Outlets, switches, vents, radiator on this wall (offset from left corner)', true),
    choice('corner_square', 'Corner square? (3-4-5 or diagonals)', ['Square', 'Out ¼″+', 'Didn\'t check'], false),
  ],
  shots: [shot('straight_on', 'Wall straight on', true)],
  coverage: [],
};

// ───────────────────────── §7.6 Addition ─────────────────────────
export const ADDITION_SAY = [
  'Tell me how you\'ll use the new space — a normal day and a busy day.',
  'Where do you picture it joining the house, and what happens to the wall, window or door there now?',
  'Basement under it, a crawlspace, or a slab?',
  'Should it look like it was always there — same siding, same roof?',
  'Do you have a survey of the lot, or old house plans?',
  'Any plans for a bathroom or sink out there?',
];
const notCitySewer = ne('utilities_sewer_water', 'City sewer and water');
const YNU = ['Yes', 'No', 'Unknown'];
export const addition_scope: ModuleDef = {
  key: 'addition_scope', version: 1, title: 'Addition', repeatable: false, say: ADDITION_SAY,
  fields: [
    multi('soils', 'Soils', ['Known fill', 'Wet / high water', 'Heavy clay', 'Unknown'], true, {
      flag: { when: isIn('soils', ['Known fill', 'Wet / high water', 'Heavy clay']), issue: 'known condition: soil check/engineer; unknown remains assumption' },
    }),
    choice('tiein_foundation_type', 'Existing foundation tie-in — type', ['Poured', 'Block', 'Stone', 'Slab', 'Crawl', 'Piers'], true),
    len('tiein_foundation_top', 'Existing foundation tie-in — top height', true),
    choice('tiein_footing_seen', 'Existing foundation tie-in — visible footing depth/Not visible', ['Visible', 'Not visible'], true),
    len('tiein_footing_depth', 'Existing foundation tie-in — visible footing depth', eq('tiein_footing_seen', 'Visible')),
    count('openings_lost_count', 'Windows/doors covered or lost — count', true, { flag: { when: gt('openings_lost_count', 0), issue: 'Check: does this remove a bedroom’s egress window?' } }),
    text('openings_lost_room', 'Windows/doors covered or lost — room affected', gt('openings_lost_count', 0)),
    num('lot_hardcover', 'Lot controls — hardcover estimate', 'sf', true),
    choice('lot_shoreland', 'Lot controls — shoreland', YNU, true, {
      flag: { when: any(eq('lot_shoreland', 'Yes'), eq('lot_floodplain', 'Yes')), issue: 'Check shoreland/floodplain/watershed; confirm city survey requirement' },
    }),
    choice('lot_floodplain', 'Lot controls — floodplain', YNU, true),
    text('lot_watershed', 'Lot controls — watershed district', true, {flag:{when:answered('lot_watershed'),issue:'Check watershed district rules and city survey requirement'}}),
    text('lot_height_limit', 'Lot controls — height limit', true),
    choice('lot_survey_required', 'Lot controls — certificate of survey required', YNU, true),
    choice('utilities_sewer_water', 'Utilities relative to footprint — sewer/water', ['City sewer and water', 'Septic', 'Well', 'Septic and well'], true),
    text('utilities_laterals', 'Utilities relative to footprint — sewer/water laterals', true),
    text('utilities_gas', 'Utilities relative to footprint — gas service/meter', true),
    yesno('utilities_meter_in_footprint', 'Utilities relative to footprint — meter in the footprint?', true, {
      flag: { when: eq('utilities_meter_in_footprint', true), issue: 'meter in footprint: relocation' },
    }),
    text('septic_well', 'Septic/well location', notCitySewer, {
      flag: { when: answered('septic_well'), issue: 'Check septic/well setbacks' },
      shots: [shot('septic_well_sketch', 'Septic/well sketch', notCitySewer)],
    }),
    num('hvac_furnace_btuh', 'HVAC capacity — furnace BTU/h', 'BTU/h', true),
    year('hvac_furnace_year', 'HVAC capacity — furnace age (year)', true),
    num('hvac_ac_tons', 'HVAC capacity — AC tonnage', 'ton', true),
    text('hvac_duct_path', 'HVAC capacity — duct path', true),
    choice('hvac_manual_j', 'HVAC capacity — Manual J by HVAC sub', ['Yes', 'No'], true, { flag: { when: eq('hvac_manual_j', 'No'), issue: 'missing load calculation' } }),
    len('roof_overhang', 'Roof tie-in — overhang depth', true, { note: 'current MN energy code 1322 applies to addition' }),
    len('roof_fascia_height', 'Roof tie-in — fascia height', true),
    text('roof_gutters', 'Roof tie-in — gutters', true),
    text('roof_within_6ft', 'Roof tie-in — vents/skylights/chimney within 6 ft', true),
    text('roof_attic_vent_path', 'Roof tie-in — attic ventilation path', true),
    text('protected_trees', 'Protected trees', false, { hint: 'Big trees near the work. The city may protect them.', note: 'city tree ordinance' }),
    text('space_for', 'What the space is for', true),
    multi('rooms', 'Rooms in it', ['Family room', 'Bedroom', 'Bath', 'Kitchen extension', 'Mudroom', 'Office', 'Four-season', 'Garage'], true, {
      note: 'Bedroom → egress note; Bath → water module required',
    }),
    choice('stories', 'Stories', ['One', 'Two', 'Over existing (second story)'], true, {
      flag: { when: eq('stories', 'Over existing (second story)'), issue: 'engineer for existing structure' },
    }),
    choice('foundation_wanted', 'Foundation wanted', ['Full basement', 'Crawl', 'Slab', 'Piers'], true),
    len('footprint_along_house', 'Planned footprint (staked or paced) — along the house', true, { range: [60, 480], precision: 1, note: 'one W × L entry, 60–480 in each' }),
    len('footprint_out', 'Planned footprint (staked or paced) — out from the house', true, { range: [60, 480], precision: 1 }),
    derived('footprint_area', 'Footprint', 'number', 'footprint_along_house * footprint_out / 144', { unit: 'sf' }),
    text('joins', 'Where it joins (wall, what\'s removed)', true),
    len('tiein_wall_length', 'Existing wall length at the tie-in', true),
    len('floor_above_grade', 'Existing floor height above grade at the tie-in', true),
    choice('floor_step', 'Step between old and new floor', ['Level', 'Step down', 'Step up'], true),
    len('eave_height', 'Existing eave height above grade', true),
    choice('roof_style', 'Roof style', ['Gable', 'Shed', 'Hip', 'Match existing'], true),
    choice('inside_ceiling', 'Inside ceiling', ['Flat', 'Vaulted'], true),
    choice('plans', 'Plans', ['None — need a drafter', 'Client has plans', 'Architect involved'], true, {
      hint: 'No plans? Joe gets a to-do to start a drafting package.', note: 'None → to-do "Drafting package" (existing drafting-package-build skill)',
    }),
    derived('wall_height', 'New wall height (eave height above grade − floor height above grade)', 'length', 'eave_height - floor_above_grade', { unit: 'in' }),
    caseField('eave_overhang_area', '12″ overhang on the eaves', 'number', { unit: 'sf' }),
  ],
  shots: [
    shot('every_side', 'Every side of the house the addition touches', true),
    shot('tiein_wall_inside', 'Tie-in wall inside', true),
    shot('tiein_wall_outside', 'Tie-in wall outside', true),
    shot('roof_at_tiein', 'Roof at the tie-in', true),
    shot('foundation_at_tiein', 'Foundation at the tie-in', true),
    shot('staked_corners', 'Staked corners or the paced footprint from two corners', true),
    shot('equipment_path', 'Equipment path', true),
    shot('trees_utilities', 'Trees and utilities in the footprint', true),
  ],
  coverage: [],
};

// ───────────────────────── §7.7 Basement ─────────────────────────
export const BASEMENT_SAY = [
  'What do you want down here — rooms, a bath, a bar, storage?',
  'Has it ever had water — even once, even a little?',
  'Has the house been tested for radon?',
  'Will anyone sleep down here?',
  'Is there a bathroom rough-in already, or capped pipes in the floor?',
  'What has to stay reachable — the furnace, water heater, panel, shutoff, sump?',
];
const basementBath = isIn('rooms_wanted', ['Bath']);
const hasSump = eq('water.sump_pump', true);
export const basement_scope: ModuleDef = {
  key: 'basement_scope', version: 1, title: 'Basement finish', repeatable: false, say: BASEMENT_SAY,
  fields: [
    choice('insulation_now', 'Foundation insulation now', ['None', 'Blanket', 'Foam board', 'Framed and batts'], true),
    len('insulation_thickness', 'Foundation insulation now — thickness', ne('insulation_now', 'None')),
    yesno('rim_insulated', 'Rim joist insulated?', true, { flag: { when: eq('rim_insulated', false), issue: '1322 wall/rim insulation; sub verifies required R-values' } }),
    multi('slab_condition', 'Slab — cracks/heave/low spots', ['None', 'Cracks', 'Heave', 'Low spots'], true),
    text('floor_drains', 'Slab — floor drain locations', true),
    yesno('sump_sealed_lid', 'Sump — sealed lid', hasSump),
    yesno('sump_battery', 'Sump — battery backup', hasSump),
    text('sump_discharge', 'Sump — discharge location', hasSump),
    choice('gravity_drain', 'Gravity drain possible for bath', ['Yes', 'No', 'Unknown'], basementBath, { hint: 'Not sure? Pick Unknown and the plumber will check.', note: 'plumber walk if uncertain' }),
    len('drain_depth', 'Gravity drain — main drain depth at cleanout', all(basementBath, ne('gravity_drain', 'Unknown'))),
    text('drain_direction', 'Gravity drain — direction at cleanout', all(basementBath, ne('gravity_drain', 'Unknown'))),
    yesno('fuel_enclosed', 'Fuel appliances enclosed by new room?', true, { flag: { when: eq('fuel_enclosed', true), issue: 'combustion air/clearances under 1346' } }),
    len('service_clearance', 'Furnace and water heater service clearance — front clearances', true, {
      shots: [shot('service_clearance', 'Furnace and water heater service clearance', true)],
    }),
    num('furnace_input', 'Furnace input and distribution — label BTU/h', 'BTU/h', true),
    text('supply_return', 'Furnace input and distribution — available supply/return for rooms', true),
    text('reroute', 'Below-joist pipes/wires/gas to reroute', eq('ceiling', 'Drywall'), {
      note: 'R? drywall ceiling', shots: [shot('reroute', 'Below-joist pipes/wires/gas to reroute', eq('ceiling', 'Drywall'))],
    }),
    yesno('stair_storage', 'Storage under stairs?', true, { flag: { when: eq('stair_storage', true), issue: 'enclosed side ½″ drywall R302.7' } }),
    multi('rooms_wanted', 'Rooms wanted', ['Family room', 'Bedroom', 'Bath', 'Bar', 'Office', 'Gym', 'Storage', 'Laundry'], true),
    text('water_details', 'When and where?', eq('water_ever', true)),
    yesno('water_ever', 'Water ever?', true, { flag: { when: eq('water_ever', true), issue: 'any → moisture plan' } }),
    choice('existing_rough_in', 'Existing bath rough-in (capped stubs)', ['Yes', 'No', 'Unknown'], basementBath),
    choice('ejector_pit', 'Ejector pit needed', ['Yes', 'No', 'Unknown'], all(basementBath, isIn('gravity_drain', ['No', 'Unknown'])), { note: 'R? Bath and no gravity drain' }),
    choice('ceiling', 'Ceiling', ['Drywall', 'Drop ceiling', 'Painted open'], true),
    len('floor_to_joists', 'Floor to underside of joists', true),
    len('lowest_beam', 'Lowest beam or duct (floor to bottom)', true, {
      range: [60, 120], flag: { when: lt('lowest_beam', 76), issue: 'below 6′4″ under beams/ducts (IRC R305.1.1)' },
    }),
    derived('finished_ceiling', 'Finished ceiling height that results', 'length', 'floor_to_joists', {
      unit: 'in', warn: { below: 84, text: 'habitable' }, note: 'less the finished ceiling build-up; under beams/ducts the Lowest beam or duct row governs',
    }),
    multi('must_stay_reachable', 'Must stay reachable', ['Furnace', 'Water heater', 'Panel', 'Main shutoff', 'Cleanouts', 'Sump', 'Radon fan'], true, {
      hint: 'In front of the panel: 30 in wide, 36 in deep and 6½ ft tall, kept empty — no shelves, soffits or walls in it.', note: 'panel → NEC 110.26 (adopted in MN): 30″ wide (or the panel width) × 36″ deep × 6½′ high working space, kept clear — no storage, soffit or finished wall in it',
    }),
    len('stair_headroom', 'Stair headroom', true, { flag: { when: lt('stair_headroom', 80), issue: 'stair headroom < 80″' } }),
    len('stair_width', 'Stair width', true),
    yesno('handrail', 'Handrail now', true),
    text('tear_out', 'Existing finished areas to tear out', true),
    len('exterior_wall_length', 'Exterior wall length to frame (perimeter)', true),
    len('new_partitions', 'New partitions to frame (total length)', true, { note: 'the plan\'s Wall framing = perimeter + new partitions' }),
    caseField('drywall_ceiling_area', 'Ceiling drywall area (when the ceiling is drywall)', 'number', { unit: 'sf' }),
  ],
  shots: [
    shot('each_wall', 'Each wall', true),
    shot('mechanical_area', 'Mechanical area', true),
    shot('sump', 'Sump', hasSump),
    shot('rough_in_stubs', 'Rough-in stubs', eq('existing_rough_in', 'Yes')),
    shot('each_window', 'Each window', true),
    shot('stairs', 'Stairs top and bottom', true),
    shot('lowest_beam_tape', 'Lowest beam/duct with tape showing', true),
    shot('water_marks', 'Water marks', isIn('moisture.signs', ['Stains', 'White crust on block', 'Musty smell', 'Active leak', 'Soft subfloor', 'Mold'])),
  ],
  coverage: [],
};

export const egress: ModuleDef = {
  key: 'egress', version: 1, title: 'Egress (IRC R310)', repeatable: true, instance_label: 'Egress {n} — bedroom', say: [],
  fields: [
    yesno('deck_over_well', 'Deck or porch over well?', true, { flag: { when: eq('deck_over_well', true), issue: 'clear path out R310' } }),
    choice('well_drainage', 'Well drainage', ['Drain', 'Gravel', 'None'], answered('well_width'), { note: 'R? well' }),
    len('sill_vs_grade', 'Opening relative to outside grade — sill elevation vs finished ground', true),
    choice('grade_class', 'Opening relative to outside grade', ['Grade-floor', 'Below-grade', 'Other', 'Uncertain'], true, { hint: 'Not sure? Pick Uncertain. The city confirms it before we price.', note: 'uncertain → AHJ confirmation before price' }),
    yesno('existing_window', 'Existing window here?', true),
    len('clear_width', 'Clear opening width (sash open)', eq('existing_window', true), { hint: 'With the sash open. Egress needs at least 20 in.', note: '≥ 20″' }),
    len('clear_height', 'Clear opening height', eq('existing_window', true), { hint: 'Egress needs at least 24 in high and at least 5.7 sq ft open (5.0 sq ft at or below grade). 20 × 24 alone is not enough.', note: '≥ 24″; and clear area ≥ 5.7 sf, or 5.0 sf for grade-floor or below-grade openings (R310.2.1 and exception)' }),
    derived('clear_area', 'Clear opening area', 'number', 'clear_width * clear_height / 144', {
      unit: 'sf', note: '≥ 5.0 sf for grade-floor or below-grade openings; 5.7 sf otherwise; verify grade classification, see §8.2',
    }),
    len('floor_to_sill', 'Floor to sill', true, { hint: 'Floor to the bottom of the open sash, not the trim. Egress needs 44 in or less.', note: '≤ 44″, measured to the bottom of the clear opening (R310.2.2)' }),
    len('well_width', 'Window well width × projection — width', eq('existing_window', true), { hint: 'Egress wells need at least 36 in each way and 9 sf.', note: 'one W × P entry; ≥ 36″ each, ≥ 9 sf' }),
    len('well_projection', 'Window well width × projection — projection', eq('existing_window', true)),
    derived('well_area', 'Window well area', 'number', 'well_width * well_projection / 144', { unit: 'sf' }),
    len('well_depth', 'Well depth', eq('existing_window', true), { hint: 'Deeper than 44 in needs a permanent ladder or steps in the well.', note: '> 44″ → permanently attached ladder or steps (R310.2.3.1)' }),
    yesno('well_ladder', 'Permanent ladder or steps in the well?', gt('well_depth', 44)),
    caseField('result', 'Result', 'choice', {
        options: ['Meets egress', 'New egress needed'], note: 'needed → basement.egress scope (new_work if missing)',
        maps_to: { scope_key: 'basement.egress', kind: 'new_work' },
      }),
    text('outside', 'Outside at that spot (AC, meter, deck, grade)', true),
  ],
  shots: [shot('window_inside', 'Window inside', true), shot('well_outside', 'Well/outside', true)],
  coverage: [],
};

// ───────────────────────── §7.8 Deck ─────────────────────────
export const DECK_SAY = [
  'How will you use it — eating, grilling, a hot tub, kids?',
  'How big feels right? Let\'s pace it out.',
  'Replacing this one or starting new?',
  'Where do the stairs come down?',
  'Any plans to screen it in later?',
];
const deckAttached = eq('attached', 'Attached');
const deckReplace = eq('new_or_replace', 'Replace');
const deckStairs = gt('stair_runs', 0);
const hotTub = isIn('uses', ['Hot tub']);
export const deck_scope: ModuleDef = {
  key: 'deck_scope', version: 1, title: 'Deck', repeatable: false, say: DECK_SAY,
  fields: [
    choice('rim_band', 'Rim/band at ledger', ['2× lumber', 'LVL', 'I-joist', 'Unknown'], deckAttached, {
      flag: { when: eq('rim_band', 'I-joist'), issue: 'I-joist: engineered detail or freestanding' },
    }),
    yesno('ledger_flashing', 'Existing ledger flashing', deckAttached),
    len('foundation_to_footing', 'Foundation to first footing line', true, {
      flag: { when: answered('foundation_to_footing'), issue: 'Check: footings need undisturbed soil, not foundation backfill' },
    }),
    multi('private_lines', 'Private lines 811 won\'t mark', ['Irrigation', 'Invisible fence', 'Grill gas', 'Garage/shed power', 'None', 'Unknown'], eq('exterior_site.will_dig', true), {
      hint: 'Ask the client. 811 marks only the utility lines — these need a private locator.', note: 'arrange private locate',
    }),
    yesno('egress_below', 'Egress window or well below deck?', true, { flag: { when: eq('egress_below', true), issue: 'clear exit path R310' } }),
    yesno('required_exit_door', 'Required exit door served?', true, { note: 'permit trigger' }),
    len('stair_width', 'Stair width, handrail, landing — width', deckStairs),
    yesno('stair_handrail', 'Stair width, handrail, landing — ≥4 risers handrail check', deckStairs),
    pair('stair_landing', 'Stair width, handrail, landing — landing W×D', deckStairs),
    text('framing_joists', 'Existing framing — joist size/spacing', deckReplace, { note: 'footing reuse needs verification' }),
    text('framing_beam', 'Existing framing — beam', deckReplace),
    text('framing_posts', 'Existing framing — posts', deckReplace),
    yesno('framing_ledger_rot', 'Existing framing — ledger rot', deckReplace),
    num('hot_tub_dry_weight', 'Hot tub — dry weight', 'lb', hotTub, { hint: 'From the spec sheet. Fill in the water weight too — the engineer designs for the filled weight.', note: 'engineer + electrician; the engineer designs for filled weight (water + people), typically 3–5× dry' }),
    num('hot_tub_water_weight', 'Hot tub — water weight', 'lb', hotTub, { hint: 'Gallons on the spec sheet × 8.3 lb.' }),
    text('hot_tub_disconnect', 'Hot tub — GFCI disconnect location', hotTub),
    multi('uses', 'Uses', ['Dining', 'Grill', 'Hot tub', 'Kids', 'Lounging'], true, { flag: { when: hotTub, issue: 'structure + 240 V circuit' } }),
    choice('new_or_replace', 'New or replace', ['New', 'Replace'], true),
    yesno('demo', 'Demo existing deck', deckReplace),
    len('size_along_house', 'Size — along the house', true, { range: [48, 480], precision: 1, note: 'one W × L entry, 48–480 in each' }),
    len('size_out', 'Size — out from the house', true, { range: [48, 480], precision: 1 }),
    derived('deck_area', 'Deck area', 'number', 'size_along_house * size_out / 144', { unit: 'sf' }),
    caseField('railing_length', 'Railing length', 'number', { unit: 'lf' }),
    choice('shape', 'Shape', ['Rectangle', 'Clipped corners', 'Multi-level', 'Wraparound'], true, { hint: 'Not a rectangle? Measure each side and photograph a hand sketch.', note: 'not Rectangle → sketch R' }),
    len('height_at_house', 'Height above grade at the house', true),
    len('height_far_edge', 'Height above grade at the far edge', true, { hint: 'Over 30 in needs guards.', note: '> 30″ → guards required (IRC R312.1.1)' }),
    choice('attached', 'Attached or freestanding', ['Attached', 'Freestanding'], true),
    choice('ledger_siding', 'Siding where the ledger goes', ['Vinyl', 'Wood', 'Fiber cement', 'Stucco', 'Brick veneer', 'Stone'], deckAttached, {
      flag: { when: isIn('ledger_siding', ['Brick veneer', 'Stone']), issue: 'no ledger on veneer — freestanding' },
    }),
    yesno('rim_visible', 'Rim joist visible inside (basement)', deckAttached, {
      shots: [shot('rim_joist_inside', 'Rim joist inside (basement)', all(deckAttached, eq('rim_visible', true)))],
    }),
    len('threshold_to_deck', 'Door threshold to finished deck surface', true),
    count('stair_runs', 'Stair runs', true),
    len('total_rise', 'Total rise at each stair', deckStairs, { hint: 'Grade to the deck surface at each stair.', note: 'riser count derived (max 7¾″)' }),
    choice('landing_surface', 'What\'s at the stair landing', ['Patio', 'Grass', 'Gravel', 'New pad'], deckStairs),
    multi('skirting', 'Skirting / under-deck storage / drainage', ['Skirting', 'Under-deck storage', 'Drainage'], false),
    multi('lights_outlets', 'Lights / outlets', ['Lights', 'Outlets'], false),
    yesno('screen_later', 'Screen porch later', false, { flag: { when: eq('screen_later', true), issue: 'size footings/beams for a roof' } }),
    count('footing_count', 'Footing count', true, {
      hint: 'Start with posts about 8 ft apart. Joe sets the final spacing from the beam size.', note: 'draft: posts ≤ 8′ apart on each beam line; shown as a suggestion that the visitor confirms or corrects on the form',
    }),
    caseField('permit_triggers', 'Permit triggers', 'yesno', {
      note: 'attached, > 30″, > 200 sf, or serves a required exit door', maps_to: { scope_key: 'deck.permit', kind: 'observation' },
    }),
  ],
  shots: [
    shot('house_wall', 'House wall where it attaches', true),
    shot('siding_at_ledger', 'Siding at the ledger close up', true),
    shot('door_threshold', 'Door and threshold', true),
    shot('corners', 'Each corner of the footprint from the yard', true),
    shot('existing_underside', 'Existing deck underside and footings', deckReplace),
    shot('things_in_area', 'Things in the work area', true),
    shot('yard_to_house', 'From the yard back to the house', true),
    shot('shape_sketch', 'Sketch of the deck shape', ne('shape', 'Rectangle'), 'Hand sketch with each side measured. Photograph it.'),
  ],
  coverage: [],
};

// ───────────────────────── §7.9 Whole-home ─────────────────────────
export const WHOLE_SAY = [
  'If we could only do three things, what are they, in order?',
  'All at once, or in phases over time?',
  'Will you live here during the work? If not, where, and until when?',
  'Any dates we have to plan around — school year, a baby, a move?',
  'What about the systems — wiring, plumbing, heat, windows, insulation, roof?',
];
const pre1981 = not(gt('house.year_built', 1980));
export const EXTERIOR_SYSTEMS = ['Windows', 'Siding', 'Roof'];
export const whole_scope: ModuleDef = {
  key: 'whole_scope', version: 1, title: 'Whole-home', repeatable: false, say: WHOLE_SAY,
  fields: [
    text('temp_kitchen_bath', 'Temporary kitchen/bath plan', isIn('living', ['Yes', 'Partly']), { note: 'R? living here' }),
    choice('asbestos_survey', 'Pre-1981 asbestos survey before whole-house demo', ['Done', 'Pending'], pre1981, {
      note: 'R? pre-1981 and demo',
      flag: { when: eq('asbestos_survey', 'Pending'), issue: 'survey before pricing demo; scope/abatement rules confirmed with MDH' },
    }),
    date('asbestos_survey_date', 'Pre-1981 asbestos survey before whole-house demo — date', all(pre1981, eq('asbestos_survey', 'Done'))),
    text('asbestos_survey_provider', 'Pre-1981 asbestos survey before whole-house demo — provider', all(pre1981, eq('asbestos_survey', 'Done'))),
    text('asbestos_survey_result', 'Pre-1981 asbestos survey before whole-house demo — result', all(pre1981, eq('asbestos_survey', 'Done'))),
    text('top_priorities', 'Top priorities, in order', true, { tier: 'record' }),
    choice('phasing', 'All at once or phased', ['All at once', 'Phased'], true),
    choice('living', 'Living here during the work', ['Yes', 'Partly', 'Moving out'], true),
    date('moving_out_until', 'Moving out — until', eq('living', 'Moving out')),
    text('dates', 'Dates to plan around', false),
    multi('systems', 'Systems in scope', ['Rewire', 'Re-pipe', 'HVAC', 'Windows', 'Insulation', 'Siding', 'Roof', 'None'], true, { note: 'each → module required' }),
    text('floor_plan_changes', 'Floor plan changes', true, { note: '→ structure' }),
    yesno('same_flooring', 'Same flooring through the house', true, { note: '→ flooring add-on' }),
    choice('paint_trim', 'Paint and trim throughout', ['All', 'Some', 'None'], true),
    choice('plans', 'Plans', ['Need a drafter', 'Have plans', 'Architect'], true),
  ],
  shots: [shot('every_system', 'Every system', true), shot('each_elevation', 'Each elevation', isIn('systems', EXTERIOR_SYSTEMS), undefined, 'R? exterior work')],
  coverage: [],
};

// ───────────────────────── §7.10 General ─────────────────────────
export const general_scope: ModuleDef = {
  key: 'general_scope', version: 1, title: 'General / other', repeatable: false, say: [],
  fields: [
    text('what', 'What we\'re doing, in the client\'s words', true),
    multi('systems', 'Systems touched', ['Electrical', 'Plumbing', 'HVAC', 'Structure', 'Exterior', 'None'], true),
    text('deadline', 'Anything that must be done by a date', false),
  ],
  shots: [shot('area_two_angles', 'The area, two angles', true)],
  coverage: [],
};

// ───────────────────────── §7.11 Add-on modules ─────────────────────────
export const garage: ModuleDef = {
  key: 'garage', version: 1, title: 'Garage', repeatable: false, say: [],
  fields: [
    choice('new_or_existing', 'New or existing', ['New', 'Existing'], true, { note: 'new → exterior_site, footing required' }),
    yesno('attached', 'Attached to the house?', true, { note: 'evaluates the plan\'s "R? attached"' }),
    pair('size', 'Size', true, { precision: 1, note: '→ garage.slab "Slab area" (sf, new label)' }),
    choice('opener', 'Opener', ['Keep', 'New', 'None'], true),
    choice('slab', 'Slab', ['Good', 'Cracked', 'Heaved', 'Replace'], true),
    text('ceiling', 'Ceiling height / trusses / attic storage', true),
    multi('electrical_wanted', 'Electrical wanted', ['Outlets', 'Lights', 'Subpanel', 'EV charger', 'Heater'], true, { note: '→ panel' }),
    choice('separation', 'Attached: wall and ceiling to the house, door to the house self-closing?', ['In place', 'Missing', 'Not sure'], eq('attached', true), {
      flag: { when: eq('separation', 'Missing'), issue: 'IRC R302.6 separation missing' },
      flags: [{when:eq('separation','Not sure'),issue:'Garage separation not confirmed (IRC R302.6)'}],
    }),
  ],
  shots: [shot('each_side', 'Each side', true), shot('slab', 'Slab', true), shot('overhead_door', 'Overhead door', true), shot('attic', 'Attic', false)],
  coverage: [],
};
/** Child rows of `garage` › "Overhead door(s) width × height | length_pair, repeat". */
export const garage_door: ModuleDef = {
  key: 'garage_door', version: 1, title: 'Overhead door', repeatable: true, instance_label: 'Overhead door {n}', say: [],
  fields: [
    pair('size', 'Overhead door(s) width × height', true, { precision: 1, note: '→ garage.overhead_door "Overhead door count" (ea, new label)' }),
    derived('unit', 'Overhead door (counts 1)', 'count', '1', { unit: 'ea' }),
  ],
  shots: [],
  coverage: [],
};

export const OPENINGS_NOTE = 'keep the opening size so egress is not reduced';
/** Per-window extras of the `openings` add-on; one row per replaced `window` instance (parent). */
export const openings: ModuleDef = {
  key: 'openings', version: 1, title: 'Windows & doors', repeatable: true, instance_label: 'Window {n} — replacement', say: [OPENINGS_NOTE],
  fields: [
    text('inside_trim', 'Inside trim width and profile', true),
    text('stool_apron', 'Stool and apron', true),
    text('outside_trim', 'Outside trim type', true),
    choice('full_frame_or_insert', 'Full-frame or insert', ['Full-frame', 'Insert'], true, { note: `bedroom window: "${OPENINGS_NOTE}" note shown` }),
    text('grids_color', 'Grids/color', true, { note: '→ selections' }),
    yesno('screens', 'Screens', false),
    choice('wall_type', 'Wall type at the window', ['Vinyl', 'Wood lap', 'Fiber cement', 'Stucco', 'Brick veneer', 'Stone', 'Metal'], true, {
      flag: { when: eq('wall_type', 'Stucco'), issue: 'stucco at the window' },
    }),
  ],
  shots: [shot('trim_closeup', 'Trim close-up', true)],
  coverage: [],
};

export const flooring: ModuleDef = {
  key: 'flooring', version: 1, title: 'Flooring', repeatable: false, say: [],
  fields: [
    text('rooms', 'Rooms', true, { hint: 'Name the rooms this floor covers.', note: '`room` instances (reuse): name the Room dimensions instances this flooring covers' }),
    text('layers_now', 'Layers now', true),
    choice('subfloor', 'Subfloor', ['Plywood', 'OSB', 'Plank', 'Concrete'], true),
    len('worst_dip', 'Worst dip over 10 ft', true, { range: [0, 2], precision: 0.0625, flag: { when: gt('worst_dip', 0.1875), issue: 'level before tile/LVP' } }),
    text('transitions', 'Transitions (count, height difference)', true),
    count('stair_treads', 'Stairs: treads / risers / nosing — treads', true, { hint: 'Enter 0 if this floor has no stairs.', note: 'R? stairs — enter 0 when the flooring has no stairs' }),
    count('stair_risers', 'Stairs: treads / risers / nosing — risers', gt('stair_treads', 0)),
    choice('stair_nosing', 'Stairs: treads / risers / nosing — nosing', ['Bullnose', 'Square', 'Stair nose trim'], gt('stair_treads', 0)),
    choice('baseboard', 'Baseboard', ['Remove & reinstall', 'New', 'Shoe only'], true),
    count('doors_undercut', 'Doors to undercut', false),
    text('move_items', 'Appliances / furniture to move', true),
    num('concrete_moisture', 'Concrete moisture', 'pct', eq('subfloor', 'Concrete')),
  ],
  shots: [shot('each_room_floor', 'Each room\'s floor', true), shot('each_transition', 'Each transition', true), shot('stairs', 'Stairs', gt('stair_treads', 0))],
  coverage: [],
};

export const templateModules: ModuleDef[] = [bath_scope, kitchen_scope, kitchen_wall, addition_scope, basement_scope, egress, deck_scope, whole_scope, general_scope];
export const templateChildModules: ModuleDef[] = [kitchen_appliance];
export const addOnModules: ModuleDef[] = [garage, openings, flooring];
export const addOnChildModules: ModuleDef[] = [garage_door];
