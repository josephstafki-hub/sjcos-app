import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button, Card, Eyebrow, PhotoGrid } from "@/components/ui";
import {
  buildClientPortalData,
  getClientUploads,
  getSharedFiles,
  getPortalBadgesForScope,
  portalScope,
  getPortalProjectUpdate,
  EMPTY_PORTAL_BADGES,
} from "@/lib/client-portal";
import { requireRole } from "@/lib/dal";
import { PROJECT_STATUSES, getProject, getProjectDailyLogs } from "@/lib/projects";
import { getPortalFinancials } from "@/lib/portal-financials";
import { getProjectMoney, usd } from "@/lib/money";
import { getProjectScheduleBlocks } from "@/lib/schedule";
import { ProjectFinancials } from "@/components/portal/ProjectFinancials";
import { portalInvoiceSummary } from "@/lib/portal-presentation";
import { stageLabel } from "@/lib/leads";
import type { LeadStage } from "@/lib/types";
import { queryOne } from "@/lib/db";
import { runDirect } from "@/lib/commands/db";
import { renderClientSummary, type SummaryContent } from "@/lib/field/weekly-summary";
import { getClientWarranty } from "@/lib/warranty";
import { ClientUploads } from "@/components/portal/ClientUploads";
import { ClientPunch } from "@/components/portal/ClientPunch";
import { WarrantyClaimForm } from "@/components/portal/WarrantyClaimForm";
import { ClaimAccount } from "@/components/portal/ClaimAccount";

// Portal home: the project journal + everything currently waiting on the
// client, each linking into its own section (nav in the layout). The deep
// sections — plans, mood, selections, documents, money, schedule, messages —
// live on their own routes. A lead-stage session gets the same page with the
// lead's pipeline stage where the journal would be — the dashboard opens
// before the project row exists.
export default async function ClientPortalPage() {
  const user = await requireRole("owner", "client");
  const scope = await portalScope();
  const slug = scope?.kind === "project" ? scope.slug : null;

  const [project, logs, badges, lead] = await Promise.all([
    slug ? getProject(slug) : Promise.resolve(null),
    slug ? getProjectDailyLogs(slug) : Promise.resolve([]),
    scope ? getPortalBadgesForScope(scope) : Promise.resolve(EMPTY_PORTAL_BADGES),
    scope?.kind === "lead"
      ? queryOne<{ name: string; stage: LeadStage }>(
          `SELECT name, stage FROM leads WHERE slug = $1`,
          [scope.slug],
        )
      : Promise.resolve(null),
  ]);

  const [financials, money, schedule, update] = slug ? await Promise.all([
    getPortalFinancials(slug), getProjectMoney(slug), getProjectScheduleBlocks(slug), getPortalProjectUpdate(slug),
  ]) : [null, null, [], null];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const invoiceSummary = portalInvoiceSummary(money?.invoices ?? [], today, financials?.currentCents, financials?.outsidePaidCents);
  const nextPayment = invoiceSummary.due[0];
  const weekEnd = new Date(`${today}T12:00:00Z`); weekEnd.setUTCDate(weekEnd.getUTCDate() + (7 - weekEnd.getUTCDay()) % 7);
  const thisWeek = schedule.filter((b) => b.iso >= today && b.iso <= weekEnd.toISOString().slice(0, 10));
  const sharedFiles = scope ? await getSharedFiles(scope) : [];
  const photos = sharedFiles.filter((file) => file.isImage).map((file) => ({ id: file.id, name: file.name, src: `/api/portal/project-file/${file.id}`, caption: file.when }));
  // Friday updates published to this job (lib/field/weekly-summary.ts).
  const weekly = slug
    ? (
        await runDirect<{ id: string; week: string; content: SummaryContent }>(
          `SELECT w.id, to_char(w.week_start, 'Mon FMDD') AS week, w.content
             FROM weekly_summaries w JOIN projects p ON p.id = w.project_id
            WHERE p.slug = $1 AND w.status = 'published'
            ORDER BY w.week_start DESC, w.revision DESC LIMIT 6`,
          [slug],
        ).catch(() => [])
      ).map((w) => ({ id: w.id, week: w.week, ...renderClientSummary(w.content), photos: w.content.photos ?? [] }))
    : [];

  const data = buildClientPortalData(project, logs);
  if (user.role === "client") data.clientInitials = user.initials || data.clientInitials;
  if (lead) {
    // Lead-stage framing: no daily logs yet — the "journal" is where things
    // stand in the pipeline and what to expect next.
    data.project = lead.name;
    data.greeting = "We're getting your project ready.";
    data.statusChips = [{ label: stageLabel(lead.stage), kind: "accent", dot: true }];
  }

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

  // Uploads are keyed by the raw link slug (project slug or 'lead:<slug>'),
  // matching what uploadClientFile stamps into files.client_slug.
  const uploads =
    user.role === "client" && user.linkSlug ? await getClientUploads(user.linkSlug) : [];

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
    ...(invoiceSummary.due.length > 0
      ? [{
          href: "/client-portal/money",
          title: `${invoiceSummary.due.length} invoice${invoiceSummary.due.length > 1 ? "s" : ""} due`,
          sub: `${usd(invoiceSummary.dueCents)} due now. Review your invoice before paying.`,
        }]
      : []),
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 @3xl/page:px-8">
      <Eyebrow>Client portal · {data.project}</Eyebrow>
      <h1 className="mt-2 font-serif text-display font-medium text-accent-2">{project?.client.name || lead?.name ? `Welcome, ${project?.client.name || lead?.name}.` : "Welcome to your project."}</h1>
      {project?.client.address && <p className="mt-2 text-body text-ink-2">{project.client.address}</p>}
      {project && <p className="mt-2 text-body text-ink-3">{PROJECT_STATUSES.find(s => s.key === project.status)?.label ?? project.status}</p>}
      {lead && <p className="mt-2 text-body text-ink-3">{stageLabel(lead.stage)} · We’re getting your project ready.</p>}

      <div className="mt-8 grid min-w-0 grid-cols-1 gap-8 @4xl/page:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="font-serif text-heading font-semibold">What I need from you</h2>
            {actions.length === 0 && toConfirmCount === 0 ? <p className="mt-3 text-body text-ink-3">You’re all caught up. Joe will let you know when there’s something to review.</p> :
              <div className="mt-3 divide-y divide-rule border-y border-rule">
                {actions.map((a) => <Link key={a.href} href={a.href} className="group flex min-h-11 items-center gap-3 py-3 hover:bg-hover">
                  <div className="min-w-0 flex-1"><p className="text-subheading font-semibold">{a.title}</p><p className="mt-1 text-meta text-ink-3">{a.sub}</p></div>
                  <ChevronRight className="size-4 shrink-0 text-ink-3" />
                </Link>)}
                {toConfirmCount > 0 && <a href="#punch" className="flex min-h-11 items-center justify-between py-3 text-subheading">{toConfirmCount} completed items to confirm <ChevronRight className="size-4" /></a>}
              </div>}
          </section>

          <Card className="p-4">
            <h2 className="font-serif text-heading font-semibold">Next payment</h2>
            {nextPayment ? <>
              <p className="mt-3 font-serif text-kpi tabular-nums">{usd(nextPayment.balance)}</p>
              <p className="mt-1 text-body text-ink-2">{nextPayment.milestone}</p>
              <p className="mt-1 text-meta text-ink-3">{nextPayment.dueAt ? `Due ${nextPayment.dueAt}` : "No due date set"}</p>
              <Button href={`/client-portal/pay/${nextPayment.id}`} size="lg" className="mt-4 w-full">Pay now</Button>
            </> : <p className="mt-3 text-body text-ink-3">No payment due right now.{invoiceSummary.upcoming.length > 0 ? " Future invoices are listed in Money." : " Joe’s next invoice will appear here."}</p>}
            {invoiceSummary.processingCents > 0 && <p className="mt-3 text-body text-ink-3">{usd(invoiceSummary.processingCents)} is processing. No need to pay that amount again.</p>}
            {invoiceSummary.processing.length > 0 && <Link href="/client-portal/money#processing" className="mt-2 inline-flex min-h-11 items-center text-body font-semibold underline">View processing payment</Link>}
          </Card>

          {donePunch.length > 0 && <section id="punch"><h2 className="mb-3 font-serif text-heading font-semibold">Confirm completed items</h2><ClientPunch items={donePunch} /></section>}
          {warranty && slug && <section id="warranty"><WarrantyClaimForm slug={slug} data={warranty} /></section>}
          <section id="files"><h2 className="mb-3 font-serif text-heading font-semibold">Share photos or documents</h2>{user.role === "client" ? <ClientUploads uploads={uploads} /> : <p className="text-body text-ink-3">Client uploads appear here. Use the project’s Client portal tab to manage sharing.</p>}</section>
          {user.role === "client" && !portalClaimed && <ClaimAccount defaultEmail={realEmail} />}
        </div>

        <div className="min-w-0 space-y-8">
          {update?.body && <section className="border-l-2 border-rule pl-3"><h2 className="text-meta font-semibold text-ink-3">Update from Joe · {update.date}</h2><p className="mt-1 whitespace-pre-wrap text-body text-ink-2">{update.body}</p><details className="mt-2 text-meta text-ink-3"><summary className="min-h-11 cursor-pointer py-3">About this update’s dates and payment notes</summary><p>The date above is when the project record was updated; the note’s original date is not recorded. See Money for current invoice status. Dates mentioned here are expected — not yet scheduled unless posted in Schedule.</p></details></section>}
          {invoiceSummary.settled.length > 0 && <details className="text-body"><summary className="min-h-11 cursor-pointer py-3 text-ink-2">{invoiceSummary.settled.length} settled invoice{invoiceSummary.settled.length === 1 ? "" : "s"} · View history</summary><div className="divide-y divide-rule-soft">{invoiceSummary.settled.map(i => <Link key={i.id} href={`/client-portal/money#invoice-${i.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2"><span>{i.number} · {i.milestone}</span><span>Settled · {usd(i.amount)} invoiced</span></Link>)}</div></details>}
          <section><h2 className="font-serif text-heading font-semibold">Project financials</h2>
            {financials ? <div className="mt-3"><ProjectFinancials data={financials} /><Link href="/client-portal/money" className="mt-2 inline-flex min-h-11 items-center text-body font-semibold underline underline-offset-4">View invoices</Link></div>
              : <p className="mt-3 text-body text-ink-3">Joe will share pricing and invoices as your project takes shape.</p>}
          </section>
          {weekly.length > 0 && <section><h2 className="font-serif text-heading font-semibold">Weekly updates</h2>
            <div className="mt-3 divide-y divide-rule-soft">{weekly.map((w) => <article key={w.id} className="py-4">
              <p className="text-meta text-ink-3">Week of {w.week}</p>{w.subject && <h3 className="mt-1 text-subheading font-semibold">{w.subject}</h3>}
              <p className="mt-2 whitespace-pre-wrap text-body text-ink-2">{w.text}</p>
              {w.photos.length > 0 && <PhotoGrid photos={w.photos.map((f) => ({ id: f, name: `Week of ${w.week}`, src: `/api/portal/project-file/${f}` }))} cols={4} className="mt-3" />}
            </article>)}</div>
          </section>}
          <section><h2 className="font-serif text-heading font-semibold">Updates</h2>
            <PhotoGrid photos={photos} cols={4} className="mt-3" />
            {data.entries.length === 0 ? <p className="mt-3 text-body text-ink-3">Joe posts site updates here as work happens. For a question in the meantime, <Link href="/client-portal/messages" className="underline">message Joe</Link>.</p>
              : <div className="mt-3 divide-y divide-rule-soft">{data.entries.map((e, i) => <article key={e.date + i} className="py-4">
                <p className="text-meta text-ink-3">{e.date}</p>{e.title && <h3 className="mt-1 text-subheading font-semibold">{e.title}</h3>}
                <p className="mt-2 whitespace-pre-wrap text-body text-ink-2">{e.body}</p>
              </article>)}</div>}
          </section>
          <section><h2 className="font-serif text-heading font-semibold">This week</h2>
            {thisWeek.length ? <div className="mt-3 divide-y divide-rule-soft">{thisWeek.map((b) => <div key={b.id} className="border-l-2 border-accent py-3 pl-3"><p className="text-meta text-ink-3">{b.dateLabel} · {b.time}</p><p className="mt-1 text-body">{b.label}</p></div>)}</div>
              : <p className="mt-3 text-body text-ink-3">No more work scheduled this week. Joe posts the upcoming work in <Link href="/client-portal/schedule" className="underline">Schedule</Link>.</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
