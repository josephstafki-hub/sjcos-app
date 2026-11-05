import "server-only";

// Shared conversation summaries (Joe, 2026-11-05): with numbers assigned to
// team members, each person's texts and calls stay on their own line, but the
// picture of a client / lead / sub / supplier is shared across every account.
// Word-for-word isn't needed ("summaries would be fine"), so each record page
// shows one row per conversation: whose line, when, and a short summary.
//
//   calls  the AI call notes summary (lib/call-notes.ts), else what happened
//          (answered 4 min / voicemail / missed).
//   texts  sms_threads.summary, written by refreshTextSummaries() on the hourly
//          detector timer (Claude, one or two sentences), else counts + dates.
//
// A row opens to the full conversation only for someone allowed to read that
// line (lib/phone-lines.ts lineVisibilityClause); everyone else gets the summary.

import { query } from "./db";
import { formatUsPhone } from "./comms/phone";
import { listPhoneLines, type PhoneLine, type Viewer } from "./phone-lines";
import { relativeAge } from "./time";

export type RecordKind = "lead" | "project" | "sub" | "vendor";

export interface ConversationRow {
  key: string;
  kind: "text" | "call";
  /** ISO time of the latest activity. */
  at: string;
  when: string;
  /** "Abigail's line", "SJC main line", or the bare number. */
  line: string;
  title: string;
  summary: string;
  /** Opens the full conversation; null when this viewer may only see the summary. */
  href: string | null;
}

interface Target {
  pairs: [string, string][];
  leadIds: string[];
  projectIds: string[];
}

/** The (link_type, link_slug) pairs and ids a record's conversations hang off.
 *  A job also gathers its lead's conversations from before it was a job. */
async function targetFor(kind: RecordKind, slug: string): Promise<Target | null> {
  if (kind === "sub" || kind === "vendor") return { pairs: [[kind, slug]], leadIds: [], projectIds: [] };
  if (kind === "lead") {
    const { rows } = await query<{ id: string; project_id: string | null; project_slug: string | null }>(
      `SELECT l.id, p.id AS project_id, p.slug AS project_slug FROM leads l LEFT JOIN projects p ON p.lead_id = l.id WHERE l.slug = $1`,
      [slug],
    );
    const r = rows[0];
    if (!r) return null;
    const pairs: [string, string][] = [["lead", slug]];
    if (r.project_slug) pairs.push(["project", r.project_slug], ["client", r.project_slug]);
    return { pairs, leadIds: [r.id], projectIds: r.project_id ? [r.project_id] : [] };
  }
  const { rows } = await query<{ id: string; lead_id: string | null; lead_slug: string | null }>(
    `SELECT p.id, l.id AS lead_id, l.slug AS lead_slug FROM projects p LEFT JOIN leads l ON l.id = p.lead_id WHERE p.slug = $1`,
    [slug],
  );
  const r = rows[0];
  if (!r) return null;
  const pairs: [string, string][] = [["project", slug], ["client", slug]];
  if (r.lead_slug) pairs.push(["lead", r.lead_slug]);
  return { pairs, leadIds: r.lead_id ? [r.lead_id] : [], projectIds: [r.id] };
}

function lineLabeller(lines: PhoneLine[]): (n: string | null) => string {
  const byNumber = new Map(lines.map((l) => [l.number, l]));
  return (n) => {
    if (!n) return "SJC line";
    const l = byNumber.get(n);
    if (!l) return formatUsPhone(n);
    if (l.assignedUserName) return `${l.assignedUserName.split(/\s+/)[0]}'s line`;
    return l.label || formatUsPhone(n);
  };
}

/** Lines whose conversations this viewer may NOT open (someone else's own line). */
function closedLines(lines: PhoneLine[], viewer: Viewer): Set<string> {
  if (viewer.role === "owner") return new Set();
  return new Set(lines.filter((l) => l.assignedUserId && l.assignedUserId !== viewer.id).map((l) => l.number));
}

const ago = (iso: string) => relativeAge(Math.max(0, (Date.now() - Date.parse(iso)) / 1000));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

function callStory(c: { direction: string; outcome: string | null; status: string; duration_s: number | null; voicemail: boolean }): string {
  const dir = c.direction === "inbound" ? "Incoming call" : "Outgoing call";
  if (c.voicemail || c.outcome === "voicemail") return `${dir}: voicemail left`;
  if (c.outcome === "missed" || c.status === "missed") return `${dir}: missed`;
  if (c.outcome === "no_answer" || c.status === "no_answer") return `${dir}: no answer`;
  if (c.outcome === "failed" || c.status === "failed") return `${dir}: did not connect`;
  if (c.duration_s && c.duration_s > 0) return `${dir}: talked ${Math.max(1, Math.round(c.duration_s / 60))} min`;
  return dir;
}

/** Calls and text conversations about one record, newest first, from every
 *  line, summarized for this viewer. Never throws (an empty list instead). */
export async function getRecordConversations(kind: RecordKind, slug: string, viewer: Viewer, limit = 12): Promise<ConversationRow[]> {
  try {
    const target = await targetFor(kind, slug);
    if (!target) return [];
    const lines = await listPhoneLines();
    const label = lineLabeller(lines);
    const closed = closedLines(lines, viewer);
    const types = target.pairs.map((p) => p[0]);
    const slugs = target.pairs.map((p) => p[1]);

    const [texts, calls] = await Promise.all([
      query<{ id: number; business_number: string | null; contact_name: string | null; phone: string; summary: string | null; last_message_at: string | null; n_in: number; n_out: number; first_at: string | null; last_body: string | null }>(
        `SELECT t.id, t.business_number, t.contact_name, t.phone, t.summary, t.last_message_at::text AS last_message_at,
                c.n_in, c.n_out, c.first_at::text AS first_at, lm.body AS last_body
           FROM sms_threads t
           JOIN unnest($1::text[], $2::text[]) AS k(lt, ls) ON k.lt = t.link_type AND k.ls = t.link_slug
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE direction = 'in')::int AS n_in, count(*) FILTER (WHERE direction = 'out')::int AS n_out, min(created_at) AS first_at
               FROM sms_messages WHERE thread_id = t.id AND keyword IS NULL
           ) c ON true
           LEFT JOIN LATERAL (
             SELECT body FROM sms_messages WHERE thread_id = t.id AND keyword IS NULL ORDER BY created_at DESC, id DESC LIMIT 1
           ) lm ON true
          WHERE t.blocked_at IS NULL AND t.last_message_at IS NOT NULL
          ORDER BY t.last_message_at DESC LIMIT $3`,
        [types, slugs, limit],
      ),
      query<{ id: string; business_number: string; direction: string; outcome: string | null; status: string; duration_s: number | null; voicemail: boolean; started_at: string; contact_name: string | null; counterparty_number: string; summary: string | null; placed_by: string | null }>(
        `SELECT c.id, c.business_number, c.direction, c.outcome, c.status, c.duration_s, c.voicemail, c.started_at::text AS started_at,
                c.contact_name, c.counterparty_number, COALESCE(NULLIF(c.notes->>'summary', ''), NULLIF(c.notes_text, '')) AS summary, c.placed_by
           FROM calls c
          WHERE (c.link_type, c.link_slug) IN (SELECT * FROM unnest($1::text[], $2::text[]))
             OR c.lead_id = ANY($3::uuid[]) OR c.project_id = ANY($4::uuid[])
          ORDER BY c.started_at DESC LIMIT $5`,
        [types, slugs, target.leadIds, target.projectIds, limit],
      ),
    ]);

    const rows: ConversationRow[] = [];
    for (const t of texts.rows) {
      if (!t.last_message_at || t.n_in + t.n_out === 0) continue;
      const open = !t.business_number || !closed.has(t.business_number);
      const counts = `${plural(t.n_in + t.n_out, "text")}${t.first_at && shortDate(t.first_at) !== shortDate(t.last_message_at) ? ` since ${shortDate(t.first_at)}` : ""}`;
      const fallback = open && t.last_body ? `Last: “${t.last_body.replace(/\s+/g, " ").slice(0, 140)}${t.last_body.length > 140 ? "…" : ""}”` : `${plural(t.n_in, "text")} from them, ${plural(t.n_out, "reply")}.`;
      rows.push({
        key: `text:${t.id}`,
        kind: "text",
        at: t.last_message_at,
        when: ago(t.last_message_at),
        line: label(t.business_number),
        title: `Texts with ${t.contact_name || formatUsPhone(t.phone)} · ${counts}`,
        summary: t.summary?.trim() || fallback,
        href: open ? `/messages?thread=${t.id}` : null,
      });
    }
    for (const c of calls.rows) {
      const open = !closed.has(c.business_number);
      rows.push({
        key: `call:${c.id}`,
        kind: "call",
        at: c.started_at,
        when: ago(c.started_at),
        line: label(c.business_number),
        title: `${callStory(c)} · ${c.contact_name || formatUsPhone(c.counterparty_number)}`,
        summary: c.summary?.trim() || (c.voicemail ? "Voicemail; the transcript and notes follow when they land." : "No notes for this call."),
        href: open ? `/calls?open=${c.id}` : null,
      });
    }
    return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
  } catch (err) {
    console.error("[comms-summaries] read failed:", (err as Error).message);
    return [];
  }
}

// ─── AI text summaries (hourly) ──────────────────────────────────────────────

const QUIET_MINUTES = 10;

/** Write a one-or-two sentence summary for linked text conversations that have
 *  new messages and have gone quiet. Bounded per run; a failure leaves the
 *  thread for the next run. Runs on the website login (detector timer). */
export async function refreshTextSummaries(opts: { limit?: number; dryRun?: boolean } = {}): Promise<{ checked: number; written: number; failed: number }> {
  const limit = Math.max(1, Math.min(25, opts.limit ?? 8));
  const { rows } = await query<{ id: number; contact_name: string | null; phone: string; link_type: string; last_id: number }>(
    `SELECT t.id, t.contact_name, t.phone, t.link_type, lm.id AS last_id
       FROM sms_threads t
       JOIN LATERAL (SELECT id FROM sms_messages WHERE thread_id = t.id AND keyword IS NULL ORDER BY created_at DESC, id DESC LIMIT 1) lm ON true
      WHERE t.link_type IS NOT NULL AND t.blocked_at IS NULL
        AND t.last_message_at < now() - make_interval(mins => $1)
        AND lm.id > COALESCE(t.summary_message_id, 0)
      ORDER BY t.last_message_at DESC
      LIMIT $2`,
    [QUIET_MINUTES, limit],
  );
  if (opts.dryRun || !rows.length) return { checked: rows.length, written: 0, failed: 0 };
  const { chatReplyClaude } = await import("./dev-agents");
  let written = 0;
  let failed = 0;
  for (const t of rows) {
    try {
      const { rows: msgs } = await query<{ direction: "in" | "out"; body: string; created_at: string }>(
        `SELECT direction, body, created_at::text AS created_at FROM (
           SELECT direction, body, created_at, id FROM sms_messages
            WHERE thread_id = $1 AND keyword IS NULL AND body <> '' ORDER BY created_at DESC, id DESC LIMIT 40
         ) m ORDER BY created_at, id`,
        [t.id],
      );
      if (!msgs.length) continue;
      const who = t.contact_name || "the contact";
      const transcript = msgs
        .map((m) => `${m.created_at.slice(0, 16)} ${m.direction === "in" ? who : "SJ Carpentry"}: ${m.body.replace(/\s+/g, " ").slice(0, 500)}`)
        .join("\n");
      const prompt =
        `Summarize this text-message conversation between SJ Carpentry LLC and ${who} (a ${t.link_type}) for the rest of the team. ` +
        `One or two plain sentences, under 280 characters: what was discussed, anything agreed or promised, and what is still open. ` +
        `Only what the messages say; no names or numbers that aren't in them, no greeting, no markdown, no quotes.\n\n${transcript}`;
      const out = (await chatReplyClaude(prompt, { model: process.env.TEXT_SUMMARY_MODEL ?? "haiku", timeoutMs: 45_000 })).trim().replace(/^["“]|["”]$/g, "");
      if (!out) throw new Error("empty summary");
      await query(`UPDATE sms_threads SET summary = $2, summary_at = now(), summary_message_id = $3 WHERE id = $1`, [t.id, out.slice(0, 600), t.last_id]);
      written++;
    } catch (err) {
      failed++;
      console.error(`[comms-summaries] thread ${t.id} summary failed:`, (err as Error).message);
    }
  }
  return { checked: rows.length, written, failed };
}
