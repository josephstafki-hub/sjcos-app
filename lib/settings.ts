// Settings data builder. DB-backed (Phase 7-B): profile fields + Claude/AI
// toggles read from the app_settings key/value table via lib/db; toggles
// persist through lib/actions/settings.ts. Integrations + the non-profile
// categories stay static placeholders.

import { query } from "./db";

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

/** The Claude/AI toggle set, with stable keys + defaults (used when a row is
 *  absent from app_settings). */
const AI_TOGGLES: { key: string; label: string; default: boolean }[] = [
  { key: "ai.draftReplies", label: "Draft client replies by default", default: true },
  { key: "ai.autoPinWatchouts", label: "Auto-pin watchouts in team chat", default: true },
  { key: "ai.summarizeVoicemails", label: "Auto-summarize incoming voicemails", default: true },
  { key: "ai.weeklyStatusEmails", label: "Auto-generate weekly client status emails (review before send)", default: true },
  { key: "ai.autoPublishSocial", label: "Auto-publish social posts on job completion", default: false },
  { key: "ai.sendBeforeReview", label: "Send before drafts are reviewed", default: false },
];

export interface SettingsData {
  categories: SettingsCategory[];
  profile: {
    name: string;
    meta: string;
    fields: { label: string; value: string }[];
  };
  integrations: Integration[];
  aiToggles: AiToggle[];
}

export async function getSettingsData(): Promise<SettingsData> {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings`,
  );
  const settings = new Map(rows.map((r) => [r.key, r.value]));
  const get = (key: string, fallback = "") => settings.get(key) ?? fallback;

  const name = get("profile.name", "Joe Stafki");
  const company = get("profile.company", "SJ Carpentry LLC");
  const email = get("profile.email", "josephstafki@sjcarpentryllc.com");

  return {
    categories: [
      { id: "profile", title: "Profile" },
      { id: "workspace", title: "Workspace" },
      { id: "team", title: "Team & roles" },
      { id: "integrations", title: "Integrations" },
      { id: "ai", title: "Claude & AI" },
      { id: "billing", title: "Subscription" },
      { id: "data", title: "Data & backups" },
      { id: "notifications", title: "Notifications" },
    ],
    profile: {
      name,
      meta: `Owner · ${company} · all roles`,
      fields: [
        { label: "Display name", value: name },
        { label: "Email", value: email },
        { label: "Phone (SMS in)", value: "(612) 555-0117" },
        { label: "Title shown to clients", value: `Owner, ${company}` },
        { label: "Time zone", value: "America/Chicago" },
        { label: "Working hours", value: "7:00 am – 6:00 pm · Mon–Fri" },
      ],
    },
    integrations: [
      { name: "QuickBooks", sub: "Books · reconciliation", connected: true },
      { name: "Google Drive", sub: "Doc archive", connected: true },
      { name: "Twilio", sub: "SMS in/out", connected: true },
      { name: "Postmark", sub: "Email sync", connected: true },
      { name: "Plaid · 1 bank", sub: "Live txns", connected: true },
      { name: "Stripe", sub: "Card payments", connected: false },
      { name: "Instagram", sub: "Auto-post", connected: false },
      { name: "Facebook", sub: "Auto-post", connected: false },
    ],
    aiToggles: AI_TOGGLES.map((t) => ({
      key: t.key,
      label: t.label,
      on: settings.has(t.key) ? settings.get(t.key) === "true" : t.default,
    })),
  };
}
