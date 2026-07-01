import Link from "next/link";
import { Bell, FileText, ArrowLeft } from "lucide-react";
import { Avatar, Card, Chip, Eyebrow } from "@/components/ui";
import { getClientPortalData, getClientUploads } from "@/lib/client-portal";
import { requireRole } from "@/lib/dal";
import { getProject } from "@/lib/projects";
import { getClientSelections } from "@/lib/selections";
import { getProjectMoney, usd } from "@/lib/money";
import { getProjectScheduleBlocks } from "@/lib/schedule";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { ClientSelections } from "@/components/portal/ClientSelections";
import { PortalMessenger } from "@/components/portal/PortalMessenger";
import { ClientSignDocs } from "@/components/portal/ClientSignDocs";
import { ClientUploads } from "@/components/portal/ClientUploads";
import { WarrantyClaimForm } from "@/components/portal/WarrantyClaimForm";
import { getClientSignatures } from "@/lib/esign";
import { getClientWarranty } from "@/lib/warranty";

export default async function ClientPortalPage() {
  const user = await requireRole("owner", "client");

  // Scope the portal to the logged-in client's project (owners previewing keep
  // the Henderson showcase). Journal content stays curated for now.
  const slug = user.role === "client" ? user.linkSlug : "henderson";

  const [data, project, money, selections, thread] = await Promise.all([
    getClientPortalData(),
    slug ? getProject(slug) : Promise.resolve(null),
    slug ? getProjectMoney(slug) : Promise.resolve(null),
    slug
      ? getClientSelections(slug)
      : Promise.resolve({ groups: [], totalBudget: 0, totalSpent: 0, totalProposed: 0 }),
    slug
      ? getPortalThread(portalChannel("client", slug))
      : Promise.resolve([]),
  ]);
  const signDocs = slug ? await getClientSignatures(slug) : [];
  const toSignCount = signDocs.filter((d) => d.status === "sent").length;

  // Read-only schedule + the client's own uploaded files (5-depth).
  const [scheduleBlocks, uploads] = slug
    ? await Promise.all([getProjectScheduleBlocks(slug), getClientUploads(slug)])
    : [[], []];

  // Warranty panel — only once the project has reached the warranty stage (P4-3).
  const inWarranty = project?.status === "warranty";
  const warranty = inWarranty && slug ? await getClientWarranty(slug) : null;

  if (project) {
    data.project = project.name;
    if (user.role === "client") data.clientInitials = user.initials || data.clientInitials;
  }

  // Real money: contract from the project, paid/outstanding/retainer from the
  // invoices + retainer ledger. Falls back to the curated rows when empty.
  const moneyRows =
    money && (money.invoices.length > 0 || money.retainer.collected > 0)
      ? [
          ...(project?.contractValue
            ? [{ label: "Contract", value: project.contractValue }]
            : []),
          { label: "Paid to date", value: usd(money.paidTotal), good: money.paidTotal > 0 },
          { label: "Outstanding", value: usd(money.outstanding) },
          ...(money.retainer.collected > 0
            ? [{ label: "Retainer on file", value: usd(money.retainer.balance), good: true }]
            : []),
        ]
      : data.money;

  // Invoices the client should see — sent + paid only, never internal drafts.
  const clientInvoices = (money?.invoices ?? []).filter((i) => i.status !== "draft");

  // Real "needs a decision" count = selections awaiting this client's approval.
  const pendingCount = selections.groups
    .flatMap((g) => g.selections)
    .filter((s) => s.status === "pending").length;

  return (
    <div className="flex h-screen flex-col bg-paper">
      {/* slim header */}
      <header className="flex h-[50px] flex-none items-center gap-3 border-b border-rule bg-paper-2 px-7">
        <span className="font-serif text-[15px] font-semibold text-accent-2">SJ Carpentry</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          Client portal · {data.project}
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
        <Chip kind="ghost">
          <Bell className="mr-0.5 inline size-2.5" strokeWidth={1.75} />
          {pendingCount + toSignCount}
        </Chip>
        <Avatar initials={data.clientInitials} size="sm" />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_360px]">
        {/* journal */}
        <main className="overflow-y-auto px-9 py-7">
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
            {data.entries.map((e, i) => (
              <div key={e.date}>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className={`size-2 rounded-full ${i === 0 ? "bg-accent" : "bg-ink-4"}`} />
                  <span className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
                    {e.date}
                  </span>
                </div>
                <h2 className="mb-1 font-serif text-[15px] font-semibold text-ink">{e.title}</h2>
                <p className="text-[13.5px] leading-relaxed text-ink">{e.body}</p>
                {e.photos > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {Array.from({ length: e.photos }).map((_, k) => (
                      <div
                        key={k}
                        className="aspect-[4/3] w-[100px] rounded border border-rule bg-paper-3"
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </main>

        {/* sidebar */}
        <aside className="overflow-y-auto border-l border-rule bg-paper-2 p-6">
          {warranty && slug && (
            <>
              <Card kind="accent" className="mb-4 p-3">
                <WarrantyClaimForm slug={slug} data={warranty} />
              </Card>
            </>
          )}

          <Eyebrow muted>What I need from you</Eyebrow>
          {pendingCount > 0 ? (
            <Card kind="accent" className="mt-2 p-2.5">
              <div className="font-serif text-[13px] font-semibold text-ink">
                {pendingCount} selection{pendingCount > 1 ? "s" : ""} need your approval
              </div>
              <div className="mt-1 text-[11px] text-ink-2">
                Review them below and approve or decline — your running budget updates as you go.
              </div>
            </Card>
          ) : (
            <div className="mt-2 text-[12px] text-ink-3">
              You&apos;re all caught up — nothing needs a decision right now.
            </div>
          )}

          {toSignCount > 0 && (
            <Card kind="accent" className="mt-2 p-2.5">
              <div className="font-serif text-[13px] font-semibold text-ink">
                {toSignCount} document{toSignCount > 1 ? "s" : ""} to sign
              </div>
              <div className="mt-1 text-[11px] text-ink-2">
                Review and e-sign them below.
              </div>
            </Card>
          )}

          <div className="my-4 border-t border-rule" />
          <Eyebrow muted>Documents to sign</Eyebrow>
          <ClientSignDocs docs={signDocs} />

          <div className="my-4 border-t border-rule" />
          <Eyebrow muted>Selections to review</Eyebrow>
          <ClientSelections view={selections} />

          {scheduleBlocks.length > 0 && (
            <>
              <div className="my-4 border-t border-rule" />
              <Eyebrow muted>Schedule</Eyebrow>
              <div className="mt-2 flex flex-col gap-1.5">
                {scheduleBlocks.slice(0, 8).map((b) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <span
                      className={`size-1.5 flex-none rounded-full ${
                        b.tone === "accent" ? "bg-accent" : b.tone === "ai" ? "bg-ai" : "bg-ink-4"
                      }`}
                    />
                    <span className="w-[92px] flex-none font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                      {b.dateLabel}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{b.label}</span>
                    <span className="font-mono text-[10px] text-ink-3">{b.time}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="my-4 border-t border-rule" />
          <Eyebrow muted>Money</Eyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            {moneyRows.map((m) => (
              <div key={m.label} className="flex items-center">
                <span className="flex-1 text-[12px] text-ink-2">{m.label}</span>
                <span className={`font-mono text-[11px] ${m.good ? "text-money" : "text-ink-3"}`}>
                  {m.value}
                </span>
              </div>
            ))}
          </div>

          {clientInvoices.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Invoices</span>
              {clientInvoices.map((inv) => (
                <Card key={inv.id} className="p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-ink-3">{inv.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{inv.milestone}</span>
                    <span className="font-mono text-[12px] font-semibold text-ink-2">{usd(inv.amount)}</span>
                    <Chip kind={inv.status === "paid" ? "money" : "accent"} dot>
                      {inv.status === "paid" ? "paid" : "due"}
                    </Chip>
                  </div>
                  {inv.lines.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5 border-t border-rule-soft pt-1.5">
                      {inv.lines.map((l, k) => (
                        <div key={k} className="flex items-center gap-2 text-[11px]">
                          <span className="min-w-0 flex-1 truncate text-ink-3">{l.label}</span>
                          <span className="font-mono text-ink-3">{usd(l.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 font-mono text-[10px] text-ink-3">{inv.statusLabel}</div>
                </Card>
              ))}
            </div>
          )}

          <div className="my-4 border-t border-rule" />
          <Eyebrow muted>Message Joe</Eyebrow>
          <PortalMessenger
            surface="client"
            thread={thread}
            placeholder="Reply about the project…"
          />

          {data.files.length > 0 && (
            <>
              <div className="my-4 border-t border-rule" />
              <Eyebrow muted>Files shared with you</Eyebrow>
              <div className="mt-2 flex flex-col gap-1.5">
                {data.files.map((f) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                    <span className="text-[12px] text-ink-2">{f}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="my-4 border-t border-rule" />
          <Eyebrow muted>Share photos or documents</Eyebrow>
          <ClientUploads uploads={uploads} />
        </aside>
      </div>
    </div>
  );
}
