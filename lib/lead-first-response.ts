import "server-only";

// Lead first response — the same-day reply to a new inbound lead.
//
// Every lead that arrives through createInboundLead (website form, Hermes
// email import, anything hitting /api/leads/intake) gets exactly one of four
// outcomes, decided deterministically from what they sent plus Qwen's read of
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
// mailable branches go out on their own; human_review never does. Either way
// the copy comes from the fixed templates below (Joe's voice, one clear ask);
// the model only contributes the classification and a one-line personalised
// opening, so a small local model can't wander off-script.
//
// Idempotency: the unique lead_id on lead_first_responses is the claim. The
// immediate path (Next `after()` at intake) and the 10-minute sweep race for
// it; whoever inserts the 'drafting' row owns the run. A crashed run leaves a
// stale 'drafting' row the sweep re-claims after 10 minutes.

import { query, queryOne } from "./db";
import { askOllamaJson } from "./ai";
import { AI_NAME } from "./ai-name";
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

/** What the model contributes: a read of the inbound + one personalised line. */
export interface FirstResponseAiRead {
  clarity: "clear" | "partial" | "unclear";
  fit: "fit" | "unsure" | "not_fit";
  fit_reason: string;
  project_label: string;
  opening: string;
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

// ─── The model's read ────────────────────────────────────────────────────────

const AI_SCHEMA = {
  type: "object",
  properties: {
    clarity: { type: "string", enum: ["clear", "partial", "unclear"] },
    fit: { type: "string", enum: ["fit", "unsure", "not_fit"] },
    fit_reason: { type: "string" },
    project_label: { type: "string" },
    opening: { type: "string" },
  },
  required: ["clarity", "fit", "fit_reason", "project_label", "opening"],
};

function fallbackLabel(scope: string): string {
  const words = scope.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 5).join(" ") : "your project";
}

/** Ask the local model for its read. Returns null when the model is down or
 *  answers with something unusable — the caller decides whether to retry
 *  later or hand the lead to a human. Under the mock provider (dev/tests) the
 *  read is derived from the signals so the flow runs without a model. */
export async function readInboundWithModel(
  ctx: Pick<LeadCtx, "name" | "source" | "scope" | "intake">,
  signals: FirstResponseSignals,
): Promise<FirstResponseAiRead | null> {
  if ((process.env.AI_PROVIDER ?? "mock") !== "ollama") {
    return {
      clarity: signals.descriptionChars >= 120 ? "clear" : signals.hasDescription ? "partial" : "unclear",
      fit: "fit",
      fit_reason: "mock provider",
      project_label: fallbackLabel(ctx.scope),
      opening: `Thanks for reaching out about ${fallbackLabel(ctx.scope)}.`,
    };
  }

  const details = ctx.intake
    .filter((p) => p.value.trim())
    .map((p) => `- ${p.label}: ${p.value.slice(0, 1200)}`)
    .join("\n");
  const prompt =
    `You are reading a new inbound lead for SJ Carpentry LLC, a residential carpentry and ` +
    `remodeling firm (kitchens, baths, basements, decks, garages, additions, finish carpentry). ` +
    `Return JSON with these fields.\n\n` +
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
    `"basement finish", "deck rebuild"), or "your project" if unclear.\n` +
    `opening — ONE or TWO short sentences written as Joe, the owner, replying to this person and ` +
    `acknowledging what they specifically asked about. Plain-spoken and warm, no corporate filler, ` +
    `no exclamation marks, no pricing, no dates, no promises, no questions. Do not use their name, ` +
    `do not greet, and do not sign off — the greeting and signature are added separately.\n\n` +
    `Lead: ${ctx.name}\nSource: ${ctx.source ?? "unknown"}\nProject: ${ctx.scope || "(blank)"}\n` +
    `Details:\n${details || "(none beyond the above)"}`;

  const out = await askOllamaJson<Partial<FirstResponseAiRead>>(prompt, AI_SCHEMA, { temperature: 0 });
  if (!out) return null;
  const clarity = out.clarity === "clear" || out.clarity === "partial" || out.clarity === "unclear" ? out.clarity : null;
  const fit = out.fit === "fit" || out.fit === "unsure" || out.fit === "not_fit" ? out.fit : null;
  if (!clarity || !fit) return null;
  const label = cleanLabel(String(out.project_label ?? "")) ?? fallbackLabel(ctx.scope);
  const opening = cleanOpening(String(out.opening ?? ""), ctx.name);
  return {
    clarity,
    fit,
    fit_reason: String(out.fit_reason ?? "").trim().slice(0, 300),
    project_label: label,
    opening: opening ?? `Thanks for reaching out about ${label}.`,
  };
}

const BAD_LABEL_RE = /^(?:n\/?a|none|unknown|unclear|not sure|tbd|-*)$/i;

function cleanLabel(raw: string): string | null {
  const label = raw.trim().toLowerCase().replace(/[.!"]+/g, "").replace(/\s+/g, " ");
  if (!label || BAD_LABEL_RE.test(label) || label.split(" ").length > 7) return null;
  return label;
}

/** Tidy the model's one-liner so it sits under a templated "Hi <first>,":
 *  drop a greeting or a leading "Thanks, <name>." (the name is already in the
 *  salutation), no exclamation marks, single spaces. Null = unusable. */
export function cleanOpening(raw: string, name: string): string | null {
  const first = firstName(name);
  let s = raw.trim().replace(/\s+/g, " ");
  s = s.replace(/^(?:hi|hello|hey)\b[^,.!]*[,.!]?\s*/i, "");
  s = s.replace(
    new RegExp(`^(thanks|thank you)[,]?\\s+${first.replace(/[^a-z]/gi, "")}[,.!]?\\s*(\\w?)`, "i"),
    (_m, _t, c: string) => `Thanks — ${c.toLowerCase()}`,
  );
  // "Got it, Tom." → "Got it." — the salutation already carries the name.
  if (first !== "there") s = s.replace(new RegExp(`,?\\s*\\b${first.replace(/[^a-z]/gi, "")}\\b[,]?`, "gi"), "");
  s = s.replace(/!+/g, ".").replace(/\s+([.,])/g, "$1").replace(/\.{2,}/g, ".");
  // The template carries the ask; a question in the opening would double it.
  s = s
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => sentence && !sentence.trim().endsWith("?"))
    .join(" ")
    .trim();
  s = s.replace(/\s*—\s*$/, ".");
  if (s && !/[.]$/.test(s)) s += ".";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length >= 12 && s.length <= 400 ? s : null;
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

// ─── Copy ────────────────────────────────────────────────────────────────────
// Fixed templates in Joe's voice (see the client-followup-draft skill: short,
// plain-spoken, one clear ask, no corporate filler). The only model-written
// text is `opening`.

const SIGN_OFF = "Joe\nSJ Carpentry";

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'-]*$/.test(first) ? first : "there";
}

export function composeFirstResponse(
  branch: Exclude<FirstResponseBranch, "human_review">,
  input: { name: string; label: string; opening: string; missing: MissingItem[] },
): { subject: string; body: string } {
  const hi = `Hi ${firstName(input.name)},`;
  const label = input.label || "your project";
  const opening = input.opening.trim();

  if (branch === "rough_estimate") {
    return {
      subject: `Your ${label} — next step is a rough estimate`,
      body:
        `${hi}\n\n${opening}\n\n` +
        `You gave me enough to work with, so the next step is a rough estimate. Here's what that means: ` +
        `I'll put together a ballpark range for the work you described — not a firm bid, but a realistic ` +
        `number so we both know we're in the right neighborhood before anyone spends time on details. ` +
        `You'll have it from me within a few business days.\n\n` +
        `From there the process is simple:\n` +
        `  1. Rough estimate — a ballpark range based on what you've sent.\n` +
        `  2. Site visit — if the range works for you, we walk the space together and nail down the details.\n` +
        `  3. Pre-construction agreement — design, selections, and a firm scope and price.\n` +
        `  4. Build.\n\n` +
        `If anything changes on your end, or you want to send more photos or details, just reply to this email.\n\n` +
        `Talk soon,\n${SIGN_OFF}`,
    };
  }

  if (branch === "missing_info") {
    const asks: string[] = [];
    if (input.missing.includes("photos")) asks.push("A few photos of the space — phone photos are fine");
    if (input.missing.includes("measurements")) {
      asks.push("Rough measurements — length, width, and ceiling height, or the overall size of the area");
    }
    if (input.missing.includes("detail")) asks.push("A bit more detail on what you'd like done and what's there now");
    if (asks.length === 0) asks.push("A few photos and rough measurements of the space");
    return {
      subject: `Your ${label} — a couple of things I need`,
      body:
        `${hi}\n\n${opening}\n\n` +
        `To put a rough number on it, I need a few things:\n` +
        asks.map((a) => `  • ${a}`).join("\n") +
        `\n\nReply to this email with whatever you have. If it's easier to just talk it through, I'm happy ` +
        `to set up a short discovery call — send me a couple of days and times that work for you and I'll ` +
        `confirm one.\n\n` +
        `Thanks,\n${SIGN_OFF}`,
    };
  }

  return {
    subject: `Your project — let's talk it through`,
    body:
      `${hi}\n\n${opening}\n\n` +
      `The best next step is a short discovery call — 15 or 20 minutes to talk through what you're ` +
      `picturing, what's there now, and roughly what you'd like it to be. It helps me understand the ` +
      `project and tell you honestly whether we're the right fit.\n\n` +
      `Reply with a couple of days and times that work for you (weekdays are best) and I'll confirm one. ` +
      `If you have any photos of the space, feel free to attach them.\n\n` +
      `Thanks,\n${SIGN_OFF}`,
  };
}

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
  let ai: FirstResponseAiRead | null = null;
  try {
    ai = await readInboundWithModel(ctx, signals);
  } catch {
    ai = null;
  }
  if (!ai && !force && ctx.age_hours < 4) {
    // Model hiccup on a fresh lead: release the claim so the sweep tries again
    // in ten minutes instead of dumping a same-day lead on Joe prematurely.
    await query(`DELETE FROM lead_first_responses WHERE id = $1 AND status = 'drafting'`, [rowId]);
    return { status: "retry", reason: "model unavailable — will retry" };
  }

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
    await logLeadActivity(ctx.slug, "note", `First response held for a human — ${decision.reason}`, AI_NAME);
    await fileHumanReviewWorkItem(ctx, rowId, decision.reason);
    await notifyOwner({
      kind: "urgent_item",
      title: `New lead needs a human reply — ${ctx.name}`,
      body: decision.reason,
      href: `/leads/${ctx.slug}`,
    });
    return { status: "human_review", reason: decision.reason };
  }

  const draft = composeFirstResponse(decision.branch, {
    name: ctx.name,
    label: ai?.project_label ?? fallbackLabel(ctx.scope),
    opening: ai?.opening ?? `Thanks for reaching out about ${fallbackLabel(ctx.scope)}.`,
    missing: decision.missing,
  });
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
  await logLeadActivity(
    ctx.slug,
    "note",
    `First response drafted — ${BRANCH_LABEL[decision.branch]}. ${decision.reason}`,
    AI_NAME,
  );

  if (await autoSendArmed()) {
    const sent = await sendLeadFirstResponse(ctx.slug, { auto: true });
    if (sent.ok) return { status: "sent", branch: decision.branch };
    return { status: "failed", branch: decision.branch, reason: sent.error };
  }

  await notifyOwner({
    kind: "approval_needed",
    title: `First response ready to send — ${ctx.name}`,
    body: `${BRANCH_LABEL[decision.branch]} · ${decision.reason}`,
    href: `/leads/${ctx.slug}`,
  });
  return { status: "pending", branch: decision.branch };
}

/** Owner picked a branch by hand (human_review row, or a redo with a different
 *  read): compose from the stored model read and park it as pending. */
export async function draftLeadFirstResponseAs(
  slug: string,
  branch: Exclude<FirstResponseBranch, "human_review">,
): Promise<{ ok: true; response: LeadFirstResponse } | { ok: false; error: string }> {
  const row = await queryOne<Row & { name: string; scope: string }>(
    `SELECT r.*, l.name, l.scope FROM lead_first_responses r JOIN leads l ON l.id = r.lead_id WHERE l.slug = $1`,
    [slug],
  );
  if (!row) return { ok: false, error: "No first-response row yet — run the draft first." };
  if (row.status === "sent") return { ok: false, error: "The first response has already been sent." };
  const signals = { ...readSignalsFallback(), ...(row.signals ?? {}) } as FirstResponseSignals;
  const missing: MissingItem[] = [];
  if (branch === "missing_info") {
    if (!signals.hasPhotos) missing.push("photos");
    if (!signals.hasMeasurements) missing.push("measurements");
    if (row.ai?.clarity !== "clear") missing.push("detail");
  }
  const draft = composeFirstResponse(branch, {
    name: row.name,
    label: row.ai?.project_label ?? fallbackLabel(row.scope),
    opening: row.ai?.opening ?? `Thanks for reaching out about ${fallbackLabel(row.scope)}.`,
    missing,
  });
  await finish(row.id, {
    branch,
    status: "pending",
    subject: draft.subject,
    body: draft.body,
    missing,
    reason: `Branch picked by Joe: ${BRANCH_LABEL[branch]}.`,
  });
  const fresh = await getLeadFirstResponse(slug);
  return fresh ? { ok: true, response: fresh } : { ok: false, error: "Could not reload the draft." };
}

function readSignalsFallback(): FirstResponseSignals {
  return {
    descriptionChars: 0,
    hasDescription: false,
    hasPhotos: false,
    hasMeasurements: false,
    hasBudget: false,
    hasTimeline: false,
    hasAddress: false,
    triageVerdict: null,
  };
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
