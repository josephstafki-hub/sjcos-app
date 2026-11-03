/** Derive the legal close gate from captured facts, never from wrap-sheet checkboxes. */
export function rrpFacts(values: Record<string, unknown>, initials: boolean, visitDate: string, plannedStart?: string | null) {
 const year = values['house.year_built'];
 const before = values['era.before_1978'] !== false && (typeof year !== 'number' || year < 1978);
 const applies = before && (values['era.disturbs_paint'] === true || values['era.window_door_replacement'] === true);
 const day = [visitDate.slice(0,10), plannedStart?.slice(0,10) ?? ''].sort().at(-1)!;
 const current = (key: string) => typeof values[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(values[key] as string) && (values[key] as string) >= day;
 return { applies, receipt: values['era.pamphlet_given'] === true && initials, firm_current: current('era.firm_cert_expiry'), renovator_current: current('era.renovator_expiry') };
}
