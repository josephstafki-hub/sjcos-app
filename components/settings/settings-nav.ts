/** One settings menu for /settings and every settings sub-page. Category ids
 *  match lib/settings.ts `categories` (sections inside /settings). */
export const SETTINGS_CATEGORIES = [
  { id: "profile", title: "Profile" },
  { id: "company", title: "Company & documents" },
  { id: "team", title: "Team & roles" },
  { id: "integrations", title: "Integrations" },
  { id: "ai", title: "AI" },
  { id: "notifications", title: "Notifications" },
  { id: "designer", title: "Floor-plan designer" },
] as const;

export const MORE_SETTINGS = [
  { title: "Pricing", href: "/settings/pricing" },
  { title: "Overhead", href: "/settings/overhead" },
  { title: "Payments · Square", href: "/settings/payments" },
  { title: "Accounting · QuickBooks", href: "/settings/accounting" },
];
