// Review-card builders (WORKFLOW W06, A10). A card is DERIVED from the exact
// payload the decision authorises — the same object whose hash becomes the
// decision's content_hash — so the summary can never describe a different
// package than the one that goes out. Copy is factual and plain: it lists
// what is in the payload and what is missing, and never claims a person did
// something (no "Joe reviewed", no "we called").
//
// Pure module: no db, no server imports.

import type { DecisionSummary } from "../commands/decisions.ts";

export interface PackageRecipient {
  name: string;
  address?: string | null;
  role?: string | null; // trade / supplier role
  /** Per-recipient record id (bid invite, outbox row). */
  ref?: string | number | null;
}

export interface PackageAttachment {
  label: string;
  filename?: string | null;
  revision?: string | null;
  fileId?: string | null;
}

export interface PackageQuantity {
  label: string;
  qty: number | string;
  unit?: string | null;
}

/** The payload shape a package-release decision is staged over. Everything
 *  the card shows comes from here. */
export interface PackagePayload {
  kind: "bid_package" | "pricing_request" | "selection_package" | "mood_board" | "newsletter_issue" | "document" | "other";
  id: string | number;
  title: string;
  revision: string | number;
  projectName?: string | null;
  recipients: PackageRecipient[];
  /** Plain-language included work / content lines. */
  inclusions: string[];
  /** Important exclusions, including work Joe keeps for himself. */
  exclusions?: string[];
  /** Work retained by SJ Carpentry (shown as an exclusion for the recipient). */
  retained?: string[];
  quantities?: PackageQuantity[];
  attachments?: PackageAttachment[];
  assumptions?: string[];
  /** Missing information the recipient will have to assume or ask about. */
  gaps?: string[];
  dueDate?: string | null;
  message?: string | null;
  /** The previously reviewed revision (same shape, minus `previous`), if any. */
  previous?: Omit<PackagePayload, "previous"> | null;
  /** Anything else the stager wants hashed with the package (ids, notes). */
  extra?: Record<string, unknown>;
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);

function verbFor(kind: PackagePayload["kind"]): string {
  switch (kind) {
    case "bid_package":
      return "emails the bid request and packet";
    case "pricing_request":
      return "emails the pricing request";
    case "selection_package":
      return "shares the selection package";
    case "mood_board":
      return "shares the mood board";
    case "newsletter_issue":
      return "releases the issue";
    case "document":
      return "sends the document";
    default:
      return "sends the package";
  }
}

/** Build the W06 review card from the exact payload. */
export function packageReleaseSummary(p: PackagePayload): DecisionSummary {
  const recipients = (p.recipients ?? []).map((r) => ({
    name: clean(r.name) || clean(r.address) || "(unnamed)",
    address: clean(r.address) || undefined,
    role: clean(r.role) || undefined,
  }));
  const missingAddress = recipients.filter((r) => !r.address).map((r) => r.name);
  const exclusions = [...list(p.exclusions), ...list(p.retained).map((x) => `${x} — kept by SJ Carpentry`)];
  const attachments = (p.attachments ?? []).map((a) => ({ label: clean(a.label) || clean(a.filename) || "attachment", revision: a.revision == null ? undefined : clean(a.revision), fileId: a.fileId ?? undefined }));
  const gaps = list(p.gaps);
  if (missingAddress.length) gaps.push(`No email address on file for ${missingAddress.join(", ")} — they will not receive this.`);
  if (!attachments.length && (p.kind === "bid_package" || p.kind === "pricing_request")) gaps.push("No attachments — the recipient gets the message text only.");
  if (!list(p.inclusions).length) gaps.push("No included-work lines were written; the recipient sees only the attachments and message.");

  const sendable = recipients.filter((r) => r.address);
  const effect =
    `Approving ${verbFor(p.kind)} "${clean(p.title)}" (revision ${clean(p.revision)}) to ${sendable.length} recipient${sendable.length === 1 ? "" : "s"}` +
    `${sendable.length ? `: ${sendable.map((r) => `${r.name}${r.role ? ` (${r.role})` : ""}`).join(", ")}` : ""}. ` +
    `Each recipient is a separate send; one that fails does not stop the others and can be retried on its own. ` +
    `Any later change to the package needs a fresh approval.`;

  return {
    recipients,
    inclusions: list(p.inclusions),
    exclusions,
    quantities: (p.quantities ?? []).map((q) => ({ label: clean(q.label), qty: q.qty, unit: q.unit ? clean(q.unit) : undefined })),
    attachments,
    assumptions: list(p.assumptions),
    gaps,
    changes: p.previous ? changesSince(p.previous, p) : ["First review of this package."],
    effect,
    dueDate: p.dueDate ? clean(p.dueDate) : undefined,
    title: clean(p.title),
    revision: clean(p.revision),
    projectName: p.projectName ? clean(p.projectName) : undefined,
    packageKind: p.kind,
  };
}

/** Field-by-field differences between the last reviewed revision and this
 *  one, in plain words. */
export function changesSince(prev: Omit<PackagePayload, "previous">, cur: PackagePayload): string[] {
  const out: string[] = [];
  const diffList = (label: string, a: string[], b: string[]) => {
    const added = b.filter((x) => !a.includes(x));
    const removed = a.filter((x) => !b.includes(x));
    if (added.length) out.push(`${label} added: ${added.join("; ")}`);
    if (removed.length) out.push(`${label} removed: ${removed.join("; ")}`);
  };
  if (clean(prev.title) !== clean(cur.title)) out.push(`Title changed from "${clean(prev.title)}" to "${clean(cur.title)}".`);
  const pr = (prev.recipients ?? []).map((r) => clean(r.address || r.name));
  const cr = (cur.recipients ?? []).map((r) => clean(r.address || r.name));
  diffList("Recipients", pr, cr);
  diffList("Included work", list(prev.inclusions), list(cur.inclusions));
  diffList("Exclusions", list(prev.exclusions), list(cur.exclusions));
  diffList("Retained by SJ Carpentry", list(prev.retained), list(cur.retained));
  diffList("Assumptions", list(prev.assumptions), list(cur.assumptions));
  diffList("Open questions", list(prev.gaps), list(cur.gaps));
  const pq = (prev.quantities ?? []).map((q) => `${clean(q.label)}: ${q.qty}${q.unit ? ` ${clean(q.unit)}` : ""}`);
  const cq = (cur.quantities ?? []).map((q) => `${clean(q.label)}: ${q.qty}${q.unit ? ` ${clean(q.unit)}` : ""}`);
  diffList("Quantities", pq, cq);
  const pa = (prev.attachments ?? []).map((a) => `${clean(a.label || a.filename)}${a.revision ? ` rev ${clean(a.revision)}` : ""}`);
  const ca = (cur.attachments ?? []).map((a) => `${clean(a.label || a.filename)}${a.revision ? ` rev ${clean(a.revision)}` : ""}`);
  diffList("Attachments", pa, ca);
  if (clean(prev.dueDate) !== clean(cur.dueDate)) out.push(`Bid due date changed from ${clean(prev.dueDate) || "none"} to ${clean(cur.dueDate) || "none"}.`);
  if (clean(prev.message) !== clean(cur.message)) out.push("The message to recipients was edited.");
  return out.length ? out : ["No content changes since the last review; the revision number moved."];
}

// ── Card text (Telegram + app preview) ──────────────────────────────────────

export interface CardDecision {
  id: string;
  kind: string;
  title: string;
  summary: DecisionSummary;
  amount_cents?: number | null;
  recipient?: string | null;
  expires_at?: string | null;
  status?: string;
  decided_via?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Plain-text card for Telegram (no markdown: titles carry client strings). */
export function cardText(d: CardDecision, opts: { appUrl?: string; maxLines?: number } = {}): string {
  const s = d.summary ?? {};
  const lines: string[] = [`[SJC OS] Decision: ${d.title}`];
  const take = <T,>(arr: T[] | undefined, n = 6): T[] => (arr ?? []).slice(0, n);
  if (s.recipients?.length) lines.push(`To: ${s.recipients.map((r) => `${r.name}${r.role ? ` (${r.role})` : ""}${r.address ? ` <${r.address}>` : ""}`).join(", ")}`);
  else if (d.recipient) lines.push(`To: ${d.recipient}`);
  if (d.amount_cents != null) lines.push(`Amount: ${usd(Number(d.amount_cents))}`);
  if (s.inclusions?.length) lines.push(`Includes: ${take(s.inclusions).join("; ")}${s.inclusions.length > 6 ? ` (+${s.inclusions.length - 6} more)` : ""}`);
  if (s.exclusions?.length) lines.push(`Excludes: ${take(s.exclusions).join("; ")}`);
  if (s.quantities?.length) lines.push(`Quantities: ${take(s.quantities, 8).map((q) => `${q.label} ${q.qty}${q.unit ? ` ${q.unit}` : ""}`).join(", ")}`);
  if (s.attachments?.length) lines.push(`Attachments: ${s.attachments.map((a) => `${a.label}${a.revision ? ` rev ${a.revision}` : ""}`).join(", ")}`);
  if (s.assumptions?.length) lines.push(`Assumptions: ${take(s.assumptions, 4).join("; ")}`);
  if (s.gaps?.length) lines.push(`Missing / open: ${take(s.gaps, 5).join("; ")}`);
  if (s.changes?.length) lines.push(`Since last review: ${take(s.changes, 5).join("; ")}`);
  if (s.effect) lines.push(`If approved: ${s.effect}`);
  if (d.status && d.status !== "pending") {
    lines.push(`Status: ${d.status}${d.decided_via ? ` via ${d.decided_via}` : ""}${d.decided_at ? ` at ${d.decided_at.slice(0, 16).replace("T", " ")}` : ""}${d.decision_note ? ` — ${d.decision_note}` : ""}`);
  } else if (d.expires_at) {
    lines.push(`Expires: ${d.expires_at.slice(0, 16).replace("T", " ")}`);
  }
  if (opts.appUrl) lines.push(`${opts.appUrl.replace(/\/$/, "")}/engine/decisions?d=${d.id}`);
  const max = opts.maxLines ?? 40;
  return lines.slice(0, max).join("\n").slice(0, 3900);
}

// ── Natural-language check (V28) ─────────────────────────────────────────────

/** Phrases that assert human activity or feelings the system cannot know.
 *  Card and routine copy must not contain them. */
const INVENTED_ACTIVITY = [
  /\b(I|we|joe)\s+(just\s+)?(called|spoke|talked|visited|inspected|walked|checked in with|stopped by|met with|reviewed this personally)\b/i,
  /\bjoe (has )?(personally )?(reviewed|approved|signed off|looked (this )?over)\b/i,
  /\bas (we|I) discussed\b/i,
  /\bper our (call|conversation|chat)\b/i,
  /\bhope (you|this) (are|is|finds you)\b/i,
  /\bjust (checking|touching base|following up) in\b/i,
  /\b(so|very|really) excited\b/i,
  /\bcan't wait\b/i,
];

export interface NaturalCheck {
  ok: boolean;
  problems: string[];
}

/** Lint copy for invented human activity, canned filler and empty claims.
 *  Returns the offending fragments so a test or a reviewer sees why. */
export function naturalCheck(text: string): NaturalCheck {
  const problems: string[] = [];
  for (const re of INVENTED_ACTIVITY) {
    const m = re.exec(text);
    if (m) problems.push(`invented activity or filler: "${m[0]}"`);
  }
  if (/\b(as an ai|language model)\b/i.test(text)) problems.push("self-description as an AI in client copy");
  if (/!{2,}/.test(text)) problems.push("multiple exclamation marks");
  return { ok: problems.length === 0, problems };
}

/** Every string a card would show, joined, for the V28 lint. */
export function cardCopyOf(summary: DecisionSummary): string {
  const parts: string[] = [];
  for (const k of ["inclusions", "exclusions", "assumptions", "gaps", "changes"] as const) parts.push(...((summary[k] as string[] | undefined) ?? []));
  if (summary.effect) parts.push(summary.effect);
  return parts.join("\n");
}
