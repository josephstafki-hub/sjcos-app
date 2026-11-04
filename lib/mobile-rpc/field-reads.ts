import "server-only";
import { NextResponse } from "next/server";
import { getUserFromRequest, hasAccess } from "@/lib/api-auth";
import type { CurrentUser } from "@/lib/dal";
import type { PermissionKey } from "@/lib/permissions";
import { query } from "@/lib/db";
import { runDirect } from "@/lib/commands/db";
import { listOpenDocs, listResolvedDocs, projectChoices } from "@/lib/unsorted-docs";
import { parseScheduleTime, formatScheduleTime } from "@/lib/schedule-time";
import { getScheduleData, getScheduleConflict, weekBounds } from "@/lib/schedule";
import { getWarrantyData, getWarrantyProjectOptions } from "@/lib/warranty";
import { getInsurancePolicies } from "@/lib/insurance";
import { COMPLIANCE_SOURCE, CENTRAL_TODAY } from "@/lib/compliance-source.mjs";
import { getCompanyMoney } from "@/lib/budget";
import { groupAttention } from "@/lib/budget-company";

export class ReadError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function areaRead(req: Request, area: PermissionKey, load: (u: CurrentUser) => Promise<unknown>, ownerOnly = false) {
  try {
    const u = await getUserFromRequest(req);
    if (!u) return NextResponse.json({error: "Unauthorized"}, {status: 401});
    if (!hasAccess(u, area) || (ownerOnly && u.role !== "owner")) return NextResponse.json({error: "Forbidden"}, {status: 403});
    return NextResponse.json(await load(u), {headers: {"Cache-Control": "private, no-store"}});
  } catch (e) {
    if (e instanceof ReadError) return NextResponse.json({error: e.message}, {status: e.status});
    console.error("[mobile-read]", e);
    return NextResponse.json({error: "Unable to load this screen"}, {status: 500});
  }
}
export const label = (s: string) => s === "under_review" ? "Needs review" : s.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
export const money = (c: number) => new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: c % 100 ? 2 : 0}).format(c / 100);
export const iso = (s: string | null) => s ? new Date(s).toISOString() : null;
export async function unsortedRead(tab: string) {
  if (!["needs", "filed"].includes(tab)) throw new ReadError("Choose needs or filed");
  const [docs, projects] = await Promise.all([tab === "filed" ? listResolvedDocs(runDirect, 60) : listOpenDocs(runDirect), projectChoices(runDirect)]);
  const ids = docs.flatMap(d => [...d.attachment_file_ids, ...(d.email_file_id ? [d.email_file_id] : [])]);
  const files = ids.length ? (await query<{id:string; name:string; mime_type:string|null}>(`SELECT id,name,mime_type FROM files WHERE id=ANY($1::text[])`, [ids])).rows : [];
  return {tab, projects, items: docs.map(d => ({
    id: d.id, title: d.subject, kind: label(d.doc_kind), summary: d.summary, vendor: d.vendor_label,
    amountCents: d.amount_cents, amountLabel: d.amount_cents == null ? "Not recorded" : money(d.amount_cents), date: d.doc_date,
    receivedAt: iso(d.received_at), createdAt: iso(d.created_at)!, status: d.status,
    statusLabel: d.status === "dismissed" ? "Set aside" : d.status === "needs_agent" ? "With the agent" : label(d.status),
    suggestions: d.suggestions.map(s => ({projectSlug: s.project_slug, projectName: projects.find(p => p.slug === s.project_slug)?.name ?? s.project_slug, reason: s.reason})),
    overheadLikely: d.overhead_likely, whyUnsure: d.why_unsure, agentNote: d.agent_note, ownerNote: d.owner_note,
    filedTo: d.filed_to, projectSlug: d.filed_project_slug, projectName: d.filed_project_name, resolvedAt: iso(d.resolved_at),
    files: [...d.attachment_file_ids, ...(d.email_file_id ? [d.email_file_id] : [])].flatMap(id => {
      const f = files.find(f => f.id === id); const url = `/api/mobile/unsorted/${d.id}/file?fileId=${encodeURIComponent(id)}`;
      return f ? [{id, name: f.name, mimeType: f.mime_type, previewUrl: url, downloadUrl: url + "&download=1"}] : [];
    }), allowedActions: d.status === "filed" || d.status === "dismissed" ? ["unsorted.undo"] : ["unsorted.file", "unsorted.note", "unsorted.setAside", "unsorted.dismiss"],
  }))};
}
export async function scheduleRead(week: string | null) {
  if (week && (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(Date.parse(week)) || new Date(week).toISOString().slice(0,10) !== week)) throw new ReadError("week must be YYYY-MM-DD");
  const {monday} = weekBounds(0);
  const offset = week ? (await query<{n:number}>(`SELECT floor(($1::date - (${monday})::date)::numeric / 7)::int AS n`, [week])).rows[0].n : 0;
  const [data, conflict] = await Promise.all([getScheduleData(offset), getScheduleConflict(offset)]);
  // Stored times are Central wall times. PostgreSQL applies the date's DST offset.
  const days = await Promise.all(data.days.map(async d => ({date: d.iso, label: `${d.dow} ${d.date}`, today: d.today,
    blocks: await Promise.all(d.blocks.map(async (b, i) => {
      let time = b.rawTime ?? b.time;
      try { time=parseScheduleTime(time).label; } catch { /* ambiguous legacy times stay visible, never invent a clock time */ }
      const times = /^(\d{2}:\d{2})(?:\s*[–-]\s*(\d{2}:\d{2}))?$/.exec(time);
      const stamp = times ? (await query<{start:string; end:string|null}>(`SELECT ($1::date + $2::time) AT TIME ZONE 'America/Chicago' AS start, CASE WHEN $3::text IS NULL THEN NULL ELSE ($1::date + $3::time) AT TIME ZONE 'America/Chicago' END AS end`, [d.iso, times[1], times[2] ?? null])).rows[0] : null;
      return {id: b.id ?? `auto:${d.iso}:${i}`, projectId: b.projectId ?? null, tone: b.tone, originalTimeLabel: b.rawTime ?? b.time, projectSlug: b.projectSlug ?? null, projectName: b.projectName ?? null, label: b.label,
        start: stamp ? iso(stamp.start) : null, end: stamp ? iso(stamp.end) : null, timeLabel: formatScheduleTime(b.time), rawTime: time, timeZone: "America/Chicago", timeZoneLabel: "Central time",
        kind: b.auto ? "Milestone" : b.projectSlug ? "Job block" : "Meeting", auto: b.auto ?? false,
        allowedActions: b.id && !b.auto ? ["schedule.update", "schedule.delete"] : []};
    }))})));
  return {week: data.days[0]?.iso ?? week, days, meetings: days.flatMap(d => d.blocks.filter(b => b.kind === "Meeting")), conflicts: {detected: conflict.startsWith("Double-booked"), label: conflict}, allowedActions: ["schedule.create"]};
}
export async function warrantyRead() {
  const [data, projects, rows, coverage] = await Promise.all([getWarrantyData(), getWarrantyProjectOptions(), query<{id:string; slug:string|null; source:string; opened:string|null}>(`SELECT w.id,p.slug,w.source,w.opened_at::text AS opened FROM warranty_claims w LEFT JOIN projects p ON p.id=w.project_id`), query<{project:string; until:string|null}>(`SELECT project,warranty_ends_at::text AS until FROM warranty_projects`)]);
  const withoutTerms=data.projects.filter(p=>/^Warranty terms not (configured|recorded)$/.test(p.warranty)).length;
  return {coverageSummary:`${data.projects.length} jobs with warranty records`,coverageTermsSummary:withoutTerms===0?"All have terms recorded":withoutTerms===data.projects.length?"None have terms recorded yet":`${withoutTerms} still need warranty terms`,claims: data.claims.map(c => {const r = rows.rows.find(r => r.id === c.id); return {id:c.id, project:c.project, projectSlug:r?.slug ?? null, issue:c.issue, channel:label(r?.source ?? "Not recorded"), openedAt:iso(r?.opened ?? null), resolved:c.resolved, statusLabel:c.resolved ? "Resolved" : c.acknowledged ? "In progress" : "Awaiting acknowledgment", allowedActions:c.resolved ? ["warranty.reopen"] : [...(!c.acknowledged ? ["warranty.acknowledge"] : []),"warranty.resolve"]};}), coverage:data.projects.map(p => ({project:p.project, projectSlug:projects.find(j => j.name === p.project)?.slug ?? null, until:coverage.rows.find(r => r.project === p.project)?.until ?? null, status:p.status, statusLabel:label(p.status), terms:/^Warranty terms not (configured|recorded)$/.test(p.warranty) ? "No warranty terms yet" : p.warranty})), projects, allowedActions:["warranty.create"]};
}
export async function complianceRead() {
  const [deadlines, policies] = await Promise.all([query<{id:string; what:string; due:string|null; days:number|null; who:string; step:string}>(`SELECT id,title AS what,due_date::text AS due,(due_date-${CENTRAL_TODAY})::int AS days,who,step FROM (${COMPLIANCE_SOURCE}) c ORDER BY due_date`), getInsurancePolicies(true)]);
  return {deadlines:deadlines.rows.map(r => ({id:r.id, what:r.what, due:r.due, who:r.who, step:r.step, statusLabel:r.days == null ? "Date not recorded" : r.days < 0 ? "Overdue" : r.days <= 14 ? "Due soon" : "Upcoming", overdue:r.days != null && r.days < 0, soon:r.days != null && r.days >= 0 && r.days <= 14, allowedActions:[] as string[]})), policies:policies.map(p => ({id:p.id, type:p.typeLabel, carrier:p.carrier, renewal:p.expires || null, archived:p.archived, statusLabel:p.status === "none" ? "Date not recorded" : label(p.status)})), allowedActions:[] as string[]};
}
export async function moneyRead() {
  const d = await getCompanyMoney();
  const groups = groupAttention(d.attention);
  const job = (r: typeof d.open[number]) => ({...r, stageLabel:label(r.stage), contractedCents:r.priceCents, contractedLabel:money(r.priceCents), collectedLabel:money(r.collectedCents), costLabel:money(r.costCents), paidLabel:money(r.paidCents), owedLabel:money(r.owedCents), orderedLabel:money(r.orderedCents), estToFinishLabel:money(r.estToFinishCents), unpaidInvoicesLabel:money(r.unpaidInvoicesCents), balanceCents:r.leftToCollectCents, balanceLabel:money(r.leftToCollectCents), profitLabel:r.profitCents == null ? "Unknown" : money(r.profitCents), profitStatusLabel:r.profitStatus === "unknown" ? "Profit unknown" : `${label(r.profitStatus)} profit`, attentionGroups:groups.filter(g => g.items.some(i => i.slug === r.slug)).map(g => g.title), allowedActions:[] as string[]});
  const totals = (t: typeof d.totals) => ({...t, contractedLabel:money(t.contractedCents), collectedLabel:money(t.collectedCents), balanceLabel:money(t.leftToCollectCents), unpaidInvoicesLabel:money(t.unpaidInvoicesCents), unbilledLabel:money(t.unbilledCents), profitPriceCoverageLabel:money(t.profitPriceCoverageCents), profitLabel:money(t.profitCents)});
  return {open:d.open.map(job), closed:d.closed.map(job), totals:totals(d.totals), closedTotals:totals(d.closedTotals), attention:groups.map(g => ({label:g.title, items:g.items.map(i => ({...i, amountLabel:money(i.amountCents)}))})), allowedActions:[] as string[]};
}
