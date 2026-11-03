// Full-fidelity checks for the executable consult forms seed (plan §7.2–§7.11, §8.1).
// The EXPECTED tables below are transcribed from docs/plans/in-home-consult-plan.md, not read from the seed.
// Codes: R = required always · C = required when (R?) · O = optional · D = derived (never asked).
// Tier: P = Price-critical · Rec = Record. Unit last when the row has one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as seed from '../lib/consult/forms/seed.ts';
import { compileCondition } from '../lib/consult/forms/conditions.ts';
import { formulaReferences } from '../lib/consult/forms/formula.ts';
import { consultCompleteness } from '../lib/consult/completeness.ts';

const EXPECTED_FIELDS = {
  visit: 'templates R P|add_ons O Rec|device O Rec',
  house: 'photos_ok R P|permit_city R P|permit_building_inspector R P|permit_electrical R P|alarms_locations R P|alarms_power R P|alarms_missing R P|water_pressure C P psi|client_list R P|year_built R P|year_source R P|living_in_home R P|where_during_work C P|who_lives_here R P|pets R P|pets_location C P|decision_makers_here R P|other_deciders C P|work_hours R P|work_hours_other C P|no_work_times O Rec|hoa R P|hoa_rules C P|past_problems R P|radon_tested C P|radon_level O Rec',
  access: 'parking R P|parking_limited C P|street_parking_rules O Rec|dumpster_spot R P|dumpster_size C P|dumpster_hazards O Rec|path R P|narrowest_door C P in|staging R P|crew_bathroom R P|crew_bathroom_which C P|outdoor_water_outlet R P|entry R P|entry_code O Rec|alarm_system O Rec|protect_move R P|dust_sensitive O Rec|neighbors O Rec|snow O Rec',
  room: 'name R P|level R P|ahead_wall R P|length R P in|width R P in|shape R P|leg_length C P in|leg_width C P in|ceiling_height R P in|ceiling_type R P|ceiling_high_point C P in|floor_finish R P|floor_layers O Rec|wall_finish R P|base_trim O Rec|out_of_level C P in|heat R P|floor_area D P sf|perimeter D P lf|wall_area D P sf',
  window: 'location R P|wall R P|left_offset C P in|casing_width C P in|size R P in|floor_to_sill C P in|type R P|condition R P|plan R P|jamb_depth C P in|wet_or_door_glazing C P|large_pane C P|near_stairs C P|unit D P ea|new_unit D P ea',
  door: 'location R P|wall R P|left_offset C P in|casing_width C P in|slab_size R P in|type R P|swing R P|wall_thickness C P in|threshold_step O Rec in|plan R P|unit D P ea|glass C P|large_pane C P|near_stairs C P',
  panel: 'location R P|main_breaker R P|brand R P|open_spaces R P ea|subpanel O Rec|service R P|wiring R P|new_loads R P',
  plumb_fixture: 'fixture R P|plan R P|rough_in C P in|side_clearance C P in|drain_from C P|drain_height C P in|supply R P|shutoffs R P|space_available C P in|move_distance C P in|below R P',
  water: 'stack_cracks C P|heater_capacity_gal C P gal|heater_recovery C P|main_shutoff R P|service_pipe R P|heater_type R P|heater_year R P|heater_size O Rec gal|main_stack R P|main_cleanout O Rec|backups_roots O Rec|softener O Rec|sump_pump C P',
  hvac: 'fuel_appliances R P|heat R P|furnace_year O Rec|cooling R P|ducts_near_work C P|fan_vents_to C P|hood_cfm C P cfm|dryer C P|other_exhaust_fan_count C P ea|year_1994_or_later D P|gas_available C P',
  hvac_vent: 'appliance R P|fuel R P|venting R P',
  hvac_exhaust_fan: 'where R P|cfm_source R P|rated_cfm C P cfm',
  structure: 'joist_size C P|joist_direction C P|walls_to_remove O Rec|bearing C P|floor_feel C P|sag_cracks O Rec|foundation R P|foundation_cracks O Rec|attic_access C P|attic_insulation C P',
  moisture: 'signs R P|meter O Rec pct|where C P|grade_slope C P',
  era: 'year_override_reason C P|window_door_replacement C P|renovator_name C P|renovator_cert C P|renovator_expiry C P|firm_cert_on_file C P|firm_cert_number C P|firm_cert_expiry C P|kids_pregnant C P|before_1978 R P|disturbs_paint C P|pamphlet_given C P|pamphlet_initials C P|lead_plan C P|asbestos C P|knob_tube C P',
  exterior_site: 'city R P|survey R P|lot_line_front R P in|lot_line_side R P in|lot_line_rear R P in|easements O Rec|slope R P in|things_in_area R P|will_dig R P|trees R P|narrowest_gate C P in|siding R P|match_siding C P|roof_pitch C P pitch|pitch_factor D P|roofing C P',
  footing: 'frost_zone R P|planned_depth R P in|depth_margin D P|required_depth R P in|footing_type R P|reusable C P|old_concrete O Rec',
  selections: 'decision R P|status R P|product C P|direction C P|who_buys R P|budget_words O Rec|showroom O Rec',
  closing: 'summary R P|client_initials R P|estimate_promised R P|best_contact R P|client_questions O Rec|worried O Rec',
  bath_scope: 'new_tub_capacity O Rec gal|existing_tub_material R P|tub_drain_end C P|shower_drain_center C P in|wet_wall_exterior R P|wet_wall_framing C P|valve_brand R P|valve_cartridge R P|valve_plan R P|vent_stack_route C P|fan_label_cfm C P cfm|fan_route C P|fan_duct_length C P in|fan_elbows C P ea|fan_exit C P|fan_switch C P|elec_gfci R P|elec_receptacles R P ea|elec_dedicated_20a R P|elec_light_locations R P|toilet_front_clearance C P in|threshold_thickness R P in|heated_floor_area C P sf|bath_type R P|only_bathroom R P|top_changes R Rec|tub_shower_plan R P|existing_length C P in|existing_width C P in|new_shower_width C P in|new_shower_depth C P in|curb C P|niche O Rec|bench O Rec|glass C P|valve_type O Rec|shower_extras O Rec|wall_tile_height R P|heated_floor R P|vanity_wall R P in|vanity_width R P in|vanity_excess D P in|mirror O Rec|mirror_stud_bay C P|toilet_plan R P|fan_now R P|window_in_shower R P|grab_bars O Rec|storage_wanted O Rec|tile_height_in D P in|kept_tub_area D P sf|wall_tile_area D P sf',
  kitchen_scope: 'hood_exit R P|hood_route C P|hood_joists C P|hood_duct_length C P in|hood_elbows C P ea|hood_duct_size C P in|gas_line_location C P|gas_line_shutoff C P|gas_line_size C P|floor_layers_height R P|dw_opening_height R P in|circuits_countertop_20a R P ea|circuit_dishwasher R P|circuit_disposal R P|circuit_microwave R P|circuit_fridge R P|island_below C P|island_below_joists C P|recessed_above C P|recessed_above_joists C P|how_they_cook R Rec|layout R P|walls_to_open C P|island R P|island_length C P in|island_depth C P in|island_seats O Rec ea|cabinets R P|upper_height R P|soffits R P|backsplash_height R P|sink_stays R P|sink_base_width R P in|extras O Rec|fridge_space R P in|range_width R P|hood_type R P|lights_wanted O Rec|floor_continues R P|pantry O Rec|backsplash_height_in D P in|island_run D P in|island_top_area D P sf',
  kitchen_appliance: 'appliance R P|type R P|fuel R P|width R P in|plan R P|who_buys R P|model_status C P|model_number C P|cutout_width C P in|cutout_height C P in|cutout_depth C P in|voltage C P|amps C P amp|gas C P|panel_ready C P',
  kitchen_wall: 'soffit_size C P in|letter R P|length_counter R P in|length_ceiling O Rec in|plumb_difference D P in|ceiling_height R P in|base_run R P in|upper_run O P in|wall_items R P|corner_square O Rec',
  addition_scope: 'soils R P|tiein_foundation_type R P|tiein_foundation_top R P in|tiein_footing_seen R P|tiein_footing_depth C P in|openings_lost_count R P ea|openings_lost_room C P|lot_hardcover R P sf|lot_shoreland R P|lot_floodplain R P|lot_watershed R P|lot_height_limit R P|lot_survey_required R P|utilities_sewer_water R P|utilities_laterals R P|utilities_gas R P|utilities_meter_in_footprint R P|septic_well C P|hvac_furnace_btuh R P BTU/h|hvac_furnace_year R P|hvac_ac_tons R P ton|hvac_duct_path R P|hvac_manual_j R P|roof_overhang R P in|roof_fascia_height R P in|roof_gutters R P|roof_within_6ft R P|roof_attic_vent_path R P|protected_trees O Rec|space_for R P|rooms R P|stories R P|foundation_wanted R P|footprint_along_house R P in|footprint_out R P in|footprint_area D P sf|joins R P|tiein_wall_length R P in|floor_above_grade R P in|floor_step R P|eave_height R P in|roof_style R P|inside_ceiling R P|plans R P|wall_height D P in|eave_overhang_area D P sf',
  basement_scope: 'water_details C P|insulation_now R P|insulation_thickness C P in|rim_insulated R P|slab_condition R P|floor_drains R P|sump_sealed_lid C P|sump_battery C P|sump_discharge C P|gravity_drain C P|drain_depth C P in|drain_direction C P|fuel_enclosed R P|service_clearance R P in|furnace_input R P BTU/h|supply_return R P|reroute C P|stair_storage R P|rooms_wanted R P|water_ever R P|existing_rough_in C P|ejector_pit C P|ceiling R P|floor_to_joists R P in|lowest_beam R P in|finished_ceiling D P in|must_stay_reachable R P|stair_headroom R P in|stair_width R P in|handrail R P|tear_out R P|exterior_wall_length R P in|new_partitions R P in|drywall_ceiling_area D P sf',
  egress: 'well_ladder C P|deck_over_well R P|well_drainage C P|sill_vs_grade R P in|grade_class R P|existing_window R P|clear_width C P in|clear_height C P in|clear_area D P sf|floor_to_sill R P in|well_width C P in|well_projection C P in|well_area D P sf|well_depth C P in|result D P|outside R P',
  deck_scope: 'rim_band C P|ledger_flashing C P|foundation_to_footing R P in|private_lines C P|egress_below R P|required_exit_door R P|stair_width C P in|stair_handrail C P|stair_landing C P in|framing_joists C P|framing_beam C P|framing_posts C P|framing_ledger_rot C P|hot_tub_dry_weight C P lb|hot_tub_water_weight C P lb|hot_tub_disconnect C P|uses R P|new_or_replace R P|demo C P|size_along_house R P in|size_out R P in|deck_area D P sf|railing_length D P lf|shape R P|height_at_house R P in|height_far_edge R P in|attached R P|ledger_siding C P|rim_visible C P|threshold_to_deck R P in|stair_runs R P ea|total_rise C P in|landing_surface C P|skirting O Rec|lights_outlets O Rec|screen_later O Rec|footing_count R P ea|permit_triggers D P',
  whole_scope: 'temp_kitchen_bath C P|asbestos_survey C P|asbestos_survey_date C P|asbestos_survey_provider C P|asbestos_survey_result C P|top_priorities R Rec|phasing R P|living R P|moving_out_until C P|dates O Rec|systems R P|floor_plan_changes R P|same_flooring R P|paint_trim R P|plans R P',
  general_scope: 'what R P|systems R P|deadline O Rec',
  garage: 'new_or_existing R P|attached R P|size R P in|opener R P|slab R P|ceiling R P|electrical_wanted R P|separation C P',
  garage_door: 'size R P in|unit D P ea',
  openings: 'inside_trim R P|stool_apron R P|outside_trim R P|full_frame_or_insert R P|grids_color R P|screens O Rec|wall_type R P',
  flooring: 'rooms R P|layers_now R P|subfloor R P|worst_dip R P in|transitions R P|stair_treads R P ea|stair_risers C P ea|stair_nosing C P|baseboard R P|doors_undercut O Rec ea|move_items R P|concrete_moisture C P pct',
};

const EXPECTED_SHOTS = {
  visit: '', house: 'front_of_house R|house_number O', access: 'street_driveway R|path_to_work_area R|dumpster_spot C',
  room: 'from_doorway R|opposite_corner R|ceiling O|floor_at_threshold O|shape_sketch C', window: 'inside R|outside C', door: 'room_side C|other_side O',
  panel: 'door_closed R|label R|breakers R|meter O', plumb_fixture: 'fixture R|under_behind C|below C',
  water: 'main_shutoff R|heater_label R|main_stack O|heater_capacity_label C', hvac: 'furnace_label C|thermostat O', hvac_vent: 'flue_connection C', hvac_exhaust_fan: '',
  structure: 'joists_from_below C|foundation_wall O|attic C', moisture: 'worst_spot C', era: 'suspect_material C',
  exterior_site: 'each_side R|things_in_area R|lot_line_markers O', footing: '', selections: 'direction_photo C', closing: '',
  bath_scope: 'room_from_door R|toilet_and_floor R|vanity_open R|tub_valve_wall R|ceiling_and_fan R|floor_at_threshold R|ceiling_below C|access_panel O|vent_stack C',
  kitchen_scope: 'sink_base_open R|range_hood_labels R|fridge_space R|ceiling_and_soffits R|floor_transitions R|basement_ceiling_under_sink C', kitchen_appliance: '', kitchen_wall: 'straight_on R',
  addition_scope: 'every_side R|tiein_wall_inside R|tiein_wall_outside R|roof_at_tiein R|foundation_at_tiein R|staked_corners R|equipment_path R|trees_utilities R|septic_well_sketch C',
  basement_scope: 'each_wall R|mechanical_area R|sump C|rough_in_stubs C|each_window R|stairs R|lowest_beam_tape R|water_marks C|service_clearance R|reroute C',
  egress: 'window_inside R|well_outside R',
  deck_scope: 'house_wall R|siding_at_ledger R|door_threshold R|corners R|existing_underside C|things_in_area R|yard_to_house R|shape_sketch C|rim_joist_inside C',
  whole_scope: 'every_system R|each_elevation C', general_scope: 'area_two_angles R',
  garage: 'each_side R|slab R|overhead_door R|attic O', garage_door: '', openings: 'trim_closeup R', flooring: 'each_room_floor R|each_transition R|stairs C',
};

// Every ⚑ in the plan, with a fragment of its required text (citations where the plan gives one).
const EXPECTED_FLAGS = {
  'era.pamphlet_given':'Renovate Right not given', 'footing.footing_type':'Shallow footing', 'footing.planned_depth':'shallower than the city requirement', 'era.year_override_reason':'Year and pre-1978 answer disagree',
  'house.alarms_locations': 'R314/R315; CO within 10 ft of sleeping rooms (299F.51)', 'house.hoa_rules': 'HOA approval may be needed before permit',
  'access.dumpster_spot': 'street-use permit', 'access.narrowest_door': 'tub/cabinet delivery — check sizes', 'room.wall_finish': 'plaster: demo and patch cost',
  'window.wet_or_door_glazing': 'IRC R308.4.5 wet area / R308.4.2 next to a door', 'window.large_pane': 'IRC R308.4.3', 'window.near_stairs': 'R308.4.6 stairs / R308.4.7 bottom landing',
  'door.glass': 'IRC R308.4.1 in a door / R308.4.2 within 24″ of the door edge', 'door.large_pane': 'IRC R308.4.3', 'door.near_stairs': 'R308.4.6 / R308.4.7',
  'panel.main_breaker': 'service upgrade likely', 'panel.brand': 'panel likely needs replacing — electrician to confirm', 'panel.wiring': 'aluminum branch',
  'plumb_fixture.rough_in': '10″/14″ rough — check toilet model', 'plumb_fixture.side_clearance': 'code needs 15″ each side', 'plumb_fixture.supply': 'polybutylene', 'plumb_fixture.below': 'cut slab',
  'water.service_pipe': 'lead service line — tell client; city program', 'water.main_stack': 'Orangeburg; Cast iron with cracks',
  'hvac.fan_vents_to': 'must vent outside', 'hvac.hood_cfm': 'Minn. R. 1346.0501 (table by year built and appliance venting); atmospheric appliances present → depressurization/backdraft check',
  'hvac_vent.venting': 'backdraft risk — HVAC sub checks before pricing',
  'structure.bearing': 'engineer', 'structure.floor_feel': 'bouncy', 'structure.attic_insulation': 'don\'t disturb — test for asbestos',
  'moisture.signs': 'moisture', 'moisture.grade_slope': 'toward the house',
  'era.window_door_replacement': 'window replacement never minor repair at any size (745.83)', 'era.asbestos': 'MDH-licensed contractor', 'era.knob_tube': 'knob & tube',
  'exterior_site.lot_line_front': 'check the city setback for these distances (Joe checks the city)',
  'bath_scope.existing_tub_material': 'cast iron: 2-person demo / break-up', 'bath_scope.wet_wall_exterior': 'MN freeze risk', 'bath_scope.fan_duct_length': '1346/1322 airflow',
  'bath_scope.toilet_front_clearance': '<24″; 4714/UPC; also 15″ each side, 30″ centre-to-centre', 'bath_scope.only_bathroom': 'portable toilet', 'bath_scope.curb': 'recess the floor — check joists',
  'bath_scope.vanity_width': '> wall available', 'bath_scope.toilet_plan': 'carrier + 2×6 wall', 'bath_scope.window_in_shower': 'tempered + wet-wall window detail',
  'kitchen_scope.hood_joists': 'crosses joists: framing work', 'kitchen_scope.dw_opening_height': '<34½″ dishwasher clearance', 'kitchen_scope.island_below': 'drain/vent trench', 'kitchen_scope.soffits': 'can\'t remove soffit freely',
  'kitchen_wall.length_ceiling': 'out of plumb if different by > 1/4″',
  'addition_scope.soils': 'soil check/engineer', 'addition_scope.openings_lost_count': 'Check: does this remove a bedroom’s egress window?', 'addition_scope.lot_shoreland': 'shoreland/floodplain/watershed; confirm city survey requirement',
  'addition_scope.utilities_meter_in_footprint': 'meter in footprint: relocation', 'addition_scope.septic_well': 'setbacks', 'addition_scope.hvac_manual_j': 'missing load calculation', 'addition_scope.stories': 'engineer for existing structure',
  'basement_scope.rim_insulated': '1322 wall/rim insulation; sub verifies required R-values', 'basement_scope.fuel_enclosed': 'combustion air/clearances under 1346', 'basement_scope.stair_storage': 'enclosed side ½″ drywall R302.7',
  'basement_scope.water_ever': 'moisture plan', 'basement_scope.lowest_beam': 'below 6′4″ under beams/ducts (IRC R305.1.1)', 'basement_scope.stair_headroom': '< 80″',
  'egress.deck_over_well': 'clear path out R310',
  'deck_scope.rim_band': 'I-joist: engineered detail or freestanding', 'deck_scope.foundation_to_footing': 'undisturbed soil, not foundation backfill', 'deck_scope.egress_below': 'clear exit path R310',
  'deck_scope.uses': 'structure + 240 V circuit', 'deck_scope.ledger_siding': 'no ledger on veneer — freestanding', 'deck_scope.screen_later': 'size footings/beams for a roof',
  'whole_scope.asbestos_survey': 'survey before pricing demo; scope/abatement rules confirmed with MDH', 'garage.separation': 'IRC R302.6 separation', 'openings.wall_type': 'stucco',
  'flooring.worst_dip': 'level before tile/LVP',
};

// Templates: module · requirement code · min (plan §7.4–§7.11). V = the server-filled visit context.
const EXPECTED_TEMPLATES = {
  bath: 'visit R|house R|access R|room R 1|bath_scope R 1|plumb_fixture R 2|window O|door R 1|water R|panel C|hvac R|hvac_vent C 1|hvac_exhaust_fan C|structure R 1|moisture R 1|era R|selections R 15|closing R',
  kitchen: 'visit R|house R|access R|room R 1|kitchen_scope R|kitchen_wall R 2|kitchen_appliance R 1|window O|door O|plumb_fixture R 1|panel R 1|hvac R|hvac_vent C 1|hvac_exhaust_fan C|water R|structure C 1|moisture O|era R|selections R 15|closing R',
  addition: 'visit R|house R|access R|addition_scope R|exterior_site R|footing R|room R 1|window O|door O|panel R 1|hvac R|hvac_vent C 1|hvac_exhaust_fan C|water C|structure R 1|moisture R 1|era R|selections R 8|closing R',
  basement: 'visit R|house R|access R|basement_scope R|room R 1|egress C 1|window O|door O|plumb_fixture C 1|water R|panel R 1|hvac R|hvac_vent C 1|hvac_exhaust_fan C|structure R 1|moisture R 1|era R|selections R 6|closing R',
  deck: 'visit R|house R|access R|deck_scope R|exterior_site R|footing R|door R 1|panel C 1|era C|selections R 5|closing R',
  whole: 'visit R|house R|access R|whole_scope R|room R 1|window C 1|door O|kitchen_scope C|kitchen_wall C 2|kitchen_appliance C 1|bath_scope C 1|plumb_fixture C 1|basement_scope C|egress C 1|panel R 1|water R|hvac R|hvac_vent C 1|hvac_exhaust_fan C|structure R 1|moisture R 1|era R|exterior_site C|selections R 0|closing R',
  general: 'visit R|house R|access R|general_scope R|room R 1|era R|selections R 0|closing R|panel C 1|plumb_fixture C 1|hvac C|hvac_vent O|structure C 1|exterior_site C',
  garage: 'garage R|garage_door R 1|exterior_site C|footing C|panel C 1',
  openings: 'window R 1|openings R 1|door O',
  flooring: 'flooring R|room R 1',
};
const EXPECTED_DERIVED = {
  bath: 'room_floor_area -|floor_tile_area bath.tile:Floor tile area|wall_tile_area bath.tile:Wall tile area',
  kitchen: 'room_floor_area kitchen.demo:Room floor area|floor_area kitchen.flooring:Floor area|cabinet_run kitchen.cabinetry:Cabinet run|countertop_area kitchen.countertops:Countertop area|backsplash_area kitchen.backsplash:Backsplash area',
  addition: 'footprint_foundation addition.foundation:Footprint|footprint_framing addition.framing:Footprint|roof_area addition.roofing:Roof area|wall_area addition.siding:Wall area|wall_ceiling_area addition.drywall:Wall + ceiling area|window_count addition.windows_doors:Window count',
  basement: 'floor_area basement.flooring:Floor area|wall_framing basement.framing:Wall framing|drywall_area basement.drywall:Drywall area',
  deck: 'deck_area_framing deck.framing:Deck area|deck_area_decking deck.decking:Deck area|railing_length deck.railing:Railing length|footing_count deck.footings:Footing count|riser_count -',
  whole: 'total_floor_area -|window_count -|door_count -', general: '',
  garage: 'slab_area garage.slab:Slab area|overhead_door_count garage.overhead_door:Overhead door count', openings: '', flooring: 'floor_area flooring.install:Floor area',
};
const SELECTIONS = {
  bath: 'Vanity, Vanity top, Sink, Faucets, Toilet, Shower valve/trim, Floor tile, Wall/shower tile, Grout color, Shower glass, Mirror/medicine cabinet, Light fixtures, Fan, Paint colors, Hardware/accessories',
  kitchen: 'Cabinet line/door style, Cabinet finish, Hardware, Countertop material, Edge profile, Backsplash tile, Grout color, Sink, Faucet, Disposal, Appliance package (each appliance), Hood, Flooring material, Light fixtures, Paint colors',
  addition: 'Window line, Exterior door, Siding product/color, Shingle/roofing product, Flooring material, Trim profile, Paint colors, Light fixtures',
  basement: 'Flooring material, Ceiling treatment, Interior door style, Trim profile, Paint colors, Light fixtures',
  deck: 'Decking material/color, Railing style, Stair style, Skirting, Lighting',
};

const split = (s) => (s ? s.split('|') : []);
const byKey = Object.fromEntries(seed.seedModules.map((m) => [m.key, m]));
const caseKeys = new Set(seed.derivationCases.filter((c) => c.kind === 'derived').map((c) => c.key));
const reqCode = (m, f) => (f.derive || caseKeys.has(`${m.key}.${f.key}`) ? 'D' : f.required === true ? 'R' : f.required === false ? 'O' : 'C');
const shotCode = (s) => (s.required === true ? 'R' : s.required === false ? 'O' : 'C');
const allTemplates = [...seed.templates, ...seed.addOns];
const plan = readFileSync(new URL('../docs/plans/in-home-consult-plan.md', import.meta.url), 'utf8');
const norm = (s) => s.replace(/^> ?/gm, '').replace(/[*`]/g, '').replace(/\s+/g, ' ');
const planText = norm(plan);

test('every module, template and add-on is present, and validate.ts accepts the whole seed', () => {
  assert.deepEqual(seed.sharedModules.map((m) => m.key), ['house', 'access', 'room', 'window', 'door', 'panel', 'plumb_fixture', 'water', 'hvac', 'structure', 'moisture', 'era', 'exterior_site', 'footing', 'selections', 'closing']);
  assert.deepEqual(seed.templates.map((t) => t.key), ['bath', 'kitchen', 'addition', 'basement', 'deck', 'whole', 'general']);
  assert.deepEqual(seed.addOns.map((t) => t.key), ['garage', 'openings', 'flooring']);
  assert.deepEqual(Object.keys(byKey).sort(), Object.keys(EXPECTED_FIELDS).sort());
  const out = seed.validateSeed();
  assert.equal(out.modules.length, seed.seedModules.length);
  assert.equal(out.templates.length, 7);
  assert.equal(out.addOns.length, 3);
});

test('every field the plan lists is present with its requirement, tier and unit; no extra fields', () => {
  for (const [key, spec] of Object.entries(EXPECTED_FIELDS)) {
    const m = byKey[key];
    const actual = m.fields.map((f) => [f.key, reqCode(m, f), f.tier === 'record' ? 'Rec' : 'P', f.unit].filter(Boolean).join(' ')).sort();
    assert.deepEqual(actual, split(spec).sort(), key);
  }
});

test('every required photo shot is present by name with its requirement; all shots Price-critical', () => {
  for (const [key, spec] of Object.entries(EXPECTED_SHOTS)) {
    const m = byKey[key];
    const shots = [...m.shots, ...m.fields.flatMap((f) => f.shots ?? [])];
    assert.deepEqual(shots.map((s) => `${s.key} ${shotCode(s)}`).sort(), split(spec).sort(), key);
    for (const s of shots) assert.equal(s.tier, 'price_critical', `${key}.${s.key}`);
  }
});

test('every ⚑ flag is present with its plan text and citations', () => {
  assert.deepEqual(seed.seedFlags.map((f) => f.key).sort(), Object.keys(EXPECTED_FLAGS).sort());
  for (const f of seed.seedFlags) assert.ok(f.issue.includes(EXPECTED_FLAGS[f.key]), `${f.key}: ${f.issue}`);
  const cites = new Set(seed.seedFlags.flatMap((f) => f.citations));
  for (const c of ['R308.4.1', 'R308.4.2', 'R308.4.3', 'R308.4.5', 'R308.4.6', 'R308.4.7', 'Minn. R. 1346.0501', '299F.51', '745.83', '4714', 'R302.6', 'R302.7', 'R305.1.1', 'R310']) assert.ok(cites.has(c), c);
});

test('code rows carry the round-2/3 fixes: egress, makeup air, tempered glass, toilet clearance, RRP, smoke/CO', () => {
  const f = (m, k) => byKey[m].fields.find((x) => x.key === k);
  assert.match(f('egress', 'clear_area').note, /5\.0 sf for grade-floor or below-grade openings; 5\.7 sf otherwise/);
  assert.match(f('egress', 'clear_width').note, /≥ 20″/); assert.match(f('egress', 'clear_height').note, /≥ 24″/);
  assert.match(f('egress', 'floor_to_sill').note, /≤ 44″/); assert.match(f('egress', 'well_width').note, /≥ 36″ each, ≥ 9 sf/);
  assert.match(f('hvac', 'year_1994_or_later').note, /Table 501\.4\.3\(1\) vs \(2\)/);
  assert.deepEqual(f('hvac_vent', 'venting').options, ['Atmospheric', 'Fan-assisted', 'Power-vent', 'Direct-vent sealed', 'Solid fuel', 'None']);
  assert.match(f('hvac', 'dryer').note, /1346\.0501/); assert.match(f('hvac', 'other_exhaust_fan_count').note, /vented central vacuum/);
  assert.deepEqual(f('hvac', 'dryer').required, { any: [{ field: 'hood_cfm', op: 'gt', value: 300 }, { field: 'visit.templates', op: 'in', value: ['kitchen', 'basement', 'whole'] }] });
  assert.match(f('era', 'pamphlet_given').note, /within 60 days before work starts/);
  assert.equal(f('era', 'pamphlet_given').say, seed.LEAD_SAFE_PAMPHLET.text);
  assert.match(f('era', 'disturbs_paint').note, /40 CFR 745 Subpart E/);
  assert.equal(f('house', 'alarms_locations').required, true);
  assert.match(f('footing', 'required_depth').note, /1303\.1600: 42″ in the southern zone \(metro\), 60″ in the northern/);
  assert.match(f('deck_scope', 'height_far_edge').note, /R312\.1\.1/);
  assert.match(f('panel', 'location').label, /Panel location/); assert.deepEqual(byKey.panel.say, ['Never take the panel cover off. Open the door only; photograph the label and the breakers.']);
});

test('field labels use the plan\'s words (seed-added helpers listed explicitly)', () => {
  const SEED_ADDED = new Set(['era.year_override_reason','footing.frost_zone','footing.planned_depth','footing.depth_margin','water.stack_cracks','hvac.fuel_appliances','bath_scope.new_tub_capacity','basement_scope.water_details','egress.well_ladder','visit.templates', 'visit.add_ons', 'visit.device', 'window.unit', 'window.new_unit', 'door.unit', 'garage_door.unit', 'garage.attached',
    'exterior_site.pitch_factor', 'bath_scope.vanity_excess', 'bath_scope.tile_height_in', 'bath_scope.kept_tub_area', 'kitchen_wall.plumb_difference',
    'kitchen_scope.backsplash_height_in', 'kitchen_scope.island_run', 'kitchen_scope.island_top_area', 'addition_scope.wall_height', 'addition_scope.eave_overhang_area',
    'addition_scope.utilities_meter_in_footprint', 'basement_scope.new_partitions', 'basement_scope.drywall_ceiling_area', 'egress.well_area', 'deck_scope.deck_area']);
  const missing = [];
  for (const m of seed.seedModules) for (const f of m.fields) {
    if (SEED_ADDED.has(`${m.key}.${f.key}`)) continue;
    // r3 C13: labels print curly quotes (“Ahead”); the plan writes straight ones.
    const base = f.label.split(' — ')[0].replace(/[*`]/g, '').replace(/[“”]/g, '"');
    if (!planText.toLowerCase().includes(base.toLowerCase())) missing.push(`${m.key}.${f.key}: ${base}`);
  }
  assert.deepEqual(missing, []);
});

test('scripts are verbatim: opening/closing for Joe and staff, section scripts, consent v2, pamphlet', () => {
  for (const line of [...seed.OPENING_JOE, ...seed.CLOSING_JOE]) assert.ok(planText.includes(norm(line.text)), line.text);
  assert.ok(planText.includes(norm(seed.STAFF_OPENING_LINE)) && planText.includes(norm(seed.STAFF_CLOSING_LINE)));
  assert.deepEqual(seed.OPENING_STAFF.map((l) => l.n), ['1–2', '3', '4', '4b', '5', '6']);
  assert.deepEqual(seed.CLOSING_STAFF.map((l) => l.n), ['1', '2', '2b', '3', '4', '5', '6']);
  for (const t of seed.templates) { assert.deepEqual(t.opening, seed.OPENING_JOE.map((l) => l.text)); assert.deepEqual(t.closing, seed.CLOSING_JOE.map((l) => l.text)); }
  for (const m of seed.seedModules) for (const line of m.say) assert.ok(planText.includes(norm(line)), `${m.key}: ${line}`);
  for (const k of ['bath_scope', 'kitchen_scope', 'addition_scope', 'basement_scope', 'deck_scope', 'whole_scope']) assert.ok(byKey[k].say.length >= 5, k);
  assert.equal(seed.CONSENT.notice_version, 'consult-2026-11-v2');
  for (const s of [seed.CONSENT.script, seed.CONSENT.recorded_confirmation_line, seed.CONSENT.no_card, seed.CONSENT.banner, seed.CONSENT.stop_sheet, seed.CONSENT.new_person, seed.LEAD_SAFE_PAMPHLET.text]) assert.ok(planText.includes(norm(s)), s);
  assert.deepEqual(seed.TEMPLATE_DURATIONS, { bath: '90–120 min', kitchen: '2 h', basement: '2 h', deck: '60 min', addition: '2 h', whole: '3–4 h or two scheduled visits', general: '45 min' });
});

test('templates list the plan\'s modules, requirements, minimums, derived quantities and selection lists', () => {
  for (const t of allTemplates) {
    const actual = t.modules.map((m) => [m.module, m.required === true ? 'R' : m.required === false ? 'O' : 'C', m.min].filter((x) => x !== undefined).join(' '));
    assert.deepEqual(actual, split(EXPECTED_TEMPLATES[t.key]), t.key);
    assert.deepEqual(t.derived.map((d) => `${d.key} ${d.maps_to ? `${d.maps_to.scope_key}:${d.maps_to.quantity_label}` : '-'}`), split(EXPECTED_DERIVED[t.key]), t.key);
    for (const d of t.derived) assert.ok(seed.planFormulas[`${t.key}.${d.key}`], `${t.key}.${d.key} plan formula`);
  }
  for (const [k, list] of Object.entries(SELECTIONS)) assert.deepEqual(seed.selectionDecisions[k], list.split(', '), k);
});

test('versioned mapping registry: new labels declared, every mapping registered, field feeds explicit', () => {
  assert.equal(seed.SCOPE_LABEL_REGISTRY_VERSION, 1);
  const added = seed.scopeLabelRegistry.filter((e) => e.origin === 'consult_registry_v1').map((e) => `${e.scope_key}:${e.quantity_label}:${e.unit}`);
  assert.deepEqual(added.sort(), ['basement.drywall:Drywall area:sf', 'basement.flooring:Floor area:sf', 'basement.framing:Wall framing:lf', 'garage.overhead_door:Overhead door count:ea', 'garage.slab:Slab area:sf']);
  const rules = readFileSync(new URL('../lib/estimating/rules.ts', import.meta.url), 'utf8');
  for (const e of seed.scopeLabelRegistry.filter((x) => x.origin === 'scope_rules')) {
    assert.ok(rules.includes(`R("${e.scope_key}"`), e.scope_key);
    if (e.quantity_label) assert.ok(new RegExp(`R\\("${e.scope_key.replace('.', '\\.')}"[^\\n]*label: "${e.quantity_label.replace('+', '\\+')}", unit: "${e.unit}"`).test(rules), `${e.scope_key} ${e.quantity_label}`);
  }
  const used = [...seed.seedModules.flatMap((m) => m.fields.map((f) => f.maps_to)), ...allTemplates.flatMap((t) => t.derived.map((d) => d.maps_to))].filter(Boolean);
  for (const u of used) assert.ok(seed.scopeLabelRegistry.some((e) => e.scope_key === u.scope_key && (u.quantity_label ?? null) === e.quantity_label || (e.scope_key === u.scope_key && !u.quantity_label)), JSON.stringify(u));
  assert.deepEqual(seed.fieldQuantityFeeds.map((f) => `${f.from}>${f.scope_key}:${f.quantity_label}`), ['window.plan>windows.replace:Window count', 'door.plan>doors.interior:Door count']);
  // No (scope_key, label) is fed twice inside one template, so the reconciler never double counts.
  for (const t of allTemplates) {
    const keys = t.derived.filter((d) => d.maps_to).map((d) => `${d.maps_to.scope_key}:${d.maps_to.quantity_label}`);
    assert.equal(new Set(keys).size, keys.length, t.key);
  }
});

test('all conditions compile, all formulas and derivation cases parse against known fields', () => {
  const qualified = seed.seedModules.flatMap((m) => m.fields.map((f) => `${m.key}.${f.key}`));
  for (const m of seed.seedModules) {
    const known = new Set([...m.fields.map((f) => f.key), ...qualified]);
    for (const f of m.fields) {
      compileCondition(f.required, known);
      if (f.flag) compileCondition(f.flag.when, known);
      if (f.derive) formulaReferences(f.derive.replace(new RegExp(`\\b${m.key}\\.`, 'g'), ''), known);
      for (const s of f.shots ?? []) compileCondition(s.required, known);
    }
    for (const s of m.shots) compileCondition(s.required, known);
  }
  for (const d of seed.derivationCases) {
    const m = byKey[d.module];
    assert.ok(m.fields.some((f) => f.key === d.field), d.key);
    const known = new Set([...m.fields.map((f) => f.key), ...qualified]);
    for (const c of d.cases) { compileCondition(c.when, known); if ('formula' in c) formulaReferences(c.formula, known); }
  }
  // every case-derived field has a derivation; no derived field is required
  for (const m of seed.seedModules) for (const f of m.fields) if (reqCode(m, f) === 'D') assert.equal(f.required, false, `${m.key}.${f.key}`);
  for (const m of seed.seedModules) for (const f of m.fields) if (/Derived — not asked/.test(f.note ?? '')) assert.ok(caseKeys.has(`${m.key}.${f.key}`), `${m.key}.${f.key}`);
  // pitch factor is exact to 4 decimals
  const pf = seed.derivationCases.find((d) => d.key === 'exterior_site.pitch_factor');
  assert.equal(pf.cases.find((c) => c.when.value === 12).formula, '1.4142');
  // template formulas: each additive term names at most one repeatable module
  const repeatable = new Set(seed.seedModules.filter((m) => m.repeatable).map((m) => m.key));
  for (const t of allTemplates) for (const d of t.derived) {
    for (const term of d.formula.split(/(?<![(*\/])\s[+-]\s(?![^(]*\))/)) {
      const mods = new Set((term.match(/[a-z_]+(?=\.)/g) ?? []).filter((x) => repeatable.has(x)));
      assert.ok(mods.size <= 1, `${t.key}.${d.key}: ${term}`);
    }
  }
});

// ───────── completeness reducer on an empty and a fully answered instance of each template ─────────
function sample(f) {
  switch (f.type) {
    case 'length': return f.range ? (f.range[0] + f.range[1]) / 2 : 36;
    case 'length_pair': return { a: 36, b: 60 };
    case 'count': return 1;
    case 'number': return f.range ? (f.range[0] + f.range[1]) / 2 : 10;
    case 'choice': return f.options[0];
    case 'multi': return [f.options[0]];
    case 'yesno': return true;
    case 'year': return 1960;
    case 'date': return '2026-11-16';
    case 'signature': return 'initials';
    default: return 'answer';
  }
}
function run(template, filled) {
  const nested = template.key === 'whole' ? ['whole', 'kitchen', 'bath', 'basement'] : [template.key];
  const live = template.modules.map((entry) => ({ entry, def: byKey[entry.module] }))
    .map(({ entry, def }) => ({ entry, def, instances: Array.from({ length: def.repeatable ? Math.max(entry.min ?? 1, 1) : 1 }, () => ({})) }));
  for (const { def, instances } of live) for (const values of instances) {
    if (def.key === 'visit') { values.templates = nested; values.add_ons = []; continue; }
    if (filled) for (const f of def.fields) if (!f.derive && !caseKeys.has(`${def.key}.${f.key}`)) values[f.key] = sample(f);
  }
  const qualified = {};
  for (const { def, instances } of live) for (const [k, v] of Object.entries(instances[0])) qualified[`${def.key}.${k}`] ??= v;
  const allKnown = seed.seedModules.flatMap((m) => m.fields.map((f) => `${m.key}.${f.key}`));
  const fields = [], photos = [], flags = [], modules = [];
  const memberKnown = new Set(template.modules.flatMap((e) => byKey[e.module].fields.map((f) => `${e.module}.${f.key}`)));
  for (const { entry, def, instances } of live) {
    const needed = compileCondition(entry.required, memberKnown)(qualified);
    modules.push({ key: def.key, minimum: needed ? (entry.min ?? 1) : 0, live_count: instances.length, parents_valid: true });
    const known = new Set([...def.fields.map((f) => f.key), ...allKnown]);
    instances.forEach((own, i) => {
      const values = { ...qualified, ...own };
      const item = (key, req, tier, answered, mapped) => ({ key: `${def.key}[${i}].${key}`, tier, required: req !== false, applicable: compileCondition(req, known)(values), mapped, answered, valid: answered });
      for (const f of def.fields) {
        fields.push(item(f.key, f.required, f.tier, own[f.key] !== undefined, !!f.maps_to));
        if (f.flag && compileCondition(f.flag.when, known)(values)) flags.push({ key: `${def.key}[${i}].${f.key}`, disposition: 'price_it', actor: 'visitor', at: '2026-11-02T15:00:00Z', note: 'Priced in' });
      }
      for (const s of [...def.shots, ...def.fields.flatMap((f) => f.shots ?? [])]) photos.push(item(s.key, s.required, s.tier, filled, false));
    });
  }
  return consultCompleteness({
    fields, photos, modules,
    recording: { asked: true, choice: 'manual', confirmed_evidence: false, documented_failure_or_stop: false }, photo_permission: true,
    acknowledgement: { initials_committed: true, visitor_reason: null, handed_back: false }, promised_date: '2026-11-16',
    manifests: [{ device: 'phone', acknowledged: true, rejected: 0, missing: false }], unresolved_conflicts: 0,
    rrp: { applies: false, receipt: false, firm_current: false, renovator_current: false, redelivery_required: false, redelivery_todo: false },
    flags, touched_trades: [], trade_walks: [], no_trades_confirmed: true,
  });
}

test('the completeness reducer runs on an empty and a fully answered instance of every template and add-on', () => {
  for (const t of allTemplates) {
    const empty = run(t, false), full = run(t, true);
    assert.equal(empty.complete, false, `${t.key} empty`);
    assert.ok(empty.checks[0].open.length > 0, `${t.key} empty has open fields`);
    // only the server-filled visit context is answered on an empty visit
    assert.equal(empty.price_critical.done, t.modules.some((m) => m.module === 'visit') ? 1 : 0, `${t.key} empty done`);
    assert.deepEqual(full.checks[0].open, [], `${t.key} full fields`);
    assert.deepEqual(full.checks[1].open, [], `${t.key} full photos`);
    assert.deepEqual(full.checks[2].open, [], `${t.key} full modules`);
    assert.equal(full.complete, true, `${t.key} full`);
    assert.ok(full.price_critical.total > 0 && full.price_critical.done === full.price_critical.total, t.key);
  }
  // Record rows exist for Joe and staff alike (how they cook / top changes / top priorities)
  assert.ok(run(seed.templates.find((t) => t.key === 'kitchen'), true).record.total >= 1);
});

test('checksums are deterministic, jsonb-ordered and change with content', async () => {
  assert.equal(seed.jsonbText({ bb: 1, a: [1, 'x'], c: { z: null, y: true } }), '{"a": [1, "x"], "c": {"y": true, "z": null}, "bb": 1}');
  assert.equal(seed.jsonbText('a"b\\c\n'), '"a\\"b\\\\c\\n"');
  const one = await seed.seedChecksums(), two = await seed.seedChecksums();
  assert.deepEqual(one, two);
  assert.equal(one.length, seed.seedModules.length + 10);
  for (const row of one) assert.match(row.checksum, /^[0-9a-f]{64}$/);
  assert.equal(new Set(one.map((r) => r.checksum)).size, one.length);
  const room = structuredClone(byKey.room);
  const shuffled = Object.fromEntries(Object.entries(room).reverse());
  assert.equal(await seed.definitionChecksum(shuffled), await seed.definitionChecksum(byKey.room));
  room.fields[0].label = 'Room';
  assert.notEqual(await seed.definitionChecksum(room), await seed.definitionChecksum(byKey.room));
});
