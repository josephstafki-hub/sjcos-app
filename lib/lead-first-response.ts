import "server-only";

// Lead first response — the same-day reply to a new inbound lead.
//
// Every lead that arrives through createInboundLead (website form, Hermes
// email import, anything hitting /api/leads/intake) gets exactly one of four
// outcomes, decided deterministically from what they sent plus the agent's read of
// the inbound:
//
//   rough_estimate  clear description + photos + measurements → we can price
//                   it from here. The email says a rough estimate is coming,
//                   what that means, and how the process runs. Sending it also
//                   moves the lead straight to the Rough estimate stage and
//                   files a "Send rough estimate" lead task for Joe.
//   missing_info    we get the gist but photos / measurements / detail are
//                   missing → ask for exactly those, offer a discovery call.
//   discovery_call  can't tell what they want → push for a short call and ask
//                   for a couple of times that work.
//   human_review    doesn't fit any of the above (scorer said PASS, not a
//                   homeowner project, model unsure, model unavailable) →
//                   nothing is sent; a work item + owner push ask Joe to look.
//
// Send policy: the draft is staged on the lead page for Joe to send unless the
// owner has armed "ai.leadFirstResponseAutoSend" in Settings — then the three
// mailable branches go out on their own; human_review never does.
//
// Who writes it: Claude (single-turn `claude -p`, no tools, ~5s) or Hermes
// (the agent gateway), chosen in Settings → AI ("ai.leadFirstResponseModel",
// default Claude). Never the local Qwen — Joe's call, 2026-08-31. The model
// does two things per lead: a structured read of the inbound (clarity / fit /
// project label) that feeds the deterministic branch rules below, and then the
// full email for the branch, written against a fixed brief (process facts +
// voice rules) so it says the right things in Joe's voice.
//
// Idempotency: the unique lead_id on lead_first_responses is the claim. The
// immediate path (Next `after()` at intake) and the 10-minute sweep race for
// it; whoever inserts the 'drafting' row owns the run. A crashed run leaves a
// stale 'drafting' row the sweep re-claims after 10 minutes.

import { query, queryOne } from "./db";
import { AI_NAME } from "./ai-name";
import { askHermes, chatReplyClaude } from "./dev-agents";
import { gmailConfigured, sendNewEmail } from "./gmail";
import { logLeadActivity } from "./lead-activity";
import { cancelLeadNurture } from "./newsletter-drip";
import { emit } from "./notify";
import { notifyOwner } from "./notify-owner";

export type FirstResponseBranch = "rough_estimate" | "missing_info" | "discovery_call" | "human_review";
export type FirstResponseStatus =
  | "drafting"
  | "pending"
  | "sent"
  | "dismissed"
  | "human_review"
  | "skipped"
  | "failed";

export const AUTO_SEND_SETTING_KEY = "ai.leadFirstResponseAutoSend";
export const MODEL_SETTING_KEY = "ai.leadFirstResponseModel";

export type FirstResponseModel = "claude" | "hermes";
export const MODEL_LABEL: Record<FirstResponseModel, string> = { claude: "Claude", hermes: "Hermes" };

/** Which agent drafts first responses (Settings → AI). Claude unless Joe picked Hermes. */
export async function firstResponseModel(): Promise<FirstResponseModel> {
  const r = await queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [MODEL_SETTING_KEY]);
  return r?.value === "hermes" ? "hermes" : "claude";
}

export const BRANCH_LABEL: Record<FirstResponseBranch, string> = {
  rough_estimate: "Rough estimate",
  missing_info: "Ask for details",
  discovery_call: "Discovery call",
  human_review: "Needs a human",
};

export type MissingItem = "photos" | "measurements" | "detail";

export interface FirstResponseSignals {
  descriptionChars: number;
  hasDescription: boolean;
  hasPhotos: boolean;
  hasMeasurements: boolean;
  hasBudget: boolean;
  hasTimeline: boolean;
  hasAddress: boolean;
  triageVerdict: "go" | "hold" | "pass" | null;
}

/** The model's structured read of the inbound (feeds the branch rules). */
export interface FirstResponseAiRead {
  model: FirstResponseModel;
  clarity: "clear" | "partial" | "unclear";
  fit: "fit" | "unsure" | "not_fit";
  fit_reason: string;
  project_label: string;
}

export interface LeadFirstResponse {
  id: number;
  branch: FirstResponseBranch;
  status: FirstResponseStatus;
  subject: string;
  body: string;
  missing: MissingItem[];
  signals: Partial<FirstResponseSignals>;
  ai: FirstResponseAiRead | null;
  reason: string;
  autoSent: boolean;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunOutcome =
  | { status: "claimed_elsewhere" }
  | { status: "retry"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "human_review"; reason: string }
  | { status: "pending"; branch: FirstResponseBranch }
  | { status: "sent"; branch: FirstResponseBranch }
  | { status: "failed"; branch: FirstResponseBranch; reason: string };

// ─── Lead context ────────────────────────────────────────────────────────────

interface LeadCtx {
  id: string;
  slug: string;
  name: string;
  email: string | null;
  scope: string;
  stage: string;
  source: string | null;
  triage_verdict: "go" | "hold" | "pass" | null;
  flag_kind: string | null;
  flag_label: string | null;
  age_hours: number;
  files: number;
  emailed: boolean;
  intake: { label: string; value: string }[];
}

async function loadLead(leadId: string): Promise<LeadCtx | null> {
  const lead = await queryOne<Omit<LeadCtx, "intake">>(
    `SELECT l.id, l.slug, l.name, l.email, l.scope, l.stage, l.source, l.triage_verdict,
            l.flag_kind, l.flag_label,
            EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600 AS age_hours,
            (SELECT count(*)::int FROM files f WHERE f.lead_slug = l.slug AND f.storage_path IS NOT NULL) AS files,
            EXISTS (SELECT 1 FROM lead_activity a WHERE a.lead_id = l.id AND a.kind = 'email') AS emailed
       FROM leads l WHERE l.id = $1`,
    [leadId],
  );
  if (!lead) return null;
  const { rows } = await query<{ question: string; answer: string }>(
    `SELECT question, answer FROM lead_intake WHERE lead_id = $1 ORDER BY sort_order, id`,
    [leadId],
  );
  return {
    ...lead,
    age_hours: Number(lead.age_hours),
    intake: rows.map((r) => ({ label: r.question, value: r.answer })),
  };
}

// ─── Deterministic signals ───────────────────────────────────────────────────

// Unit-anchored so "$20,000", "2 bedrooms" or a phone number don't read as a
// measurement: 12', 8 ft, 10x12, 200 sq ft, 30 linear feet, 3 meters …
const MEASURE_RE =
  /\b\d+(?:\.\d+)?\s*(?:'(?!s)|′|ft\b|feet\b|foot\b|"|″|inch(?:es)?\b|sq\.?\s*ft\b|sqft\b|square\s*(?:feet|foot)\b|sf\b|lf\b|linear\s*(?:feet|foot)\b|meters?\b|cm\b)|\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\b|\b\d+\s+by\s+\d+\b/i;
const PHOTO_LABEL_RE = /photo|picture|\bpics?\b|image|attach/i;
const PHOTO_NEGATIVE_RE = /^(?:no|none|n\/?a|0|-|not yet|nothing)\.?$/i;
const PHOTO_TEXT_RE =
  /https?:\/\/\S+\.(?:jpe?g|png|heic|webp|gif)(?:\?\S*)?|\battach(?:ed|ing|ments?)?\b[^.\n]{0,40}\b(?:photos?|pics?|pictures?|images?)\b|\b(?:photos?|pics?|pictures?|images?)\b[^.\n]{0,24}\battached\b/i;
const DESCRIPTION_LABEL_RE = /^(?:project|scope|description|message|notes?|details?|what)/i;

export function readSignals(ctx: Pick<LeadCtx, "scope" | "intake" | "files" | "triage_verdict">): FirstResponseSignals {
  const has = (re: RegExp) => ctx.intake.some((p) => re.test(p.label) && p.value.trim() !== "");
  const allText = [ctx.scope, ...ctx.intake.map((p) => `${p.label}: ${p.value}`)].join("\n");

  const descriptionParts = new Set<string>();
  if (ctx.scope.trim()) descriptionParts.add(ctx.scope.trim());
  for (const p of ctx.intake) {
    if (DESCRIPTION_LABEL_RE.test(p.label) && p.value.trim()) descriptionParts.add(p.value.trim());
  }
  const descriptionChars = [...descriptionParts].join(" ").length;

  const hasPhotos =
    ctx.files > 0 ||
    ctx.intake.some((p) => PHOTO_LABEL_RE.test(p.label) && p.value.trim() !== "" && !PHOTO_NEGATIVE_RE.test(p.value.trim())) ||
    PHOTO_TEXT_RE.test(allText);

  return {
    descriptionChars,
    hasDescription: descriptionChars >= 40,
    hasPhotos,
    hasMeasurements: MEASURE_RE.test(allText),
    hasBudget: has(/budget/i),
    hasTimeline: has(/timeline|timing|when/i),
    hasAddress: has(/address|location|city/i),
    triageVerdict: ctx.triage_verdict,
  };
}

// ─── Talking to the model ────────────────────────────────────────────────────

const MOCK = process.env.LEAD_FIRST_RESPONSE_MOCK === "1"; // dev/tests: no agent calls

/** Pull a JSON object out of an agent's prose answer (fences, preamble,
 *  trailing remarks all tolerated). Null when there's no parseable object. */
export function parseJsonObject<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

const HERMES_GUARD =
  "This is research and writing only: do NOT create work items, capture knowledge, " +
  "submit drafts for approval, look up unrelated records, or send anything. Answer with the JSON only.";

/** One structured ask to the chosen agent. Claude: single-turn `claude -p`,
 *  every tool disabled. Hermes: the agent gateway, pinned to a per-lead
 *  session so one lead's facts never bleed into another's. Null = the agent
 *  was unavailable or didn't return usable JSON; the caller decides between
 *  retrying later and handing the lead to a human. */
async function askModelJson<T>(model: FirstResponseModel, prompt: string, sessionId: string): Promise<T | null> {
  let text: string;
  try {
    text =
      model === "hermes"
        ? await askHermes(`${prompt}\n\n${HERMES_GUARD}`, undefined, sessionId)
        : await chatReplyClaude(prompt, { timeoutMs: 120_000 });
  } catch {
    return null;
  }
  return parseJsonObject<T>(text);
}

const BAD_LABEL_RE = /^(?:n\/?a|none|unknown|unclear|not sure|tbd|-*)$/i;

function cleanLabel(raw: string): string | null {
  const label = raw.trim().toLowerCase().replace(/[.!"]+/g, "").replace(/\s+/g, " ");
  if (!label || BAD_LABEL_RE.test(label) || label.split(" ").length > 7) return null;
  return label;
}

function fallbackLabel(scope: string): string {
  const words = scope.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 5).join(" ") : "your project";
}

function detailsBlock(ctx: Pick<LeadCtx, "intake">): string {
  return ctx.intake
    .filter((p) => p.value.trim())
    .map((p) => `- ${p.label}: ${p.value.slice(0, 1500)}`)
    .join("\n");
}

// ─── Step 1: the model's read ────────────────────────────────────────────────

/** Ask the chosen agent to read the inbound. Under LEAD_FIRST_RESPONSE_MOCK=1
 *  the read is derived from the signals so the flow runs without an agent. */
export async function readInboundWithModel(
  ctx: Pick<LeadCtx, "id" | "name" | "source" | "scope" | "intake">,
  signals: FirstResponseSignals,
  model: FirstResponseModel,
): Promise<FirstResponseAiRead | null> {
  if (MOCK) {
    return {
      model,
      clarity: signals.descriptionChars >= 120 ? "clear" : signals.hasDescription ? "partial" : "unclear",
      fit: "fit",
      fit_reason: "mock",
      project_label: fallbackLabel(ctx.scope),
    };
  }

  const prompt =
    `You are reading a new inbound lead for SJ Carpentry LLC, a residential carpentry and ` +
    `remodeling firm (kitchens, baths, basements, decks, garages, additions, finish carpentry). ` +
    `Return ONLY a JSON object with these keys — no markdown, no commentary:\n\n` +
    `clarity — could a carpenter put a rough ballpark range on this from the description alone?\n` +
    `  "clear": we know the space, the work wanted, and roughly how big it is.\n` +
    `  "partial": we get the general idea but the details are thin.\n` +
    `  "unclear": can't tell what they actually want done.\n` +
    `fit — "fit" = a homeowner asking about residential remodel/carpentry work, INCLUDING vague or ` +
    `one-line inquiries (vagueness is what clarity is for — a vague homeowner is still "fit"). ` +
    `"not_fit" = clearly commercial work, a job seeker, a vendor or sales pitch, spam, or a trade we ` +
    `don't do on its own (roofing-only, plumbing-only, HVAC-only). "unsure" = odd enough that the ` +
    `owner should look before anyone replies.\n` +
    `fit_reason — one short sentence.\n` +
    `project_label — 2 to 6 plain lowercase words naming the project ("kitchen remodel", ` +
    `"basement finish", "deck rebuild"), or "your project" if unclear.\n\n` +
    `Lead: ${ctx.name}\nSource: ${ctx.source ?? "unknown"}\nProject: ${ctx.scope || "(blank)"}\n` +
    `Details:\n${detailsBlock(ctx) || "(none beyond the above)"}`;

  const out = await askModelJson<Partial<FirstResponseAiRead>>(model, prompt, `lead-first-response-${ctx.id}`);
  if (!out) return null;
  const clarity = out.clarity === "clear" || out.clarity === "partial" || out.clarity === "unclear" ? out.clarity : null;
  const fit = out.fit === "fit" || out.fit === "unsure" || out.fit === "not_fit" ? out.fit : null;
  if (!clarity || !fit) return null;
  return {
    model,
    clarity,
    fit,
    fit_reason: String(out.fit_reason ?? "").trim().slice(0, 300),
    project_label: cleanLabel(String(out.project_label ?? "")) ?? fallbackLabel(ctx.scope),
  };
}

// ─── Step 2: the email ───────────────────────────────────────────────────────
// The brief is fixed — what each branch must say, the process facts, and the
// voice rules (client-followup-draft skill: short, plain-spoken, one clear
// ask, no corporate filler). The agent writes the words.

const PROCESS_FACTS =
  `How SJ Carpentry works (use these facts; do not invent others):\n` +
  `- A rough estimate is a ballpark range for the work described — not a firm bid — so both ` +
  `sides know they're in the right neighborhood before anyone spends time on details. Joe sends ` +
  `it within a few business days of having enough to go on.\n` +
  `- After the rough estimate, if the range works for the client: a site visit to walk the space ` +
  `and nail down details, then a pre-construction agreement (design, selections, and a firm ` +
  `scope and price), then the build.\n` +
  `- A discovery call is a short phone call, 15–20 minutes, to talk through what they're ` +
  `picturing, what's there now, and whether we're the right fit. To set one up the client ` +
  `replies with a couple of days and times that work (weekdays are best) and Joe confirms one.\n` +
  `- Phone photos and rough measurements (length, width, ceiling height, or the overall size ` +
  `of the area) are what Joe needs to put a rough number on a project.`;

const VOICE_RULES =
  `Voice: Joe, the owner, writing personally. Short, plain-spoken, practical, casual — no ` +
  `corporate filler, no exclamation marks, no emojis, no bullet-point walls. Acknowledge what ` +
  `they specifically asked about. One clear next step. Never quote prices, ranges, dates, or ` +
  `availability; never promise anything beyond the process facts. Plain text only (no markdown). ` +
  `Under 200 words. Start with "Hi <first name>," and end with:\nJoe\nSJ Carpentry`;

const MISSING_ASK: Record<MissingItem, string> = {
  photos: "a few photos of the space (phone photos are fine)",
  measurements: "rough measurements — length, width, and ceiling height, or the overall size of the area",
  detail: "a bit more detail on what's there now and what they'd like done",
};

function branchBrief(branch: Exclude<FirstResponseBranch, "human_review">, missing: MissingItem[]): string {
  switch (branch) {
    case "rough_estimate":
      return (
        `This reply's job: tell them they've given you enough to work with, so the next step is a ` +
        `rough estimate. Explain what a rough estimate is and isn't, that it's coming within a few ` +
        `business days, and walk through the process after that (site visit → pre-construction ` +
        `agreement → build) in a sentence or two. Invite them to reply if anything changes or they ` +
        `want to send more photos or details. Do not quote any numbers.`
      );
    case "missing_info":
      return (
        `This reply's job: to put a rough number on it you need ` +
        `${missing.map((m) => MISSING_ASK[m]).join("; ") || "photos and rough measurements"}. ` +
        `Ask for exactly those things and nothing else, say they can reply with whatever they have, ` +
        `and offer a short discovery call as the alternative — ask for a couple of days and times ` +
        `that work.`
      );
    case "discovery_call":
      return (
        `This reply's job: you can't tell yet what they need, so don't guess at the project. ` +
        `Suggest a short discovery call as the best next step, say in a sentence what it's for, and ` +
        `ask for a couple of days and times that work. Mention photos are welcome if they have any.`
      );
  }
}

export interface DraftedEmail {
  subject: string;
  body: string;
}

/** Ask the chosen agent to write the email for a branch. Null when the agent
 *  was unavailable or the answer wasn't a usable email. */
export async function draftWithModel(
  model: FirstResponseModel,
  branch: Exclude<FirstResponseBranch, "human_review">,
  ctx: Pick<LeadCtx, "id" | "name" | "source" | "scope" | "intake">,
  signals: FirstResponseSignals,
  read: FirstResponseAiRead | null,
  missing: MissingItem[],
): Promise<DraftedEmail | null> {
  const label = read?.project_label ?? fallbackLabel(ctx.scope);
  if (MOCK) {
    return {
      subject: `Your ${label} — ${BRANCH_LABEL[branch].toLowerCase()}`,
      body: `Hi ${firstName(ctx.name)},\n\n(mock ${branch} draft for ${label})\n\nJoe\nSJ Carpentry`,
    };
  }

  const prompt =
    `Write Joe's first reply to a new inbound lead for SJ Carpentry LLC (residential carpentry ` +
    `and remodeling).\n\n${VOICE_RULES}\n\n${PROCESS_FACTS}\n\n` +
    `${branchBrief(branch, missing)}\n\n` +
    `Lead: ${ctx.name} (address them as ${firstName(ctx.name)})\nSource: ${ctx.source ?? "unknown"}\n` +
    `Project: ${label}\nWhat they sent:\n${detailsBlock(ctx) || "(nothing beyond the above)"}\n` +
    `They included photos: ${signals.hasPhotos ? "yes" : "no"}. They included measurements: ` +
    `${signals.hasMeasurements ? "yes" : "no"}.\n\n` +
    `Return ONLY a JSON object {"subject": string, "body": string} — no markdown, no commentary. ` +
    `Subject: short and specific, no "Re:". Body: the full email text with real line breaks.`;

  const out = await askModelJson<Partial<DraftedEmail>>(model, prompt, `lead-first-response-${ctx.id}`);
  if (!out) return null;
  const subject = String(out.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const body = String(out.body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/```/g, "")
    .trim();
  if (subject.length < 3 || body.length < 80 || body.length > 3000) return null;
  return { subject, body };
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'-]*$/.test(first) ? first : "there";
}

// ─── Decision ────────────────────────────────────────────────────────────────

export function decideBranch(
  signals: FirstResponseSignals,
  ai: FirstResponseAiRead | null,
): { branch: FirstResponseBranch; reason: string; missing: MissingItem[] } {
  if (!ai) return { branch: "human_review", reason: `${AI_NAME} couldn't read the inbound (model unavailable).`, missing: [] };
  if (signals.triageVerdict === "pass") {
    return { branch: "human_review", reason: "Lead score is PASS — likely under the floor or out of scope.", missing: [] };
  }
  if (ai.fit === "not_fit") return { branch: "human_review", reason: `Doesn't look like a homeowner project: ${ai.fit_reason || "model flagged it"}.`, missing: [] };
  if (ai.fit === "unsure") return { branch: "human_review", reason: `Unusual inbound: ${ai.fit_reason || "model wasn't sure it fits"}.`, missing: [] };

  // A "clear" read with almost no words behind it is a model being generous.
  const clarity = ai.clarity === "clear" && !signals.hasDescription ? "partial" : ai.clarity;
  if (clarity === "unclear") {
    return { branch: "discovery_call", reason: "Too little to go on — pushing for a short call.", missing: [] };
  }
  const missing: MissingItem[] = [];
  if (!signals.hasPhotos) missing.push("photos");
  if (!signals.hasMeasurements) missing.push("measurements");
  if (clarity === "partial") missing.push("detail");
  if (missing.length === 0) {
    return { branch: "rough_estimate", reason: "Clear scope with photos and measurements — enough to price.", missing };
  }
  const list = missing.map((m) => MISSING_LABEL[m]).join(", ");
  return { branch: "missing_info", reason: `Asking for: ${list}. Offering a discovery call.`, missing };
}

const MISSING_LABEL: Record<MissingItem, string> = {
  photos: "photos",
  measurements: "measurements",
  detail: "more scope detail",
};

// ─── Persistence helpers ─────────────────────────────────────────────────────

interface Row {
  id: number;
  lead_id: string;
  branch: FirstResponseBranch;
  status: FirstResponseStatus;
  subject: string;
  body: string;
  missing: MissingItem[];
  signals: Partial<FirstResponseSignals>;
  ai: FirstResponseAiRead | null;
  reason: string;
  auto_sent: boolean;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

function toPublic(r: Row): LeadFirstResponse {
  return {
    id: r.id,
    branch: r.branch,
    status: r.status,
    subject: r.subject,
    body: r.body,
    missing: Array.isArray(r.missing) ? r.missing : [],
    signals: r.signals ?? {},
    ai: r.ai ?? null,
    reason: r.reason,
    autoSent: r.auto_sent,
    sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** The lead's first-response row for the lead page, or null. */
export async function getLeadFirstResponse(slug: string): Promise<LeadFirstResponse | null> {
  const r = await queryOne<Row>(
    `SELECT r.* FROM lead_first_responses r JOIN leads l ON l.id = r.lead_id WHERE l.slug = $1`,
    [slug],
  );
  return r ? toPublic(r) : null;
}

async function autoSendArmed(): Promise<boolean> {
  const r = await queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [AUTO_SEND_SETTING_KEY]);
  return r?.value === "true";
}

async function finish(id: number, patch: Partial<Row>): Promise<void> {
  await query(
    `UPDATE lead_first_responses
        SET branch = COALESCE($2, branch), status = COALESCE($3, status),
            subject = COALESCE($4, subject), body = COALESCE($5, body),
            missing = COALESCE($6::jsonb, missing), signals = COALESCE($7::jsonb, signals),
            ai = COALESCE($8::jsonb, ai), reason = COALESCE($9, reason), updated_at = now()
      WHERE id = $1`,
    [
      id,
      patch.branch ?? null,
      patch.status ?? null,
      patch.subject ?? null,
      patch.body ?? null,
      patch.missing ? JSON.stringify(patch.missing) : null,
      patch.signals ? JSON.stringify(patch.signals) : null,
      patch.ai ? JSON.stringify(patch.ai) : null,
      patch.reason ?? null,
    ],
  );
}

/** Take the claim. Inserts a fresh 'drafting' row, or re-claims a stale one
 *  (a 'drafting' row nobody has touched for 10 minutes = a crashed run). With
 *  `force`, any non-sent row is re-claimed — the owner's "redo" button. */
async function claim(leadId: string, force: boolean): Promise<number | null> {
  const r = await queryOne<{ id: number }>(
    `INSERT INTO lead_first_responses (lead_id, status) VALUES ($1, 'drafting')
     ON CONFLICT (lead_id) DO UPDATE
       SET status = 'drafting', reason = '', subject = '', body = '', auto_sent = false, updated_at = now()
       WHERE lead_first_responses.status <> 'sent'
         AND ($2 OR (lead_first_responses.status = 'drafting'
                     AND lead_first_responses.updated_at < now() - interval '10 minutes'))
     RETURNING id`,
    [leadId, force],
  );
  return r?.id ?? null;
}

async function fileHumanReviewWorkItem(ctx: LeadCtx, rowId: number, reason: string): Promise<void> {
  const sourceId = `lead-first-response:${rowId}`;
  await query(
    `INSERT INTO work_items
       (title, body, priority, assignee_kind, assignee_key, lead_id, source_kind, source_id, requires_approval, created_by)
     SELECT $1, $2, 'high', 'human', 'human-joe', $3, 'agent', $4, false, 'lead-first-response'
      WHERE NOT EXISTS (SELECT 1 FROM work_items WHERE source_id = $4 AND status NOT IN ('done','cancelled'))`,
    [
      `Reply to new lead — ${ctx.name} (needs a human)`,
      `${AI_NAME} didn't send an automatic first response to this lead: ${reason}\n\n` +
        `Read the inbound on /leads/${ctx.slug}, then either pick a reply branch on the First response card ` +
        `(rough estimate / ask for details / discovery call), write your own, or mark the lead lost.`,
      ctx.id,
      sourceId,
    ],
  );
}

// ─── The run ─────────────────────────────────────────────────────────────────

/** Draft (and, when armed, send) the first response for one lead. Safe to
 *  call repeatedly — every path is guarded by the claim row. */
export async function runLeadFirstResponse(leadId: string, opts: { force?: boolean } = {}): Promise<RunOutcome> {
  const force = opts.force ?? false;
  const rowId = await claim(leadId, force);
  if (!rowId) return { status: "claimed_elsewhere" };

  const skip = async (reason: string): Promise<RunOutcome> => {
    await finish(rowId, { status: "skipped", reason });
    return { status: "skipped", reason };
  };

  const ctx = await loadLead(leadId);
  if (!ctx) return skip("lead no longer exists");
  const email = (ctx.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return skip("no usable email on the lead");
  if (ctx.stage !== "intake") return skip(`lead is already at ${ctx.stage}`);
  if (ctx.flag_kind === "scam" || /^scam/i.test(ctx.flag_label ?? "")) return skip("lead is flagged as scam");
  if (ctx.emailed && !force) return skip("this lead has already been emailed");

  const signals = readSignals(ctx);
  const model = await firstResponseModel();
  const who = MODEL_LABEL[model];

  // Agent hiccup on a fresh lead: release the claim so the sweep tries again
  // in ten minutes instead of dumping a same-day lead on Joe prematurely.
  const releaseForRetry = async (what: string): Promise<RunOutcome> => {
    await query(`DELETE FROM lead_first_responses WHERE id = $1 AND status = 'drafting'`, [rowId]);
    return { status: "retry", reason: `${who} ${what} — will retry` };
  };

  let ai: FirstResponseAiRead | null = null;
  try {
    ai = await readInboundWithModel(ctx, signals, model);
  } catch {
    ai = null;
  }
  if (!ai && !force && ctx.age_hours < 4) return releaseForRetry("unavailable");

  const decision = decideBranch(signals, ai);

  if (decision.branch === "human_review") {
    await finish(rowId, {
      branch: "human_review",
      status: "human_review",
      signals,
      ai: ai ?? undefined,
      reason: decision.reason,
      missing: [],
    });
    await logLeadActivity(ctx.slug, "note", `First response held for a human — ${decision.reason}`, ai ? who : AI_NAME);
    await fileHumanReviewWorkItem(ctx, rowId, decision.reason);
    await notifyOwner({
      kind: "urgent_item",
      title: `New lead needs a human reply — ${ctx.name}`,
      body: decision.reason,
      href: `/leads/${ctx.slug}`,
    });
    return { status: "human_review", reason: decision.reason };
  }

  let draft: DraftedEmail | null = null;
  try {
    draft = await draftWithModel(model, decision.branch, ctx, signals, ai, decision.missing);
  } catch {
    draft = null;
  }
  if (!draft) {
    if (!force && ctx.age_hours < 4) return releaseForRetry("couldn't draft");
    const reason = `${who} couldn't write the ${BRANCH_LABEL[decision.branch].toLowerCase()} reply.`;
    await finish(rowId, { branch: "human_review", status: "human_review", signals, ai: ai ?? undefined, reason, missing: [] });
    await logLeadActivity(ctx.slug, "note", `First response held for a human — ${reason}`, AI_NAME);
    await fileHumanReviewWorkItem(ctx, rowId, reason);
    await notifyOwner({ kind: "urgent_item", title: `New lead needs a human reply — ${ctx.name}`, body: reason, href: `/leads/${ctx.slug}` });
    return { status: "human_review", reason };
  }
  await finish(rowId, {
    branch: decision.branch,
    status: "pending",
    subject: draft.subject,
    body: draft.body,
    missing: decision.missing,
    signals,
    ai: ai ?? undefined,
    reason: decision.reason,
  });
  await logLeadActivity(ctx.slug, "note", `First response drafted — ${BRANCH_LABEL[decision.branch]}. ${decision.reason}`, who);

  if (await autoSendArmed()) {
    const sent = await sendLeadFirstResponse(ctx.slug, { auto: true });
    if (sent.ok) return { status: "sent", branch: decision.branch };
    return { status: "failed", branch: decision.branch, reason: sent.error };
  }

  await notifyOwner({
    kind: "approval_needed",
    title: `First response ready to send — ${ctx.name}`,
    body: `${BRANCH_LABEL[decision.branch]} · drafted by ${who}. ${decision.reason}`,
    href: `/leads/${ctx.slug}`,
  });
  return { status: "pending", branch: decision.branch };
}

/** Owner picked a branch by hand (human-review holds, or a redo with a
 *  different read): have the agent write that branch's email and park it as
 *  pending. Reuses the stored read; re-reads the signals from the lead. */
export async function draftLeadFirstResponseAs(
  slug: string,
  branch: Exclude<FirstResponseBranch, "human_review">,
): Promise<{ ok: true; response: LeadFirstResponse } | { ok: false; error: string }> {
  const row = await queryOne<Row>(
    `SELECT r.* FROM lead_first_responses r JOIN leads l ON l.id = r.lead_id WHERE l.slug = $1`,
    [slug],
  );
  if (!row) return { ok: false, error: "No first-response row yet — run the draft first." };
  if (row.status === "sent") return { ok: false, error: "The first response has already been sent." };
  const ctx = await loadLead(row.lead_id);
  if (!ctx) return { ok: false, error: "Lead not found." };
  const signals = readSignals(ctx);
  const missing: MissingItem[] = [];
  if (branch === "missing_info") {
    if (!signals.hasPhotos) missing.push("photos");
    if (!signals.hasMeasurements) missing.push("measurements");
    if (row.ai?.clarity !== "clear") missing.push("detail");
  }
  const model = row.ai?.model ?? (await firstResponseModel());
  let draft: DraftedEmail | null = null;
  try {
    draft = await draftWithModel(model, branch, ctx, signals, row.ai, missing);
  } catch {
    draft = null;
  }
  if (!draft) return { ok: false, error: `${MODEL_LABEL[model]} couldn't write that reply right now — try again.` };
  await finish(row.id, {
    branch,
    status: "pending",
    subject: draft.subject,
    body: draft.body,
    missing,
    signals,
    reason: `Branch picked by Joe: ${BRANCH_LABEL[branch]} — drafted by ${MODEL_LABEL[model]}.`,
  });
  await logLeadActivity(ctx.slug, "note", `First response redrafted as ${BRANCH_LABEL[branch]}`, MODEL_LABEL[model]);
  const fresh = await getLeadFirstResponse(slug);
  return fresh ? { ok: true, response: fresh } : { ok: false, error: "Could not reload the draft." };
}

// ─── Sending ─────────────────────────────────────────────────────────────────

function addBusinessDays(from: Date, days: number): string {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Mail the staged draft (optionally with the owner's edits) and do the
 *  branch's bookkeeping. Used by the auto-send path and the lead-page button. */
export async function sendLeadFirstResponse(
  slug: string,
  opts: { auto?: boolean; subject?: string; body?: string } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await queryOne<Row & { slug: string; name: string; email: string | null; stage: string }>(
    `SELECT r.*, l.slug, l.name, l.email, l.stage
       FROM lead_first_responses r JOIN leads l ON l.id = r.lead_id
      WHERE l.slug = $1`,
    [slug],
  );
  if (!row) return { ok: false, error: "Nothing drafted for this lead yet." };
  if (row.status === "sent") return { ok: false, error: "Already sent." };
  if (row.branch === "human_review") return { ok: false, error: "Pick a reply branch first." };
  const to = (row.email ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: "No usable email on the lead." };
  if (!gmailConfigured()) return { ok: false, error: "Gmail is not connected." };

  const subject = (opts.subject ?? row.subject).trim() || row.subject;
  const body = (opts.body ?? row.body).trim();
  if (!body) return { ok: false, error: "The email body is empty." };
  const auto = opts.auto ?? false;

  try {
    await sendNewEmail({ to, subject, bodyText: body });
  } catch (err) {
    const error = (err as Error).message ?? "send failed";
    await finish(row.id, { status: "failed", subject, body, reason: `Send failed: ${error}`.slice(0, 300) });
    if (auto) {
      await notifyOwner({
        kind: "agent_failure",
        title: `First response failed to send — ${row.name}`,
        body: error.slice(0, 200),
        href: `/leads/${row.slug}`,
      });
    }
    return { ok: false, error };
  }

  await query(
    `UPDATE lead_first_responses
        SET status = 'sent', subject = $2, body = $3, auto_sent = $4, sent_at = now(), updated_at = now()
      WHERE id = $1`,
    [row.id, subject, body, auto],
  );
  await logLeadActivity(
    row.slug,
    "email",
    `First response sent — ${BRANCH_LABEL[row.branch]}${auto ? " (auto)" : ""}`,
    auto ? AI_NAME : "Joe",
  );

  if (row.branch === "rough_estimate") {
    // The email just promised a rough estimate: put the lead where that
    // work happens and give Joe a dated task for it.
    if (row.stage === "intake") {
      await query(`UPDATE leads SET stage = 'rough_estimate', updated_at = now() WHERE id = $1`, [row.lead_id]);
      await logLeadActivity(row.slug, "stage", "Moved to Rough estimate — inbound had enough to price", AI_NAME);
      try {
        await cancelLeadNurture(to, "moved to rough estimate at first response");
      } catch {
        /* nurture bookkeeping must never block the send */
      }
    }
    await query(
      `INSERT INTO lead_tasks (lead_id, title, due_date, sort_order)
       SELECT $1, $2, $3::date, COALESCE((SELECT max(sort_order) FROM lead_tasks WHERE lead_id = $1), 0) + 1
        WHERE NOT EXISTS (SELECT 1 FROM lead_tasks WHERE lead_id = $1 AND title = $2 AND done = false)`,
      [row.lead_id, "Send rough estimate (promised in first response)", addBusinessDays(new Date(), 3)],
    );
  }

  if (auto) {
    await emit({
      kind: "job",
      tag: "Intake",
      accent: "ai",
      icon: "site",
      title: `First response sent · ${row.name}`,
      subline: `${BRANCH_LABEL[row.branch]} — ${subject}`,
      href: `/leads/${row.slug}`,
    });
  }
  return { ok: true };
}

/** Owner decided not to send this draft (they'll reply by hand or let it go). */
export async function dismissLeadFirstResponse(slug: string, reason = "dismissed by Joe"): Promise<boolean> {
  const r = await query(
    `UPDATE lead_first_responses r SET status = 'dismissed', reason = $2, updated_at = now()
       FROM leads l WHERE l.id = r.lead_id AND l.slug = $1 AND r.status <> 'sent'`,
    [slug, reason],
  );
  if ((r.rowCount ?? 0) > 0) {
    await query(
      `UPDATE work_items w SET status = 'done', completed_at = now(), updated_at = now()
         FROM lead_first_responses r JOIN leads l ON l.id = r.lead_id
        WHERE l.slug = $1 AND w.source_id = 'lead-first-response:' || r.id AND w.status NOT IN ('done','cancelled')`,
      [slug],
    );
  }
  return (r.rowCount ?? 0) > 0;
}

// ─── Sweep (safety net for the immediate run) ────────────────────────────────

/** Leads that came in through the inbound funnel in the last 3 days and still
 *  have no first-response row (or a stale 'drafting' claim). Manually-entered
 *  leads are deliberately excluded — Joe already talked to those people. */
export async function sweepLeadFirstResponses(opts: { max?: number } = {}): Promise<{
  scanned: number;
  results: { slug: string; outcome: RunOutcome }[];
}> {
  const max = Math.max(1, Math.min(opts.max ?? 5, 25));
  const { rows } = await query<{ id: string; slug: string }>(
    `SELECT l.id, l.slug
       FROM leads l
       LEFT JOIN lead_first_responses r ON r.lead_id = l.id
      WHERE l.stage = 'intake'
        AND l.email IS NOT NULL AND l.email <> ''
        AND l.created_at > now() - interval '3 days'
        AND EXISTS (SELECT 1 FROM lead_activity a
                     WHERE a.lead_id = l.id AND a.kind = 'created' AND a.summary LIKE 'Lead received%')
        AND (r.id IS NULL OR (r.status = 'drafting' AND r.updated_at < now() - interval '10 minutes'))
      ORDER BY l.created_at
      LIMIT $1`,
    [max],
  );
  const results: { slug: string; outcome: RunOutcome }[] = [];
  for (const r of rows) {
    try {
      results.push({ slug: r.slug, outcome: await runLeadFirstResponse(r.id) });
    } catch (err) {
      results.push({ slug: r.slug, outcome: { status: "retry", reason: (err as Error).message } });
    }
  }
  return { scanned: rows.length, results };
}
