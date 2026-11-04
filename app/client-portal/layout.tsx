import { PreviewPicker } from "@/components/portal/PreviewPicker";
import Link from "next/link";
import { Bell, ArrowLeft } from "lucide-react";
import { Avatar } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { getProject } from "@/lib/projects";
import { query, queryOne } from "@/lib/db";
import {
  EMPTY_PORTAL_BADGES,
  getPortalBadgesForScope,
  portalScope,
  type PortalBadges,
} from "@/lib/client-portal";
import { PortalNav, type PortalNavItem } from "@/components/portal/PortalNav";
import { LiveUpdates } from "@/components/shell/LiveUpdates";
import { logPortalVisit } from "@/lib/client-activity";

// Client-portal chrome: slim header + section nav shared by every portal page.
// Standalone surface — deliberately NOT wrapped in Shell (see Shell's
// docstring); the portal has its own nav and its own live-update poller so a
// client sees Joe's pushes (selections, docs, messages) without reloading.
//
// A lead-stage session (link_slug 'lead:<slug>') gets a trimmed nav — Home,
// Documents, Messages — because plans, mood boards, selections, money, and
// schedule are project machinery that doesn't exist yet. The nav grows on
// conversion without the client doing anything.
export default async function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole("owner", "client");
  const scope = await portalScope();
  const previewProjects = user.role === "owner" ? (await query<{ slug: string; name: string }>("SELECT slug, name FROM projects ORDER BY name")).rows : [];

  // "Client opened the portal" — once per day per client, into the activity
  // ledger the owner reads on the lead/project Client portal tab. Best-effort;
  // an owner previewing is not a visit.
  if (scope && user.role === "client") await logPortalVisit(scope, user.name);

  const [title, badges] = await Promise.all([
    scope?.kind === "project"
      ? getProject(scope.slug).then((p) => p?.name ?? null)
      : scope?.kind === "lead"
        ? queryOne<{ name: string }>(`SELECT name FROM leads WHERE slug = $1`, [scope.slug]).then(
            (l) => (l ? `${l.name} · getting started` : null),
          )
        : Promise.resolve(null),
    scope ? getPortalBadgesForScope(scope) : Promise.resolve<PortalBadges>(EMPTY_PORTAL_BADGES),
  ]);

  const items: PortalNavItem[] =
    scope?.kind === "lead"
      ? [
          { href: "/client-portal", label: "Home" },
          { href: "/client-portal/documents", label: "Documents", badge: badges.toSign },
          { href: "/client-portal/messages", label: "Messages" },
        ]
      : [
          { href: "/client-portal", label: "Home" },
          { href: "/client-portal/plans", label: "Floor plans" },
          { href: "/client-portal/mood", label: "Mood boards" },
          { href: "/client-portal/selections", label: "Selections", badge: badges.decisions },
          { href: "/client-portal/documents", label: "Documents", badge: badges.toSign },
          { href: "/client-portal/money", label: "Money", badge: badges.due },
          { href: "/client-portal/schedule", label: "Schedule" },
          { href: "/client-portal/messages", label: "Messages" },
        ];

  // Bell = everything currently waiting on the CLIENT (never their own past
  // actions): open decisions, docs to sign, punch items to confirm.
  const attention = badges.decisions + badges.toSign + badges.confirm;

  return (
    <div className="flex h-dvh flex-col bg-paper">
      <header className="flex min-h-16 flex-none flex-wrap items-center gap-3 border-b border-rule bg-card px-4 sm:px-7">
        <div className="min-w-0 flex-1 py-2">
          <span className="font-serif text-heading font-semibold text-accent-2">SJ Carpentry</span>
          <p className="text-body text-ink-2">
            {title ?? (user.role === "owner" ? "Owner preview" : "No project linked — contact Joe")}
          </p>
        </div>
        {user.role === "owner" && (
          <Link
            href="/today"
            className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-meta font-medium text-ink-2 transition-colors hover:bg-paper-3"
          >
            <ArrowLeft className="size-3" strokeWidth={1.75} />
            Return to SJC OS
          </Link>
        )}
        <span aria-label={`${attention} items need your attention`} className="inline-flex items-center gap-1 text-label text-ink-2">
          <Bell className="mr-0.5 inline size-2.5" strokeWidth={1.75} />
          {attention}
        </span>
        <Avatar initials={user.initials || "—"} size="sm" />
      </header>

      {user.role === "owner" && <PreviewPicker projects={previewProjects} selected={scope?.slug ?? ""} />}
      <PortalNav items={items} />

      <div className="@container/page min-h-0 flex-1 overflow-y-auto max-sm:[&_button]:min-h-11 max-sm:[&_input:not([type=checkbox])]:min-h-11 max-sm:[&_label:has(input[type=file])]:min-h-11 pb-[env(safe-area-inset-bottom)]">{children}</div>
      <LiveUpdates />
    </div>
  );
}
