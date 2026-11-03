import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { Button, PageHeader } from "@/components/ui";
import { CoverageMark } from "@/components/ui/CoverageMark";
import { requireAccess } from "@/lib/dal";
import { consultDevices, lookOverExtra, readSnapshot, scheduleOptions, visitHead } from "@/lib/consult/ui/server";
import { buildModel, emptyDraft, type EvidenceDraft, type FieldView, type SectionView } from "@/lib/consult/ui/model";
import { pinnedDerivations } from "@/lib/consult/derive";
import { openCheckPhrase, openItemCount } from "@/lib/consult/completeness";
import { displayLength } from "@/lib/consult/length";
import type { LocalBlob } from "@/lib/consult/offline-engine";
import { W, checkedAt, conflictSideLabel, fill, plainWords, quantitiesLine, reopenedHead, skipLine, skippedNotNA, statusLabel } from "@/lib/consult/ui/words";
import { ApplyFindings, OfficeConflict, ReopenButton } from "@/components/consult/office/LookOverActions";
import { AssignControl } from "@/components/consult/office/ScheduleDialog";
import { RecoveryControl } from "@/components/consult/office/RecoveryControl";
import { MeasureText } from "@/components/consult/MeasureText";
import { scopeLabelRegistry } from "@/lib/consult/forms/seed/templates";
import { SCOPE_RULES } from "@/lib/estimating/rules";

/** Scope item title for a FEEDS row: the scope register's own title, never the raw key. */
const SCOPE_TITLES = new Map(SCOPE_RULES.flatMap((r) => r.items.map((i) => [i.key, i.title] as const)));
function scopeTitle(key: string): string {
  const known = SCOPE_TITLES.get(key);
  if (known) return known;
  const [area, item = ""] = key.split(".");
  const words = `${area} ${item}`.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const unitOf = (key: string, label: string) => scopeLabelRegistry.find((r) => r.scope_key === key && r.quantity_label === label)?.unit ?? null;

export const dynamic = "force-dynamic";

const fmt = (iso: string | null | undefined, o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", ...o }).format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm") : "");
/** A started visit whose day has passed without a close reads "Visit interrupted" (§5.7). */
const interrupted = (iso: string) => new Date(iso).getTime() < Date.now() - 86400000;
function show(v: unknown, f: FieldView["def"]): string {
  if (v === undefined || v === null) return "—";
  const p = f.precision && [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1].includes(f.precision) ? f.precision : 1 / 8;
  try { if (f.type === "length" && typeof v === "number") return displayLength(v, p); if (f.type === "length_pair" && Array.isArray(v)) return v.map((x) => (typeof x === "number" ? displayLength(x, p) : "—")).join(" × "); } catch { /* raw */ }
  if (v === true) return W.yes; if (v === false) return W.no;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return (v as { text?: string }).text ?? JSON.stringify(v);
  return `${v}${f.unit && f.unit !== "ea" && f.unit !== "in" ? ` ${f.unit}` : ""}`;
}

/**
 * Visit page — an optional look-over (plan §6.8). Nothing waits on it: Complete is the
 * §10.3 test alone and no to-do or push asks anyone to open this. Joe on any visit;
 * the assigned visitor on their own. Pick a late conflict, Reopen with a reason, Apply
 * findings while automatic apply is off. Phone width stacks the three columns.
 */
export default async function ConsultLookOver({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ s?: string }> }) {
  const user = await requireAccess("projects");
  const { slug, id } = await params; const { s: selected } = await searchParams;
  const head = await visitHead(id.toLowerCase(), user);
  if (!head || head.slug !== slug) notFound();
  if (user.role !== "owner" && !head.assigned && head.conducted_by !== user.id) notFound();
  let snap;
  try { snap = await readSnapshot(user, head.id); } catch { notFound(); }
  const extra = await lookOverExtra(head.id);
  const ev = extra.evidence as (Partial<EvidenceDraft> & { promised_date?: string }) | null;
  const draft: EvidenceDraft = { ...emptyDraft(), ...(ev ? { skips: ev.skips ?? {}, flags: ev.flags ?? {}, trade_walks: (ev.trade_walks ?? []) as EvidenceDraft["trade_walks"], no_trades_confirmed: !!ev.no_trades_confirmed, rrp: ev.rrp ?? emptyDraft().rrp, ack_reason: ev.ack_reason ?? null } : {}) };
  const blobs: LocalBlob[] = extra.media.map((m) => ({ hash: m.sha256, event_id: m.id, mime: "image/jpeg", kind: m.kind === "initials" ? "initials" : "photo", instance_id: m.instance_id, ...(m.field_key ? { field_key: m.field_key } : {}), ...(m.shot_key ? { shot_key: m.shot_key } : {}), receipt: { file_id: m.file_id, media_id: m.id } }));
  const model = buildModel(snap, [], blobs, draft);
  const section: SectionView | undefined = model.sections.find((x) => x.instance.id === selected) ?? model.sections[0];
  const status = snap.consult.status;
  const completeness = extra.completeness as { checks?: { check: number; code: string; open: string[]; open_phrase?: string }[]; price_critical?: { total: number; done: number }; record?: { total: number; done: number } } | null;
  const openChecks = completeness?.checks?.filter((c) => c.open.length) ?? [];
  // The same total the visitor saw on Before you wrap and the close result (r3 C2 / r2 N6).
  const openN = completeness?.price_critical && completeness.record ? openItemCount({ price_critical: completeness.price_critical, record: completeness.record }) : openChecks.reduce((n, c) => n + c.open.length, 0);
  const job = snap.findings_job;
  const live = snap.instances.filter((i) => !i.removed_at);
  // FEEDS (§6.8): scope title · quantity label, value + unit in mono; "○ Open" until an answer feeds it.
  let feeds: { label: string; scope: string; title: string; value: number | null; unit: string | null }[] = [];
  try {
    feeds = pinnedDerivations(model.modules, model.templates, live, snap.heads.map((h) => ({ ...h, server_revision: String(h.server_revision) }))).derived
      .filter((d) => d.definition.maps_to).map((d) => {
        const scope = d.definition.maps_to!.scope_key, label = d.definition.maps_to!.quantity_label ?? d.definition.label;
        const measured = !!d.result && d.result.answer_revisions.length > 0;
        return { label, scope, title: scopeTitle(scope), value: measured ? d.result!.value : null, unit: unitOf(scope, label) };
      });
  } catch { feeds = []; }
  const owner = user.role === "owner";
  const movable = owner && !["complete", "cancelled"].includes(status);
  const [devices, moveOptions] = owner ? await Promise.all([consultDevices(head.id), movable ? scheduleOptions(head.project_id).catch(() => null) : Promise.resolve(null)]) : [[], null];
  const photos = extra.media.filter((m) => m.kind !== "initials");
  const initials = extra.media.find((m) => m.kind === "initials");
  const chip: "covered" | "partial" | null = status === "complete" ? "covered" : status === "incomplete" ? "partial" : null;
  // r8 domain E4: a Complete visit says how many quantities that feed the estimate weren't measured.
  const unmeasured = quantitiesLine(feeds.filter((x) => x.value === null).length);
  const headline = status === "complete" ? `Complete · ${fmt(extra.completedAt)}${unmeasured ? ` · ${unmeasured}` : ""}` : status === "incomplete" ? `Needs finishing · ${openN} open` : status === "in_progress" && interrupted(snap.consult.scheduled_at) ? W.visitInterrupted : statusLabel(status);
  const sectionLink = (x: SectionView) => `/projects/${slug}/consult/${head.id}?s=${x.instance.id}`;
  const fieldLink = (addr: string) => `/projects/${slug}/consult/${head.id}?s=${addr.split(":")[0]}#f-${addr}`;
  const canRecover = owner && devices.some((d) => d.revoked && !d.closed);
  /** r5 R5-4: each open check on the look-over — the office's own words and its way forward. */
  const officeRow = (c: { code: string; open: string[]; open_phrase?: string }) => {
    const firstField = model.open.find((o) => o.kind === "field");
    const firstShot = model.open.find((o) => o.kind === "shot");
    const finishOnDevice = head.assigned
      ? { action: <Button variant="secondary" size="lg" href={`/consult/${head.id}`}>{W.openVisitShort}</Button> }
      : { tail: ` ${fill(W.officeFinishOnDevice, { name: head.visitor_name })}` };
    if (c.code === "close_manifests") {
      const n = c.open.filter((x) => x !== "conflicts").length, conflicts = c.open.includes("conflicts");
      const conflictAddr = Object.keys(extra.conflicts)[0];
      const text = [n ? fill(n === 1 ? W.officeDeviceWaiting : W.officeDevicesWaiting, { n }) : "", conflicts ? W.conflictsToPick : ""].filter(Boolean).join(" · ");
      return {
        text, problem: conflicts,
        tail: n && !canRecover ? ` ${fill(W.officeSendFromDevice, { name: head.visitor_name })}` : "",
        action: conflicts && conflictAddr ? <Button variant="secondary" size="lg" href={fieldLink(conflictAddr)}>{W.goToField}</Button>
          : n && canRecover ? <Button variant="secondary" size="lg" href="#recover">{W.recoverAnswers}</Button> : undefined,
      };
    }
    // r6 D6: an open check says what is left, in the words Before you wrap uses on the visit.
    const text = c.open_phrase ?? openCheckPhrase(c.code, c.open);
    if (c.code === "required_fields" && firstField) return { text, action: <Button variant="secondary" size="lg" href={fieldLink((firstField.item as FieldView).addr)}>{W.goToField}</Button> };
    if (c.code === "required_photos" && (firstShot ?? firstField)) return { text, action: <Button variant="secondary" size="lg" href={sectionLink((firstShot ?? firstField)!.section)}>{W.goToPhoto}</Button> };
    return { text, ...finishOnDevice };
  };

  return (
    <Shell breadcrumb={`PROJECTS › ${head.project.toUpperCase()} › IN-HOME CONSULTATION`}>
      <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 @xl/page:px-7">
        {/* §6.8 head: "{client} › In-home consultation · Nov 3 · Abigail Stafki", a status chip (not a control), then actions. */}
        <PageHeader variant="record" title={`${head.client} › ${W.app} · ${fmt(snap.consult.scheduled_at, { month: "short", day: "numeric" })} · ${head.visitor_name}`} className="mb-4"
          badge={<span className={`inline-flex items-center gap-1.5 rounded-[20px] ${unmeasured && status === "complete" ? "" : "whitespace-nowrap"} border border-rule-soft bg-paper-2 px-2.5 py-0.5 text-meta font-semibold text-ink-2`}>
            {chip === "covered" && <span aria-hidden>✓</span>}{chip === "partial" && <span aria-hidden className="font-mono">◐</span>}{headline}
          </span>}
          actions={<>
            {(status === "complete" || status === "incomplete") && (owner || head.assigned) && <ReopenButton id={head.id} revision={Number(snap.consult.revision)} />}
            <Button variant="secondary" size="lg" href={`/projects/${slug}`}>← Project</Button>
          </>} />
        {extra.pendingDevice && <div role="status" className="mb-4 rounded-lg border-2 border-info bg-info-soft px-4 py-3 text-body text-ink">{fill(W.notSyncedYet, { photos: `${extra.pendingDevice.photos} ${extra.pendingDevice.photos === 1 ? "photo" : "photos"}`, name: head.visitor_name })}</div>}
        {/* r5 R5-4: Needs finishing is a normal outcome — the calm ◐ heading and one ○ Open row per open
            check on the neutral card, each with its count and its way forward. ! only for a conflict. */}
        {status === "incomplete" && openChecks.length > 0 && (
          <section aria-labelledby="nf-h" className="mb-4 rounded-lg border border-rule bg-card px-4 py-3 text-body text-ink">
            <h2 id="nf-h" className="font-serif text-title font-semibold text-ink"><span aria-hidden className="font-mono">◐ </span>{W.needsFinishing} · <span className="whitespace-nowrap">{openN} open</span></h2>
            <p className="text-ink-2">{fill(W.officeNeedsFinishingLead, { name: head.visitor_name })}</p>
            <ul className="mt-2 grid">
              {openChecks.map((c) => { const r = officeRow(c); return (
                <li key={c.code} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-rule-soft py-2 @[600px]/page:grid-cols-[auto_minmax(0,1fr)_auto]">
                  {r.problem ? <CoverageMark variant="ready" state="problem" size="sm" /> : <CoverageMark variant="coverage" state="open" size="sm" />}
                  <span className="min-w-0">{r.text}{r.tail && <span className="text-ink-2">{r.tail}</span>}</span>
                  {r.action && <span className="col-start-2 @[600px]/page:col-start-auto">{r.action}</span>}
                </li>); })}
            </ul>
          </section>
        )}
        {/* r9 R9-3: who reopened it, when and why — calm, and gone after the next close. */}
        {extra.reopened?.reason?.trim() && status !== "complete" && status !== "incomplete" && <p role="note" className="mb-4 rounded-lg border border-rule-soft bg-card px-4 py-2 text-body text-ink"><span className="font-semibold">{reopenedHead(extra.reopened)}</span> — {extra.reopened.reason.trim()}</p>}

        {/* Columns follow the content area, not the window (the Operator panel can take half the screen):
            one column, then sections | section with evidence under it, then three columns. */}
        <div className="grid gap-6 @[600px]/page:grid-cols-[220px_minmax(0,1fr)] @[1040px]/page:grid-cols-[240px_minmax(0,1fr)_320px]">
          <nav aria-label={W.sections} className="min-w-0 @[600px]/page:row-span-2 @[1040px]/page:row-span-1">
            <p className="eyebrow mb-2">{W.sections}</p>
            {model.sections.length === 0 && <p className="text-body text-ink-3">No sections yet — the visit hasn’t started.</p>}
            <ul className="grid gap-1">
              {model.sections.map((x) => (
                <li key={x.instance.id}>
                  <Link href={sectionLink(x)} aria-current={x === section ? "page" : undefined} className={`grid min-h-12 grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-hover ${x === section ? "bg-selected" : ""}`}>
                    <span className="min-w-0 font-semibold text-ink">{x.depth ? "↳ " : ""}{x.label}</span>
                    <span className="font-mono text-meta text-ink-2">{x.pc.done}/{x.pc.total}</span>
                    {/* r9 extra: a section in conflict shows "! Conflict" alone until it is picked — the device's form. */}
                    <span className="col-span-2 flex flex-wrap gap-2">{x.conflict ? <CoverageMark variant="coverage" state="conflict" size="sm" /> : <><CoverageMark variant="coverage" state={x.mark} size="sm" />{x.returnVisit && <CoverageMark variant="coverage" state="return_visit" size="sm" />}</>}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="eyebrow mb-2 mt-6">Status</p>
            <dl className="grid gap-1 text-body text-ink-2">
              <div>{initials ? "Client initialed ✓" : ev?.ack_reason ? `Client initials · ${ev.ack_reason}` : "Client initials · not yet"}</div>
              <div>Closed on device {extra.closedAt ? "✓" : "· not yet"}</div>
              <div>Notes · off (manual visit)</div>
            </dl>
            {owner && (movable || devices.some((d) => d.revoked && !d.closed)) && (
              <div id="recover" className="mt-6 grid gap-3">
                <p className="eyebrow">Owner</p>
                {movable && moveOptions && <AssignControl consultId={head.id} revision={Number(snap.consult.revision)} visitors={moveOptions.visitors} current={head.conducted_by} />}
                <RecoveryControl consultId={head.id} devices={devices} />
              </div>
            )}
          </nav>

          <section className="@container/sec min-w-0" aria-labelledby="sec-h">
            {section ? <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2">
                <h2 id="sec-h" className="font-serif text-title font-semibold text-ink">{section.label}</h2>
                <span className="flex items-center gap-3 font-mono text-body text-ink-2">Price-critical {section.pc.done}/{section.pc.total}<CoverageMark variant="coverage" state={section.mark} /></span>
              </div>
              <ul className="divide-y divide-rule-soft">
                {section.fields.map((f) => {
                  const p = extra.provenance[f.addr]; const c = extra.conflicts[f.addr];
                  // r7 R7-5: "Skipped · {reason} · {note}" — the N/A is said once, by the mark on the right.
                  const v = f.answer?.status === "answered" ? show(f.answer.value, f.def) : f.answer?.status === "skipped" ? skipLine(f) : "";
                  return (
                    <li key={f.addr} id={`f-${f.addr}`} className="grid gap-1 py-2 @[520px]/sec:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] @[520px]/sec:items-baseline @[520px]/sec:gap-4">
                      <span className="text-body font-semibold text-ink">{f.def.label}{f.required && <span className="text-flag" aria-label={W.required}> *</span>}</span>
                      {/* r9 extra: mono for measured values only; a skip line is words, in the body face. */}
                      <span className="text-body text-ink">{v && <span className={f.answer?.status === "answered" ? "font-mono" : ""}>{v}</span>}{p && <span className="ml-2 text-meta text-ink-3">{p.source === "office" ? "picked in office" : "typed"} · {p.actor}</span>}</span>
                      {/* r8: a field in conflict shows only "! Conflict" until it is picked; a skip that needs no assumption reads "– Skipped". */}
                      <span className="flex flex-wrap justify-end gap-2">{c ? <CoverageMark variant="coverage" state="conflict" size="sm" /> : <><CoverageMark variant="coverage" state={f.mark} size="sm" skipped={skippedNotNA(f)} />{f.returnVisit && <CoverageMark variant="coverage" state="return_visit" size="sm" />}</>}</span>
                      {/* r8 R8-1/R8-2: "Section › Field", and each side named by person and time — the field's words. */}
                      {c && <div className="@[520px]/sec:col-span-3"><OfficeConflict id={head.id} revision={Number(snap.consult.revision)} generation={Number(snap.consult.completion_generation)} instance={f.addr.split(":")[0]} fieldKey={f.key} label={`${section.label} › ${f.def.label}`} mono={f.def.type.startsWith("length")}
                        current={{ id: c.current.id, text: c.current.status === "answered" ? show(c.current.value, f.def) : c.current.status, from: c.current.source_label ?? conflictSideLabel({ ...c.current, created_at: c.current.at }, { ...c.proposed, created_at: c.proposed.at }), available: c.current.available !== false }}
                        proposed={{ id: c.proposed.id, text: c.proposed.status === "answered" ? show(c.proposed.value, f.def) : c.proposed.status, from: c.proposed.source_label ?? conflictSideLabel({ ...c.proposed, created_at: c.proposed.at }, { ...c.current, created_at: c.current.at }), available: c.proposed.available !== false }} /></div>}
                      {f.answer?.status === "skipped" && draft.skips[f.addr]?.assumption && <p className="text-meta text-ink-2 @[520px]/sec:col-span-3">Assumption: {draft.skips[f.addr].assumption!.text} · {draft.skips[f.addr].assumption!.responsible_trade} · {checkedAt(draft.skips[f.addr].assumption!.verification_point)}</p>}
                    </li>
                  );
                })}
              </ul>
              {section.hidden.length > 0 && <p className="mt-2 text-meta text-ink-3">Not on this job: {section.hidden.map((f) => f.def.label).join(", ")}</p>}
            </> : null}

            <div className="mt-6 rounded-lg border border-rule bg-card p-4">
              <p className="eyebrow">{W.feeds}</p>
              {feeds.length ? (
                <ul className="mt-2 grid gap-1 text-body text-ink">
                  {feeds.map((x) => (
                    <li key={`${x.scope}:${x.label}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-rule-soft py-1.5 last:border-0">
                      <span className="min-w-0 break-words">{x.title} · <span className="text-ink-2">{x.label}</span></span>
                      {x.value === null ? <CoverageMark variant="coverage" state="open" size="sm" /> : <span className="whitespace-nowrap font-mono">{Math.round(x.value * 10) / 10}{x.unit ? ` ${x.unit}` : ""}</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-body text-ink-3">No quantities worked out yet.</p>}
              <div className="mt-3">
                {status !== "complete" ? <p className="text-body text-ink-3">Findings go to the scope when the visit is Complete.</p>
                  : job?.status === "done" ? <p className="text-body font-semibold text-accent-2">{fill(W.findingsApplied, { when: "" }).trim()}</p>
                  : job?.status === "failed" || (job && job.last_error) ? <p className="flex flex-wrap items-center gap-2 text-body text-ink"><span aria-hidden className="text-flag">⚠</span>{"Couldn’t apply findings to the scope —"} <ApplyFindings id={head.id} generation={Number(snap.consult.completion_generation)} retry /></p>
                  : job ? <p className="text-body text-ink-2">{W.findingsWaiting}</p>
                  : !extra.autoApply ? <ApplyFindings id={head.id} generation={Number(snap.consult.completion_generation)} />
                  : <p className="text-body text-ink-2">{W.findingsWaiting}</p>}
              </div>
            </div>
          </section>

          <aside className="min-w-0 @[600px]/page:col-start-2 @[1040px]/page:col-start-3 @[1040px]/page:row-start-1" aria-label={W.evidence}>
            <p className="eyebrow mb-2">{W.evidence}</p>
            {photos.length ? (
              <ul className="grid grid-cols-3 gap-2">
                {photos.map((m) => {
                  const inst = model.sections.find((x) => x.instance.id === m.instance_id);
                  return <li key={m.id}><a href={`/api/consult/${head.id}/media/${m.file_id}?w=1280`} className="block"><img src={`/api/consult/${head.id}/media/${m.file_id}?w=320`} alt={`${inst?.label ?? "Photo"}${m.shot_key ? ` · ${m.shot_key.replace(/_/g, " ")}` : ""}`} className="aspect-square w-full rounded-md border border-rule object-cover" loading="lazy" /></a></li>;
                })}
              </ul>
            ) : <p className="text-body text-ink-3">No photos yet.</p>}
            {model.flags.length > 0 && <div className="mt-4"><p className="eyebrow mb-1">Flags</p><ul className="grid gap-1 text-body">{model.flags.map((f) => <li key={f.key}>{f.kind === "advisory" ? <span className="text-ink-2"><span aria-hidden className="font-semibold">⚐</span> <MeasureText text={f.hint} /></span> : <><span className="font-semibold text-flag">⚑</span> <MeasureText text={f.issue} /></>} — {draft.flags[f.key] ? `${draft.flags[f.key].disposition.replace(/_/g, " ")} · ${draft.flags[f.key].note}` : "needs a decision"}</li>)}</ul></div>}
            {draft.trade_walks.length > 0 && <div className="mt-4"><p className="eyebrow mb-1">{W.tradeWalkTitle}</p><ul className="grid gap-1 text-body">{draft.trade_walks.map((w) => <li key={w.trade}>{w.trade}: {w.needed ? "walk-through needed" : "no walk-through"} · {w.reason}</li>)}</ul></div>}
            {ev?.promised_date && <p className="mt-4 text-body text-ink">{W.promisedBy} {fmt(`${ev.promised_date}T12:00:00-06:00`, { weekday: "short", month: "short", day: "numeric" })}</p>}
            {snap.conflicts.length > 0 && <p className="mt-4 text-body font-semibold text-flag">! {snap.conflicts.length} {snap.conflicts.length === 1 ? "conflict" : "conflicts"} to pick — whoever gets there first, the visitor or Joe, picks.</p>}
            {job?.last_error && <p className="mt-4 text-meta text-ink-3">{plainWords("findings_failed")}</p>}
          </aside>
        </div>
      </div>
    </Shell>
  );
}
