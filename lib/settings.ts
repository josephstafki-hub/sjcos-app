// Settings data builder. Mock-backed today; reads workspace config + live
// integration status in Phase 7. Profile is the built showcase section; the
// other categories are placeholders.

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
  label: string;
  on: boolean;
}

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
      name: "Joe Schroeder",
      meta: "Owner · all roles · joined Mar 2017",
      fields: [
        { label: "Display name", value: "Joe Schroeder" },
        { label: "Email", value: "joe@sjcarpentryllc.com" },
        { label: "Phone (SMS in)", value: "(612) 555-0117" },
        { label: "Title shown to clients", value: "Owner, SJ Carpentry LLC" },
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
    aiToggles: [
      { label: "Draft client replies by default", on: true },
      { label: "Auto-pin watchouts in team chat", on: true },
      { label: "Auto-summarize incoming voicemails", on: true },
      { label: "Auto-generate weekly client status emails (review before send)", on: true },
      { label: "Auto-publish social posts on job completion", on: false },
      { label: "Send before drafts are reviewed", on: false },
    ],
  };
}
