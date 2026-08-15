import Link from "next/link";
import { Bell, ArrowLeft } from "lucide-react";
import { Avatar, Chip } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { getProject } from "@/lib/projects";
import { queryOne } from "@/lib/db";
import {
  EMPTY_PORTAL_BADGES,
  getPortalBadgesForScope,
  parseLinkSlug,
  type PortalBadges,
} from "@/lib/client-portal";
import { PortalNav, type PortalNavItem } from "@/components/portal/PortalNav";
import { LiveUpdates } from "@/components/shell/LiveUpdates";

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
  const scope = user.role === "client" ? parseLinkSlug(user.linkSlug) : null;

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
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex h-[50px] flex-none items-center gap-3 border-b border-rule bg-paper-2 px-7">
        <span className="font-serif text-[15px] font-semibold text-accent-2">SJ Carpentry</span>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 sm:inline">
          Client portal · {title ?? "Your project"}
        </span>
        <div className="flex-1" />
        {user.role === "owner" && (
          <Link
            href="/today"
            className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-paper-3"
          >
            <ArrowLeft className="size-3" strokeWidth={1.75} />
            Return to SJC OS
          </Link>
        )}
        <Chip kind={attention > 0 ? "accent" : "ghost"}>
          <Bell className="mr-0.5 inline size-2.5" strokeWidth={1.75} />
          {attention}
        </Chip>
        <Avatar initials={user.initials || "—"} size="sm" />
      </header>

      <PortalNav items={items} />

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <LiveUpdates />
    </div>
  );
}
