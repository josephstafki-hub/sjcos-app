import {curly} from '../../typography.ts';
import {frostZones} from '../../frost.ts';
import {rrpBefore,rrpApplies,rrpYearConflict} from '../../rrp.ts';
// Plan §7.3 shared modules, as executable data. Labels are the plan's words.
import type { ModuleDef } from '../../form-types.ts';
import {
  addon, all, answered, any, caseField, choice, count, date, derived, eq, gt, isIn, len, lt, multi, ne, not, num, pair, shot, signature, text, tileFloor, tpl, wallRemoval, year, yesno,
} from './helpers.ts';

/** Context module (not a plan row, never shown; listed first in each of the 7 templates so it is pinned): the server fills it from
 *  the consult's pins so "template ∈ …" and add-on conditions compile against a real field. */
export const visit: ModuleDef = {
  key: 'visit', version: 1, title: 'Visit context (server-filled)', repeatable: false, say: [],
  fields: [
    num('template_count', 'Number of templates', undefined, false),
    multi('templates', 'Templates on this visit', ['bath', 'kitchen', 'addition', 'basement', 'deck', 'whole', 'general'], true,
      { note: 'Server-filled from the pinned templates; whole-home also lists the nested area templates it was scheduled with. Never asked.' }),
    multi('add_ons', 'Add-ons on this visit', ['garage', 'openings', 'flooring'], false, { note: 'Server-filled from the ticked add-ons. Never asked.' }),
    choice('device', 'Capture device word for the consent notice', ['tablet', 'phone'], false, { note: 'Fills {tablet/phone} in the consent words (§8.1); the one variable in the notice.' }),
  ],
  shots: [], coverage: [],
};

const PHOTO_LINE = 'I’ll take photos of the rooms, closets, the basement and the mechanicals so I can price it right — I’ll keep people and personal things out of them. Is that okay?';

export const house: ModuleDef = {
  key: 'house', version: 1, title: 'House & household', repeatable: false, say: [],
  fields: [
    yesno('photos_ok', 'Photos okay?', true, { say: PHOTO_LINE, hint: 'If no, leave the camera off and write down what you saw instead.', note: 'No disables camera/upload and creates explicit photo alternatives/assumptions; no hidden completeness bypass' }),
    text('permit_city', 'Permit authority — city/township', true, { note: 'prefill sub scope permits', maps_to: { scope_key: 'general.permits', kind: 'client_answer' } }),
    text('permit_building_inspector', 'Permit authority — building/plumbing inspector', true, { hint: 'Usually the city building department. Write the city, or Not sure.', note: 'prefill sub scope permits', maps_to: { scope_key: 'general.permits', kind: 'client_answer' } }),
    choice('permit_electrical', 'Permit authority — electrical', ['City', 'DLI', 'Not sure'], true, { hint: 'Most cities use the state (DLI, the Dept. of Labor and Industry). A few, like Minneapolis and St. Paul, inspect their own. Not sure? Pick Not sure — Joe checks.', note: 'prefill sub scope permits; DLI inspects electrical statewide except cities with their own electrical inspection (e.g. Minneapolis, St. Paul); the licensed electrician files the request. Not sure → Joe confirms from exterior_site.city', maps_to: { scope_key: 'general.permits', kind: 'client_answer' } }),
    text('alarms_locations', 'Smoke and CO alarms now — locations', true, {
      note: 'all templates including add-ons',
      flag: { when: isIn('alarms_missing', ['Missing', 'Unknown']), issue: 'permitted work: review R314/R315; CO within 10 ft of sleeping rooms (299F.51)' },
    }),
    multi('alarms_power', 'Smoke and CO alarms now — hardwired/battery', ['Hardwired', 'Battery'], true),
    choice('alarms_missing', 'Smoke and CO alarms now — missing/unknown', ['None missing', 'Missing', 'Unknown'], true),
    num('water_pressure', 'Water pressure at hose bib', 'psi', any(
      isIn('bath_scope.shower_extras', ['Body sprays', 'Rain head']), tpl('bath'),
      isIn('addition_scope.rooms', ['Bath']), isIn('basement_scope.rooms_wanted', ['Bath']),
    ), { note: 'R? body sprays, rain head or new bath; O otherwise. Record measurement or access assumption' }),
    text('client_list', 'Client\'s own list ("anything you want us to look at")', true, { note: 'from opening line 6' }),
    year('year_built', 'Year built', true, { range: [1850, 2026], hint: 'Ask the client, or use the county record.', note: 'prefill if known' }),
    choice('year_source', 'How we know the year', ['Client said', 'County record', 'Guessed from features'], true),
    yesno('living_in_home', 'Living in the home during the work?', true),
    text('where_during_work', 'Where will you be?', eq('living_in_home', false)),
    text('who_lives_here', 'Who lives here (adults, kids, older adults, anyone with health needs)', true),
    multi('pets', 'Pets', ['None', 'Dog', 'Cat', 'Other'], true),
    text('pets_location', 'Where the pets will be during work', isIn('pets', ['Dog', 'Cat', 'Other'])),
    yesno('decision_makers_here', 'All decision makers here today?', true),
    text('other_deciders', 'Who else decides, and how to reach them', eq('decision_makers_here', false)),
    choice('work_hours', 'Work hours that suit the household', ['7:00–3:30', '8:00–4:30', 'Other'], true),
    text('work_hours_other', 'Work hours that suit the household — other', eq('work_hours', 'Other')),
    text('no_work_times', 'Days or times we must not work (shift sleep, naps, events)', false),
    yesno('hoa', 'HOA or condo association?', true),
    text('hoa_rules', 'HOA rules / approval needed / contact', eq('hoa', true), {
      flag: { when: eq('hoa', true), issue: 'HOA approval may be needed before permit' },
    }),
    text('past_problems', 'Past remodels or known problems (leaks, settling, open permits)', true),
    choice('radon_tested', 'Radon tested?', ['Yes — level', 'No', 'Unknown'], tpl('basement', 'addition', 'whole')),
    num('radon_level', 'Radon tested? — level (pCi/L)', undefined, false, {flag:{kind:'advisory',when:gt('radon_level',3.99),issue:'Radon at or above 4 pCi/L (MDH)'}}),
  ],
  shots: [shot('front_of_house', 'Front of house', true), shot('house_number', 'House number', false)],
  coverage: [
    { key: 'asked_household', text: 'Asked about the household during the work', satisfied_by: ['living_in_home'] },
    { key: 'asked_decision_makers', text: 'Asked who else decides', satisfied_by: ['decision_makers_here'] },
    { key: 'asked_past_problems', text: 'Asked about past problems', satisfied_by: ['past_problems'] },
  ],
};

export const access: ModuleDef = {
  key: 'access', version: 1, title: 'Access & logistics', repeatable: false, say: [],
  fields: [
    choice('parking', 'Where the crew parks', ['Driveway', 'Street', 'Alley', 'Limited'], true),
    text('parking_limited', 'Where the crew parks — limited: details', eq('parking', 'Limited')),
    text('street_parking_rules', 'Street parking rules (permits, snow emergency)', false),
    choice('dumpster_spot', 'Dumpster spot', ['Driveway', 'Street (city permit)', 'Yard', 'Trailer only', 'Not possible'], true, {
      flag: { when: eq('dumpster_spot', 'Street (city permit)'), issue: 'street-use permit' },
    }),
    choice('dumpster_size', 'Dumpster size that fits', ['10 yd', '15 yd', '20 yd'], ne('dumpster_spot', 'Not possible')),
    text('dumpster_hazards', 'Wires, trees or slope at the dumpster spot', false),
    text('path', 'Path from truck to work area (doors, stairs, turns)', true),
    len('narrowest_door', 'Narrowest door or turn on that path', tpl('bath', 'kitchen', 'basement', 'whole'), {
      range: [18, 60], flag: { when: lt('narrowest_door', 30), issue: 'tub/cabinet delivery — check sizes' },
    }),
    choice('staging', 'Where materials can be staged', ['Garage', 'Basement', 'In the room', 'Yard', 'Nowhere'], true),
    choice('crew_bathroom', 'Bathroom the crew may use', ['Yes (which)', 'No — portable toilet'], true),
    text('crew_bathroom_which', 'Bathroom the crew may use — which', eq('crew_bathroom', 'Yes (which)')),
    yesno('outdoor_water_outlet', 'Outdoor water and outlet usable', true),
    choice('entry', 'Getting in when nobody\'s home', ['Someone home', 'Lockbox', 'Garage code', 'Key'], true),
    text('entry_code', 'Getting in — code', false, { hint: 'Kept in SJC OS only. Never shown to the client.', note: 'shown masked, internal only' }),
    text('alarm_system', 'Alarm system (who to call)', false),
    text('protect_move', 'Floors and furniture to protect or move; who moves contents', true),
    text('dust_sensitive', 'Dust-sensitive people or things (asthma, nursery, electronics)', false),
    text('neighbors', 'Neighbors to know about (shared driveway, close houses)', false),
    choice('snow', 'Winter: who clears snow on the path', ['Client', 'SJC', 'N/A'], false),
  ],
  shots: [
    shot('street_driveway', 'Street/driveway', true),
    shot('path_to_work_area', 'Path to work area', true),
    shot('dumpster_spot', 'Dumpster spot', ne('dumpster_spot', 'Not possible')),
  ],
  coverage: [],
};

export const room: ModuleDef = {
  key: 'room', version: 1, title: 'Room dimensions', repeatable: true, instance_label: 'Room {n} — {name}', say: [],
  fields: [
    text('name', 'Room name', true),
    multi('part_of', 'This room is part of', ['Bathroom','Kitchen','Addition','Basement finish','Deck','Whole-home','General / other','Garage','Windows & doors','Flooring'], gt('visit.template_count',1), {hint: 'Pick the job that prices this room’s floor. A hall the kitchen floor runs into is Kitchen, or Flooring if that add-on is on the visit. A bath inside a basement finish is Bathroom only.'}),
    choice('level', 'Level', ['Basement', 'Main', 'Upper', 'Attic', 'Garage'], true),
    text('ahead_wall', 'Wall used as “Ahead” (facing from the entry door)', true, { hint: 'Facing the room from the main door, which wall is ahead?', note: 'orients windows/doors for the floor plan' }),
    len('length', 'Length (wall to wall, longest)', true, { range: [24, 600], precision: 0.125 }),
    len('width', 'Width', true, { range: [24, 600], precision: 0.125 }),
    choice('shape', 'Shape', ['Rectangle', 'L-shape', 'Other'], true, { hint: 'Not a rectangle? Measure each leg and photograph a hand sketch.', note: 'not Rectangle → sketch R + leg length/width R' }),
    len('leg_length', 'Shape — leg length', ne('shape', 'Rectangle'), { range: [24, 600], precision: 0.125 }),
    len('leg_width', 'Shape — leg width', ne('shape', 'Rectangle'), { range: [24, 600], precision: 0.125 }),
    len('ceiling_height', 'Ceiling height', true, { range: [60, 240], warn: { below: 84, text: 'below 7 ft — habitable room?' } }),
    choice('ceiling_type', 'Ceiling type', ['Flat', 'Vaulted', 'Sloped', 'Soffits', 'Drop ceiling', 'Beams'], true),
    len('ceiling_high_point', 'Ceiling high point', isIn('ceiling_type', ['Vaulted', 'Sloped'])),
    choice('floor_finish', 'Floor finish now', ['Hardwood', 'Tile', 'LVP', 'Sheet vinyl', 'Carpet', 'Concrete', 'Other'], true),
    text('floor_layers', 'Layers under the floor (seen at a vent or threshold)', false),
    choice('wall_finish', 'Wall finish', ['Drywall', 'Plaster & lath', 'Paneling', 'Tile', 'Block'], true, {
      flag: { when: eq('wall_finish', 'Plaster & lath'), issue: 'plaster: demo and patch cost' },
    }),
    text('base_trim', 'Base trim height and profile', false),
    len('out_of_level', 'Out of level across the room', any(tpl('kitchen'), tileFloor), { range: [0, 6], hint: 'How much lower the floor’s low side is than its high side — with a laser, or a level held level. Not dips under a straightedge.', note: 'R? kitchen or tile floor; O otherwise. Level (low side vs high side), not flatness; tile flatness (about ¼ in in 10 ft) is the flooring add-on’s worst-dip field' }),
    choice('heat', 'Heat in the room', ['Floor register', 'Baseboard', 'Radiator', 'In-floor', 'None'], true),
    derived('floor_area', 'Floor area', 'number', '(length * width + leg_length * leg_width) / 144', { unit: 'sf', note: 'length × width (+ leg) ÷ 144' }),
    derived('perimeter', 'Perimeter', 'number', '2 * (length + width) / 12', { unit: 'lf' }),
    derived('wall_area', 'Wall area', 'number', 'perimeter * ceiling_height / 12', { unit: 'sf', note: 'perimeter × ceiling − openings; the window/door W × H ÷ 144 of openings placed in this room is subtracted once openings are linked to the room' }),
  ],
  shots: [
    shot('from_doorway', 'From the doorway', true),
    shot('opposite_corner', 'Opposite corner back to the door', true),
    shot('ceiling', 'Ceiling', false),
    shot('floor_at_threshold', 'Floor at threshold', false),
    shot('shape_sketch', 'Sketch of the room shape', ne('shape', 'Rectangle'), 'Hand sketch with each leg measured. Photograph it.'),
  ],
  coverage: [],
};

const replacedOrNew = (k = 'plan') => isIn(k, ['Replace', 'New']);

export const windowModule: ModuleDef = {
  key: 'window', version: 1, title: 'Window', repeatable: true, instance_label: 'Window {n} — {location}', say: [],
  fields: [
    text('location', 'Location (room + what it\'s over)', true),
    choice('wall', 'Wall (from the room\'s entry)', ['Left', 'Ahead', 'Right', 'Behind'], true, { hint: 'Stand in the room’s doorway facing in: left, ahead, right or behind.', note: 'for the floor plan' }),
    len('left_offset', 'Left corner to window edge', tpl('kitchen'), { note: 'R? kitchen; O otherwise. Cabinet layout and floor plan' }),
    len('casing_width', 'Casing width', tpl('kitchen'), { hint: 'Width of the trim around the window. Cabinets have to clear it.', note: 'cabinet clearance' }),
    pair('size', 'Width × height (frame, inside)', true, { range: [12, 144], component_ranges:[[12,144],[12,120]], hint: 'Type both at once, e.g. 36 × 60.', note: '"36 × 60" in one entry; width 12–144 in × height 12–120 in' }),
    len('floor_to_sill', 'Floor to sill', tpl('bath', 'kitchen', 'basement'), { range: [0, 96] }),
    choice('type', 'Type', ['Double-hung', 'Casement', 'Slider', 'Picture', 'Awning', 'Glass block'], true),
    choice('condition', 'Condition', ['Good', 'Fogged', 'Rot', 'Won\'t open'], true),
    choice('plan', 'Plan', ['Keep', 'Replace', 'Remove', 'New'], true, {
      note: '→ windows.replace "Window count" (ea) when Replace; addition.windows_doors in additions',
      maps_to: { scope_key: 'windows.replace', quantity_label: 'Window count', kind: 'measurement' },
    }),
    derived('unit', 'Window (counts 1)', 'count', '1', { unit: 'ea' }),
    caseField('new_unit', 'New window (counts 1 when Plan = New)', 'count', { unit: 'ea' }),
    len('jamb_depth', 'Jamb depth', eq('plan', 'Replace'), { range: [2, 12] }),
    yesno('wet_or_door_glazing', 'Within 60″ of a tub/shower floor or 24″ of a door edge?', any(tpl('bath'), replacedOrNew(), addon('openings')), {
      note: 'R? room is a bath or has a door nearby',
      flag: { when: eq('wet_or_door_glazing', true), issue: 'tempered (IRC R308.4.5 wet area / R308.4.2 next to a door)' },
    }),
    yesno('large_pane', 'Large pane: any single pane larger than 9 sf, with its bottom under 18″ above the floor, its top over 36″, and a walking surface within 36″?', any(replacedOrNew(), addon('openings')), {
      flag: { when: eq('large_pane', true), issue: 'tempered (IRC R308.4.3) unless the walking-surface/barrier exceptions apply — supplier confirms' },
    }),
    yesno('near_stairs', 'Near stairs: within 36″ (side) of stairs or a landing, or within 60″ of the bottom step, with its bottom edge under 36″ above that walking surface?', any(replacedOrNew(), addon('openings')), {
      flag: { when: eq('near_stairs', true), issue: 'tempered (IRC R308.4.6 stairs / R308.4.7 bottom landing)' },
    }),
  ],
  shots: [shot('inside', 'Inside', true), shot('outside', 'Outside', any(replacedOrNew(), addon('openings')))],
  coverage: [],
};

const doorGlass = all(ne('glass', 'None'), any(replacedOrNew(), addon('openings')));
export const door: ModuleDef = {
  key: 'door', version: 1, title: 'Door', repeatable: true, instance_label: 'Door {n} — {location}', say: [],
  fields: [
    text('location', 'Location', true),
    choice('wall', 'Wall', ['Left', 'Ahead', 'Right', 'Behind'], true),
    len('left_offset', 'Left corner to door edge', tpl('kitchen'), { note: 'R? kitchen; O otherwise' }),
    len('casing_width', 'Casing width', tpl('kitchen'), { hint: 'Width of the trim around the door. Cabinets have to clear it.', note: 'cabinet clearance' }),
    pair('slab_size', 'Slab width × height', true, { range: [18, 96], component_ranges:[[18,72],[72,96]], hint: 'Type both at once, e.g. 32 × 80.', note: 'width 18–72 in × height 72–96 in' }),
    choice('type', 'Type', ['Interior passage', 'Bifold', 'Pocket', 'Barn', 'Exterior entry', 'Patio slider', 'French', 'Storm'], true),
    choice('swing', 'Swing', ['In-left', 'In-right', 'Out-left', 'Out-right', 'Slides'], true),
    len('wall_thickness', 'Wall thickness (jamb width)', isIn('plan', ['Replace', 'Move']), { range: [3, 12], hint: 'Measure across the door jamb.', note: 'R? Replace or Relocate (Move)' }),
    len('threshold_step', 'Step at the threshold', false, { range: [0, 12] }),
    choice('plan', 'Plan', ['Keep', 'Replace', 'Remove', 'New', 'Move'], true, {
      note: '→ doors.interior "Door count" when interior Replace/New',
      maps_to: { scope_key: 'doors.interior', quantity_label: 'Door count', kind: 'measurement' },
    }),
    derived('unit', 'Door (counts 1)', 'count', '1', { unit: 'ea' }),
    choice('glass', 'Glass in or beside it', ['None', 'In the door', 'Sidelight or transom', 'Both'], any(replacedOrNew(), addon('openings')), {
      flag: { when: isIn('glass', ['In the door', 'Sidelight or transom', 'Both']), issue: 'tempered (IRC R308.4.1 in a door / R308.4.2 within 24″ of the door edge)' },
    }),
    yesno('large_pane', 'Large pane (sidelight or transom): single pane larger than 9 sf, bottom under 18″, top over 36″, walking surface within 36″?', doorGlass, {
      flag: { when: eq('large_pane', true), issue: 'tempered (IRC R308.4.3) unless exceptions apply' },
    }),
    yesno('near_stairs', 'Near stairs: glass within 36″ (side) of stairs or a landing, or within 60″ of the bottom step, bottom edge under 36″ above it?', doorGlass, {
      flag: { when: eq('near_stairs', true), issue: 'tempered (IRC R308.4.6 / R308.4.7)' },
    }),
  ],
  shots: [shot('room_side', 'Room side', isIn('plan', ['Replace', 'Move'])), shot('other_side', 'Other side', false)],
  coverage: [],
};

const LOADS = ['Induction/electric range', 'Heated floor', 'Hood requiring makeup-air assessment', 'EV charger', 'Hot tub', 'Mini-split', 'Sauna', 'None'];
export const panel: ModuleDef = {
  key: 'panel', version: 1, title: 'Electrical panel', repeatable: true, instance_label: 'Electrical panel {n} — {location}',
  say: ['Never take the panel cover off. Open the door only; photograph the label and the breakers.'],
  fields: [
    text('location', 'Panel location', true),
    choice('main_breaker', 'Main breaker size', ['60 A', '100 A', '125 A', '150 A', '200 A', '400 A', 'Can\'t tell'], true, {
      flag: { when: all(isIn('main_breaker', ['60 A', '100 A']), isIn('new_loads', LOADS.filter((l) => l !== 'None'))), issue: 'service upgrade likely' },
    }),
    choice('brand', 'Brand', ['Square D', 'Eaton (Cutler-Hammer)', 'Siemens', 'GE', 'Murray', 'Federal Pacific (Stab-Lok)', 'Zinsco', 'Pushmatic', 'Fuse box', 'Other'], true, {
      flag: { when: isIn('brand', ['Federal Pacific (Stab-Lok)', 'Zinsco', 'Pushmatic', 'Fuse box']), issue: 'panel likely needs replacing — electrician to confirm' },
    }),
    count('open_spaces', 'Open breaker spaces', true, { range: [0, 60] }),
    text('subpanel', 'Subpanel (where)', false),
    choice('service', 'Service', ['Overhead', 'Underground'], true),
    multi('wiring', 'Wiring seen', ['NM (plastic)', 'Cloth NM', 'Knob & tube', 'Armored (BX)', 'Conduit', 'Aluminum branch'], true, {
      flag: { when: isIn('wiring', ['Knob & tube', 'Aluminum branch']), issue: 'knob & tube or aluminum branch wiring seen' },
    }),
    multi('new_loads', 'New loads this job adds', LOADS, true, { note: '→ electrical scope note' }),
  ],
  shots: [
    shot('door_closed', 'Panel door closed', true),
    shot('label', 'Label inside the door', true),
    shot('breakers', 'Breakers with door open', true),
    shot('meter', 'Meter', false),
  ],
  coverage: [],
};

const SINKS = ['Bath sink', 'Kitchen sink', 'Bar sink'];
export const plumb_fixture: ModuleDef = {
  key: 'plumb_fixture', version: 1, title: 'Plumbing fixture', repeatable: true, instance_label: 'Fixture {n} — {fixture}', say: [],
  fields: [
    choice('fixture', 'Fixture', ['Toilet', 'Bath sink', 'Kitchen sink', 'Tub', 'Shower', 'Tub-shower', 'Laundry', 'Dishwasher', 'Fridge water', 'Bar sink', 'Floor drain'], true),
    choice('plan', 'Plan', ['Keep', 'Replace', 'Move', 'Remove', 'New'], true),
    len('rough_in', 'Toilet rough-in (finished wall to flange center)', eq('fixture', 'Toilet'), {
      range: [9, 15], precision: 0.25, flag: { when: any(lt('rough_in', 11.5), gt('rough_in', 12.5)), issue: '10″/14″ rough — check toilet model' },
    }),
    len('side_clearance', 'Center of toilet to side wall/fixture', eq('fixture', 'Toilet'), {
      flag: { when: lt('side_clearance', 15), issue: 'code needs 15″ each side' },
    }),
    choice('drain_from', 'Drain comes out of', ['Wall', 'Floor'], isIn('fixture', SINKS)),
    len('drain_height', 'Drain height above floor', eq('drain_from', 'Wall')),
    choice('supply', 'Supply pipe', ['Copper', 'PEX', 'CPVC', 'Galvanized', 'Polybutylene (gray)', 'Unknown'], true, {
      flag: { when: isIn('supply', ['Galvanized', 'Polybutylene (gray)']), issue: 'galvanized or polybutylene supply pipe' },
    }),
    choice('shutoffs', 'Shutoff valves under it', ['Work', 'Missing', 'Seized'], true),
    len('space_available', 'Space available for the new fixture', all(isIn('plan', ['Replace', 'New']), isIn('fixture', ['Bath sink', 'Tub', 'Tub-shower'])), { note: 'R? Replace/New (vanity, tub)' }),
    len('move_distance', 'How far it moves', eq('plan', 'Move')),
    choice('below', 'What\'s below', ['Unfinished basement', 'Finished ceiling', 'Crawl', 'Slab'], true, {
      flag: { when: all(eq('below', 'Slab'), eq('plan', 'Move')), issue: 'cut slab' },
    }),
  ],
  shots: [
    shot('fixture', 'Fixture', true),
    shot('under_behind', 'Plumbing under/behind it', isIn('fixture', SINKS)),
    shot('below', 'What\'s below', eq('plan', 'Move')),
  ],
  coverage: [],
};

const largeTubOrSprays = any(isIn('bath_scope.shower_extras', ['Body sprays']), eq('bath_scope.tub_shower_plan', 'Freestanding tub'), gt('bath_scope.new_tub_capacity', 60));
export const water: ModuleDef = {
  key: 'water', version: 1, title: 'Plumbing & water heater', repeatable: false, say: [],
  fields: [
    num('heater_capacity_gal', 'Heater capacity for large tub/body sprays — gallons', 'gal', largeTubOrSprays, { hint: 'Read it off the water heater label. The plumber checks if it’s big enough.', note: 'R? tub >60 gal or body sprays; capacity check by plumber; no invented sizing' }),
    text('heater_recovery', 'Heater capacity for large tub/body sprays — recovery (from the label)', largeTubOrSprays, {
      shots: [shot('heater_capacity_label', 'Water heater label for capacity and recovery', largeTubOrSprays)],
    }),
    text('main_shutoff', 'Main shutoff location', true),
    choice('service_pipe', 'Pipe coming in from the street', ['Copper', 'Galvanized', 'PEX', 'Lead (dull gray, scratches shiny)', 'Unknown'], true, {
      flag: { when: eq('service_pipe', 'Lead (dull gray, scratches shiny)'), issue: 'lead service line — tell client; city program' },
    }),
    choice('heater_type', 'Water heater', ['Gas tank', 'Electric tank', 'Gas tankless', 'Electric tankless', 'Off the boiler'], true, {
      note: 'gas → its venting is a row in hvac › How each fuel-burning appliance vents',
    }),
    year('heater_year', 'Water heater year (from label)', true),
    num('heater_size', 'Water heater size', 'gal', false),
    yesno('stack_cracks', 'Cracks, rust or weeping on the stack?', eq('main_stack', 'Cast iron')),
    choice('main_stack', 'Main drain stack', ['Cast iron', 'PVC-ABS', 'Galvanized', 'Clay', 'Orangeburg'], true, {
      flag: { when: any(eq('main_stack', 'Orangeburg'), all(eq('main_stack', 'Cast iron'), eq('stack_cracks', true))), issue: 'Drain stack is Orangeburg or cracked cast iron — plan on replacing it' },
    }),
    text('main_cleanout', 'Main cleanout location', false),
    text('backups_roots', 'Backups or roots history', false),
    yesno('softener', 'Water softener', false),
    yesno('sump_pump', 'Sump pump', tpl('basement', 'whole')),
  ],
  shots: [shot('main_shutoff', 'Main shutoff', true), shot('heater_label', 'Water heater label', true), shot('main_stack', 'Main stack', false)],
  coverage: [],
};

const HOOD_FLAG = '> 300 cfm in an existing home: HVAC sub calculates makeup air under Minn. R. 1346.0501 (table by year built and appliance venting); atmospheric appliances present → depressurization/backdraft check';
export const hvac: ModuleDef = {
  key: 'hvac', version: 1, title: 'Heating & cooling', repeatable: false, say: [],
  fields: [
    yesno('fuel_appliances', 'Any fuel-burning appliances?', true),

    choice('heat', 'Heat', ['Gas forced air', 'Electric forced air', 'Heat pump', 'Boiler & radiators', 'Electric baseboard', 'In-floor'], true),
    year('furnace_year', 'Furnace/boiler year', false),
    choice('cooling', 'Cooling', ['Central', 'Mini-split', 'Window units', 'None'], true),
    text('ducts_near_work', 'Where ducts run near the work', tpl('kitchen', 'bath', 'basement', 'addition', 'whole')),
    choice('fan_vents_to', 'Bath fan / hood vents to', ['Roof', 'Side wall', 'Soffit', 'Into the attic', 'No vent'], tpl('bath', 'kitchen'), {
      flag: { when: eq('fan_vents_to', 'Into the attic'), issue: 'must vent outside' },
    }),
    num('hood_cfm', 'Planned hood size', 'cfm', tpl('kitchen'), { range: [100, 1500], flag: { when: gt('hood_cfm', 300), issue: HOOD_FLAG } }),
    choice('dryer', 'Clothes dryer', ['Electric, vented outside', 'Gas, vented outside', 'Ventless (heat-pump or condensing)', 'None'], any(gt('hood_cfm', 300), tpl('kitchen', 'basement', 'whole')), {
      note: 'dryer exhaust counts toward 1346.0501',
    }),
    count('other_exhaust_fan_count', 'Other exhaust fans in the house — how many', gt('hood_cfm', 300), {
      hint: 'Bath fans, other kitchen fans and a vented central vacuum all count.', note: 'one Exhaust fan row per fan: where + rated cfm from the label, or "Can\'t tell"; 1346.0501 sums the largest exhausts (bath fans, other kitchen fans, vented central vacuum)',
    }),
    caseField('year_1994_or_later', 'Year built 1994 or later?', 'yesno', {
      note: 'picks the 1346.0501 table for pre- vs post-1994 homes (Table 501.4.3(1) vs (2)); unknown year → HVAC sub uses the more conservative table',
    }),
    yesno('gas_available', 'Gas available at range / dryer', tpl('kitchen')),
  ],
  shots: [shot('furnace_label', 'Furnace label', tpl('addition', 'basement', 'whole')), shot('thermostat', 'Thermostat', false)],
  coverage: [],
};

/** Child rows of `hvac` › "How each fuel-burning appliance vents (one row per appliance)". */
const newExhaust = any(answered('hvac.hood_cfm'), tpl('bath', 'kitchen'), isIn('basement_scope.rooms_wanted', ['Bath']), isIn('addition_scope.rooms', ['Bath', 'Kitchen extension']));
export const hvac_vent: ModuleDef = {
  key: 'hvac_vent', version: 1, title: 'How each fuel-burning appliance vents', repeatable: true, instance_label: 'Vented appliance {n} — {appliance}', say: [],
  fields: [
    choice('appliance', 'Appliance', ['Furnace', 'Boiler', 'Water heater', 'Fireplace or stove', 'Gas dryer', 'Other'], true),
    choice('fuel', 'Fuel', ['Electric — no venting', 'Natural gas', 'Propane', 'Oil', 'Wood', 'Pellet'], true),
    choice('venting', 'Venting', ['Atmospheric', 'Fan-assisted', 'Power-vent', 'Direct-vent sealed', 'Solid fuel', 'None'], true, {
      hint: 'Atmospheric: draft hood or open metal flue to a chimney. Fan-assisted: metal flue, fan inside. Power-vent: one plastic pipe out, fan on top or inside. Direct-vent: two plastic pipes, or one inside another.', note: 'Atmospheric (draft hood or open metal flue into a chimney) / Fan-assisted (metal flue, fan inside the appliance) / Power-vent (one plastic pipe out the wall or roof; fan on top for a water heater, inside for a 90% furnace) / Direct-vent sealed (two pipes or one concentric pipe) / Solid fuel / None. Feeds the 1346.0501 table column',
      flag: { when: all(eq('venting', 'Atmospheric'), newExhaust), issue: 'backdraft risk — HVAC sub checks before pricing' },
    }),
  ],
  shots: [shot('flue_connection', 'Flue connection', ne('venting', 'None'))],
  coverage: [],
};

/** Child rows of `hvac` › "Other exhaust fans in the house (per fan)". */
export const hvac_exhaust_fan: ModuleDef = {
  key: 'hvac_exhaust_fan', version: 1, title: 'Other exhaust fan', repeatable: true, instance_label: 'Exhaust fan {n} — {where}', say: [],
  fields: [
    text('where', 'Other exhaust fans in the house — where', true),
    choice('cfm_source', 'Other exhaust fans in the house — rated cfm from the label, or "Can\'t tell"', ['From the label', 'Can\'t tell'], true),
    num('rated_cfm', 'Other exhaust fans in the house — rated cfm from the label', 'cfm', eq('cfm_source', 'From the label')),
  ],
  shots: [],
  coverage: [],
};

const joistsAsked = any(tileFloor, eq('kitchen_scope.island', 'New'), wallRemoval('walls_to_remove'), tpl('addition'));
export const structure: ModuleDef = {
  key: 'structure', version: 1, title: 'Structure check', repeatable: true, instance_label: 'Structure check {n}', say: [],
  fields: [
    text('joist_size', 'Joist size and spacing (seen from below)', joistsAsked, { hint: 'From the basement, e.g. 2×8 @ 16″.', note: 'e.g. "2×8 @ 16″"; R? tile floor, island, wall removal, addition tie-in' }),
    choice('joist_direction', 'Joist direction', ['Front–back', 'Side–side'], wallRemoval('walls_to_remove')),
    text('walls_to_remove', 'Walls to remove or open up', false),
    choice('bearing', 'Is that wall bearing?', ['Likely bearing', 'Likely not', 'Need engineer'], answered('walls_to_remove'), {
      flag: { when: isIn('bearing', ['Likely bearing', 'Need engineer']), issue: 'wall likely bearing or needs an engineer' },
    }),
    choice('floor_feel', 'Floor feel where tile goes', ['Solid', 'Some bounce', 'Bouncy'], tileFloor, {
      flag: { when: eq('floor_feel', 'Bouncy'), issue: 'bouncy floor where tile goes' },
    }),
    text('sag_cracks', 'Sagging floors, cracked plaster, sticking doors', false),
    choice('foundation', 'Foundation', ['Poured', 'Block', 'Stone', 'Slab', 'Crawl', 'Piers'], true),
    text('foundation_cracks', 'Foundation cracks (where, width)', false),
    text('attic_access', 'Attic access (where, size)', tpl('addition', 'whole', 'bath'), { hint: 'Where the hatch is and how big.', note: 'R? template ∈ addition, whole, bath (fan)' }),
    choice('attic_insulation', 'Attic insulation', ['Fiberglass batts', 'Blown cellulose', 'Blown fiberglass', 'Vermiculite (gray-brown pebbles)', 'None'], answered('attic_access'), {
      flag: { when: eq('attic_insulation', 'Vermiculite (gray-brown pebbles)'), issue: 'don\'t disturb — test for asbestos' },
    }),
  ],
  shots: [shot('joists_from_below', 'Joists from below', joistsAsked), shot('foundation_wall', 'Foundation wall', false), shot('attic', 'Attic', answered('attic_access'))],
  coverage: [],
};

const MOISTURE_SIGNS = ['Stains', 'White crust on block', 'Musty smell', 'Active leak', 'Soft subfloor', 'Mold'];
export const moisture: ModuleDef = {
  key: 'moisture', version: 1, title: 'Moisture check', repeatable: true, instance_label: 'Moisture check {n} — {where}', say: [],
  fields: [
    multi('signs', 'Signs', ['None', ...MOISTURE_SIGNS], true, { flag: { when: isIn('signs', MOISTURE_SIGNS), issue: 'moisture signs seen' } }),
    num('meter', 'Moisture meter at the worst spot', 'pct', false, { range: [0, 100] }),
    text('where', 'Where', isIn('signs', MOISTURE_SIGNS)),
    choice('grade_slope', 'Ground and gutters slope away from the house?', ['Yes', 'Flat', 'Toward house'], tpl('basement', 'addition'), {
      flag: { when: eq('grade_slope', 'Toward house'), issue: 'ground or gutters slope toward the house' },
    }),
  ],
  shots: [shot('worst_spot', 'Worst spot', isIn('signs', MOISTURE_SIGNS))],
  coverage: [],
};

export const PAMPHLET_LINE = 'Because the house was built before 1978, the law requires us to give you this pamphlet about lead-safe work — it\'s called Renovate Right. Could you initial here that you got it?';
export const PAMPHLET_UNKNOWN_YEAR_LINE = curly("We’re not sure the house was built in 1978 or later, so we’re giving you this pamphlet about lead-safe work — it's called Renovate Right. Could you initial here that you got it?");
const before1978 = rrpBefore;
const ASBESTOS = ['9×9 floor tile', 'Popcorn ceiling', 'Pipe or boiler wrap', 'Old duct tape', 'Vermiculite', 'Transite siding'];
export const era: ModuleDef = {
  key: 'era', version: 1, title: 'Era hazards', repeatable: false, say: [],
  fields: [
    yesno('window_door_replacement', 'Window or door replacement in pre-1978 home?', before1978, {
      flag: { when: eq('window_door_replacement', true), issue: 'window replacement never minor repair at any size (745.83); door disturbance assessed separately, conservative RRP review' },
    }),
    text('renovator_name', 'Certified renovator assigned — name', rrpApplies, { note: 'missing/expired blocks paint-disturbing trade readiness' }),
    text('renovator_cert', 'Certified renovator assigned — cert #', rrpApplies),
    date('renovator_expiry', 'Certified renovator assigned — expiry', rrpApplies),
    yesno('firm_cert_on_file', 'SJC firm certification on file', rrpApplies, { hint: 'Check the expiry date.', note: 'verify expiry' }),
    text('firm_cert_number', 'SJC firm certification — cert #', rrpApplies),
    date('firm_cert_expiry', 'SJC firm certification — expiry (verify)', rrpApplies),
    choice('kids_pregnant', 'Kids under 6 or pregnant person in home', ['Yes', 'No', 'Declined'], rrpApplies, { hint: 'Yes or no only. No names or medical details.', note: 'containment and cleaning plan; no identity/medical details' }),
    yesno('before_1978', 'Built before 1978?', true, { hint: 'Filled from Year built. Change it if that’s wrong.', note: 'filled from Year built, editable (prefill: derivationCases era.before_1978)' }),
    text('year_override_reason', 'How do we know it was built in 1978 or later?', rrpYearConflict, {hint:'If Year built is wrong, change Year built instead.',flag:{when:all(rrpYearConflict,{not:answered('era.year_override_reason')}),issue:'Year and pre-1978 answer disagree — record the reason before closing'}}),
    yesno('disturbs_paint', 'Will the work disturb more than 6 sq ft of painted surface in a room, or 20 sq ft outside?', before1978, { note: 'EPA RRP rule (40 CFR 745 Subpart E)' }),
    yesno('pamphlet_given', 'Renovate Right pamphlet given', rrpApplies, {
      flag: { when: eq('pamphlet_given', false), issue: 'Renovate Right not given — give before work starts' },
      say: PAMPHLET_LINE,
      hint: 'Give it no more than 60 days before work starts, and get their initials. If work starts later, we give it again.', note: 'R? RRP applies (including window replacement). Pamphlet must reach the client within 60 days before work starts; if the start is later, the app files a to-do to re-deliver it before start',
    }),
    signature('pamphlet_initials', 'Renovate Right pamphlet — client initials', rrpApplies, { note: 'client initials on SignaturePad' }),
    choice('lead_plan', 'Lead: plan', ['Assume lead present', 'Test kit', 'Lab test', 'Not needed'], before1978, {hint:'Test kit or Lab test means we still have to test: price lead-safe work until the result is in. Tested today and no lead on every surface? Pick Not needed. Lead found? Pick Assume lead present.',note:'40 CFR 745.82(a)',flag:{kind:'advisory',hint:'Lead-safe work can only be skipped after a lead test shows none. Pick another plan, or answer Yes just below if a test showed no lead. If not, decide it in Before you wrap.',when:all(rrpApplies,eq('lead_plan','Not needed'),any(not(answered('lead_test_negative')),eq('lead_test_negative',false))),issue:'RRP applies but the lead plan is Not needed — price lead-safe work unless a recorded negative lead test shows no lead (745.82(a))'}}),
    yesno('lead_test_negative', 'Has a lead test already shown no lead where we\'ll work?', all(before1978, eq('lead_plan','Not needed')), {hint:'Yes only if SJC has a copy covering every painted surface we’ll disturb: a licensed lead inspector’s or risk assessor’s report (not a home inspection); an EPA-recognized kit used by a certified renovator; or an EPA-recognized lab test of paint chips a certified renovator took. A test the homeowner did doesn’t count.'}),
    multi('asbestos', 'Possible asbestos seen', ['None', ...ASBESTOS], not(gt('house.year_built', 1980)), {
      flag: { when: isIn('asbestos', ASBESTOS), issue: 'test before demo; abatement by an MDH-licensed contractor — confirm residential rules with MDH/counsel' },
    }),
    yesno('knob_tube', 'Knob & tube seen', not(gt('house.year_built', 1949)), { flag: { when: eq('knob_tube', true), issue: 'knob & tube seen' } }),
  ],
  shots: [shot('suspect_material', 'Each suspect material', isIn('asbestos', ASBESTOS))],
  coverage: [],
};

const tieIn = any(tpl('addition'), eq('garage.attached', true));
export const exterior_site: ModuleDef = {
  key: 'exterior_site', version: 1, title: 'Exterior & site', repeatable: false, say: [],
  fields: [
    text('city', 'City (permit + code)', true, { hint: 'Filled from the address.', note: 'prefill from address' }),
    choice('survey', 'Survey', ['Client has one', 'County GIS only', 'None'], true),
    len('lot_line_front', 'Distance from the new work to front / side / rear lot lines — front', true, {
      precision: 1,
      flag: { when: all(answered('lot_line_front'), answered('lot_line_side'), answered('lot_line_rear')), issue: 'check the city setback for these distances (Joe checks the city)' },
    }),
    len('lot_line_side', 'Distance from the new work to front / side / rear lot lines — side', true, { precision: 1 }),
    len('lot_line_rear', 'Distance from the new work to front / side / rear lot lines — rear', true, { precision: 1 }),
    text('easements', 'Easements or utilities across the lot', false),
    len('slope', 'Slope across the work area (high to low)', true, { range: [0, 120] }),
    multi('things_in_area', 'Things in the work area', ['Gas meter', 'AC unit', 'Dryer vent', 'Hose bib', 'Electric service', 'Window wells', 'None'], true),
    yesno('will_dig', 'Will we dig?', true, { hint: 'Whoever digs calls 811 at least 2 business days ahead. 811 doesn’t mark private lines — yard lights, sprinklers, gas to a grill.', note: 'yes → "Gopher State One Call (811) before digging" (MN Stat. 216D)' }),
    text('trees', 'Trees, roots, shrubs in the way', true),
    len('narrowest_gate', 'Narrowest gate or gap for equipment', any(tpl('addition'), addon('garage'))),
    choice('siding', 'Siding', ['Vinyl', 'Wood lap', 'Fiber cement', 'Stucco', 'Brick veneer', 'Stone', 'Metal'], true),
    text('match_siding', 'Match the existing siding? Where to get it', any(tpl('addition'), addon('garage'))),
    num('roof_pitch', 'Existing roof pitch', 'pitch', tieIn, { hint: 'Rise in inches per 12, e.g. 6 for a 6/12 roof.', note: 'x/12' }),
    caseField('pitch_factor', 'Pitch factor √(1 + (pitch/12)²)', 'number'),
    choice('roofing', 'Existing roofing', ['Asphalt', 'Metal', 'Cedar', 'Flat membrane'], tieIn),
  ],
  shots: [shot('each_side', 'Each side of the house the work touches', true), shot('things_in_area', 'Things in the work area', true), shot('lot_line_markers', 'Lot-line markers', false)],
  coverage: [],
};

export const footing: ModuleDef = {
  key: 'footing', version: 1, title: 'Footings & frost', repeatable: false, say: [],
  fields: [
    choice('frost_zone', 'County frost zone', frostZones.map(z=>z.label), true, {hint:'Confirm the county in the city’s handout. The city requirement stays editable.',note:'Minn. R. 1303.1600: Zone I northern counties 60 in; Zone II southern counties 42 in.'}),
    len('required_depth', 'Footing depth the city requires', true, {
      hint: '42 in across southern Minnesota, metro included. 60 in in the northern counties. The city’s handout is the final word.', note: 'default 42 in. MN Rules 1303.1600: 42″ in the southern zone (metro), 60″ in the northern; confirm on the city\'s handout; floating option requires documented Minn. R. 1303.1600 criteria and city approval',
    }),
    len('planned_depth', 'Planned footing depth', true, {flag:{when:lt('depth_margin',0),issue:'Planned footing is shallower than the city requirement — get a written city-approved detail'}}),
    derived('depth_margin', 'Planned depth minus city requirement', 'number', 'planned_depth - required_depth'),
    choice('footing_type', 'Footing type planned', ['Poured piers', 'Helical piles', 'Full foundation', 'Frost-protected shallow', 'Floating (freestanding, low deck — city must allow)'], true, { flag: { when: any(isIn('footing_type', ['Frost-protected shallow', 'Floating (freestanding, low deck — city must allow)']), lt('required_depth', 42)), issue: 'Shallow footing — written city-approved detail before pricing (Minn. R. 1303.1600)' } }),
    choice('reusable', 'Existing footings reusable?', ['Yes', 'No', 'Unknown'], eq('deck_scope.new_or_replace', 'Replace'), { note: 'R? replacing a deck/porch' }),
    text('old_concrete', 'Old concrete or roots where we\'d dig', false),
  ],
  shots: [],
  coverage: [],
};

export const SELECTIONS_SAY = 'For each of these, do you already have something picked, a direction, or no idea yet? No idea is fine — it shows as an allowance.';
export const selections: ModuleDef = {
  key: 'selections', version: 1, title: 'Selections & allowances', repeatable: true, instance_label: '{decision}',
  say: [SELECTIONS_SAY],
  fields: [
    text('decision', 'Decision', true, { note: 'one row per decision the template lists (prefilled from the template list)' }),
    choice('status', 'Status', ['Exact product picked', 'A direction', 'No idea yet'], true, { note: '→ set_design_path exact / defined / undefined' }),
    text('product', 'Product (brand, model, finish, link)', eq('status', 'Exact product picked'), { hint: 'A real product: brand, model, finish or a link. Never “or equal”.', note: '→ apply_client_product (real product only — no "or equal")' }),
    text('direction', 'Direction (style, color, material, a photo)', eq('status', 'A direction'), {
      shots: [shot('direction_photo', 'Direction photo', eq('status', 'A direction'))],
    }),
    choice('who_buys', 'Who buys it', ['SJC', 'Client'], true, { note: 'client-supplied → exclusion note' }),
    text('budget_words', 'What the client said about budget for it (their words)', false, { hint: 'Write down their words. Never give a price.', note: 'never a price from us' }),
    yesno('showroom', 'Wants a showroom visit', false),
  ],
  shots: [],
  coverage: [],
};

export const closing: ModuleDef = {
  key: 'closing', version: 1, title: 'Closing', repeatable: false, say: [],
  fields: [
    text('summary', 'Walk-through summary text', false, { hint: 'What the client initialed.' }),
    date('estimate_promised', 'Formal estimate promised by', true, { hint: 'Joe gets a to-do for this date.', note: 'files Joe\'s to-do' }),
    signature('client_initials', 'Client initials — "This is what we went over"', true, { note: 'or skip with reason' }),
    choice('best_contact', 'Best way to reach them with questions', ['Call', 'Text', 'Email'], true),
    text('client_questions', 'Client\'s questions', false),
    text('worried', 'Anything that worried you (internal, not shown to client)', false, { hint: 'Goes to Joe only. The client never sees it.', note: 'goes to Joe' }),
  ],
  shots: [],
  coverage: [],
};

/** The 16 shared modules of plan §7.3, in plan order. */
export const sharedModules: ModuleDef[] = [house, access, room, windowModule, door, panel, plumb_fixture, water, hvac, structure, moisture, era, exterior_site, footing, selections, closing];
/** Child-row modules that carry the plan's "one row per …" sub-tables of shared modules. */
export const sharedChildModules: ModuleDef[] = [hvac_vent, hvac_exhaust_fan];
