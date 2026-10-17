// Client-safe half of lib/owner-grants.ts: the gated-action catalogue + row
// type + the pure "does this grant cover this call" rule, with no db import so
// UI components and unit tests can use them.

/** Every action an agent needs a grant for. Keep in sync with the MCP tool
 *  surface (mcp/grants-tools.mjs) and lib/agent-sends.ts. */
export const GATED_ACTIONS = [
  "send_bid_package",
  "send_purchase_order",
  "send_invoice",
  "release_newsletter_issue",
  "release_newsletter_outbox_item",
  "send_document_for_signature",
  "send_email",
  "send_sms",
  "place_call",
] as const;
export type GatedAction = (typeof GATED_ACTIONS)[number];

export const ACTION_LABEL: Record<GatedAction, string> = {
  send_bid_package: "Send a bid package to subs",
  send_purchase_order: "Send a purchase order to a vendor",
  send_invoice: "Email an invoice to a client",
  release_newsletter_issue: "Release a queued newsletter issue",
  release_newsletter_outbox_item: "Release one newsletter outbox row",
  send_document_for_signature: "Send a document for signature",
  send_email: "Send an email",
  send_sms: "Send a text message",
  place_call: "Place a phone call (Joe's cell rings first)",
};

/** What each action's target_kind is, for narrowing a grant. */
export const ACTION_TARGET_KIND: Record<GatedAction, string> = {
  send_bid_package: "bid_package",
  send_purchase_order: "purchase_order",
  send_invoice: "invoice",
  release_newsletter_issue: "newsletter_issue",
  release_newsletter_outbox_item: "newsletter_outbox",
  send_document_for_signature: "document_draft",
  send_email: "email", // target_id = recipient address
  send_sms: "phone", // target_id = recipient +E.164
  place_call: "phone", // target_id = the number dialed (+E.164)
};

export type GrantStatus = "requested" | "approved" | "denied" | "revoked";

export interface OwnerGrant {
  id: string;
  status: GrantStatus;
  actions: string[];
  target_kind: string | null;
  target_id: string | null;
  scope: Record<string, unknown>;
  reason: string;
  requested_by: string;
  conversation_id: string | null;
  run_id: string | null;
  max_uses: number;
  uses: number;
  expires_at: string;
  decided_at: string | null;
  used_at: string | null;
  audit: { at: string; action: string; target: string; result: string; note?: string }[];
  created_at: string;
  /** A05/A06 bridge: the decision row this grant is the consumable face of. */
  decision_id?: string | null;
}

export function isGatedAction(a: string): a is GatedAction {
  return (GATED_ACTIONS as readonly string[]).includes(a);
}

/** Is a request still waiting on Joe? A request lapses at its expires_at —
 *  approving it after that would only mint a grant that's already dead, so a
 *  lapsed request is history, not "waiting" (and never nudged). */
export function grantWaiting(g: Pick<OwnerGrant, "status" | "expires_at">, nowMs: number = Date.now()): boolean {
  return g.status === "requested" && new Date(g.expires_at).getTime() > nowMs;
}

/** Pure decision: may `grant` (null = none found) be spent on `action` for
 *  `target` right now? The ONE rule every gated send runs through
 *  (consumeGrant applies it, then spends atomically). Reasons are phrased so
 *  an agent can relay them to Joe. */
export function grantCovers(
  grant: OwnerGrant | null,
  action: GatedAction,
  target: { kind: string; id: string; to?: string },
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; error: string } {
  if (!grant) {
    return { ok: false, error: "No such owner grant. Ask Joe for express permission first (request_owner_permission)." };
  }
  if (grant.status === "requested") {
    return { ok: false, error: "That permission is still waiting for Joe's approval on /engine/permissions." };
  }
  if (grant.status !== "approved") return { ok: false, error: `That permission was ${grant.status}.` };
  if (new Date(grant.expires_at).getTime() <= nowMs) return { ok: false, error: "That permission has expired — ask again." };
  if (grant.uses >= grant.max_uses) return { ok: false, error: "That permission has already been used up." };
  if (!grant.actions.includes("*") && !grant.actions.includes(action)) {
    return { ok: false, error: `That permission covers ${grant.actions.join(", ")}, not ${action}.` };
  }
  if (grant.target_kind && grant.target_kind !== target.kind) {
    return { ok: false, error: `That permission is for a ${grant.target_kind}, not a ${target.kind}.` };
  }
  if (grant.target_id && grant.target_id.toLowerCase() !== target.id.toLowerCase()) {
    return { ok: false, error: `That permission is for ${grant.target_kind ?? "target"} ${grant.target_id} only.` };
  }
  const scopeTo = typeof grant.scope?.to === "string" ? grant.scope.to.toLowerCase() : "";
  if (scopeTo && target.to && scopeTo !== target.to.toLowerCase()) {
    return { ok: false, error: `That permission only allows sending to ${String(grant.scope.to)}.` };
  }
  return { ok: true };
}

// ── Send-on-approval (2026-10-17) ────────────────────────────────────────────
// Joe tapped Approve in Telegram on "email Scott at ABC" and nothing went out:
// approving only minted a permission, and the send waited for the agent to
// come back. A request can now carry the exact send. It's stored on the grant
// (scope.staged), shown on every approval surface, and run by the app the
// moment Joe approves (lib/grant-execution.ts), on any channel. The outcome
// lands in scope.staged_result.

export interface StagedSend {
  action: GatedAction;
  /** Record id for record-backed actions; the address/number for email/SMS. */
  target_id?: string | null;
  email?: { to: string; subject: string; body: string; attachment_file_ids?: string[]; work_item_id?: string | null };
  sms?: { to: string; body: string };
  override?: boolean;
}

export interface StagedResult {
  state: "running" | "sent" | "failed" | "held";
  at: string;
  summary?: string;
  error?: string;
}

/** The send this grant performs on approval, if it carries one. */
export function stagedSendOf(g: Pick<OwnerGrant, "scope"> | null | undefined): StagedSend | null {
  const s = (g?.scope as { staged?: unknown } | undefined)?.staged;
  return s && typeof s === "object" && typeof (s as StagedSend).action === "string" ? (s as StagedSend) : null;
}

export function stagedResultOf(g: Pick<OwnerGrant, "scope"> | null | undefined): StagedResult | null {
  const r = (g?.scope as { staged_result?: unknown } | undefined)?.staged_result;
  return r && typeof r === "object" && typeof (r as StagedResult).state === "string" ? (r as StagedResult) : null;
}

/** Record-backed actions run from the target id alone. Calls are left to the
 *  agent: Joe's phone rings first, so it happens when he's ready, not when he
 *  taps Approve from a job site. */
const RUN_FROM_TARGET: ReadonlySet<string> = new Set([
  "send_bid_package",
  "send_purchase_order",
  "send_invoice",
  "release_newsletter_issue",
  "release_newsletter_outbox_item",
  "send_document_for_signature",
]);

/** Build (and validate) the staged send for a request. Returns null when the
 *  request can't run on its own (no message given, a call, or the agent
 *  opted out), or an error the agent can relay. */
export function buildStagedSend(input: {
  action: string;
  targetId?: string | null;
  email?: { to?: string; subject?: string; body?: string; attachment_file_ids?: string[]; work_item_id?: string | null } | null;
  sms?: { to?: string; body?: string } | null;
  override?: boolean;
  sendOnApproval?: boolean;
}): { ok: true; staged: StagedSend | null; targetId: string | null } | { ok: false; error: string } {
  if (!isGatedAction(input.action)) return { ok: false, error: `Unknown gated action "${input.action}".` };
  const action = input.action;
  const targetId = input.targetId?.toString().trim() || null;
  if (input.sendOnApproval === false || action === "place_call") return { ok: true, staged: null, targetId };
  if (action === "send_email") {
    if (!input.email) return { ok: true, staged: null, targetId };
    const to = (input.email.to ?? targetId ?? "").trim();
    const body = (input.email.body ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: "email.to must be a valid address." };
    if (!body) return { ok: false, error: "email.body is required — it is sent as written when Joe approves." };
    if (targetId && targetId.toLowerCase() !== to.toLowerCase()) return { ok: false, error: `target_id (${targetId}) and email.to (${to}) disagree.` };
    const ids = (input.email.attachment_file_ids ?? []).map(String).filter(Boolean);
    return {
      ok: true,
      targetId: to,
      staged: {
        action,
        target_id: to,
        email: { to, subject: (input.email.subject ?? "").trim(), body, ...(ids.length ? { attachment_file_ids: ids } : {}), ...(input.email.work_item_id ? { work_item_id: input.email.work_item_id } : {}) },
      },
    };
  }
  if (action === "send_sms") {
    if (!input.sms) return { ok: true, staged: null, targetId };
    const to = (input.sms.to ?? targetId ?? "").trim();
    const body = (input.sms.body ?? "").trim();
    if (!to || !body) return { ok: false, error: "sms.to and sms.body are required to send on approval." };
    return { ok: true, targetId: targetId ?? to, staged: { action, target_id: targetId ?? to, sms: { to, body } } };
  }
  if (RUN_FROM_TARGET.has(action)) {
    const n = Number(targetId);
    if (!Number.isInteger(n) || n <= 0) return { ok: true, staged: null, targetId };
    const email = action === "send_purchase_order" && input.email && (input.email.to || input.email.subject || input.email.body)
      ? { to: (input.email.to ?? "").trim(), subject: (input.email.subject ?? "").trim(), body: (input.email.body ?? "").trim() }
      : undefined;
    return { ok: true, targetId: String(n), staged: { action, target_id: String(n), ...(email ? { email } : {}), ...(input.override ? { override: true } : {}) } };
  }
  return { ok: true, staged: null, targetId };
}

/** Short noun phrase for a card title: 'Email scott@… — "Subject"'. */
export function stagedHeadline(s: StagedSend): string {
  if (s.action === "send_email" && s.email) return `Email ${s.email.to}${s.email.subject ? ` — "${s.email.subject}"` : ""}`;
  if (s.action === "send_sms" && s.sms) return `Text ${s.sms.to}`;
  return `${ACTION_LABEL[s.action] ?? s.action} (${s.target_id})`;
}

/** One line for cards / popups: what approving this request will do. */
export function describeStagedSend(s: StagedSend): string {
  if (s.action === "send_email" && s.email) return `Sends the email to ${s.email.to}${s.email.subject ? ` — "${s.email.subject}"` : ""}${s.email.attachment_file_ids?.length ? ` with ${s.email.attachment_file_ids.length} attachment(s)` : ""}.`;
  if (s.action === "send_sms" && s.sms) return `Texts ${s.sms.to}.`;
  const label = ACTION_LABEL[s.action] ?? s.action;
  return `${label} (${ACTION_TARGET_KIND[s.action] ?? "target"} ${s.target_id}).`;
}
