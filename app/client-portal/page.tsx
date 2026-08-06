import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import {
  buildClientPortalData,
  getClientUploads,
  getPortalBadges,
  type PortalBadges,
} from "@/lib/client-portal";
import { requireRole } from "@/lib/dal";
import { getProject, getProjectDailyLogs } from "@/lib/projects";
import { queryOne } from "@/lib/db";
import { getClientWarranty } from "@/lib/warranty";
import { ClientUploads } from "@/components/portal/ClientUploads";
import { ClientPunch } from "@/components/portal/ClientPunch";
import { WarrantyClaimForm } from "@/components/portal/WarrantyClaimForm";
import { ClaimAccount } from "@/components/portal/ClaimAccount";

// Portal home: the project journal + everything currently waiting on the
// client, each linking into its own section (nav in the layout). The deep
// sections — plans, mood, selections, documents, money, schedule, messages —
// live on their own routes.
export default async function ClientPortalPage() {
  const user = await requireRole("owner", "client");
  const slug = user.role === "client" ? user.linkSlug : null;

  const emptyBadges: PortalBadges = { decisions: 0, toSign: 0, due: 0, confirm: 0 };
  const [project, logs, badges] = await Promise.all([
    slug ? getProject(slug) : Promise.resolve(null),
    slug ? getProjectDailyLogs(slug) : Promise.resolve([]),
    slug ? getPortalBadges(slug) : Promise.resolve(emptyBadges),
  ]);

  const data = buildClientPortalData(project, logs);
  if (user.role === "client") data.clientInitials = user.initials || data.clientInitials;

  // Has this client traded their link for a real password yet? Drives the
  // "create an account" offer. The synthetic address the link-in flow mints
  // isn't a real one, so don't prefill the form with it.
  const claimRow =
    user.role === "client"
      ? await queryOne<{ portal_claimed_at: Date | null; email: string }>(
          `SELECT portal_claimed_at, email FROM users WHERE id = $1`,
          [user.id],
        )
      : null;
  const portalClaimed = !!claimRow?.portal_claimed_at;
  const realEmail = claimRow?.email?.endsWith("@client-portal.invalid")
    ? undefined
    : claimRow?.email;

  const uploads = slug ? await getClientUploads(slug) : [];

  // Warranty panel — only once the project has reached the warranty stage.
  const inWarranty = project?.status === "warranty";
  const warranty = inWarranty && slug ? await getClientWarranty(slug) : null;

  // Punch items the PM has finished, ready for the client to confirm.
  const donePunch = (project?.punch ?? []).filter((p) => p.done);
  const toConfirmCount = donePunch.filter((p) => !p.clientConfirmed).length;

  const actions: { href: string; title: string; sub: string }[] = [
    ...(badges.decisions > 0
      ? [{
          href: "/client-portal/selections",
          title: `${badges.decisions} selection${badges.decisions > 1 ? "s" : ""} need your decision`,
          sub: "Compare the options and pick one — your running budget updates as you go.",
        }]
      : []),
    ...(badges.toSign > 0
      ? [{
          href: "/client-portal/documents",
          title: `${badges.toSign} document${badges.toSign > 1 ? "s" : ""} to sign`,
          sub: "Review and e-sign — estimates, contracts, and change orders.",
        }]
      : []),
    ...(badges.due > 0
      ? [{
          href: "/client-portal/money",
          title: `${badges.due} invoice${badges.due > 1 ? "s" : ""} open`,
          sub: "See what's been billed and what's outstanding.",
        }]
      : []),
  ];

  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-[1fr_360px]">
      {/* journal */}
      <main className="px-9 py-7">
        <Eyebrow>Project journal · {data.project}</Eyebrow>
        <h1 className="mt-1 font-serif text-[30px] font-medium leading-tight text-accent-2">
          {data.greeting}
        </h1>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {data.statusChips.map((c) => (
            <Chip key={c.label} kind={c.kind} dot={c.dot}>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="my-5 border-t border-rule" />

        <div className="flex flex-col gap-5">
          {data.entries.length === 0 ? (
            <p className="text-[13.5px] leading-relaxed text-ink-3">
              No updates posted yet. As work gets logged on site, the latest will show up here.
            </p>
          ) : (
            data.entries.map((e, i) => (
              <div key={e.date + i}>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className={`size-2 rounded-full ${i === 0 ? "bg-accent" : "bg-ink-4"}`} />
                  <span className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
                    {e.date}
                  </span>
                </div>
                {e.title && (
                  <h2 className="mb-1 font-serif text-[15px] font-semibold text-ink">{e.title}</h2>
                )}
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{e.body}</p>
              </div>
            ))
          )}
        </div>
      </main>

      {/* action rail */}
      <aside className="border-l border-rule bg-paper-2 p-6">
        {user.role === "client" && !portalClaimed && (
          <div className="mb-4">
            <ClaimAccount defaultEmail={realEmail} />
          </div>
        )}

        {warranty && slug && (
          <div id="warranty" className="scroll-mt-4">
            <Card kind="accent" className="mb-4 p-3">
              <WarrantyClaimForm slug={slug} data={warranty} />
            </Card>
          </div>
        )}

        <Eyebrow muted>What I need from you</Eyebrow>
        {actions.length === 0 && toConfirmCount === 0 ? (
          <div className="mt-2 text-[12px] text-ink-3">
            You&apos;re all caught up — nothing needs a decision right now.
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {actions.map((a) => (
              <Link key={a.href} href={a.href} className="group block">
                <Card kind="accent" className="p-2.5 transition-colors group-hover:bg-accent-soft/70">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-serif text-[13px] font-semibold text-ink">{a.title}</div>
                      <div className="mt-0.5 text-[11px] text-ink-2">{a.sub}</div>
                    </div>
                    <ChevronRight className="size-3.5 flex-none text-ink-3 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {donePunch.length > 0 && (
          <>
            <div className="my-4 border-t border-rule" />
            <Eyebrow muted>Confirm completed items</Eyebrow>
            <div className="mt-2">
              <ClientPunch items={donePunch} />
            </div>
          </>
        )}

        <div className="my-4 border-t border-rule" />
        <div id="files" className="scroll-mt-4">
          <Eyebrow muted>Share photos or documents</Eyebrow>
          <ClientUploads uploads={uploads} />
        </div>
      </aside>
    </div>
  );
}
