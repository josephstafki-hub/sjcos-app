/**
 * r6 D4 (docs/plans/reviews/build-consult-r6-design.md): a flag card leads with the number or answer
 * that tripped it — "Measured 20″ in front of the toilet. A new toilet needs …" — so the visitor sees
 * why it fired and can fix a typo instead of pricing it. Pure; shared by the visit and its tests.
 */
import { displayLength } from '../length.ts';
import { curly } from '../typography.ts';
import { W } from './words.ts';
import type { VisitModel } from './model.ts';

/** Inches as the flag hints write them (24″), feet and inches from 4 ft (r7: the shared displayLength). */
function inchesText(v: number): string {
  try { return displayLength(v, 1 / 16); } catch { return `${v}″`; }
}
const PROPER = /^(Renovate|SJC|MDH|EPA|Minnesota|I-joist)\b/;
/** r6 D4: what was measured or answered, so the card says why it fired and a typo can be fixed. */
export function flagLead(f: VisitModel["flags"][number], model: VisitModel): string {
  const fields = model.sections.flatMap((s) => [...s.fields, ...s.hidden]);
  const shown = f.measured.filter((m) => m.value !== undefined && m.value !== null && m.value !== "" && typeof m.value !== "boolean");
  if (!shown.length) return f.hint;
  const value = (m: (typeof shown)[number]) => typeof m.value === "number" ? (m.unit === "″" ? inchesText(m.value) : `${m.value}${m.unit && m.unit !== "ea" ? ` ${m.unit}` : ""}`)
    : Array.isArray(m.value) ? m.value.map(String).join(", ") : curly(String(m.value));
  const label = (m: (typeof shown)[number]) => fields.find((x) => x.addr === m.address)?.def.label ?? m.field;
  // "Measured" only for lengths; a year, a count or a choice reads "Year built: 1965".
  const measured = shown.every((m) => typeof m.value === "number" && m.unit === "″");
  const lead = measured
    ? `${W.measured} ${shown.length === 1 ? value(shown[0]) : shown.map((m) => `${label(m)} ${value(m)}`).join(", ")}`
    : shown.map((m) => `${label(m)}: ${value(m)}`).join(" · ");
  // r11 domain E1: a "Less than 24″ in front of …" hint reads as two sentences with the measured value:
  // "Measured 20″ in front of the toilet. A new toilet needs at least 24″ …" — no dash after the number.
  const less = measured && shown.length === 1 ? /^Less than \S+ (.+)$/.exec(f.hint) : null;
  if (less) return `${lead} ${less[1]}`;
  const hint = PROPER.test(f.hint) || /^[A-Z]{2}/.test(f.hint) ? f.hint : f.hint.charAt(0).toLowerCase() + f.hint.slice(1);
  return `${lead} — ${hint}`;
}

