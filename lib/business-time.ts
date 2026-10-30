/** Wall-clock fields use the business zone, independent of the browser/server zone. */
export const BUSINESS_ZONE = "America/Chicago";
const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function toBusinessInput(iso: string): string {
  const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function businessDate(now = new Date()): string { return toBusinessInput(now.toISOString()).slice(0, 10); }
export function requireInstant(value: string): string {
  if (!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Choose a valid time with its time zone.");
  return value;
}
export function fromBusinessInput(value: string, original?: string | null): string {
  // An unchanged field keeps seconds and the original side of the DST fold.
  if (original && toBusinessInput(original) === value) return original;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a valid Central date and time.");
  const wall = Date.parse(value + "Z");
  if (!Number.isFinite(wall)) throw new Error("Enter a valid Central date and time.");
  // Chicago uses UTC-5 or UTC-6. Round-trip candidates reject spring gaps,
  // invalid calendar dates and ambiguous fall-back edits rather than guessing.
  const candidates = [5, 6].map(h => new Date(wall + h * 3600_000).toISOString()).filter(iso => toBusinessInput(iso) === value);
  if (candidates.length !== 1) throw new Error(candidates.length ? "That Central time occurs twice when daylight saving ends. Choose a time outside the repeated hour." : "That Central date or time does not exist. Choose another time.");
  return candidates[0];
}
/** Split an instant range at business midnights, including short/long DST days. */
export function splitBusinessDays(start: number, end: number): {start:number;end:number}[] {
  const out: {start:number;end:number}[] = [];
  for (let cursor=start; cursor<end;) {
    const day=businessDate(new Date(cursor));
    const nextDay=new Date(Date.parse(`${day}T12:00:00Z`)+86400_000).toISOString().slice(0,10);
    const until=Math.min(end,Date.parse(fromBusinessInput(`${nextDay}T00:00`)));
    out.push({start:cursor,end:until}); cursor=until;
  }
  return out;
}
