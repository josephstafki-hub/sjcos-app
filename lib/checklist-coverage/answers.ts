// Answer fields for each discovery-checklist row (plan §3.3 "Stored value").
// Pure and client-safe: the row sheet renders these specs, builds the stored
// value, and the summary formats it. Keys and allowed values mirror
// `checklist_valid_manual_value` in 0074 exactly — anything else is refused
// by the server with CHECKLIST_INVALID_ANSWER.

export type FieldSpec =
  | { name: string; type: 'text' | 'textarea' | 'email' | 'tel' | 'date'; label: string; placeholder?: string; main?: boolean }
  | { name: string; type: 'choice'; label: string; options: { value: string; label: string }[] }
  | { name: string; type: 'check'; label: string }
  | { name: 'people'; type: 'people'; label: string; main?: boolean };

export type Fields = Record<string, string>;

const YES_NO = (yes: string, no: string) => [{ value: 'true', label: yes }, { value: 'false', label: no }];

export const ANSWER_FIELDS: Record<string, FieldSpec[]> = {
  work: [
    { name: 'scope', type: 'textarea', label: 'Answer', placeholder: 'e.g. upstairs bath, tub out, walk-in shower', main: true },
    { name: 'job_type', type: 'text', label: 'Type of job' },
    { name: 'goals', type: 'text', label: "What they'd like instead" },
  ],
  budget: [
    { name: 'amount_text', type: 'text', label: 'Answer', placeholder: 'e.g. around $40–50k', main: true },
    { name: 'response', type: 'choice', label: 'Budget', options: [{ value: 'stated', label: 'Stated' }, { value: 'not_set', label: 'No budget yet' }, { value: 'declined', label: 'Rather not say' }] },
  ],
  timeline: [
    { name: 'text', type: 'text', label: 'Answer', placeholder: 'e.g. start in spring, done by August', main: true },
    { name: 'start', type: 'date', label: 'Start' },
    { name: 'finish', type: 'date', label: 'Finish by' },
    { name: 'firm', type: 'choice', label: 'Is the date firm?', options: YES_NO('Firm', 'Flexible') },
  ],
  address: [
    { name: 'street', type: 'text', label: 'Street address', main: true },
    { name: 'city', type: 'text', label: 'City' },
    { name: 'confirmed', type: 'check', label: 'They confirmed this is the job address' },
  ],
  contact: [
    { name: 'name', type: 'text', label: 'Name', main: true },
    { name: 'phone_e164', type: 'tel', label: 'Callback number' },
    { name: 'email', type: 'email', label: 'Email' },
    { name: 'preferred_channel', type: 'choice', label: 'Best way to reach them', options: [{ value: 'call', label: 'Call' }, { value: 'text', label: 'Text' }, { value: 'email', label: 'Email' }] },
    { name: 'email_declined', type: 'check', label: 'No email — another way to reach them' },
  ],
  who_decides: [
    { name: 'sole', type: 'choice', label: 'Who decides', options: YES_NO('Just them', 'Others too') },
    { name: 'people', type: 'people', label: 'Who else — one per line, e.g. "Pat, spouse"', main: true },
  ],
  found_us: [
    { name: 'channel', type: 'choice', label: 'How they found us', options: ['Referral', 'Google', 'Houzz', 'Facebook', 'Other'].map((v) => ({ value: v, label: v })) },
    { name: 'referrer', type: 'text', label: 'Who referred them' },
    { name: 'detail', type: 'text', label: 'Answer', main: true },
    { name: 'unknown', type: 'check', label: "They don't remember" },
  ],
  other_bids: [
    { name: 'answer', type: 'choice', label: 'Other bids', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'undecided', label: 'Undecided' }, { value: 'declined', label: 'Rather not say' }] },
    { name: 'detail', type: 'text', label: 'Answer', main: true },
  ],
  years_staying: [
    { name: 'occupancy_text', type: 'text', label: "How long they've lived there", main: true },
    { name: 'stay_plan_text', type: 'text', label: 'Plan to stay' },
  ],
  next_step: [
    { name: 'kind', type: 'choice', label: 'Next step', options: [{ value: 'visit', label: 'Come out to see it' }, { value: 'precon_agreement', label: 'Send the pre-con agreement' }, { value: 'client_calls_back', label: "They'll call back" }, { value: 'other', label: 'Other' }] },
    { name: 'date', type: 'date', label: 'Date' },
  ],
  photos_request: [
    { name: 'answer', type: 'choice', label: 'Photos', options: [{ value: 'will_send', label: 'Will send' }, { value: 'sent', label: 'Already sent' }, { value: 'no', label: 'No' }] },
  ],
  property: [
    { name: 'owner', type: 'choice', label: 'Own the home?', options: [{ value: 'yes', label: 'Owns it' }, { value: 'no', label: "Doesn't own it" }, { value: 'buying', label: 'Buying' }, { value: 'renting', label: 'Renting' }] },
    { name: 'type', type: 'choice', label: 'Property', options: [{ value: 'house', label: 'House' }, { value: 'townhome', label: 'Townhome' }, { value: 'condo', label: 'Condo' }, { value: 'other', label: 'Other' }] },
    { name: 'hoa', type: 'choice', label: 'Has an HOA', options: [{ value: 'yes', label: 'HOA' }, { value: 'no', label: 'No HOA' }, { value: 'unknown', label: 'Not sure' }] },
  ],
  paying: [
    { name: 'method', type: 'choice', label: 'Paying for it', options: [{ value: 'cash', label: 'Out of pocket' }, { value: 'loan_heloc', label: 'Loan or HELOC' }, { value: 'insurance', label: 'Insurance claim' }, { value: 'declined', label: 'Rather not say' }] },
  ],
};

const BOOLEAN_FIELDS = new Set(['firm', 'confirmed', 'email_declined', 'sole', 'unknown']);

export function fieldsFor(key: string): FieldSpec[] {
  return ANSWER_FIELDS[key] ?? [{ name: 'text', type: 'textarea', label: 'Answer', main: true }];
}

export function mainField(key: string): string | null {
  const main = fieldsFor(key).find((f) => 'main' in f && f.main);
  return main?.name ?? null;
}

function phoneE164(text: string): string {
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return text.trim();
}

function parsePeople(text: string): { name: string | null; role: string }[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [a, ...rest] = line.split(',');
    const role = rest.join(',').trim();
    return role ? { name: a.trim() || null, role } : { name: null, role: a.trim() };
  });
}

/** The stored value for the sheet's fields, or null when nothing was entered
 *  (a tick with no typed answer never writes a fact — plan §4.2). */
export function buildValue(key: string, fields: Fields): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const spec of fieldsFor(key)) {
    const raw = (fields[spec.name] ?? '').trim();
    if (!raw) continue;
    if (spec.type === 'people') { const people = parsePeople(raw); if (people.length) out.people = people; continue; }
    if (spec.type === 'check') { if (raw === 'true') out[spec.name] = true; continue; }
    if (BOOLEAN_FIELDS.has(spec.name)) { out[spec.name] = raw === 'true'; continue; }
    out[spec.name] = spec.type === 'tel' ? phoneE164(raw) : raw;
  }
  if (key === 'budget' && out.amount_text && !out.response) out.response = 'stated';
  if (key === 'who_decides' && out.people && out.sole === undefined) out.sole = false;
  return Object.keys(out).length ? out : null;
}

/** Sheet fields from a stored value (or a prior lead fact already adapted). */
export function fieldsFromValue(key: string, value: unknown): Fields {
  const fields: Fields = {};
  if (value === null || value === undefined) return fields;
  if (typeof value !== 'object') { const main = mainField(key); if (main) fields[main] = String(value); return fields; }
  const v = value as Record<string, unknown>;
  for (const spec of fieldsFor(key)) {
    const x = v[spec.name];
    if (x === undefined || x === null) continue;
    if (spec.type === 'people' && Array.isArray(x)) fields.people = x.map((p: { name?: string | null; role?: string }) => (p?.name ? `${p.name}, ${p.role ?? ''}` : p?.role ?? '')).join('\n');
    else if (typeof x === 'boolean') fields[spec.name] = String(x);
    else fields[spec.name] = String(x);
  }
  return fields;
}

/** A short, human line for a stored value: "around $40–50k", "Rather not say". */
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'object') return String(value);
  const v = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const spec of fieldsFor(key)) {
    const x = v[spec.name];
    if (x === undefined || x === null || x === '') continue;
    if (spec.type === 'people' && Array.isArray(x)) { parts.push(x.map((p: { name?: string | null; role?: string }) => [p?.name, p?.role].filter(Boolean).join(', ')).join('; ')); continue; }
    if (spec.type === 'check') { if (x === true) parts.push(spec.label); continue; }
    if (spec.type === 'choice') { const o = spec.options.find((o) => o.value === String(x)); parts.push(o?.label ?? String(x)); continue; }
    parts.push(String(x));
  }
  if (!parts.length) {
    const flat = Object.values(v).filter((x) => typeof x === 'string' && x.trim());
    return flat.join(' · ');
  }
  // "Stated" adds nothing next to the amount itself.
  if (key === 'budget' && v.amount_text && v.response === 'stated') return String(v.amount_text);
  return parts.join(' · ');
}

/** The client declined to answer: never put this row in a follow-up email. */
export function isRefusal(key: string, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (key === 'budget' && v.response === 'declined') || (key === 'other_bids' && v.answer === 'declined') || (key === 'paying' && v.method === 'declined');
}

/** The state an answer suggests when Joe hasn't picked one himself (plan §3.1
 *  "Covered when" / "Partly when"). Conservative and structural only: Covered
 *  needs every part the rule asks for (Budget "Stated" needs the amount; an
 *  address needs street, city and "They confirmed"); anything less is Partly.
 *  Null when nothing is entered. */
export function suggestedState(key: string, value: Record<string, unknown> | null): 'partial' | 'covered' | null {
  if (!value) return null;
  const has = (k: string) => value[k] !== undefined && value[k] !== null && value[k] !== '' && value[k] !== false;
  const all = (...ks: string[]) => (ks.every(has) ? 'covered' : 'partial');
  switch (key) {
    case 'work': return has('scope') ? 'covered' : 'partial';
    case 'budget': return has('amount_text') || value.response === 'not_set' || value.response === 'declined' ? 'covered' : 'partial';
    case 'timeline': return has('text') || has('start') || has('finish') ? 'covered' : 'partial';
    case 'address': return all('street', 'city', 'confirmed');
    case 'contact': return has('name') && has('phone_e164') && (has('email') || value.email_declined === true) ? 'covered' : 'partial';
    case 'who_decides': return value.sole === true || has('people') ? 'covered' : 'partial';
    case 'found_us': return (has('channel') && (value.channel !== 'Referral' || has('referrer'))) || has('referrer') || has('detail') || value.unknown === true ? 'covered' : 'partial';
    case 'other_bids': return has('answer') ? 'covered' : 'partial';
    case 'years_staying': return all('occupancy_text', 'stay_plan_text');
    case 'next_step': return value.kind === 'visit' ? (has('date') ? 'covered' : 'partial') : value.kind === 'precon_agreement' || value.kind === 'client_calls_back' ? 'covered' : 'partial';
    case 'photos_request': return has('answer') ? 'covered' : 'partial';
    case 'property': return all('owner', 'type', 'hoa');
    case 'paying': return has('method') ? 'covered' : 'partial';
    default: return 'covered';
  }
}

/** The row sheet's state after an answer edit. While Joe hasn't tapped a state
 *  button and the row opened as Open, the state follows the answer both ways:
 *  up as parts are filled, back down when one is removed, Open when the answer
 *  is cleared. A state he tapped, or a row that opened already ticked, never
 *  moves. */
export function autoState(opts: { key: string; value: Record<string, unknown> | null; opened: CoverageStateLike; current: CoverageStateLike; touched: boolean }): CoverageStateLike {
  if (opts.touched || opts.opened !== 'open') return opts.current;
  return suggestedState(opts.key, opts.value) ?? 'open';
}
type CoverageStateLike = 'open' | 'partial' | 'covered' | 'not_applicable';

export function isInsurance(key: string, value: unknown): boolean {
  return key === 'paying' && !!value && typeof value === 'object' && (value as Record<string, unknown>).method === 'insurance';
}

/** Ask-in-email candidates (plan §6.8): Open/Partly rows that aren't refusals,
 *  ordered by reminder priority. At most three start ticked. */
export function emailCandidates<R extends { item_id: string; key: string; state: string; value: unknown; priority: number }>(rows: R[]): { rows: R[]; ticked: string[] } {
  const eligible = rows.filter((r) => (r.state === 'open' || r.state === 'partial') && !isRefusal(r.key, r.value)).sort((a, b) => a.priority - b.priority);
  return { rows: eligible, ticked: eligible.slice(0, 3).map((r) => r.item_id) };
}

export const MAX_EMAIL_QUESTIONS = 3;
