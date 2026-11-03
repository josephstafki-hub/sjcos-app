// Derivations that need a branch, a yes/no test or an indicator: formula.ts has only + − × ÷ and
// parentheses, so these are data-only cases. First matching case wins; no match = a gap, never zero
// (§10.5). `when` compiles with forms/conditions.ts; `formula` parses with forms/formula.ts.
import type { When } from '../../form-types.ts';
import { all, answered, any, eq, gt, isIn, lt, ne, not } from './helpers.ts';

export type DerivationCase = { when: When; formula: string } | { when: When; value: string | boolean } | { when: When; gap: true };
export interface Derivation { key: string; module: string; field: string; kind: 'derived' | 'prefill'; plan: string; cases: DerivationCase[] }

const d = (key: string, kind: Derivation['kind'], plan: string, cases: DerivationCase[]): Derivation => {
  const [module, field] = key.split('.');
  return { key, module, field, kind, plan, cases };
};

const PITCHES = Array.from({ length: 24 }, (_, i) => i + 1);
const pitchFactor = (k: number) => String(Math.round(Math.sqrt(1 + (k / 12) ** 2) * 1e4) / 1e4);

const meetsEgress = all(
  eq('existing_window', true), answered('clear_width'), answered('clear_height'), answered('floor_to_sill'), answered('grade_class'),
  not(lt('clear_width', 20)), not(lt('clear_height', 24)),
  any(all(isIn('grade_class', ['Grade-floor', 'Below-grade']), not(lt('clear_area', 5))), not(lt('clear_area', 5.7))),
  not(gt('floor_to_sill', 44)),
  any(eq('grade_class', 'Grade-floor'), all(answered('well_width'), answered('well_projection'), not(lt('well_width', 36)), not(lt('well_projection', 36)), not(lt('well_area', 9)))),
);

export const derivationCases: Derivation[] = [
  d('window.new_unit', 'derived', 'addition Window count = count of window Plan = New', [
    { when: eq('plan', 'New'), formula: '1' }, { when: answered('plan'), formula: '0' },
  ]),
  d('hvac.year_1994_or_later', 'derived', 'derived from house.year_built; unknown year → HVAC sub uses the more conservative table', [
    { when: gt('house.year_built', 1993), value: true }, { when: lt('house.year_built', 1994), value: false },
  ]),
  d('era.before_1978', 'prefill', 'filled from Year built, editable', [
    { when: lt('house.year_built', 1978), value: true }, { when: gt('house.year_built', 1977), value: false },
  ]),
  d('exterior_site.pitch_factor', 'derived', 'pitch factor (√(1 + (pitch/12)²)), 4 decimals; a non-whole pitch is a gap', PITCHES.map((k) => ({ when: eq('roof_pitch', k), formula: pitchFactor(k) }))),
  d('bath_scope.tile_height_in', 'derived', 'wall tile height in inches', [
    { when: eq('wall_tile_height', 'To ceiling'), formula: 'room.ceiling_height' },
    { when: eq('wall_tile_height', '84″'), formula: '84' },
    { when: eq('wall_tile_height', '72″'), formula: '72' },
    { when: eq('wall_tile_height', 'Wainscot'), formula: '36' },
    { when: eq('wall_tile_height', 'None'), formula: '0' },
  ]),
  d('bath_scope.kept_tub_area', 'derived', '(tub footprint if the tub stays)', [
    { when: eq('tub_shower_plan', 'Keep tub'), formula: 'existing_length * existing_width / 144' },
    { when: answered('tub_shower_plan'), formula: '0' },
  ]),
  d('bath_scope.wall_tile_area', 'derived', 'shower: (2 × depth + width) × wall tile height ÷ 144; tub: (2 × 30″ + length) × height ÷ 144; wainscot: perimeter × 36″ ÷ 144', [
    { when: eq('wall_tile_height', 'Wainscot'), formula: 'room.perimeter * 12 * 36 / 144' },
    { when: eq('wall_tile_height', 'None'), formula: '0' },
    { when: isIn('tub_shower_plan', ['Tub → shower', 'New tub-shower', 'Shower only']), formula: '(2 * new_shower_depth + new_shower_width) * tile_height_in / 144' },
    { when: eq('tub_shower_plan', 'Keep tub'), formula: '(2 * 30 + existing_length) * tile_height_in / 144' },
    { when: eq('tub_shower_plan', 'Freestanding tub'), gap: true },
  ]),
  d('kitchen_scope.backsplash_height_in', 'derived', 'backsplash height in inches; To the uppers / Full wall at range are measured, so they stay a gap until entered', [
    { when: eq('backsplash_height', '4″'), formula: '4' },
    { when: isIn('backsplash_height', ['To the uppers', 'Full wall at range']), gap: true },
  ]),
  d('kitchen_scope.island_run', 'derived', '(+ island length ÷ 12)', [
    { when: eq('island', 'New'), formula: 'island_length' }, { when: answered('island'), formula: '0' },
  ]),
  d('kitchen_scope.island_top_area', 'derived', '+ island W × D ÷ 144', [
    { when: eq('island', 'New'), formula: 'island_length * island_depth / 144' }, { when: answered('island'), formula: '0' },
  ]),
  d('addition_scope.eave_overhang_area', 'derived', '+ 12″ overhang on the eaves', [
    { when: eq('roof_style', 'Shed'), formula: 'footprint_along_house * 12 / 144' },
    { when: eq('roof_style', 'Gable'), formula: '2 * footprint_out * 12 / 144' },
    { when: eq('roof_style', 'Hip'), formula: '(footprint_along_house + 2 * footprint_out) * 12 / 144' },
    { when: eq('roof_style', 'Match existing'), gap: true },
  ]),
  d('basement_scope.drywall_ceiling_area', 'derived', '+ ceiling if drywall', [
    { when: eq('ceiling', 'Drywall'), formula: 'room.floor_area' }, { when: answered('ceiling'), formula: '0' },
  ]),
  d('egress.result', 'derived', 'derived: Meets egress / New egress needed (width ≥ 20″, height ≥ 24″, area ≥ 5.0 sf grade-floor/below-grade or 5.7 sf otherwise, sill ≤ 44″, well ≥ 36″ each and ≥ 9 sf)', [
    { when: meetsEgress, value: 'Meets egress' },
    { when: any(eq('existing_window', false), all(answered('clear_width'), answered('clear_height'), answered('floor_to_sill'))), value: 'New egress needed' },
  ]),
  d('deck_scope.railing_length', 'derived', 'perimeter − house side − stair openings (when > 30″)', [
    { when: ne('shape', 'Rectangle'), gap: true },
    { when: gt('height_far_edge', 30), formula: '(size_along_house + 2 * size_out - stair_width * stair_runs) / 12' },
    { when: answered('height_far_edge'), formula: '0' },
  ]),
  d('deck_scope.permit_triggers', 'derived', 'derived: attached, > 30″, > 200 sf, or serves a required exit door', [
    { when: any(eq('attached', 'Attached'), gt('height_far_edge', 30), gt('deck_area', 200), eq('required_exit_door', true)), value: true },
    { when: all(answered('attached'), answered('height_far_edge'), answered('deck_area'), answered('required_exit_door')), value: false },
  ]),
];
