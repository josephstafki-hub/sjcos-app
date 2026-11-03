/**
 * Pure view model for the in-home consultation field app (plan §6.1–§6.4, §10.2–§10.3).
 * Inputs: the stored/fresh server snapshot, the durable local queue and blob metadata,
 * and the local close-evidence draft. Output: sections, fields with their one-legend
 * marks, counts, the Before-you-wrap list, fired flags, and next op revisions.
 * Nothing here talks to the network or storage; the server alone decides Complete.
 */
import type { FieldDef, ModuleDef, ShotDef, TemplateDef, When } from '../form-types.ts';
import { compileCondition } from '../forms/conditions.ts';
import { countingSkip, hasRiskAssumption, type CompletionItem, type RiskAssumption, type SkipReason } from '../completeness.ts';
import type { QueueEntry } from '../queue.ts';
import type { LocalBlob } from '../offline-engine.ts';

export interface Display { client: string; project: string; slug: string; address: string | null; visitor_name: string; visitor_staff: boolean; scheduled_label: string }
export interface SnapInstance { id: string; module_key: string; parent_id: string | null; removed_at: string | null; label?: string; created_at?: string }
export interface SnapHead { id: string; instance_id: string; field_key: string; status: string; value: unknown; unit?: string | null; skip_reason: string | null; skip_note: string | null; server_revision: string | number; device_id?: string | null; actor?: string | null; created_at?: string }
export interface SnapConflict { id?: string; instance_id: string; field_key: string; current_answer_id: string; proposed_answer_id: string }
export interface Snapshot {
  consult: { id: string; project_id: string; status: string; revision: string | number; completion_generation: string | number; conducted_by: string; scheduled_at: string; deletion_epoch?: string | number; promised_date?: string | null; closed_at?: string | null; completed_at?: string | null; completeness_cache?: unknown };
  pins: { kind: string; key?: string; version?: number; checksum?: string; definition: ModuleDef | TemplateDef }[];
  instances: SnapInstance[]; heads: SnapHead[]; conflicts: SnapConflict[];
  proposals?: unknown[];
  findings_job?: { generation: string | number; status: string; attempts: number; last_error: string | null; result: unknown } | null;
  display?: Display;
}
export interface EvidenceDraft {
  skips: Record<string, { reason: SkipReason; note?: string; assumption?: RiskAssumption; trade_walk_decided?: boolean }>;
  flags: Record<string, { disposition: 'price_it' | 'allowance' | 'sub_must_look' | 'not_an_issue'; note: string }>;
  trade_walks: { trade: string; needed: boolean | null; reason: string }[];
  no_trades_confirmed: boolean;
  rrp: { receipt: boolean; firm_current: boolean; renovator_current: boolean; redelivery_required: boolean; redelivery_day?: string };
  ack_reason: string | null;
}
export const emptyDraft = (): EvidenceDraft => ({ skips: {}, flags: {}, trade_walks: [], no_trades_confirmed: false, rrp: { receipt: false, firm_current: false, renovator_current: false, redelivery_required: false }, ack_reason: null });

export type Mark = 'open' | 'partial' | 'covered' | 'not_applicable';
export interface AnswerView { status: 'answered' | 'skipped' | 'cleared'; value: unknown; unit?: string; skip_reason?: SkipReason; skip_note?: string; local: 'server' | 'pending' | 'accepted' | 'conflict' | 'invalid' | 'other'; error_code?: string; event_id?: string; revision?: number }
export interface ConflictView { key: string; instance_id: string; field_key: string; current?: { id: string; value: unknown; status: string; revision: number; device?: string | null }; proposed?: { id: string; value: unknown; status: string; device?: string | null }; event_id?: string; rebase?: boolean }
export interface ShotView { key: string; def: ShotDef; required: boolean; mark: Mark; skip?: AnswerView['skip_reason']; blobs: LocalBlob[]; addr: string }
export interface FieldView {
  key: string; addr: string; def: FieldDef; required: boolean; applicable: boolean; mark: Mark;
  answer?: AnswerView; conflict?: ConflictView; returnVisit: boolean; skipNote?: string; skipCounts: boolean;
  shots: ShotView[]; flags: { key: string; issue: string }[]; initials?: LocalBlob;
}
export interface SectionView {
  instance: SnapInstance; module: ModuleDef; label: string; title: string; depth: number;
  fields: FieldView[]; hidden: FieldView[]; shots: ShotView[]; mark: Mark; conflict: boolean; returnVisit: boolean;
  pc: { done: number; total: number }; record: { done: number; total: number }; children: string[];
}
export interface ModuleSlot { module: ModuleDef; minimum: number; live: number; required: boolean; parent?: string; optional: boolean; label?: string }
export interface VisitModel {
  modules: ModuleDef[]; templates: TemplateDef[]; sections: SectionView[]; slots: ModuleSlot[];
  pc: { done: number; total: number; skipped: number }; record: { done: number; total: number; skipped: number };
  open: { section: SectionView; item: FieldView | ShotView; kind: 'field' | 'shot'; partly: boolean }[];
  flags: { key: string; issue: string; section: SectionView; field: FieldView }[];
  conflicts: ConflictView[]; touchedTrades: string[]; rrpApplies: boolean;
  values: Record<string, unknown>; photosOk: boolean | null; promised: string | null;
  started: boolean; status: string; generation: number;
}

export const addrOf = (instance_id: string, field_key: string) => `${instance_id}:${field_key}`;
export const shotAddr = (instance_id: string, shot_key: string) => `${instance_id}:shot:${shot_key}`;

const ANSWER_TYPES = new Set(['answer', 'clear', 'resolve']);
const BUMPS = new Set(['start', 'create_instance', 'remove_instance', 'answer', 'clear', 'resolve']);

export function modulesOf(s: Snapshot): ModuleDef[] { return s.pins.filter((p) => p.kind === 'module').map((p) => p.definition as ModuleDef); }
export function templatesOf(s: Snapshot): TemplateDef[] { return s.pins.filter((p) => p.kind === 'template').map((p) => p.definition as TemplateDef); }
export const isHiddenModule = (m: ModuleDef) => m.key === 'visit' || !!m.context_module;
export const isDerived = (f: FieldDef) => !!f.derive || !!f.derive_cases || (f.help ?? '').startsWith('Derived');

/** Live instances = snapshot instances + local create/remove ops that weren't refused. */
export function liveInstances(s: Snapshot, entries: QueueEntry[]): SnapInstance[] {
  const list = s.instances.map((i) => ({ ...i }));
  for (const e of entries) {
    if (['invalid', 'deleted', 'quarantined'].includes(e.status) || (e.status === 'conflict' && e.op.type !== 'answer')) continue;
    const t = e.op.target as { instance_id: string; module_key?: string; parent_id?: string; label?: string } | null;
    if (e.op.type === 'create_instance' && t && !list.some((i) => i.id === t.instance_id)) list.push({ id: t.instance_id, module_key: t.module_key!, parent_id: t.parent_id ?? null, removed_at: null, label: t.label });
    if (e.op.type === 'remove_instance' && t) { const hit = list.find((i) => i.id === t.instance_id); if (hit) hit.removed_at = hit.removed_at ?? 'local'; }
  }
  return list;
}

/** Answers = server heads, overlaid by every local answer/clear/resolve in sequence order. */
export function answerMap(s: Snapshot, entries: QueueEntry[], overlayFrom = 0): Map<string, AnswerView> {
  const map = new Map<string, AnswerView>();
  for (const h of s.heads) map.set(addrOf(h.instance_id, h.field_key), { status: h.status as AnswerView['status'], value: h.value, unit: h.unit ?? undefined, skip_reason: (h.skip_reason ?? undefined) as SkipReason | undefined, skip_note: h.skip_note ?? undefined, local: 'server', revision: Number(h.server_revision) });
  for (const e of entries) {
    if (!ANSWER_TYPES.has(e.op.type) || e.op.seq <= overlayFrom && e.status === 'accepted') continue;
    if (['deleted', 'quarantined'].includes(e.status)) continue;
    const t = e.op.target as { instance_id: string; field_key: string };
    const p = (e.op.type === 'resolve' ? (e.op.payload as { answer: unknown }).answer : e.op.payload) as { status: AnswerView['status']; value?: unknown; unit?: string; skip_reason?: SkipReason; skip_note?: string };
    const key = addrOf(t.instance_id, t.field_key);
    const local: AnswerView['local'] = e.status === 'pending' || e.status === 'locked' ? 'pending' : e.status === 'accepted' ? 'accepted' : e.status === 'conflict' ? 'conflict' : e.status === 'invalid' ? 'invalid' : 'other';
    if (local === 'invalid' && map.has(key)) { map.set(key, { ...map.get(key)!, error_code: e.error_code, event_id: e.op.client_event_id, local: 'invalid' }); continue; }
    if (local === 'conflict' && e.op.type !== 'resolve') { const prior = map.get(key); map.set(key, { ...(prior ?? { status: p.status, value: p.value }), local: 'conflict', error_code: e.error_code, event_id: e.op.client_event_id }); continue; }
    map.set(key, { status: p.status, value: p.status === 'answered' ? p.value : undefined, unit: p.unit, skip_reason: p.skip_reason, skip_note: p.skip_note, local, error_code: e.error_code, event_id: e.op.client_event_id, revision: e.revision });
  }
  return map;
}

/** Conflicts still to pick: server conflicts + local conflict/rebase receipts with no later resolve/discard. */
export function openConflicts(s: Snapshot, entries: QueueEntry[]): ConflictView[] {
  const out: ConflictView[] = [];
  const resolvedEvents = new Set<string>();
  const resolvedAddr = new Set<string>();
  for (const e of entries) {
    if (e.status !== 'accepted' && e.status !== 'pending') continue;
    if (e.op.type === 'discard_rejection') resolvedEvents.add((e.op.payload as { event_id: string }).event_id);
    if (e.op.type === 'resolve') { const p = e.op.payload as { proposed_answer_id: string }; resolvedEvents.add(p.proposed_answer_id); const t = e.op.target as { instance_id: string; field_key: string }; resolvedAddr.add(`${addrOf(t.instance_id, t.field_key)}@${e.op.seq}`); }
  }
  const heads = new Map(s.heads.map((h) => [h.id, h]));
  for (const x of s.conflicts) {
    if (resolvedEvents.has(x.proposed_answer_id)) continue;
    const cur = heads.get(x.current_answer_id);
    out.push({ key: addrOf(x.instance_id, x.field_key), instance_id: x.instance_id, field_key: x.field_key, current: cur ? { id: cur.id, value: cur.value, status: cur.status, revision: Number(cur.server_revision), device: cur.device_id } : undefined, proposed: { id: x.proposed_answer_id, value: undefined, status: 'answered' } });
  }
  for (const e of entries) {
    if (e.status !== 'conflict' || !ANSWER_TYPES.has(e.op.type) || resolvedEvents.has(e.op.client_event_id)) continue;
    const t = e.op.target as { instance_id: string; field_key: string };
    const key = addrOf(t.instance_id, t.field_key);
    const laterResolve = [...resolvedAddr].some((r) => { const [k, seq] = r.split('@'); return k === key && Number(seq) > e.op.seq; });
    if (laterResolve) continue;
    const pair = e.conflict as { current?: { id: string; value: unknown; status: string; server_revision: number | string; device_id?: string }; proposed?: { id: string; value: unknown; status: string; device_id?: string } } | undefined;
    if (pair?.proposed && resolvedEvents.has(pair.proposed.id)) continue;
    const prop = pair?.proposed;
    const same = prop ? out.find((c) => c.key === key && c.proposed?.id === prop.id) : undefined;
    if (same && prop) { same.proposed = { id: prop.id, value: prop.value, status: prop.status, device: prop.device_id }; same.event_id = e.op.client_event_id; continue; }
    const p = e.op.payload as { value?: unknown; status: string };
    out.push({ key, instance_id: t.instance_id, field_key: t.field_key, event_id: e.op.client_event_id, rebase: e.error_code === 'rebase_required' || !pair?.current,
      current: pair?.current ? { id: pair.current.id, value: pair.current.value, status: pair.current.status, revision: Number(pair.current.server_revision), device: pair.current.device_id } : undefined,
      proposed: pair?.proposed ? { id: pair.proposed.id, value: pair.proposed.value, status: pair.proposed.status, device: pair.proposed.device_id } : { id: e.op.client_event_id, value: p.value, status: p.status } });
  }
  return out;
}

/** Entries the server refused (422) that a person has not explicitly abandoned yet. */
export function refusedEntries(entries: QueueEntry[]): QueueEntry[] {
  const discarded = new Set(entries.filter((e) => e.op.type === 'discard_rejection' && e.status !== 'invalid').map((e) => (e.op.payload as { event_id: string }).event_id));
  return entries.filter((e) => e.status === 'invalid' && !discarded.has(e.op.client_event_id));
}

/** Local work not yet acknowledged and not explicitly resolved: gate for Close (local_pending must be 0). */
export function unsentCount(entries: QueueEntry[]): number {
  return entries.filter((e) => e.status === 'pending' || e.status === 'locked' || e.status === 'update_required').length;
}

/** Revision each new op is based on. The consult revision moves by exactly one per accepted op (§12.2). */
export interface Baseline { rev: number; seq: number; fields: Record<string, number> }
export function predictRevisions(base: Baseline, entries: QueueEntry[]): Baseline {
  let rev = base.rev; const fields = { ...base.fields };
  for (const e of entries) {
    if (e.op.seq <= base.seq) continue;
    if (['invalid', 'deleted', 'quarantined', 'update_required'].includes(e.status)) continue;
    if (!BUMPS.has(e.op.type)) continue;
    if (e.status === 'accepted' || (e.status === 'conflict' && e.revision !== undefined)) rev = e.revision ?? rev + 1;
    else if (e.status === 'conflict') continue;
    else rev += 1;
    if (ANSWER_TYPES.has(e.op.type) && e.status !== 'conflict') { const t = e.op.target as { instance_id: string; field_key: string }; fields[addrOf(t.instance_id, t.field_key)] = rev; }
  }
  return { rev, seq: entries.at(-1)?.op.seq ?? base.seq, fields };
}
export function baselineOf(s: Snapshot, seq = 0): Baseline {
  const fields: Record<string, number> = {};
  for (const h of s.heads) if (h.instance_id !== s.consult.id) fields[addrOf(h.instance_id, h.field_key)] = Number(h.server_revision);
  return { rev: Number(s.consult.revision), seq, fields };
}

function knownFields(modules: ModuleDef[]): Set<string> {
  return new Set(modules.flatMap((m) => m.fields.map((f) => `${m.key}.${f.key}`)));
}
function safeCondition(cond: boolean | When, known: Set<string>, values: Record<string, unknown>): boolean {
  try { return compileCondition(cond, known)(values); } catch { return true; }
}

/** Display label: the instance_label pattern with {n} and field values filled in. */
export function instanceLabel(m: ModuleDef, inst: SnapInstance, ordinal: number, answers: Map<string, AnswerView>): string {
  if (!m.repeatable) return m.title;
  const pattern = m.instance_label ?? `${m.title} {n}`;
  let missing = false;
  const text = pattern.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    if (key === 'n') return String(ordinal);
    const a = answers.get(addrOf(inst.id, key));
    if (a?.status === 'answered' && a.value !== undefined && a.value !== null && String(a.value).trim()) return String(a.value);
    missing = true; return '';
  });
  if (missing) {
    const clean = text.replace(/\s+—\s*$/, '').trim();
    return clean || inst.label || `${m.title} ${ordinal}`;
  }
  return text;
}

export interface TradeMap { [module: string]: string }
const TRADES: TradeMap = { panel: 'Electrician', plumb_fixture: 'Plumber', water: 'Plumber', hvac: 'HVAC', hvac_vent: 'HVAC', hvac_exhaust_fan: 'HVAC' };

export function buildModel(s: Snapshot, entries: QueueEntry[], blobs: LocalBlob[], draft: EvidenceDraft, overlayFrom = 0): VisitModel {
  const modules = modulesOf(s), templates = templatesOf(s);
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const live = liveInstances(s, entries).filter((i) => !i.removed_at);
  const answers = answerMap(s, entries, overlayFrom);
  const conflicts = openConflicts(s, entries);
  const known = knownFields(modules);
  // Global values for cross-module conditions; ambiguous repeats stay arrays (server rule).
  const global: Record<string, unknown> = {};
  for (const m of modules) for (const f of m.fields) {
    const vals = live.filter((i) => i.module_key === m.key).map((i) => answers.get(addrOf(i.id, f.key))).filter((a) => a?.status === 'answered').map((a) => a!.value);
    if (vals.length) global[`${m.key}.${f.key}`] = vals.length === 1 ? vals[0] : vals;
  }
  const templateKeys = templates.map((t) => t.key);
  global['visit.templates'] = templateKeys.filter((k) => !['garage', 'openings', 'flooring'].includes(k));
  global['visit.add_ons'] = templateKeys.filter((k) => ['garage', 'openings', 'flooring'].includes(k));

  // Template module order, merged across pinned templates.
  const order: { module: string; required: boolean | When; min?: number; label?: string }[] = [];
  for (const t of templates) for (const entry of t.modules) if (!order.some((o) => o.module === entry.module)) order.push(entry);
  for (const m of modules) if (!isHiddenModule(m) && !order.some((o) => o.module === m.key) && live.some((i) => i.module_key === m.key)) order.push({ module: m.key, required: false });

  const slots: ModuleSlot[] = [];
  for (const o of order) {
    const m = byKey.get(o.module); if (!m || isHiddenModule(m)) continue;
    const required = safeCondition(o.required, known, global);
    const minimum = required ? Math.max(1, o.min ?? 1) : 0;
    slots.push({ module: m, minimum, live: live.filter((i) => i.module_key === m.key).length, required, parent: m.parent_module, optional: o.required === false, label: o.label });
  }

  const sections: SectionView[] = [];
  const ordinals = new Map<string, number>();
  const sorted: SnapInstance[] = [];
  const slotIndex = (key: string) => { const i = slots.findIndex((s) => s.module.key === key); return i < 0 ? slots.length : i; };
  const place = (inst: SnapInstance) => {
    sorted.push(inst);
    const kids = live.filter((c) => c.parent_id === inst.id).sort((a, b) => slotIndex(a.module_key) - slotIndex(b.module_key));
    for (const c of kids) if (!sorted.includes(c)) place(c);
  };
  for (const slot of slots) for (const i of live.filter((i) => i.module_key === slot.module.key && !i.parent_id)) place(i);
  for (const i of live) { const m = byKey.get(i.module_key); if (!sorted.includes(i) && m && !isHiddenModule(m)) place(i); }

  const allOpen: VisitModel['open'] = [];
  const allFlags: VisitModel['flags'] = [];
  const tally = { pc: { done: 0, total: 0, skipped: 0 }, record: { done: 0, total: 0, skipped: 0 } };
  const photoBlobs = blobs.filter((b) => b.kind === 'photo');

  for (const inst of sorted) {
    const m = byKey.get(inst.module_key); if (!m || isHiddenModule(m)) continue;
    const n = (ordinals.get(m.key) ?? 0) + 1; ordinals.set(m.key, n);
    const values: Record<string, unknown> = { ...global };
    for (const f of m.fields) { const a = answers.get(addrOf(inst.id, f.key)); if (a?.status === 'answered') values[f.key] = a.value; }
    const localKnown = new Set([...known, ...m.fields.map((f) => f.key)]);
    const req = (r: boolean | When) => safeCondition(r, localKnown, values);
    const fieldViews: FieldView[] = []; const hidden: FieldView[] = [];
    const section: SectionView = { instance: inst, module: m, label: '', title: m.title, depth: inst.parent_id ? 1 : 0, fields: [], hidden: [], shots: [], mark: 'open', conflict: false, returnVisit: false, pc: { done: 0, total: 0 }, record: { done: 0, total: 0 }, children: live.filter((c) => c.parent_id === inst.id).map((c) => c.id) };
    const count = (tier: 'price_critical' | 'record', done: boolean, skipped: boolean) => {
      const t = tier === 'price_critical' ? section.pc : section.record; t.total++; if (done) t.done++;
      const g = tier === 'price_critical' ? tally.pc : tally.record; g.total++; if (done) g.done++; if (skipped) g.skipped++;
    };
    const shotView = (shot: ShotDef): ShotView => {
      const key = shotAddr(inst.id, shot.key);
      const mine = photoBlobs.filter((b) => b.instance_id === inst.id && b.shot_key === shot.key);
      const sk = draft.skips[key];
      const required = req(shot.required);
      const item: CompletionItem = { key, tier: shot.tier, required, applicable: true, mapped: false, answered: mine.length > 0, valid: true, skip: sk ? { reason: sk.reason, note: sk.note, assumption: sk.assumption, trade_walk_decided: sk.trade_walk_decided } : undefined };
      const done = mine.length > 0 || countingSkip(item);
      return { key: shot.key, def: shot, required, mark: mine.length ? 'covered' : done ? 'not_applicable' : 'open', skip: sk?.reason, blobs: mine, addr: key };
    };
    for (const f of m.fields) {
      if (isDerived(f)) continue;
      const addr = addrOf(inst.id, f.key);
      const a = answers.get(addr);
      const conditional = typeof f.required !== 'boolean';
      const required = req(f.required);
      const applicable = !conditional || required || (a !== undefined && a.status !== 'cleared');
      const sk = draft.skips[addr];
      const skip = a?.status === 'skipped' ? { reason: a.skip_reason as SkipReason, note: a.skip_note, ...(sk?.reason === a.skip_reason ? sk : {}), condition_validated: conditional && !required } : undefined;
      const item: CompletionItem = { key: addr, tier: f.tier, required, applicable: true, mapped: !!f.maps_to, answered: a?.status === 'answered', valid: a?.status === 'answered' && a.value !== null && a.value !== '' && (!Array.isArray(a.value) || a.value.length > 0), skip };
      const initials = f.type === 'signature' ? blobs.find((b) => b.kind === 'initials' && b.instance_id === inst.id && b.field_key === f.key) : undefined;
      const answered = (item.answered && item.valid) || !!initials;
      const counts = !answered && countingSkip(item);
      const shots = (f.shots ?? []).map(shotView);
      const shotsDone = shots.filter((s) => s.required).every((s) => s.mark !== 'open');
      const conflict = conflicts.find((c) => c.key === addr);
      let mark: Mark = answered ? (shotsDone ? 'covered' : 'partial') : counts ? 'not_applicable' : 'open';
      if (f.type === 'length_pair' && answered && Array.isArray(a?.value) && a!.value.some((v) => typeof v !== 'number')) mark = 'partial';
      const flags: FieldView['flags'] = [];
      for (const [index, flag] of [...(f.flag ? [f.flag] : []), ...(f.flags ?? [])].entries()) if (req(flag.when)) flags.push({ key: index ? `${addr}:${index}` : addr, issue: flag.issue });
      const view: FieldView = { key: f.key, addr, def: f, required, applicable, mark, answer: a, conflict, returnVisit: a?.status === 'skipped' && a.skip_reason === 'Get on return visit', skipNote: a?.skip_note, skipCounts: counts, shots, flags, initials };
      if (!applicable) { hidden.push(view); continue; }
      fieldViews.push(view);
      if (required) {
        count(f.tier, answered || counts, counts);
        if (!(answered || counts)) allOpen.push({ section, item: view, kind: 'field', partly: false });
        else if (mark === 'partial') allOpen.push({ section, item: view, kind: 'field', partly: true });
      }
      for (const s of shots) if (s.required) { const done = s.mark !== 'open'; count(s.def.tier, done, s.mark === 'not_applicable'); if (!done && (answered || counts)) allOpen.push({ section, item: s, kind: 'shot', partly: false }); }
      for (const fl of flags) allFlags.push({ ...fl, section, field: view });
      if (conflict) section.conflict = true;
      if (view.returnVisit) section.returnVisit = true;
    }
    section.shots = m.shots.map(shotView);
    for (const s of section.shots) if (s.required) { const done = s.mark !== 'open'; count(s.def.tier, done, s.mark === 'not_applicable'); if (!done) allOpen.push({ section, item: s, kind: 'shot', partly: false }); }
    section.fields = fieldViews; section.hidden = hidden;
    section.label = instanceLabel(m, inst, n, answers);
    const pcDone = section.pc.done, pcTotal = section.pc.total;
    section.mark = pcTotal === 0 ? (section.record.total && section.record.done < section.record.total ? (section.record.done ? 'partial' : 'open') : 'covered') : pcDone === 0 ? 'open' : pcDone < pcTotal ? 'partial' : 'covered';
    sections.push(section);
  }

  const touched = new Set<string>();
  for (const i of live) if (TRADES[i.module_key]) touched.add(TRADES[i.module_key]);
  const year = global['house.year_built'];
  const status = s.consult.status;
  const started = status !== 'scheduled' || entries.some((e) => e.op.type === 'start' && !['invalid', 'deleted'].includes(e.status));
  const photosOk = typeof global['house.photos_ok'] === 'boolean' ? (global['house.photos_ok'] as boolean) : null;
  const promisedRaw = global['closing.estimate_promised'];
  return {
    modules, templates, sections, slots, pc: tally.pc, record: tally.record, open: allOpen, flags: allFlags, conflicts,
    touchedTrades: [...touched], rrpApplies: typeof year !== 'number' || year < 1978, values: global, photosOk,
    promised: typeof promisedRaw === 'string' ? promisedRaw : null, started, status, generation: Number(s.consult.completion_generation),
  };
}

/** Next open required item after `from` in the same section, else the first open item in the next section (§6.3 Next). */
export function nextOpen(model: VisitModel, sectionId: string, fromAddr?: string): { section: string; addr: string } | null {
  const idx = model.sections.findIndex((s) => s.instance.id === sectionId);
  const section = model.sections[idx];
  if (section) {
    const items = model.open.filter((o) => o.section.instance.id === sectionId && !o.partly);
    const order = section.fields.map((f) => f.addr);
    const after = fromAddr ? order.indexOf(fromAddr) : -1;
    const hit = items.find((o) => o.kind === 'field' && order.indexOf((o.item as FieldView).addr) > after) ?? items.find((o) => o.kind === 'shot');
    if (hit) return { section: sectionId, addr: hit.kind === 'field' ? (hit.item as FieldView).addr : (hit.item as ShotView).addr };
  }
  return null;
}

/** Open items in one section, in the leave-section banner's words (§5.3 step 8). */
export function leaveList(model: VisitModel, sectionId: string): { open: string[]; partly: string[] } {
  const items = model.open.filter((o) => o.section.instance.id === sectionId);
  const name = (o: VisitModel['open'][number]) => (o.kind === 'field' ? (o.item as FieldView).def.label : `${(o.item as ShotView).def.label} photo`).replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return { open: items.filter((o) => !o.partly).map(name), partly: items.filter((o) => o.partly).map(name) };
}

/** Allowlisted client summary (§6.4): rooms + work words, still-to-decide, open questions, formal estimate date. */
export function summaryInput(model: VisitModel, display: Display | undefined, visitDate: string, formalDate: string) {
  const rooms: { name: string; work: string[] }[] = [];
  for (const s of model.sections) {
    if (!['room', 'bath_scope', 'kitchen_scope', 'kitchen_wall', 'addition_scope', 'basement_scope', 'deck_scope', 'whole_scope', 'general_scope'].includes(s.module.key)) continue;
    const work = s.fields.filter((f) => f.answer?.status === 'answered' && f.def.type === 'choice' && f.def.maps_to && f.def.tier === 'price_critical').map((f) => `${f.def.label.toLowerCase()}: ${String(f.answer!.value).toLowerCase()}`).slice(0, 6);
    rooms.push({ name: s.label, work });
  }
  const stillToDecide = model.sections.filter((s) => s.module.key === 'selections').filter((s) => { const st = s.fields.find((f) => f.key === 'status'); return !st?.answer || st.answer.value !== 'Exact product picked'; }).map((s) => s.label);
  const questions = model.sections.filter((s) => s.module.key === 'closing').flatMap((s) => s.fields.filter((f) => f.key === 'client_questions' && f.answer?.status === 'answered').map((f) => String(f.answer!.value)));
  return { client_name: display?.client ?? '', visit_date: visitDate, rooms, still_to_decide: stillToDecide, open_questions: questions, formal_estimate_date: formalDate };
}

/** Required blob hashes for the exact close manifest: every photo this device holds for live instances. */
export function manifestBlobs(blobs: LocalBlob[]): { photos: string[]; initials: string | null } {
  const photos = blobs.filter((b) => b.kind === 'photo').map((b) => b.hash);
  const initials = blobs.filter((b) => b.kind === 'initials');
  return { photos: [...new Set(photos)].sort(), initials: initials.length ? initials[initials.length - 1].hash : null };
}

/** Validity of a written assumption, for the skip sheet's Save button. */
export const assumptionOk = hasRiskAssumption;

/**
 * The strict evidenceSchema payload from the local draft (§10.3 checks 4–6, 8–11).
 * Returns null when the promised-by date is missing: the server then reports
 * Needs finishing with the exact open checks instead of refusing the close.
 * Phase 1 has no recording, so the manual choice is always recorded.
 */
export function buildEvidence(model: VisitModel, draft: EvidenceDraft, hasInitials: boolean): Record<string, unknown> | null {
  if (!model.promised || !/^\d{4}-\d{2}-\d{2}$/.test(model.promised)) return null;
  const trim = (s?: string | null) => (s ?? '').trim();
  const skips: Record<string, unknown> = {};
  const fields = new Map(model.sections.flatMap((s) => s.fields.map((f) => [f.addr, f] as const)));
  const shots = new Set(model.sections.flatMap((s) => [...s.shots, ...s.fields.flatMap((f) => f.shots)].map((x) => x.addr)));
  for (const [key, v] of Object.entries(draft.skips)) {
    const f = fields.get(key);
    if (f ? !(f.answer?.status === 'skipped' && f.answer.skip_reason === v.reason) : !shots.has(key)) continue;
    const a = v.assumption && hasRiskAssumption(v.assumption) ? { text: trim(v.assumption.text), responsible_trade: trim(v.assumption.responsible_trade), verification_point: trim(v.assumption.verification_point), adjustment_route: v.assumption.adjustment_route, quantity: v.assumption.quantity, unit: trim(v.assumption.unit) || null, exclusion: trim(v.assumption.exclusion) || null } : undefined;
    skips[key] = { reason: v.reason, ...(trim(v.note) ? { note: trim(v.note) } : {}), ...(a ? { assumption: a } : {}), ...(typeof v.trade_walk_decided === 'boolean' ? { trade_walk_decided: v.trade_walk_decided } : {}) };
  }
  const flagKeys = new Set(model.flags.map((f) => f.key));
  const flags: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(draft.flags)) if (flagKeys.has(key) && trim(v.note)) flags[key] = { disposition: v.disposition, note: trim(v.note) };
  const walks = draft.trade_walks.filter((w) => trim(w.trade) && typeof w.needed === 'boolean' && trim(w.reason)).map((w) => ({ trade: trim(w.trade), needed: w.needed as boolean, reason: trim(w.reason) }));
  const touched = [...new Set([...model.touchedTrades, ...draft.trade_walks.map((w) => trim(w.trade)).filter(Boolean)])];
  const rrp = { receipt: draft.rrp.receipt, firm_current: draft.rrp.firm_current, renovator_current: draft.rrp.renovator_current, redelivery_required: draft.rrp.redelivery_required, ...(draft.rrp.redelivery_required && draft.rrp.redelivery_day && /^\d{4}-\d{2}-\d{2}$/.test(draft.rrp.redelivery_day) ? { redelivery_day: draft.rrp.redelivery_day } : {}) };
  return {
    photos_ok: model.photosOk === true, manual_confirmed: true, handed_back: true,
    ack_reason: hasInitials ? null : trim(draft.ack_reason) || null, promised_date: model.promised,
    no_trades_confirmed: touched.length === 0 && draft.no_trades_confirmed, touched_trades: touched, trade_walks: walks, rrp, flags, skips,
  };
}
