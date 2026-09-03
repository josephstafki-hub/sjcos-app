import "server-only";

// AI call notes — the transcript is the input, not the product. For every
// completed call with a transcript: a plain-language summary, decisions and
// commitments (by whom), action items (owner + any date), and explicit flags
// for anything that looks like a scope change, a price discussion or a
// schedule change.
//
// Runs through the orchestrator pattern (lib/orchestrator/): Hermes is the
// default operator (drafts the notes), Claude sonnet reviews the draft
// against the transcript (lib/orchestrator/claude-review.ts reviewCallNotes),
// and a failed or unparseable review defaults to RETRY — never to approve.
// If Hermes' gateway is unreachable, Claude drafts instead (the same
// takeover rule the ladder uses), still reviewed by a separate Claude call.
//
// The note-taker WRITES NOTES AND FILES WORK ITEMS. It never sends anything,
// never drafts an outbound that auto-sends, and never touches stage/status.

import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import { askHermes, chatReplyClaude } from "./dev-agents";
import { extractJson, reviewCallNotes } from "./orchestrator/claude-review";
import { notifyOwner } from "./notify-owner";
import { fileCommsWorkItem, linkHref } from "./comms-shared";
import { callDisplayName, getCall, type CallNotesShape, type CallRow } from "./voice";

const MAX_ROUNDS = Number(process.env.CALL_NOTES_MAX_ROUNDS ?? 2);
const DRAFT_MODEL = process.env.CALL_NOTES_CLAUDE_MODEL ?? "sonnet";

function coerceNotes(raw: unknown): CallNotesShape | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) return null;
  const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const decisions = Array.isArray(o.decisions)
    ? o.decisions
        .map((d) => (d && typeof d === "object" ? { text: str((d as Record<string, unknown>).text), by: str((d as Record<string, unknown>).by) || "unspecified" } : null))
        .filter((d): d is { text: string; by: string } => !!d && d.text.length > 0)
        .slice(0, 20)
    : [];
  const action_items = Array.isArray(o.action_items)
    ? o.action_items
        .map((a) => {
          if (!a || typeof a !== "object") return null;
          const r = a as Record<string, unknown>;
          const text = str(r.text);
          if (!text) return null;
          const owner = str(r.owner).toLowerCase() || "unspecified";
          const due = str(r.due) || null;
          return { text, owner, due };
        })
        .filter((a): a is { text: string; owner: string; due: string | null } => a !== null)
        .slice(0, 20)
    : [];
  const flags = Array.isArray(o.flags)
    ? o.flags
        .map((f) => {
          if (!f || typeof f !== "object") return null;
          const r = f as Record<string, unknown>;
          const kind = str(r.kind);
          const text = str(r.text);
          if (!text || !["scope_change", "price", "schedule"].includes(kind)) return null;
          return { kind: kind as CallNotesShape["flags"][number]["kind"], text };
        })
        .filter((f): f is CallNotesShape["flags"][number] => f !== null)
        .slice(0, 20)
    : [];
  return { summary: summary.slice(0, 2000), decisions, action_items, flags };
}

function draftPrompt(call: CallRow, feedback: string | null): string {
  const who = callDisplayName(call);
  const when = call.started_at.slice(0, 16).replace("T", " ");
  const mins = call.duration_s ? Math.round(call.duration_s / 60) : null;
  return (
    `You are taking notes for SJ Carpentry LLC (Joe, the owner) after a recorded phone call. ` +
    `Write only what the transcript supports; do not invent names, prices or dates. Plain language, no markdown.\n\n` +
    `Call: ${call.direction} · with ${who}${call.link_type ? ` (${call.link_type} record "${call.link_slug}")` : " (not linked to a record)"} · ${when}${mins ? ` · ~${mins} min` : ""}` +
    `${call.outcome === "voicemail" ? " · this is a VOICEMAIL left for Joe" : ""}.\n\n` +
    `Transcript:\n${(call.transcript ?? "").slice(0, 24000)}\n\n` +
    (feedback ? `A reviewer rejected the previous draft: ${feedback}\nFix every point.\n\n` : "") +
    `Reply with ONE JSON object and nothing else:\n` +
    `{"summary":"2–5 sentences, what was discussed",` +
    `"decisions":[{"text":"…","by":"joe|client|sub|vendor|both|<name>"}],` +
    `"action_items":[{"text":"…","owner":"joe|client|sub|vendor|<name>","due":"date mentioned or null"}],` +
    `"flags":[{"kind":"scope_change|price|schedule","text":"what was said"}]}\n` +
    `Rules: every commitment goes in decisions with who made it; every "I'll …"/"can you …" goes in action_items with its owner; ` +
    `anything about adding/removing work, cost, discounts, or moving dates gets a flag. Empty arrays are fine. Do not add tasks nobody mentioned.`
  );
}

async function draft(call: CallRow, feedback: string | null): Promise<{ notes: CallNotesShape | null; raw: string; by: "hermes" | "claude" }> {
  const prompt = draftPrompt(call, feedback);
  try {
    const raw = await askHermes(prompt, undefined, `call-notes:${call.id}`);
    return { notes: coerceNotes(extractJson(raw)), raw, by: "hermes" };
  } catch (err) {
    console.error(`[call-notes] Hermes unavailable, Claude drafting: ${(err as Error).message}`);
    const raw = await chatReplyClaude(prompt, { model: DRAFT_MODEL, effort: "low", timeoutMs: 120_000 });
    return { notes: coerceNotes(extractJson(raw)), raw, by: "claude" };
  }
}

export function renderNotes(call: CallRow, n: CallNotesShape): string {
  const who = callDisplayName(call);
  const when = call.started_at.slice(0, 16).replace("T", " ");
  const lines = [
    `Call notes — ${call.direction} call with ${who} (${when} UTC${call.outcome === "voicemail" ? ", voicemail" : ""})`,
    "",
    n.summary,
  ];
  if (n.flags.length) {
    lines.push("", "Flags:");
    for (const f of n.flags) lines.push(`- [${f.kind.replace("_", " ")}] ${f.text}`);
  }
  if (n.decisions.length) {
    lines.push("", "Decisions / commitments:");
    for (const d of n.decisions) lines.push(`- ${d.text} (${d.by})`);
  }
  if (n.action_items.length) {
    lines.push("", "Action items:");
    for (const a of n.action_items) lines.push(`- ${a.text} — ${a.owner}${a.due ? `, ${a.due}` : ""}`);
  }
  lines.push("", `[call:${call.id}]`);
  return lines.join("\n");
}

/** Best-effort date from the model's free-text `due`. Null unless it parses
 *  to something in the future within a year. */
function dueDate(due: string | null): Date | null {
  if (!due) return null;
  const t = Date.parse(due);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const now = Date.now();
  if (d.getTime() < now - 86_400_000 || d.getTime() > now + 366 * 86_400_000) return null;
  return d;
}

/** Generate, review, and file notes for one call. Idempotent per call
 *  (skips when notes are already done). Never throws. */
export async function generateCallNotes(callId: string): Promise<{ status: "done" | "failed" | "skipped" }> {
  const call = await getCall(callId);
  if (!call) return { status: "skipped" };
  if (call.notes_status === "done") return { status: "done" };
  if (!call.transcript || !call.transcript.trim()) {
    await query(`UPDATE calls SET notes_status = 'skipped', notes_error = 'no transcript', updated_at = now() WHERE id = $1`, [callId]);
    return { status: "skipped" };
  }
  await query(`UPDATE calls SET notes_status = 'pending', notes_attempts = notes_attempts + 1, updated_at = now() WHERE id = $1`, [callId]);

  let feedback: string | null = null;
  let last: { notes: CallNotesShape | null; by: string } = { notes: null, by: "hermes" };
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let d: Awaited<ReturnType<typeof draft>>;
    try {
      d = await draft(call, feedback);
    } catch (err) {
      return fail(call, `drafting failed: ${(err as Error).message}`);
    }
    last = { notes: d.notes, by: d.by };
    if (!d.notes) {
      feedback = "The reply was not the requested JSON object.";
      continue;
    }
    const verdict = await reviewCallNotes(call.transcript, d.notes);
    // Review unavailable / unparseable → RETRY, never approve.
    if (!verdict) {
      feedback = "Claude's review did not complete — be strictly faithful to the transcript and re-check every name, number and date.";
      continue;
    }
    if (verdict.verdict === "approve") return finish(call, d.notes, d.by, round);
    feedback = verdict.feedback || "Reviewer rejected the draft.";
  }
  return fail(call, `not approved after ${MAX_ROUNDS} rounds (${last.by}): ${feedback ?? "no feedback"}`);
}

async function fail(call: CallRow, reason: string): Promise<{ status: "failed" }> {
  await query(`UPDATE calls SET notes_status = 'failed', notes_error = $2, updated_at = now() WHERE id = $1`, [call.id, reason.slice(0, 500)]);
  const who = callDisplayName(call);
  await fileCommsWorkItem({
    title: `Write up the call with ${who} yourself`,
    body: `AI call notes could not be produced (${reason.slice(0, 300)}). The transcript is on the call record at /calls. [call:${call.id}]`,
    priority: "normal",
    leadId: call.lead_id,
    projectId: call.project_id,
    sourceKind: "call",
    sourceId: `call-notes:${call.id}`,
  });
  await notifyOwner({ kind: "voice_call", title: `Call notes failed: ${who}`, body: reason.slice(0, 160), href: "/calls" });
  return { status: "failed" };
}

async function finish(call: CallRow, notes: CallNotesShape, by: string, rounds: number): Promise<{ status: "done" }> {
  const text = renderNotes(call, notes);
  // Open Brain: the note attaches to the linked lead / project (knowledge_items
  // carries both), de-duped on content.
  const fingerprint = createHash("md5").update(`call:${call.id}:${text}`).digest("hex");
  let knowledgeId: string | null = null;
  try {
    const k = await queryOne<{ id: string }>(
      `INSERT INTO knowledge_items (content, kind, source, source_uri, metadata, lead_id, project_id, content_fingerprint, created_by)
       VALUES ($1, 'call_summary', 'agent', $2, $3::jsonb, $4, $5, $6, $7)
       ON CONFLICT (content_fingerprint) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        text,
        `/calls?open=${call.id}`,
        JSON.stringify({
          call_id: call.id,
          direction: call.direction,
          counterparty: call.counterparty_number,
          contact_name: call.contact_name,
          link_type: call.link_type,
          link_slug: call.link_slug,
          outcome: call.outcome,
          drafted_by: by,
          review_rounds: rounds,
          flags: notes.flags.map((f) => f.kind),
        }),
        call.lead_id,
        call.project_id,
        fingerprint,
        `call-notes:${by}`,
      ],
    );
    knowledgeId = k?.id ?? null;
  } catch (err) {
    console.error("[call-notes] knowledge insert failed", err);
  }
  await query(
    `UPDATE calls SET notes = $2::jsonb, notes_text = $3, notes_status = 'done', notes_error = NULL, knowledge_item_id = $4, updated_at = now() WHERE id = $1`,
    [call.id, JSON.stringify(notes), text, knowledgeId],
  );

  // Work items for Joe's action items. Nothing client-facing: these are
  // to-dos in his queue, drafted by nobody, sent by nobody.
  const mine = notes.action_items.filter((a) => /^(joe|us|we|sj|owner|sj carpentry)/i.test(a.owner) || a.owner === "unspecified");
  for (const [i, a] of mine.entries()) {
    await fileCommsWorkItem({
      title: a.text.slice(0, 140),
      body: `From the ${call.direction} call with ${callDisplayName(call)} on ${call.started_at.slice(0, 10)}${a.due ? ` (mentioned: ${a.due})` : ""}.\n\n${notes.summary}\n\n[call:${call.id}]`,
      priority: notes.flags.length ? "high" : "normal",
      status: "queued",
      leadId: call.lead_id,
      projectId: call.project_id,
      sourceKind: "call",
      sourceId: `call:${call.id}:action:${i}`,
      dueAt: dueDate(a.due),
      createdBy: `call-notes:${by}`,
    });
  }
  // Voicemail callback item gets the summary appended so Joe knows what it's about.
  if (call.work_item_id) {
    await query(`UPDATE work_items SET body = body || E'\\n\\nVoicemail: ' || $2, updated_at = now() WHERE id = $1`, [call.work_item_id, notes.summary.slice(0, 600)]).catch(() => {});
  }

  const flagLine = notes.flags.length ? ` · flags: ${notes.flags.map((f) => f.kind.replace("_", " ")).join(", ")}` : "";
  await notifyOwner({
    kind: "voice_call",
    title: `Call notes: ${callDisplayName(call)}${flagLine}`,
    body: notes.summary.slice(0, 220),
    href: linkHref(call.link_type, call.link_slug) ?? "/calls",
  });
  return { status: "done" };
}
