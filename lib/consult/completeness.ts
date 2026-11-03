import { compileCondition } from './forms/conditions.ts';
import type { When } from './form-types.ts';
export type SkipReason = 'Not on this job' | 'No access' | 'Not safe to measure' | 'Client declined' | 'Get on return visit' | 'Sub/supplier will measure' | 'Other';
export interface RiskAssumption {
  text: string; responsible_trade: string; verification_point: string;
  adjustment_route: 'precon_change' | 'change_order';
  quantity: number | null; unit: string | null; exclusion: string | null;
}
export interface CompletionItem {
  key: string; tier: 'price_critical' | 'record'; required: boolean; applicable: boolean;
  mapped: boolean; answered: boolean; valid: boolean;
  skip?: { reason: SkipReason; note?: string; condition_validated?: boolean; assumption?: RiskAssumption; trade_walk_decided?: boolean };
}
export function hasRiskAssumption(a?: RiskAssumption): boolean {
  return !!a && !!a.text.trim() && !!a.responsible_trade.trim() && !!a.verification_point.trim()
    && ['precon_change','change_order'].includes(a.adjustment_route)
    && (!!a.exclusion?.trim() || (a.quantity !== null && Number.isFinite(a.quantity) && a.quantity >= 0 && !!a.unit?.trim()));
}
export function countingSkip(item: CompletionItem): boolean {
  const skip = item.skip;
  if (!skip || !['Not on this job','No access','Not safe to measure','Client declined','Get on return visit','Sub/supplier will measure','Other'].includes(skip.reason)) return false;
  if (skip.reason === 'Get on return visit') return false;
  if (skip.reason === 'Not on this job') return skip.condition_validated === true;
  if (skip.reason === 'Other' && !skip.note?.trim()) return false;
  if (item.tier === 'record') return true;
  if (skip.reason === 'Sub/supplier will measure' && !skip.trade_walk_decided) return false;
  return hasRiskAssumption(skip.assumption);
}
export function conditionMatches(when: When, get: (field: string) => unknown): boolean {
  const values: Record<string,unknown> = {};
  function collect(node: When): void {
    if ('all' in node) node.all.forEach(collect);
    else if ('any' in node) node.any.forEach(collect);
    else if ('not' in node) collect(node.not);
    else values[node.field] = get(node.field);
  }
  collect(when);
  return compileCondition(when,new Set(Object.keys(values)))(values);
}
export interface CompletionInput {
  fields: CompletionItem[]; photos: CompletionItem[];
  modules: { key: string; minimum: number; live_count: number; parents_valid: boolean }[];
  recording: { asked: boolean; choice: 'manual' | 'recorded' | null; confirmed_evidence: boolean; documented_failure_or_stop: boolean };
  photo_permission: boolean | null;
  acknowledgement: { initials_committed: boolean; visitor_reason: string | null; handed_back: boolean };
  promised_date: string | null;
  manifests: { device: string; acknowledged: boolean; rejected: number; missing: boolean }[];
  unresolved_conflicts: number;
  rrp: { applies: boolean; receipt: boolean; firm_current: boolean; renovator_current: boolean; redelivery_required: boolean; redelivery_todo: boolean };
  flags: { key: string; disposition: 'price_it' | 'allowance' | 'sub_must_look' | 'not_an_issue' | null; actor: string | null; at: string | null; note: string }[];
  touched_trades: string[];
  trade_walks: { trade: string; needed: boolean; reason: string; actor: string; at: string }[];
  no_trades_confirmed: boolean;
}
const trim = (s: string | null | undefined) => !!s?.trim();
function validDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
export function consultCompleteness(input: CompletionInput) {
  const required = (items: CompletionItem[]) => items.filter((i) => i.required && i.applicable);
  const done = (item: CompletionItem) => (item.answered && item.valid) || countingSkip(item);
  const fields = required(input.fields), photos = required(input.photos);
  const unsafe = fields.filter((i) => i.mapped && i.skip && ['No access','Not safe to measure'].includes(i.skip.reason));
  const checks = [
    { check: 1, code: 'required_fields', open: fields.filter((i) => !done(i)).map((i) => i.key) },
    { check: 2, code: 'required_photos', open: photos.filter((i) => !done(i)).map((i) => i.key) },
    { check: 3, code: 'module_requirements', open: input.modules.filter((m) => !m.parents_valid || m.live_count < m.minimum).map((m) => m.key) },
    { check: 4, code: 'permissions', open: input.recording.asked && input.recording.choice !== null && (input.recording.choice === 'manual' || input.recording.confirmed_evidence || input.recording.documented_failure_or_stop) && input.photo_permission !== null ? [] : ['permissions'] },
    { check: 5, code: 'client_acknowledgement', open: input.acknowledgement.initials_committed || (input.acknowledgement.handed_back && trim(input.acknowledgement.visitor_reason)) ? [] : ['client_acknowledgement'] },
    { check: 6, code: 'promised_date', open: validDate(input.promised_date) ? [] : ['promised_date'] },
    { check: 7, code: 'close_manifests', open: [...(input.manifests.length ? input.manifests.filter((m) => !m.acknowledged || m.rejected > 0 || m.missing).map((m) => m.device) : ['missing_device']), ...(input.unresolved_conflicts > 0 ? ['conflicts'] : [])] },
    { check: 8, code: 'rrp', open: !input.rrp.applies || (input.rrp.receipt && input.rrp.firm_current && input.rrp.renovator_current && (!input.rrp.redelivery_required || input.rrp.redelivery_todo)) ? [] : ['rrp'] },
    { check: 9, code: 'flag_decisions', open: input.flags.filter((f) => !f.disposition || !['price_it','allowance','sub_must_look','not_an_issue'].includes(f.disposition) || !trim(f.actor) || !trim(f.at) || !trim(f.note)).map((f) => f.key) },
    { check: 10, code: 'risk_assumptions', open: unsafe.filter((i) => !hasRiskAssumption(i.skip?.assumption)).map((i) => i.key) },
    { check: 11, code: 'trade_walks', open: input.touched_trades.length ? input.touched_trades.filter((trade) => !input.trade_walks.some((w) => w.trade === trade && typeof w.needed === 'boolean' && trim(w.reason) && trim(w.actor) && trim(w.at))) : input.no_trades_confirmed ? [] : ['trade_none'] },
  ];
  const counts = (tier: CompletionItem['tier']) => {
    const items = [...fields, ...photos].filter((i) => i.tier === tier);
    return { total: items.length, done: items.filter(done).length, skipped: items.filter((i) => countingSkip(i)).length };
  };
  return { complete: checks.every((c) => !c.open.length), checks: checks.map(c=>({...c,action:closeAction(c.code)})), price_critical: counts('price_critical'), record: counts('record') };
}

export function openItemCount(counts: {price_critical:{total:number;done:number};record:{total:number;done:number}}):number { const n=sectionCounts({pc:counts.price_critical,record:counts.record});return n.total-n.done; }

export function closeAction(code:string):string {
 return ({required_fields:'go_field',required_photos:'take_photo',module_requirements:'add_instance',permissions:'review_permissions',client_acknowledgement:'show_client',promised_date:'pick_date',close_manifests:'review_sync',rrp:'review_rrp',flag_decisions:'review_flags',risk_assumptions:'review_assumptions',trade_walks:'review_trades'} as Record<string,string>)[code]??'review_sync';
}
export function sectionCounts(section:{pc:{total:number;done:number};record:{total:number;done:number}}) {
 return {done:section.pc.done+section.record.done,total:section.pc.total+section.record.total};
}
