// Access areas for STAFF accounts — the catalog every other piece of the
// access system keys off (proxy route gating, Shell nav filtering, the Team &
// roles editor, requireAccess() in server actions).
//
// Deliberately dependency-free: proxy.ts imports this on the Edge runtime.
//
// Model: `owner` sees everything, always. `staff` is an internal team login
// whose users.permissions[] lists the areas they may open; anything not
// listed is invisible (hidden from the sidebar, redirected by proxy, refused
// by the matching server actions). Financial surfaces are fenced by the
// money areas: `estimates`, `invoices`, `purchase_orders`, `change_orders`,
// `bidding`, `cost_book` are grantable one by one; `money` is everything else with a dollar sign and the
// default gate for every future money feature.
//
// Adding an area: append here, then gate its actions with requireAccess(key).
// A path that is not claimed by any area is owner-only for staff.

export type PermissionKey =
  | "today"
  | "inbox"
  | "comms"
  | "chat"
  | "leads"
  | "projects"
  | "subs"
  | "vendors"
  | "site"
  | "newsletter"
  | "catalog"
  | "compliance"
  | "warranty"
  | "marketing"
  | "automate"
  | "engine"
  | "estimates"
  | "invoices"
  | "purchase_orders"
  | "change_orders"
  | "bidding"
  | "cost_book"
  | "money"
  | "ai";

export interface PermissionDef {
  key: PermissionKey;
  label: string;
  /** One line for the Team editor — what the box actually unlocks. */
  description: string;
  /** Route prefixes this area opens. Matched as `path === p || path.startsWith(p + "/")`. */
  paths: string[];
  /** Shown with a warning tint in the editor. */
  sensitive?: boolean;
}

export const PERMISSIONS: readonly PermissionDef[] = [
  { key: "today", label: "Today", description: "Today queue, work items, notifications, workbench.", paths: ["/today", "/notifications", "/workbench"] },
  { key: "inbox", label: "Inbox", description: "Company email inbox — read, reply, draft.", paths: ["/inbox"] },
  { key: "comms", label: "Messages & calls", description: "Client/sub SMS threads and the call log.", paths: ["/messages", "/calls"] },
  { key: "chat", label: "Team chat", description: "Internal team channels and project rooms.", paths: ["/chat"] },
  { key: "leads", label: "Leads", description: "Lead pipeline, intake, follow-ups and lead tasks.", paths: ["/leads"] },
  { key: "projects", label: "Projects", description: "Project records, schedule, files, selections, mood/floor boards, documents, daily log, closeout, safety.", paths: ["/projects", "/schedule", "/files", "/floor"] },
  { key: "subs", label: "Subs", description: "Subcontractor roster and sub portal admin.", paths: ["/subs"] },
  { key: "vendors", label: "Vendors", description: "Vendor roster.", paths: ["/vendors"] },
  { key: "site", label: "Website", description: "Marketing site content.", paths: ["/site"] },
  { key: "newsletter", label: "Newsletter", description: "Recipients, issues, drips (release still needs an owner grant).", paths: ["/newsletter"] },
  { key: "catalog", label: "Catalog", description: "Product / selection catalog.", paths: ["/catalog"] },
  { key: "compliance", label: "Compliance", description: "Insurance, permits, safety compliance.", paths: ["/compliance"] },
  { key: "warranty", label: "Warranty", description: "Warranty claims and service calls.", paths: ["/warranty"] },
  { key: "marketing", label: "Marketing", description: "Campaigns and marketing assets.", paths: ["/marketing"] },
  { key: "automate", label: "Automate", description: "Automations and scheduled jobs.", paths: ["/automate"] },
  { key: "engine", label: "Engine", description: "Open Engine board, skills, runbooks (not owner permissions).", paths: ["/engine"] },
  // ── Money — split so a team member can be trusted with, say, invoices and
  //    purchase orders without seeing bids or margins. `money` is the catch-all
  //    for everything financial not named below, and the default fence for
  //    every future money feature.
  { key: "estimates", label: "Estimates", description: "Project estimates and lead rough estimates (Money tab › Estimate).", paths: [], sensitive: true },
  { key: "invoices", label: "Invoices & payments", description: "Invoices, draws, collections, contract value and paid-to-date (Money tab › Invoices).", paths: [], sensitive: true },
  { key: "purchase_orders", label: "Purchase orders", description: "Vendor POs on projects (Money tab › Purchase orders).", paths: [], sensitive: true },
  { key: "change_orders", label: "Change orders", description: "Change orders and their amounts (Money tab › Change orders).", paths: [], sensitive: true },
  { key: "bidding", label: "Bidding", description: "Bid packages, sub bid amounts, awards and bid files (project Bidding tab).", paths: [], sensitive: true },
  { key: "cost_book", label: "Cost book", description: "The reusable unit costs estimates pull from.", paths: ["/cost-book"], sensitive: true },
  {
    key: "money",
    label: "All other financials",
    description: "Billing rates, Books, and every future money feature not listed above.",
    paths: ["/books"],
    sensitive: true,
  },
  {
    key: "ai",
    label: "AI operator panel",
    description: "The Ask window. Agents there act with full owner-level tool access, so this effectively unlocks everything — grant with care.",
    paths: ["/ai", "/panel"],
    sensitive: true,
  },
];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

/** Reachable by every signed-in staff member regardless of areas. */
const ALWAYS_ALLOWED = ["/logout"];

/** Routes under the internal app that only the owner may open, no matter what
 *  areas a staff account holds. Kept explicit so a future area can't
 *  accidentally claim them. */
export const OWNER_ONLY_PATHS = ["/settings", "/engine/permissions", "/client-portal", "/sub-portal"];

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function isPermissionKey(k: string): k is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(k);
}

/** Drop unknown keys, dedupe, keep catalog order. */
export function normalizePermissions(raw: readonly string[] | null | undefined): PermissionKey[] {
  const set = new Set((raw ?? []).filter(isPermissionKey));
  return PERMISSION_KEYS.filter((k) => set.has(k));
}

/** Owner-only regardless of areas. proxy.ts gates staff on this alone — the
 *  per-area check happens in Shell against the DB row, so an area granted or
 *  revoked in Settings takes effect on the next click, not the next login. */
export function isOwnerOnlyPath(path: string): boolean {
  return OWNER_ONLY_PATHS.some((p) => under(path, p));
}

/** Can a STAFF account with these areas open this path? (Owner never asks.) */
export function staffMayOpen(perms: readonly string[], path: string): boolean {
  if (ALWAYS_ALLOWED.some((p) => under(path, p))) return true;
  if (OWNER_ONLY_PATHS.some((p) => under(path, p))) return false;
  const held = new Set(perms);
  return PERMISSIONS.some((def) => held.has(def.key) && def.paths.some((p) => under(path, p)));
}

/** Which area a path belongs to, if any (first match in catalog order). */
export function areaForPath(path: string): PermissionKey | null {
  for (const def of PERMISSIONS) if (def.paths.some((p) => under(path, p))) return def.key;
  return null;
}

/** Where a staff member lands after login: Today if they have it, else the
 *  first area they hold. No areas at all → /logout, which breaks the
 *  login→home→login loop instead of spinning in it (the Team editor refuses to
 *  save a staff account with nothing ticked, so this is a backstop). */
export function staffHome(perms: readonly string[]): string {
  const held = new Set(perms);
  if (held.has("today")) return "/today";
  for (const def of PERMISSIONS) if (held.has(def.key)) return def.paths[0];
  return "/logout";
}
