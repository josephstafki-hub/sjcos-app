// Settings data builder. DB-backed (Phase 7-B): profile fields + AI
// toggles read from the app_settings key/value table via lib/db; toggles
// persist through lib/actions/settings.ts. Integrations + the non-profile
// categories stay static placeholders.

import { query } from "./db";
import { getCurrentUser } from "./dal";
import { gmailConfigured } from "./gmail";
import { getClipToken } from "./clip";
import { getIntakeToken } from "./lead-intake-token";
import { BILLING_RATE_ROWS, MARKUP_KEY, MARKUP_DEFAULT } from "./billing-rates";

export interface SettingsCategory {
  id: string;
  title: string;
}

export interface Integration {
  name: string;
  sub: string;
  connected: boolean;
}

export interface AiToggle {
  /** Stable app_settings key, e.g. "ai.draftReplies". */
  key: string;
  label: string;
  on: boolean;
}

/** The AI toggle set, with stable keys + defaults (used when a row is
 *  absent from app_settings). */
const AI_TOGGLES: { key: string; label: string; default: boolean }[] = [
  { key: "ai.draftReplies", label: "Draft client replies by default", default: true },
  { key: "ai.autoPinWatchouts", label: "Auto-pin watchouts in team chat", default: true },
  { key: "ai.summarizeVoicemails", label: "Auto-summarize incoming voicemails", default: true },
  { key: "ai.weeklyStatusEmails", label: "Auto-generate weekly client status emails (review before send)", default: true },
  { key: "ai.autoPublishSocial", label: "Auto-publish social posts on job completion", default: false },
  { key: "ai.sendBeforeReview", label: "Send before drafts are reviewed", default: false },
  {
    key: "ai.leadFirstResponseAutoSend",
    label: "Auto-send the first response to new inbound leads (off = drafts wait on the lead page)",
    default: false,
  },
];

/** Per-channel notification toggles. Persist via app_settings under "notify.*"
 *  (same upsert path as the AI toggles). */
const NOTIFY_TOGGLES: { key: string; label: string; default: boolean }[] = [
  { key: "notify.decisions", label: "Decisions that need my call", default: true },
  { key: "notify.money", label: "Money — draws, invoices, A/R", default: true },
  { key: "notify.compliance", label: "Compliance — COI / license / tax deadlines", default: true },
  { key: "notify.mentions", label: "@mentions in team chat", default: true },
  { key: "notify.emailDigest", label: "Daily email digest (7am)", default: false },
  { key: "notify.sms", label: "Text me for urgent items", default: true },
];

export interface SettingsData {
  categories: SettingsCategory[];
  profile: {
    name: string;
    meta: string;
    /** Editable identity fields (saved via updateProfile). */
    email: string;
    company: string;
    phone: string;
    /** Read-only display rows shown beneath the editable form. */
    fields: { label: string; value: string }[];
  };
  team: {
    /** Present for real login rows; absent for the synthetic AI row. */
    id?: string;
    initials: string;
    name: string;
    role: string;
    chip: "accent" | "ghost" | "ai";
    active?: boolean;
    isOwner?: boolean;
  }[];
  integrations: Integration[];
  aiToggles: AiToggle[];
  /** Which agent drafts the same-day first response to inbound leads. */
  leadFirstResponseModel: "claude" | "hermes";
  notifyToggles: AiToggle[];
  /** Company / contract boilerplate used by generated contracts + SOWs (B5). */
  companyDocs: {
    license: string;
    address: string;
    depositPct: string;
    terms: string;
    /** Auto-send milestone invoices when a project reaches a billing stage (7-inv). */
    autoSendMilestone: boolean;
    /** Google review link used in completion outreach (P4-2); "" hides the ask. */
    googleReviewUrl: string;
    /** Warranty coverage blurb sent to clients + printed on closeout docs. */
    warrantyTerms: string;
    /** Auto-send warranty + review emails when a job reaches completion (P4-2). */
    autoOutreach: boolean;
    /** Auto-draft a social post when a job reaches completion (P6-2). */
    autoDraftSocial: boolean;
  };
  /** Precon billing rates + third-party markup (doc-templates plan). Powers the
   *  Pre-Construction Agreement's rates table. */
  billingRates: {
    markup: string;
    rows: { key: string; label: string; value: string }[];
  };
  /** Browser-extension catalog clipper (Phase 2 A): the auth token (null until
   *  generated) + the endpoint the extension posts to. */
  clip: {
    token: string | null;
    endpoint: string;
  };
  /** Website lead-form ingestion: the auth token (null until generated) + the
   *  endpoint the site's lead form POSTs new leads to. */
  intake: {
    token: string | null;
    endpoint: string;
  };
}

export async function getSettingsData(): Promise<SettingsData> {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings`,
  );
  const settings = new Map(rows.map((r) => [r.key, r.value]));
  const get = (key: string, fallback = "") => settings.get(key) ?? fallback;

  // Name + email are the authoritative login identity, read from the current
  // user's row (kept in sync by updateProfile); company + phone live in settings.
  const me = await getCurrentUser();
  const clipToken = await getClipToken();
  const intakeToken = await getIntakeToken();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
  const name = me?.name ?? get("profile.name", "Joe Stafki");
  const email = me?.email ?? get("profile.email", "josephstafki@sjcarpentryllc.com");
  const company = get("profile.company", "SJ Carpentry LLC");
  // No fake fallback number — stays empty until Joe saves his real cell
  // (this value feeds SMS-in later, so a placeholder here is worse than blank).
  const phone = get("profile.phone");

  const aiProvider = process.env.AI_PROVIDER ?? "mock";
  const aiModel = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";

  // Team list is live from the users table. A synthetic AI row stands in for
  // the AI assistant (not a login account).
  const { rows: userRows } = await query<{
    id: string;
    name: string;
    email: string;
    role: string;
    initials: string;
    link_slug: string | null;
    active: boolean;
  }>(`SELECT id, name, email, role, initials, link_slug, active
        FROM users ORDER BY (role = 'owner') DESC, name`);

  const roleDescription = (r: typeof userRows[number]): string => {
    const base =
      r.role === "owner"
        ? "Owner · all roles"
        : r.role === "sub"
          ? `Sub · ${r.link_slug ?? "portal"} (portal access)`
          : `Client · ${r.link_slug ?? "portal"} (portal access)`;
    return r.active ? base : `${base} · disabled`;
  };

  const team: SettingsData["team"] = [
    ...userRows.map((r) => ({
      id: r.id,
      initials: r.initials || "?",
      name: r.name,
      role: roleDescription(r),
      chip: (r.role === "owner" ? "accent" : "ghost") as "accent" | "ghost" | "ai",
      active: r.active,
      isOwner: r.role === "owner",
    })),
    { initials: "AI", name: "AI assistant", role: "System · all models", chip: "ai" as const },
  ];

  return {
    // Only categories with a real function. Workspace/Subscription/Data were
    // read-only fiction (no subscription on a self-hosted tool, duplicated
    // identity, placeholder backup status) — removed in S6.
    categories: [
      { id: "profile", title: "Profile" },
      { id: "company", title: "Company & documents" },
      { id: "team", title: "Team & roles" },
      { id: "integrations", title: "Integrations" },
      { id: "ai", title: "AI" },
      { id: "notifications", title: "Notifications" },
    ],
    profile: {
      name,
      meta: `Owner · ${company} · all roles`,
      email,
      company,
      phone,
      fields: [
        { label: "Title shown to clients", value: `Owner, ${company}` },
        { label: "Time zone", value: "America/Chicago" },
        { label: "Working hours", value: "7:00 am – 6:00 pm · Mon–Fri" },
      ],
    },
    team,
    // Honest connection state, derived from real config rather than a fixed
    // showcase list. The first three reflect what's actually wired today; the
    // rest are genuinely not connected yet (deferred subsystems).
    integrations: [
      {
        name: "Gmail",
        sub: "Inbox read + send",
        connected: gmailConfigured(),
      },
      {
        name: aiProvider === "ollama" ? "Local AI · Ollama" : "AI provider",
        sub: aiProvider === "ollama" ? aiModel : aiProvider,
        connected: aiProvider !== "mock",
      },
      { name: "PostgreSQL", sub: "sjcos database", connected: true },
      { name: "QuickBooks", sub: "Books · reconciliation", connected: false },
      { name: "Google Drive", sub: "Doc archive (deferred)", connected: false },
      { name: "Stripe", sub: "Card payments", connected: false },
    ],
    leadFirstResponseModel: get("ai.leadFirstResponseModel") === "hermes" ? "hermes" : "claude",
    aiToggles: AI_TOGGLES.map((t) => ({
      key: t.key,
      label: t.label,
      on: settings.has(t.key) ? settings.get(t.key) === "true" : t.default,
    })),
    notifyToggles: NOTIFY_TOGGLES.map((t) => ({
      key: t.key,
      label: t.label,
      on: settings.has(t.key) ? settings.get(t.key) === "true" : t.default,
    })),
    companyDocs: {
      license: get("company.license", ""),
      address: get("company.address", ""),
      depositPct: get("contract.deposit_pct", "10"),
      terms: get("contract.terms", ""),
      autoSendMilestone: settings.has("invoice.auto_send_on_milestone")
        ? settings.get("invoice.auto_send_on_milestone") === "true"
        : true,
      googleReviewUrl: get("company.google_review_url", ""),
      warrantyTerms: get("company.warranty_terms", ""),
      autoOutreach: settings.has("outreach.auto_on_completion")
        ? settings.get("outreach.auto_on_completion") === "true"
        : true,
      autoDraftSocial: settings.has("marketing.auto_draft_on_completion")
        ? settings.get("marketing.auto_draft_on_completion") === "true"
        : true,
    },
    billingRates: {
      markup: get(MARKUP_KEY, MARKUP_DEFAULT),
      rows: BILLING_RATE_ROWS.map((r) => ({ key: r.key, label: r.label, value: get(r.key, r.default) })),
    },
    intake: {
      token: intakeToken,
      endpoint: `${appUrl}/api/leads/intake`,
    },
    clip: {
      token: clipToken,
      endpoint: `${appUrl}/api/catalog/clip`,
    },
  };
}
