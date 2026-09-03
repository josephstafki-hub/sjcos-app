import "server-only";

// W1 detector layer. Detection is deterministic SQL — no model ever decides
// whether a condition exists. Each detector finds a condition (a thread owed a
// reply, a silent sub, an unanswered estimate, …), files ONE work item keyed to
// the underlying thing via detector_state, keeps it (bumping last_seen) while
// the condition holds, and auto-resolves it when the condition clears. When an
// open work item already covers the underlying thing (sub-silent's source item,
// any open item on a gate-stalled record), the detector ESCALATES that item —
// priority +1 and an appended note, at most once per 7 days per item — instead
// of filing a sibling, so one issue never occupies multiple queue slots. The
// readable summary comes later: Hermes rewrites the factual body through the
// enrich_work_item MCP tool (mcp/sjcos-mcp.mjs), never through this module.
//
// Run hourly by app/api/cron/detect (systemd timer, deploy/sjcos-detect.*).
// Writes ONLY work_items + detector_state — never a send path, never
// notifications. dryRun computes everything and writes nothing.

import { query } from "./db";
import { notifyOwner } from "./notify-owner";
import { gmailConfigured, fetchThreadPage } from "./gmail";
import { extractEmail } from "./lead-thread-sync";
import { computeStageGate } from "./record-ops";
import { linkIds } from "./comms-shared";

// ─── Thresholds (tune here; locked 2026-08-19) ──────────────────────────────
const CLIENT_REPLY_DAYS = 3; // client message with no reply from us
const SUB_SILENT_DAYS = 5; // waiting_on_sub item untouched
const ESTIMATE_UNANSWERED_DAYS = 7; // sent estimate, no signature/decision
const GATE_STALLED_DAYS = 7; // lead/project sitting at a stage gate
const PO_UNACKED_DAYS = 5; // sent PO with no status change
const COI_WINDOWS = [30, 15, 5]; // days-to-expiry heads-up windows
const COMPLIANCE_WINDOWS = [60, 30, 14];
const WARRANTY_ACK_WINDOW = 2; // ack deadline ≤2 days out (mirrors reminders)
const WARRANTY_RESOLVE_WINDOW = 5; // resolve deadline ≤5 days out
const MAX_CREATES_PER_RUN = 30; // spreads a first-run burst over a few hours
const ESCALATION_COOLDOWN_DAYS = 7; // a given item escalates at most once/7d per detector

export interface DetectedItem {
  dedupKey: string;
  title: string;
  priority: "low" | "normal" | "high" | "urgent";
  /** work_items.status the filed item lands in (waiting_on_human/…). */
  status: string;
  dueAt?: Date;
  projectId?: string;
  leadId?: string;
  /** Plain factual body: what, since when, source ref. Never Hermes prose —
   *  enrichment overwrites this later (original kept under source facts). */
  body: string;
  expectedSkillSlug?: string;
  /** Gmail thread id where applicable (Hermes-dedup vs source_kind='email'). */
  sourceId?: string;
}

/** An existing open work item to escalate instead of filing a sibling:
 *  priority bumped one step (low→normal→high→urgent, capped) and one factual
 *  line appended to the body. Never touches status, assignee, or due date.
 *  updated_at IS touched — deliberately, so clocks keyed to it restart. */
export interface DetectedEscalation {
  /** Guard key in detector_state (detector_key gets an `-esc` suffix so the
   *  creation-key resolve() sweeps never see these rows). */
  dedupKey: string;
  workItemId: string;
  /** The one line appended to the item's body, e.g. "[sub-silent] …". */
  note: string;
  /** For run-result reporting only. */
  title: string;
}

export interface Detector {
  key: string;
  /** Everything currently matching the condition. Pure deterministic reads
   *  (SQL + Gmail metadata) — no model calls, no ai.ts import. */
  find(): Promise<DetectedItem[]>;
  /** dedup_keys among the open detector_state rows whose condition CLEARED. */
  resolve(): Promise<string[]>;
  /** Conditions covered by an EXISTING open item: escalate it instead of
   *  filing a sibling. Guarded to once per ESCALATION_COOLDOWN_DAYS per item
   *  via detector_state last_seen. */
  escalate?(): Promise<DetectedEscalation[]>;
}

export interface DetectorCounts {
  created: number;
  bumped: number;
  resolved: number;
  skipped: number;
  escalated: number;
}

export interface DetectorRunResult {
  dryRun: boolean;
  capHit: boolean;
  detectors: Record<string, DetectorCounts>;
  /** Created (or, in dryRun, would-create) items. */
  created: { detector: string; dedupKey: string; title: string }[];
  /** Escalated (or would-escalate) existing items: priority +1, note appended. */
  escalated: { detector: string; dedupKey: string; workItemId: string; title: string; note: string }[];
  /** Auto-resolved (or would-resolve) dedup keys. */
  resolved: { detector: string; dedupKey: string }[];
  /** Not created: run cap hit, or an open source_kind='email' work item
   *  already covers the same Gmail thread (Hermes filed it first). */
  skipped: { detector: string; dedupKey: string; title: string; reason: string }[];
}

/** Whole days since `d` (server clock). */
function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/** YYYY-MM-DD, the factual-body date format. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── 1 · needs-reply ────────────────────────────────────────────────────────
// Reuses the lead-thread matching from lib/lead-thread-sync.ts: Gmail threads
// newest-first, matched to leads via thread_links or the lead's email, and to
// projects via thread_links. The NEWEST matched thread per record decides —
// if its latest message is inbound and older than CLIENT_REPLY_DAYS, we owe a
// reply. One Gmail fetch per run, shared by find() and resolve().
function needsReplyDetector(): Detector {
  interface Scan {
    configured: boolean;
    items: DetectedItem[];
    /** Every scanned thread whose latest message is ours. */
    outboundThreadIds: Set<string>;
  }
  let scanP: Promise<Scan> | null = null;
  const scan = () => (scanP ??= doScan());

  async function doScan(): Promise<Scan> {
    if (!gmailConfigured()) return { configured: false, items: [], outboundThreadIds: new Set() };
    const [{ threads }, leadRes, linkRes, projRes] = await Promise.all([
      fetchThreadPage(150),
      query<{ id: string; slug: string; name: string; email: string }>(
        `SELECT id, slug, name, email FROM leads
          WHERE email IS NOT NULL AND email <> '' AND stage <> 'lost'
            AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = leads.id)`,
      ),
      query<{ gmail_thread_id: string; link_type: string; link_slug: string }>(
        `SELECT gmail_thread_id, link_type, link_slug FROM thread_links`,
      ),
      // A converted lead is off the pipeline, so its client's email rides with
      // the project instead: the origin lead's address matches unlinked
      // threads to the project the lead became.
      query<{
        id: string; slug: string; name: string; client_name: string;
        email: string | null; lead_slug: string | null;
      }>(
        `SELECT p.id, p.slug, p.name, p.client_name, l.email, l.slug AS lead_slug
           FROM projects p LEFT JOIN leads l ON l.id = p.lead_id
          WHERE p.status <> 'warranty'`,
      ),
    ]);

    const leadBySlug = new Map(leadRes.rows.map((l) => [l.slug, l]));
    const leadByEmail = new Map(leadRes.rows.map((l) => [l.email.toLowerCase(), l]));
    const projBySlug = new Map(projRes.rows.map((p) => [p.slug, p]));
    const projByEmail = new Map(
      projRes.rows.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]),
    );
    // Origin-lead slug → project, for threads still linked to a converted lead.
    const projByLeadSlug = new Map(
      projRes.rows.filter((p) => p.lead_slug).map((p) => [p.lead_slug!, p]),
    );
    const linked = new Map(linkRes.rows.map((r) => [r.gmail_thread_id, r]));

    const items: DetectedItem[] = [];
    const outboundThreadIds = new Set<string>();
    const seen = new Set<string>(); // 'lead:<slug>' / 'project:<slug>' already decided

    for (const t of threads) {
      if (t.outbound) outboundThreadIds.add(t.id);
      const link = linked.get(t.id);
      const email = (t.outbound ? extractEmail(t.toLine) : t.fromEmail).toLowerCase();
      const lead = link
        ? link.link_type === "lead"
          ? leadBySlug.get(link.link_slug)
          : undefined
        : leadByEmail.get(email);
      // A converted lead's threads resolve to its project — whether linked to
      // the lead (projByLeadSlug) or matched by the client's email address.
      const project = link
        ? link.link_type === "project"
          ? projBySlug.get(link.link_slug)
          : projByLeadSlug.get(link.link_slug)
        : lead
          ? undefined
          : projByEmail.get(email);
      if (!lead && !project) continue;

      // Newest-first: the first matched thread per record is its latest word.
      const recordKey = lead ? `lead:${lead.slug}` : `project:${project!.slug}`;
      if (seen.has(recordKey)) continue;
      seen.add(recordKey);

      const msgAt = new Date(t.date);
      if (t.outbound || daysSince(msgAt) < CLIENT_REPLY_DAYS) continue;

      const who = lead ? lead.name : project!.client_name || project!.name;
      items.push({
        dedupKey: `needs-reply:${t.id}`,
        title: `Reply to ${who} — no answer in ${daysSince(msgAt)} days`,
        priority: "high",
        status: "waiting_on_human",
        leadId: lead?.id,
        projectId: project?.id,
        sourceId: t.id,
        expectedSkillSlug: "client-followup-draft",
        body:
          `No reply to ${who} since ${isoDay(msgAt)} (last inbound ${isoDay(msgAt)}). ` +
          `Thread: "${t.subject}". [detector:needs-reply]`,
      });
    }
    return { configured: true, items, outboundThreadIds };
  }

  return {
    key: "needs-reply",
    async find() {
      return (await scan()).items;
    },
    async resolve() {
      const s = await scan();
      if (!s.configured) return []; // no Gmail view → resolve nothing
      // Cleared when we replied (the thread's latest message is now ours), or
      // when the lead's live "Needs reply" flag — maintained by
      // lib/lead-thread-sync.ts + logLeadActivity() — went quiet the other way
      // (cleared, or the lead left the pipeline).
      const open = await query<{ dedup_key: string; flag_kind: string | null; stage: string | null }>(
        `SELECT ds.dedup_key, l.flag_kind, l.stage
           FROM detector_state ds
           LEFT JOIN work_items w ON w.id = ds.work_item_id
           LEFT JOIN leads l ON l.id = w.lead_id
          WHERE ds.detector_key = 'needs-reply' AND ds.resolved_at IS NULL`,
      );
      return open.rows
        .filter(
          (r) =>
            s.outboundThreadIds.has(r.dedup_key.slice("needs-reply:".length)) ||
            (r.stage !== null && (r.flag_kind !== "flag" || r.stage === "lost")),
        )
        .map((r) => r.dedup_key);
    },
  };
}

// ─── 2 · sub-silent ─────────────────────────────────────────────────────────
// Open waiting_on_sub work items untouched for SUB_SILENT_DAYS. The silent
// item already occupies a queue slot, so this detector never files a sibling:
// it ESCALATES the source item in place (priority +1, one appended
// "[sub-silent]" line). The escalation touches updated_at, deliberately
// resetting the silence clock, so a still-silent sub re-escalates naturally
// every SUB_SILENT_DAYS (throttled by the shared 7-day escalation guard).
// Detector-filed items are excluded so a waiting_on_sub item this layer (or a
// sibling detector) created never chases itself. resolve() still clears the
// legacy creation-keyed rows from the file-a-sibling era.
function subSilentDetector(): Detector {
  return {
    key: "sub-silent",
    async find() {
      return []; // escalation-only: the silent item IS the queue entry
    },
    async escalate() {
      const { rows } = await query<{
        id: string; title: string; updated: string; days: number;
      }>(
        `SELECT w.id, w.title,
                to_char(w.updated_at, 'YYYY-MM-DD') AS updated,
                floor(extract(epoch FROM now() - w.updated_at) / 86400)::int AS days
           FROM work_items w
          WHERE w.status = 'waiting_on_sub'
            AND w.updated_at < now() - interval '${SUB_SILENT_DAYS} days'
            AND w.created_by NOT LIKE 'detector:%'`,
      );
      return rows.map((r) => ({
        dedupKey: `sub-silent-esc:${r.id}`,
        workItemId: r.id,
        title: `Sub silent ${r.days} days: ${r.title}`,
        note: `[sub-silent] No sub update since ${r.updated} (${r.days} days).`,
      }));
    },
    async resolve() {
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'sub-silent' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM work_items w
               WHERE w.id::text = split_part(ds.dedup_key, ':', 2)
                 AND w.status = 'waiting_on_sub'
                 AND w.updated_at < now() - interval '${SUB_SILENT_DAYS} days')`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

// ─── 3 · estimate-unanswered ────────────────────────────────────────────────
function estimateUnansweredDetector(): Detector {
  return {
    key: "estimate-unanswered",
    async find() {
      const { rows } = await query<{
        id: string; title: string; total: number; sent: string; days: number;
        project_id: string | null; lead_id: string | null; who: string | null;
      }>(
        `SELECT e.id, e.title, e.total,
                to_char(e.sent_at, 'YYYY-MM-DD') AS sent,
                floor(extract(epoch FROM now() - e.sent_at) / 86400)::int AS days,
                e.project_id, l.id AS lead_id,
                COALESCE(NULLIF(p.client_name, ''), p.name, l.name) AS who
           FROM estimates e
           LEFT JOIN projects p ON p.id = e.project_id
           LEFT JOIN leads l ON l.slug = e.lead_slug
          WHERE e.status = 'sent' AND e.sent_at IS NOT NULL
            AND e.sent_at < now() - interval '${ESTIMATE_UNANSWERED_DAYS} days'
            AND NOT EXISTS (SELECT 1 FROM signature_requests sr
                             WHERE sr.estimate_id = e.id AND sr.status IN ('signed','declined'))`,
      );
      return rows.map((r) => ({
        dedupKey: `est-unanswered:${r.id}`,
        title: `Estimate unanswered ${r.days} days${r.who ? ` — ${r.who}` : ""}`,
        priority: "normal" as const,
        status: "waiting_on_client",
        projectId: r.project_id ?? undefined,
        leadId: r.lead_id ?? undefined,
        body:
          `Estimate "${r.title || `#${r.id}`}" ($${Math.round(r.total / 100).toLocaleString("en-US")}) ` +
          `sent ${r.sent}${r.who ? ` to ${r.who}` : ""}; no approval, signature, or decline after ` +
          `${r.days} days. Estimate: ${r.id}. [detector:estimate-unanswered]`,
      }));
    },
    async resolve() {
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'estimate-unanswered' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM estimates e
               WHERE e.id::text = split_part(ds.dedup_key, ':', 2)
                 AND e.status = 'sent'
                 AND NOT EXISTS (SELECT 1 FROM signature_requests sr
                                  WHERE sr.estimate_id = e.id AND sr.status IN ('signed','declined')))`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

// ─── 4 · missing-draw-schedule ──────────────────────────────────────────────
// Approved estimates on live projects with no payment/draw schedule — those
// jobs cannot self-invoice. The W0 persist fix stops new ones; this catches
// legacy rows.
function missingDrawScheduleDetector(): Detector {
  return {
    key: "missing-draw-schedule",
    async find() {
      const { rows } = await query<{
        id: string; title: string; total: number; project_id: string; project: string; approved: string | null;
      }>(
        `SELECT e.id, e.title, e.total, e.project_id, p.name AS project,
                to_char(e.approved_at, 'YYYY-MM-DD') AS approved
           FROM estimates e
           JOIN projects p ON p.id = e.project_id
          WHERE e.status = 'approved' AND e.draw_schedule IS NULL
            AND p.status NOT IN ('warranty','closeout')`,
      );
      return rows.map((r) => ({
        dedupKey: `no-draws:${r.id}`,
        title: `No draw schedule — ${r.project}`,
        priority: "urgent" as const,
        status: "waiting_on_human",
        projectId: r.project_id,
        body:
          `Approved estimate "${r.title || `#${r.id}`}" ($${Math.round(r.total / 100).toLocaleString("en-US")}) ` +
          `on ${r.project}${r.approved ? ` (approved ${r.approved})` : ""} has no draw schedule — ` +
          `the job cannot invoice by milestone. Estimate: ${r.id}. [detector:missing-draw-schedule]`,
      }));
    },
    async resolve() {
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'missing-draw-schedule' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM estimates e
               JOIN projects p ON p.id = e.project_id
              WHERE e.id::text = split_part(ds.dedup_key, ':', 2)
                AND e.status = 'approved' AND e.draw_schedule IS NULL
                AND p.status NOT IN ('warranty','closeout'))`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

// ─── 5 · w9-missing ─────────────────────────────────────────────────────────
// Subs who have invoiced us but have no W-9 on file. W-9 evidence lives in
// sub_documents (doc_type='w9') — uploaded from the sub portal or by the owner.
function w9MissingDetector(): Detector {
  return {
    key: "w9-missing",
    async find() {
      const { rows } = await query<{ slug: string; name: string; invoices: number }>(
        `SELECT s.slug, s.name,
                (SELECT count(*)::int FROM sub_invoices si WHERE si.sub_slug = s.slug) AS invoices
           FROM subs s
          WHERE EXISTS (SELECT 1 FROM sub_invoices si WHERE si.sub_slug = s.slug)
            AND NOT EXISTS (SELECT 1 FROM sub_documents sd
                             WHERE sd.sub_slug = s.slug AND sd.doc_type = 'w9')`,
      );
      return rows.map((r) => ({
        dedupKey: `w9:${r.slug}`,
        title: `W-9 missing — ${r.name}`,
        priority: "normal" as const,
        status: "waiting_on_sub",
        body:
          `${r.name} has submitted ${r.invoices} invoice${r.invoices === 1 ? "" : "s"} but no W-9 ` +
          `is on file (sub_documents). Sub: /subs/${r.slug}. [detector:w9-missing]`,
      }));
    },
    async resolve() {
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'w9-missing' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM subs s
               WHERE s.slug = split_part(ds.dedup_key, ':', 2)
                 AND EXISTS (SELECT 1 FROM sub_invoices si WHERE si.sub_slug = s.slug)
                 AND NOT EXISTS (SELECT 1 FROM sub_documents sd
                                  WHERE sd.sub_slug = s.slug AND sd.doc_type = 'w9'))`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

/** The narrowest window already reached: smallest w with days <= w. Windows are
 *  escalation steps, not parallel filings — one open item per record, keyed by
 *  the window it's currently in, so closing an early item still lets the next
 *  window file a fresh one. */
function reachedWindow(days: number, windows: number[]): number | null {
  const reached = windows.filter((w) => days <= w);
  return reached.length ? Math.min(...reached) : null;
}

/** SQL for the same narrowest-reached window (windows in descending order). */
function reachedWindowSql(daysExpr: string, windows: number[]): string {
  const cases = [...windows]
    .sort((a, b) => a - b)
    .map((w) => `WHEN ${daysExpr} <= ${w} THEN ${w}`)
    .join(" ");
  return `CASE ${cases} END`;
}

// ─── 6 · coi-expiring ───────────────────────────────────────────────────────
// Same data source as the COI block in lib/reminders.ts (subs.coi_expires_at),
// same 30/15/5 windows. reminders.ts keeps emitting its bell notification —
// this detector adds the queue item: ONE open item per sub, keyed to the
// narrowest window reached (escalating 30 → 15 → 5 as expiry nears; an item
// stays open past expiry until a renewal moves the date back out).
function coiExpiringDetector(): Detector {
  return {
    key: "coi-expiring",
    async find() {
      const { rows } = await query<{ slug: string; name: string; days: number; exp: string }>(
        `SELECT slug, name,
                (coi_expires_at - CURRENT_DATE) AS days,
                to_char(coi_expires_at, 'YYYY-MM-DD') AS exp
           FROM subs
          WHERE coi_expires_at IS NOT NULL
            AND coi_expires_at - CURRENT_DATE <= ${COI_WINDOWS[0]}`,
      );
      return rows.map((r) => {
        const w = reachedWindow(r.days, COI_WINDOWS)!;
        return {
          dedupKey: `coi:${r.slug}:${w}`,
          title:
            r.days >= 0
              ? `COI expires in ${r.days} days — ${r.name}`
              : `COI expired ${-r.days} days ago — ${r.name}`,
          priority: (w <= 5 ? "high" : "normal") as DetectedItem["priority"],
          status: "waiting_on_sub",
          dueAt: new Date(`${r.exp}T12:00:00`),
          body:
            `${r.name}'s COI ${r.days >= 0 ? "expires" : "expired"} ${r.exp} ` +
            `(${w}-day window). Renewal certificate needed. Sub: /subs/${r.slug}. [detector:coi-expiring]`,
        };
      });
    },
    async resolve() {
      // Cleared when the COI was renewed (date out past every window, or gone)
      // — or when expiry crept into a NARROWER window, which retires this key
      // as its escalation files.
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'coi-expiring' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM subs s
               WHERE s.slug = split_part(ds.dedup_key, ':', 2)
                 AND s.coi_expires_at IS NOT NULL
                 AND ${reachedWindowSql("s.coi_expires_at - CURRENT_DATE", COI_WINDOWS)}
                     = split_part(ds.dedup_key, ':', 3)::int)`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

// ─── 7 · compliance-due ─────────────────────────────────────────────────────
// Same source as the reminders.ts compliance block, wider windows (60/30/14),
// escalating like coi-expiring: ONE open item per compliance row, keyed to the
// narrowest window reached. The item stays open while the row is unresolved —
// including past the due date — and clears when the owner resolves it (or when
// it escalates into a narrower window's fresh item).
function complianceDueDetector(): Detector {
  return {
    key: "compliance-due",
    async find() {
      const { rows } = await query<{
        id: string; title: string; kind: string; owner: string | null; step: string | null;
        days: number; due: string;
      }>(
        `SELECT id, title, kind, owner, step,
                (due_date - CURRENT_DATE) AS days,
                to_char(due_date, 'YYYY-MM-DD') AS due
           FROM compliance_items
          WHERE resolved = false
            AND due_date - CURRENT_DATE <= ${COMPLIANCE_WINDOWS[0]}`,
      );
      return rows.map((r) => {
        const w = reachedWindow(r.days, COMPLIANCE_WINDOWS)!;
        return {
          dedupKey: `compliance:${r.id}:${w}`,
          title:
            r.days >= 0
              ? `${r.title} due in ${r.days} days`
              : `${r.title} overdue ${-r.days} days`,
          priority: (w <= 14 ? "high" : "normal") as DetectedItem["priority"],
          status: "waiting_on_human",
          dueAt: new Date(`${r.due}T12:00:00`),
          body:
            `Compliance item "${r.title}" (${r.kind}) due ${r.due}` +
            `${r.owner ? `, owner ${r.owner}` : ""}${r.step ? `; next step: ${r.step}` : ""} ` +
            `(${w}-day window). See /compliance. [detector:compliance-due]`,
        };
      });
    },
    async resolve() {
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'compliance-due' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM compliance_items ci
               WHERE ci.id::text = split_part(ds.dedup_key, ':', 2)
                 AND ci.resolved = false
                 AND ${reachedWindowSql("ci.due_date - CURRENT_DATE", COMPLIANCE_WINDOWS)}
                     = split_part(ds.dedup_key, ':', 3)::int)`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

// ─── 8 · warranty-unacked ───────────────────────────────────────────────────
// Unresolved warranty claims approaching/past their acknowledgment (5-day) or
// resolution (30-day) targets — the same windows lib/reminders.ts watches.
function warrantyUnackedDetector(): Detector {
  return {
    key: "warranty-unacked",
    async find() {
      const { rows } = await query<{
        id: string; project: string; issue: string; acknowledged: boolean;
        project_id: string | null;
        ack_days: number | null; resolve_days: number | null;
        ack_due: string | null; resolve_due: string | null;
      }>(
        `SELECT id, project, issue, acknowledged, project_id,
                (ack_deadline_at - CURRENT_DATE)     AS ack_days,
                (resolve_deadline_at - CURRENT_DATE) AS resolve_days,
                to_char(ack_deadline_at, 'YYYY-MM-DD')     AS ack_due,
                to_char(resolve_deadline_at, 'YYYY-MM-DD') AS resolve_due
           FROM warranty_claims
          WHERE resolved = false
            AND (ack_deadline_at IS NOT NULL OR resolve_deadline_at IS NOT NULL)`,
      );
      const items: DetectedItem[] = [];
      for (const r of rows) {
        const issue = r.issue.slice(0, 120);
        if (!r.acknowledged && r.ack_days !== null && r.ack_days <= WARRANTY_ACK_WINDOW) {
          items.push({
            dedupKey: `warranty:${r.id}:ack`,
            title: `Acknowledge warranty claim — ${r.project}`,
            priority: "high",
            status: "waiting_on_human",
            projectId: r.project_id ?? undefined,
            dueAt: r.ack_due ? new Date(`${r.ack_due}T12:00:00`) : undefined,
            body:
              `Warranty claim on ${r.project} ("${issue}") is unacknowledged; ` +
              `5-day acknowledgment target is ${r.ack_due}. Claim: ${r.id}. [detector:warranty-unacked]`,
          });
        }
        if (r.resolve_days !== null && r.resolve_days <= WARRANTY_RESOLVE_WINDOW) {
          items.push({
            dedupKey: `warranty:${r.id}:resolve`,
            title: `Resolve warranty claim — ${r.project}`,
            priority: "high",
            status: "waiting_on_human",
            projectId: r.project_id ?? undefined,
            dueAt: r.resolve_due ? new Date(`${r.resolve_due}T12:00:00`) : undefined,
            body:
              `Warranty claim on ${r.project} ("${issue}") is unresolved; ` +
              `30-day resolution target is ${r.resolve_due}. Claim: ${r.id}. [detector:warranty-unacked]`,
          });
        }
      }
      return items;
    },
    async resolve() {
      // ack keys clear on acknowledgment or resolution; resolve keys on resolution.
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'warranty-unacked' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM warranty_claims wc
               WHERE wc.id::text = split_part(ds.dedup_key, ':', 2)
                 AND wc.resolved = false
                 AND (split_part(ds.dedup_key, ':', 3) = 'resolve' OR wc.acknowledged = false))`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

// ─── 9 · gate-stalled ───────────────────────────────────────────────────────
// Leads/projects that haven't moved in GATE_STALLED_DAYS while a stage gate
// (stage_rules, via computeStageGate) still lies ahead of them. Keyed to the
// current stage, so advancing a record retires the old key and restarts the
// stall clock for the new stage.
//
// A record that ALREADY has an open work item gets no sibling: the stall
// escalates that item instead — the open item with the highest priority
// (tie → oldest due_at, then oldest created_at) takes a priority bump and a
// "[gate-stalled]" line. Only a record with ZERO open items files a fresh
// item, so a truly silent stall still surfaces. One scan feeds both find()
// and escalate() so the split is computed exactly once per run.
function gateStalledDetector(): Detector {
  interface Scan { items: DetectedItem[]; escalations: DetectedEscalation[] }
  let scanP: Promise<Scan> | null = null;
  const scan = () => (scanP ??= doScan());

  async function doScan(): Promise<Scan> {
    const [leads, projects, openItems] = await Promise.all([
      query<{ id: string; slug: string; name: string; stage: string; days: number }>(
        `SELECT id, slug, name, stage,
                floor(extract(epoch FROM now() - updated_at) / 86400)::int AS days
           FROM leads
          WHERE stage <> 'lost'
            AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = leads.id)
            AND updated_at < now() - interval '${GATE_STALLED_DAYS} days'`,
      ),
      query<{ id: string; slug: string; name: string; status: string; days: number }>(
        `SELECT id, slug, name, status,
                floor(extract(epoch FROM now() - updated_at) / 86400)::int AS days
           FROM projects
          WHERE status <> 'warranty' AND updated_at < now() - interval '${GATE_STALLED_DAYS} days'`,
      ),
      // Best escalation target per project: highest priority, tie → oldest
      // due_at (nulls last), then oldest created_at.
      query<{ id: string; title: string; project_id: string }>(
        `SELECT DISTINCT ON (w.project_id) w.id, w.title, w.project_id
           FROM work_items w
          WHERE w.status NOT IN ('done','cancelled') AND w.project_id IS NOT NULL
          ORDER BY w.project_id,
                   array_position(ARRAY['urgent','high','normal','low'], w.priority),
                   w.due_at ASC NULLS LAST, w.created_at ASC`,
      ),
    ]);
    // Same per lead (leads in the stalled list are pre-conversion, so their
    // items ride on lead_id).
    const openLeadItems = await query<{ id: string; title: string; lead_id: string }>(
      `SELECT DISTINCT ON (w.lead_id) w.id, w.title, w.lead_id
         FROM work_items w
        WHERE w.status NOT IN ('done','cancelled') AND w.lead_id IS NOT NULL
        ORDER BY w.lead_id,
                 array_position(ARRAY['urgent','high','normal','low'], w.priority),
                 w.due_at ASC NULLS LAST, w.created_at ASC`,
    );
    const targetByProject = new Map(openItems.rows.map((w) => [w.project_id, w]));
    const targetByLead = new Map(openLeadItems.rows.map((w) => [w.lead_id, w]));

    const items: DetectedItem[] = [];
    const escalations: DetectedEscalation[] = [];
    for (const l of leads.rows) {
      const gate = await computeStageGate("lead", l.stage);
      const next = gate.nextStages[0];
      if (!next) continue;
      const target = targetByLead.get(l.id);
      if (target) {
        escalations.push({
          dedupKey: `gate-stalled-esc:${target.id}`,
          workItemId: target.id,
          title: `Lead stalled ${l.days} days in ${l.stage} — ${l.name}`,
          note: `[gate-stalled] ${l.stage} for ${l.days} days; next gate: ${next.requirement}`,
        });
        continue;
      }
      items.push({
        dedupKey: `gate:lead:${l.slug}:${l.stage}`,
        title: `Lead stalled ${l.days} days in ${l.stage} — ${l.name}`,
        priority: "normal",
        status: "waiting_on_human",
        leadId: l.id,
        body:
          `Lead "${l.name}" has sat in ${l.stage} for ${l.days} days. ` +
          `Next gate (${next.stage}): ${next.requirement} Lead: /leads/${l.slug}. [detector:gate-stalled]`,
      });
    }
    for (const p of projects.rows) {
      const gate = await computeStageGate("project", p.status);
      const next = gate.nextStages[0];
      if (!next) continue;
      const target = targetByProject.get(p.id);
      if (target) {
        escalations.push({
          dedupKey: `gate-stalled-esc:${target.id}`,
          workItemId: target.id,
          title: `Project stalled ${p.days} days in ${p.status} — ${p.name}`,
          note: `[gate-stalled] ${p.status} for ${p.days} days; next gate: ${next.requirement}`,
        });
        continue;
      }
      items.push({
        dedupKey: `gate:project:${p.slug}:${p.status}`,
        title: `Project stalled ${p.days} days in ${p.status} — ${p.name}`,
        priority: "normal",
        status: "waiting_on_human",
        projectId: p.id,
        body:
          `Project "${p.name}" has sat in ${p.status} for ${p.days} days. ` +
          `Next gate (${next.stage}): ${next.requirement} Project: /projects/${p.slug}. [detector:gate-stalled]`,
      });
    }
    return { items, escalations };
  }

  return {
    key: "gate-stalled",
    async find() {
      return (await scan()).items;
    },
    async escalate() {
      return (await scan()).escalations;
    },
    async resolve() {
      // Cleared when the record moved stage (key no longer matches), was
      // touched recently (the stall clock reset), or left the pipeline.
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'gate-stalled' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM leads l
               WHERE split_part(ds.dedup_key, ':', 2) = 'lead'
                 AND l.slug = split_part(ds.dedup_key, ':', 3)
                 AND l.stage = split_part(ds.dedup_key, ':', 4)
                 AND l.stage <> 'lost'
                 AND NOT EXISTS (SELECT 1 FROM projects p2 WHERE p2.lead_id = l.id)
                 AND l.updated_at < now() - interval '${GATE_STALLED_DAYS} days')
            AND NOT EXISTS (
              SELECT 1 FROM projects p
               WHERE split_part(ds.dedup_key, ':', 2) = 'project'
                 AND p.slug = split_part(ds.dedup_key, ':', 3)
                 AND p.status = split_part(ds.dedup_key, ':', 4)
                 AND p.status <> 'warranty'
                 AND p.updated_at < now() - interval '${GATE_STALLED_DAYS} days')`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

// ─── 10 · po-unacknowledged ─────────────────────────────────────────────────
function poUnacknowledgedDetector(): Detector {
  return {
    key: "po-unacknowledged",
    async find() {
      const { rows } = await query<{
        id: string; po_number: string; title: string; vendor: string; project_id: string;
        project: string; sent: string; days: number; subtotal: number;
      }>(
        `SELECT po.id, po.po_number, po.title,
                COALESCE(NULLIF(po.vendor_name, ''), 'vendor') AS vendor,
                po.project_id, p.name AS project, po.subtotal,
                to_char(po.sent_at, 'YYYY-MM-DD') AS sent,
                floor(extract(epoch FROM now() - po.sent_at) / 86400)::int AS days
           FROM purchase_orders po
           JOIN projects p ON p.id = po.project_id
          WHERE po.status = 'sent' AND po.sent_at IS NOT NULL
            AND po.sent_at < now() - interval '${PO_UNACKED_DAYS} days'`,
      );
      return rows.map((r) => ({
        dedupKey: `po-unacked:${r.id}`,
        title: `PO unacknowledged ${r.days} days — ${r.vendor}`,
        priority: "normal" as const,
        status: "waiting_on_human",
        projectId: r.project_id,
        body:
          `${r.po_number || `PO ${r.id}`}${r.title ? ` "${r.title}"` : ""} ` +
          `($${Math.round(r.subtotal / 100).toLocaleString("en-US")}) sent to ${r.vendor} on ${r.sent} ` +
          `for ${r.project}; no status change in ${r.days} days — chase the vendor. [detector:po-unacknowledged]`,
      }));
    },
    async resolve() {
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
          WHERE ds.detector_key = 'po-unacknowledged' AND ds.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM purchase_orders po
               WHERE po.id::text = split_part(ds.dedup_key, ':', 2)
                 AND po.status = 'sent')`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

// Fresh instances per run so per-run caches (the needs-reply Gmail scan) never
// leak across runs. Registry order is also cap order: when the 30-creation cap
// hits mid-run, earlier detectors got there first.

// ─── 11 · sms-unanswered ────────────────────────────────────────────────────
// An inbound text (not a STOP/HELP/START keyword) that has sat unanswered for
// SMS_REPLY_HOURS. The thread's unread flag + last_inbound_at / last_outbound_at
// stamps (lib/sms.ts) are the whole condition, so this is one SQL read. Keyed
// per (thread, latest inbound message) — a new text after we replied is a new
// item. Clears when Joe replies (an outbound after the inbound) or opens and
// marks the thread read.
const SMS_REPLY_HOURS = 4;
function smsUnansweredDetector(): Detector {
  return {
    key: "sms-unanswered",
    async find() {
      const { rows } = await query<{
        id: number; phone: string; contact_name: string | null; link_type: string | null; link_slug: string | null;
        last_inbound_at: string; hours: number; msg_id: number; body: string;
      }>(
        `SELECT t.id, t.phone, t.contact_name, t.link_type, t.link_slug, t.last_inbound_at::text AS last_inbound_at,
                floor(extract(epoch FROM now() - t.last_inbound_at) / 3600)::int AS hours,
                m.id AS msg_id, m.body
           FROM sms_threads t
           JOIN LATERAL (
             SELECT id, body FROM sms_messages
              WHERE thread_id = t.id AND direction = 'in' AND keyword IS NULL
              ORDER BY created_at DESC, id DESC LIMIT 1
           ) m ON true
          WHERE t.unread = true AND t.opted_out = false
            AND t.last_inbound_at IS NOT NULL
            AND t.last_inbound_at < now() - make_interval(hours => $1)
            AND (t.last_outbound_at IS NULL OR t.last_outbound_at < t.last_inbound_at)`,
        [SMS_REPLY_HOURS],
      );
      const items: DetectedItem[] = [];
      for (const r of rows) {
        const ids = await linkIds(r.link_type, r.link_slug);
        const who = r.contact_name || r.phone;
        items.push({
          dedupKey: `sms-unanswered:${r.id}:${r.msg_id}`,
          title: `Reply to ${who}'s text — unanswered ${r.hours}h`,
          priority: "high",
          status: "waiting_on_human",
          leadId: ids.leadId ?? undefined,
          projectId: ids.projectId ?? undefined,
          sourceId: String(r.id),
          expectedSkillSlug: "client-followup-draft",
          body:
            `Text from ${who} at ${r.last_inbound_at.slice(0, 16)} has no reply. ` +
            `"${r.body.replace(/\s+/g, " ").slice(0, 200)}". Reply from /messages (thread ${r.id}). [detector:sms-unanswered]`,
        });
      }
      return items;
    },
    async resolve() {
      const { rows } = await query<{ dedup_key: string }>(
        `SELECT ds.dedup_key
           FROM detector_state ds
           LEFT JOIN sms_threads t ON t.id = NULLIF(split_part(ds.dedup_key, ':', 2), '')::bigint
          WHERE ds.detector_key = 'sms-unanswered' AND ds.resolved_at IS NULL
            AND (t.id IS NULL OR t.unread = false OR t.opted_out = true
                 OR (t.last_outbound_at IS NOT NULL AND t.last_outbound_at >= t.last_inbound_at))`,
      );
      return rows.map((r) => r.dedup_key);
    },
  };
}

const REGISTRY: (() => Detector)[] = [
  needsReplyDetector,
  subSilentDetector,
  estimateUnansweredDetector,
  missingDrawScheduleDetector,
  w9MissingDetector,
  coiExpiringDetector,
  complianceDueDetector,
  warrantyUnackedDetector,
  gateStalledDetector,
  poUnacknowledgedDetector,
  smsUnansweredDetector,
];

export async function runDetectors(opts: { dryRun?: boolean } = {}): Promise<DetectorRunResult> {
  const dryRun = opts.dryRun ?? false;
  const result: DetectorRunResult = {
    dryRun,
    capHit: false,
    detectors: {},
    created: [],
    escalated: [],
    resolved: [],
    skipped: [],
  };
  let creations = 0;

  for (const factory of REGISTRY) {
    const detector = factory();
    const counts: DetectorCounts = { created: 0, bumped: 0, resolved: 0, skipped: 0, escalated: 0 };
    result.detectors[detector.key] = counts;

    let items: DetectedItem[] = [];
    let escalations: DetectedEscalation[] = [];
    let clearedKeys: string[] = [];
    try {
      items = await detector.find();
      escalations = detector.escalate ? await detector.escalate() : [];
      clearedKeys = await detector.resolve();
    } catch (e) {
      // One broken detector (e.g. Gmail hiccup) must not sink the whole run.
      console.error(`[detectors] ${detector.key} failed:`, e);
      continue;
    }

    // ── find(): file new conditions, bump ones we're already tracking ──
    const keys = items.map((i) => i.dedupKey);
    const stateRows = keys.length
      ? await query<{ dedup_key: string; resolved_at: string | null }>(
          `SELECT dedup_key, resolved_at::text AS resolved_at
             FROM detector_state WHERE dedup_key = ANY($1::text[])`,
          [keys],
        )
      : { rows: [] as { dedup_key: string; resolved_at: string | null }[] };
    const openState = new Set(stateRows.rows.filter((r) => !r.resolved_at).map((r) => r.dedup_key));

    for (const item of items) {
      if (openState.has(item.dedupKey)) {
        counts.bumped++;
        if (!dryRun) {
          await query(
            `UPDATE detector_state SET last_seen = now()
              WHERE dedup_key = $1 AND resolved_at IS NULL`,
            [item.dedupKey],
          );
        }
        continue;
      }

      // Hermes's inbox items and needs-reply must not double-file one thread:
      // an OPEN email-sourced work item on the same Gmail thread wins.
      if (item.sourceId) {
        const dup = await query<{ id: string }>(
          `SELECT id FROM work_items
            WHERE source_kind = 'email' AND source_id = $1
              AND status NOT IN ('done','cancelled') LIMIT 1`,
          [item.sourceId],
        );
        if (dup.rows.length) {
          counts.skipped++;
          result.skipped.push({
            detector: detector.key, dedupKey: item.dedupKey, title: item.title,
            reason: `open email work item ${dup.rows[0].id} already covers thread ${item.sourceId}`,
          });
          continue;
        }
      }

      if (creations >= MAX_CREATES_PER_RUN) {
        result.capHit = true;
        counts.skipped++;
        result.skipped.push({
          detector: detector.key, dedupKey: item.dedupKey, title: item.title,
          reason: `run cap of ${MAX_CREATES_PER_RUN} creations hit — will retry next run`,
        });
        continue;
      }

      creations++;
      counts.created++;
      result.created.push({ detector: detector.key, dedupKey: item.dedupKey, title: item.title });
      if (dryRun) continue;

      const inserted = await query<{ id: string }>(
        `INSERT INTO work_items
           (title, body, status, priority, assignee_kind, assignee_key, due_at,
            lead_id, project_id, source_kind, source_id, expected_skill_slug,
            requires_approval, created_by)
         VALUES ($1,$2,$3,$4,'human','human-joe',$5,$6,$7,'schedule',$8,$9,true,$10)
         RETURNING id`,
        [
          item.title, item.body, item.status, item.priority,
          item.dueAt ? item.dueAt.toISOString() : null,
          item.leadId ?? null, item.projectId ?? null,
          item.sourceId ?? null, item.expectedSkillSlug ?? null,
          `detector:${detector.key}`,
        ],
      );
      // A previously-resolved key whose condition returned re-opens its row.
      await query(
        `INSERT INTO detector_state (dedup_key, detector_key, work_item_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (dedup_key) DO UPDATE
           SET work_item_id = EXCLUDED.work_item_id,
               first_seen = now(), last_seen = now(), resolved_at = NULL`,
        [item.dedupKey, detector.key, inserted.rows[0].id],
      );
      // W3: an urgent filing is worth a buzz on Joe's phone, not just a queue
      // row he'll see whenever he next opens /today. Never throws.
      if (item.priority === "urgent") {
        await notifyOwner({ kind: "urgent_item", title: item.title, href: "/today" });
      }
    }

    // ── escalate(): bump an existing item instead of filing a sibling ──
    // Guarded per item per detector: detector_state rows under the `-esc`
    // detector_key (kept out of the creation resolve() sweeps), throttled by
    // last_seen to once per ESCALATION_COOLDOWN_DAYS. Priority and body only —
    // status, assignee, and due date are never touched. updated_at IS set,
    // deliberately: clocks keyed to it (sub-silent) restart on escalation.
    if (escalations.length) {
      const cooling = await query<{ dedup_key: string }>(
        `SELECT dedup_key FROM detector_state
          WHERE dedup_key = ANY($1::text[])
            AND last_seen > now() - interval '${ESCALATION_COOLDOWN_DAYS} days'`,
        [escalations.map((e) => e.dedupKey)],
      );
      const suppressed = new Set(cooling.rows.map((r) => r.dedup_key));
      for (const esc of escalations) {
        if (suppressed.has(esc.dedupKey)) continue; // still in cooldown
        suppressed.add(esc.dedupKey); // two records → one target: bump once
        counts.escalated++;
        result.escalated.push({
          detector: detector.key, dedupKey: esc.dedupKey,
          workItemId: esc.workItemId, title: esc.title, note: esc.note,
        });
        if (dryRun) continue;
        const bumped = await query<{ id: string }>(
          `UPDATE work_items
              SET priority = CASE priority WHEN 'low' THEN 'normal'
                                           WHEN 'normal' THEN 'high'
                                           ELSE 'urgent' END,
                  body = body || E'\\n' || $2,
                  updated_at = now()
            WHERE id = $1 AND status NOT IN ('done','cancelled')
            RETURNING id`,
          [esc.workItemId, esc.note],
        );
        if (!bumped.rows.length) continue; // closed mid-run — claim nothing
        await query(
          `INSERT INTO detector_state (dedup_key, detector_key, work_item_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (dedup_key) DO UPDATE
             SET work_item_id = EXCLUDED.work_item_id, last_seen = now()`,
          [esc.dedupKey, `${detector.key}-esc`, esc.workItemId],
        );
      }
    }

    // ── resolve(): close out conditions that cleared ──
    if (clearedKeys.length) {
      const open = await query<{ dedup_key: string; work_item_id: string | null }>(
        `SELECT dedup_key, work_item_id FROM detector_state
          WHERE dedup_key = ANY($1::text[]) AND resolved_at IS NULL`,
        [clearedKeys],
      );
      for (const row of open.rows) {
        counts.resolved++;
        result.resolved.push({ detector: detector.key, dedupKey: row.dedup_key });
        if (dryRun) continue;
        if (row.work_item_id) {
          // Close only items still open — one the owner already closed (or an
          // agent completed) keeps its own status/completion story.
          await query(
            `UPDATE work_items
                SET status = 'done', completed_at = now(),
                    body = body || E'\\n\\n[auto-resolved: condition cleared]',
                    updated_at = now()
              WHERE id = $1 AND status NOT IN ('done','cancelled')`,
            [row.work_item_id],
          );
        }
        await query(
          `UPDATE detector_state SET resolved_at = now() WHERE dedup_key = $1`,
          [row.dedup_key],
        );
      }
    }
  }

  return result;
}
