import type { ReactNode } from "react";
import { can, getCurrentUser } from "@/lib/dal";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, DollarSign, FileText, ChevronRight } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, Button, Card, Chip, EmptyState, Eyebrow, PageHeader, SubmitButton } from "@/components/ui";
import { ProjectTabs } from "@/components/projects/ProjectTabs";
import { PanelSections } from "@/components/projects/PanelSections";
import { TabLink } from "@/components/projects/TabNav";
import type { ProjectTab } from "@/lib/project-tabs";
import { WeeklyStatusSend } from "@/components/projects/WeeklyStatusSend";
import { WeeklyStatusDraft } from "@/components/projects/WeeklyStatusDraft";
import { PunchList } from "@/components/projects/PunchList";
import { MoneyPanel } from "@/components/projects/MoneyPanel";
import { BudgetPanel } from "@/components/projects/BudgetPanel";
import { getProjectBudget } from "@/lib/budget";
import { todayCentral } from "@/lib/budget-queries";
import { computeTotals, fmtK } from "@/lib/budget-types";
import { SelectionsBoard } from "@/components/projects/SelectionsBoard";
import { BiddingBoard } from "@/components/projects/BiddingBoard";
import { getProjectBidding, listAllSubs } from "@/lib/bidding";
import { MoodBoard } from "@/components/projects/MoodBoard";
import { FloorPlan } from "@/components/projects/FloorPlan";
import { getProject, getProjectFiles, getProjectFileTrash, getProjectSubsData, getProjectDailyLogs, PROJECT_STATUSES, projectStageLabel, stageToolTab } from "@/lib/projects";
import { ProjectSubs } from "@/components/projects/ProjectSubs";
import { SubInvitesPanel } from "@/components/projects/SubInvitesPanel";
import { getQueuedSubInvites } from "@/lib/sub-invites";
import { ProjectDailyLog } from "@/components/projects/ProjectDailyLog";
import { ProjectFiles } from "@/components/projects/ProjectFiles";
import { DeletedFiles } from "@/components/projects/DeletedFiles";
import { ProjectComms } from "@/components/projects/ProjectComms";
import { PortalAccessPanel, type PortalInviteSummary } from "@/components/portal/PortalAccessPanel";
import { getClientInvite, getPortalClaim } from "@/lib/client-invites";
import { getClientActivity } from "@/lib/client-activity";
import { getClientUploadsForOwner, getPublishedRoster } from "@/lib/portal-roster";
import { ClientActivityFeed } from "@/components/portal-admin/ClientActivityFeed";
import { PublishedRoster } from "@/components/portal-admin/PublishedRoster";
import { ProjectSchedule } from "@/components/projects/ProjectSchedule";
import { DocTypePanel, type DocSourcePicker } from "@/components/projects/DocTypePanel";
import { ESTIMATE_KIND_LABEL, WHERE } from "@/lib/estimate-kinds";
import { fmtUsd } from "@/lib/cost-book-units";
import { InPersonSignList } from "@/components/esign/InPersonSignList";
import { getProjectSignatureRequests, getLeadSignatureRequests } from "@/lib/esign";
import { listDocDrafts, listDocTemplates } from "@/lib/doc-drafts";
import { LeadPaperwork } from "@/components/projects/LeadPaperwork";
import { getLeadPaperworkForProject } from "@/lib/leads";
import { ChangeOrders } from "@/components/projects/ChangeOrders";
import { PurchaseOrders } from "@/components/projects/PurchaseOrders";
import { getProjectPurchaseOrders } from "@/lib/purchase-orders";
import { listVendors } from "@/lib/vendors";
import { Closeout } from "@/components/projects/Closeout";
import { Safety } from "@/components/projects/Safety";
import { Incidents } from "@/components/projects/Incidents";
import { getProjectChangeOrders } from "@/lib/change-orders";
import { getCloseoutView } from "@/lib/closeout";
import { getProjectPermits } from "@/lib/permits";
import { PermitPacket } from "@/components/projects/PermitPacket";
import { getProjectOrientations, getProjectIncidents } from "@/lib/safety";
import { ProjectEstimate } from "@/components/projects/ProjectEstimate";
import { getProjectEstimates, getScopeChangeContext } from "@/lib/estimates";
import { getApprovalGate } from "@/lib/approval-gate";
import { getCostBook } from "@/lib/cost-book";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { getProjectScheduleBlocks, getScheduleTemplates } from "@/lib/schedule";
import { getProjectMoney, usd } from "@/lib/money";
import { getProjectSelections } from "@/lib/selections";
import { getProjectMood } from "@/lib/mood";
import { getProjectFloorplans } from "@/lib/floorplans";
import { getDesignsForScope } from "@/lib/plan-designs";
import { getCatalogData } from "@/lib/catalog";
import { projectContext } from "@/lib/page-context";
import { advanceProjectStatus } from "@/lib/actions/projects";
import { whisperAvailable } from "@/lib/transcribe";
import { RecordOps } from "@/components/engine/RecordOps";
import { getRecordOps } from "@/lib/record-ops";
import { getActiveRunbookInstancesFor } from "@/lib/runbook-engine";

/** Small "View →" affordance that jumps an Overview card to its full tab. */
function ViewTab({ tab, section }: { tab: ProjectTab; section?: string }) {
  return (
    <TabLink tab={tab} section={section} title={`Open the ${tab} tab`}>
      View
      <ChevronRight className="size-2.5" strokeWidth={2} />
    </TabLink>
  );
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; focus?: string }>;
}) {
  const { slug } = await params;
  const { tab: linkedTab, focus: linkedFocus } = await searchParams;
  // Money fence, per area (lib/permissions.ts): each Money-tab section shows
  // only to a viewer holding its area; the tab itself goes when none do.
  // Contract value / invoice button / Money rail card follow `invoices`.
  const viewer = await getCurrentUser();
  const showEstimates = can(viewer, "estimates");
  const showInvoices = can(viewer, "invoices");
  const showPOs = can(viewer, "purchase_orders");
  const showCOs = can(viewer, "change_orders");
  const showBidding = can(viewer, "bidding");
  const showMoney = showInvoices;
  // Job costing (Money › Overview) sits behind `money`, the catch-all fence for
  // every financial feature that is not one of the named areas above.
  const showFinancials = can(viewer, "money");
  const [
    project,
    money,
    selections,
    mood,
    floorplans,
    planDesigns,
    catalog,
    projectFiles,
    commsThread,
    scheduleBlocks,
    scheduleTemplates,
    subsData,
    subInvites,
    dailyLogs,
    estimates,
    costBook,
    changeOrders,
    closeoutView,
    orientations,
    approvalGate,
    purchaseOrders,
    vendors,
    incidents,
    permits,
    docDrafts,
    ops,
    bidding,
    biddingRoster,
    budget,
    signatureRequests,
    scopeChange,
  ] = await Promise.all([
    getProject(slug),
    getProjectMoney(slug),
    getProjectSelections(slug),
    getProjectMood(slug),
    getProjectFloorplans(slug),
    getDesignsForScope({ projectSlug: slug }),
    getCatalogData(),
    getProjectFiles(slug),
    getPortalThread(portalChannel("client", slug)),
    getProjectScheduleBlocks(slug),
    getScheduleTemplates(),
    getProjectSubsData(slug),
    getQueuedSubInvites(slug),
    getProjectDailyLogs(slug),
    getProjectEstimates(slug),
    getCostBook(),
    getProjectChangeOrders(slug),
    getCloseoutView(slug),
    getProjectOrientations(slug),
    getApprovalGate(slug),
    getProjectPurchaseOrders(slug),
    listVendors(),
    getProjectIncidents(slug),
    getProjectPermits(slug),
    listDocDrafts({ slug }),
    // Open Engine + Brain data scoped to this one project (work queue, knowledge,
    // receipts, stage-gate guidance) — the "Ops" tab.
    getRecordOps("project", slug),
    getProjectBidding(slug),
    listAllSubs(),
    showFinancials ? getProjectBudget(slug) : Promise.resolve(null),
    // Every signature request on the job (any doc type) — the "Sign in person"
    // section of the Documents tab lists whatever is awaiting a signature.
    getProjectSignatureRequests(slug),
    // Which record a client change becomes right now (pre-con change
    // estimate vs change order) — decided by the DB, shown on the Money tab.
    getScopeChangeContext(slug),
  ]);
  const docTemplates = listDocTemplates().filter((t) => t.scope !== "lead");
  if (!project || !scopeChange) notFound();

  // Paperwork inherited from the lead stage (rough estimate, pre-con agreement,
  // lead-scoped signature requests). Those rows stay keyed by lead_slug after
  // conversion, so the project fetches them by the origin lead's slug —
  // Documents › From the lead. Null when the job didn't come from a lead.
  const leadPaperwork = await getLeadPaperworkForProject(slug);
  const [leadDocDrafts, leadSignatureRequests] = leadPaperwork
    ? await Promise.all([
        listDocDrafts({ leadSlug: leadPaperwork.leadSlug }),
        getLeadSignatureRequests(leadPaperwork.leadSlug),
      ])
    : [[], []];

  // Client portal tab: invite/access, the ledger of what the client has done,
  // their uploads, and what's currently published to them.
  const portalScopeObj = { kind: "project", slug } as const;
  const [invite, portalClaim, clientActivity, clientUploads, publishedRoster] = await Promise.all([
    getClientInvite({ project: slug }),
    getPortalClaim({ project: slug }),
    getClientActivity(portalScopeObj),
    getClientUploadsForOwner(portalScopeObj),
    getPublishedRoster(portalScopeObj),
  ]);
  const inviteSummary: PortalInviteSummary = {
    ...(invite
      ? {
          status:
            invite.status === "dismissed"
              ? ("dismissed" as const)
              : invite.expiresAt !== null && invite.expiresAt < new Date()
                ? ("expired" as const)
                : ("active" as const),
          toEmail: invite.toEmail,
          // null = the link doesn't expire, which is every link issued since
          // portal links stopped having a clock. The panel words it that way.
          expiresLabel:
            invite.expiresAt?.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }) ?? null,
          used: invite.usedAt !== null,
        }
      : { status: "none" as const, toEmail: null, expiresLabel: null, used: false }),
    claimed: portalClaim !== null,
    claimedEmail: portalClaim?.email ?? null,
  };

  const catalogOptions = catalog.materials.map((m) => ({ id: m.id, name: m.name }));

  // The mood-board picker shows thumbnails + price, so it needs more than the
  // id/name the selections picker gets. `id` is coerced because catalog_items.id
  // is bigserial and node-postgres hands int8 back as a string.
  const moodCatalog = catalog.materials.map((m) => ({
    id: Number(m.id),
    name: m.name,
    supplier: m.supplier,
    category: m.category,
    priceLabel: m.price,
    imageUrl: m.imageId ? `/api/files/${m.imageId}` : null,
  }));

  // Real invoices override the curated money summary on the Overview rail.
  const realMoney = money.invoices.length > 0;
  const nextInvoice = money.invoices.find((i) => i.status === "sent");

  const statusIdx = PROJECT_STATUSES.findIndex((s) => s.key === project.status);
  const nextStatus = PROJECT_STATUSES[statusIdx + 1];

  async function moveToNextStatus() {
    "use server";
    await advanceProjectStatus(slug);
  }

  const activeRunbooks = await getActiveRunbookInstancesFor("project", slug);
  const m = project.money;
  // Profit for the Overview rail: only when the budget allows one to be claimed.
  const finTotals = budget ? computeTotals(budget) : null;

  const overview = (
    <div className="grid grid-cols-1 items-start gap-6 @4xl/page:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        <AiBubble>
          <h2 className="mb-1 text-subheading font-semibold text-ai-2">
            Project pulse
          </h2>
          <p className="text-body">{project.pulse}</p>
        </AiBubble>
        {project.status === "warranty" ? (
          // A finished job: coverage and claims matter, not weekly client updates.
          <Card className="p-4">
            <h2 className="font-serif text-heading font-semibold">Warranty</h2>
            <p className="mt-2 text-body text-ink-2">
              Claims, coverage dates and missing closeout records for this job live on Warranty.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button href="/warranty" size="sm" variant="secondary">Open Warranty</Button>
            </div>
          </Card>
        ) : (
          <Card className="p-4">
            <h2 className="font-serif text-heading font-semibold">
              Weekly status email
            </h2>
            <div className="mt-3 text-body text-ink-2">
              {project.weeklyStatus || <WeeklyStatusDraft slug={slug} />}
            </div>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-rule-soft pt-3">
              <span className="text-meta text-ink-3">
                Review the draft before sending.
              </span>
              {project.weeklyStatus && <WeeklyStatusSend slug={slug} />}
            </div>
          </Card>
        )}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-serif text-heading font-semibold">Activity</h2>
            <ViewTab tab="Daily log" />
          </div>
          {dailyLogs.length === 0 && !ops?.receipts.length ? (
            <EmptyState
              title="No activity recorded yet"
              description="Daily logs and completed actions will appear here. Use Log update to record the next site update."
            />
          ) : (
            <ol className="divide-y divide-rule-soft">
              {[
                ...dailyLogs
                  .slice(0, 8)
                  .map((log) => ({
                    id: `log-${log.id}`,
                    date: log.iso,
                    label: "Daily log",
                    body: log.body,
                    meta: log.photos ? `${log.photos} photos` : null,
                  })),
                ...(ops?.receipts ?? [])
                  .slice(0, 8)
                  .map((r) => ({
                    id: `receipt-${r.id}`,
                    date: r.createdAt.slice(0, 10),
                    label: r.runtimeName || "Recorded action",
                    body: r.label || r.workItemTitle || "Action recorded",
                    meta: null,
                  })),
              ]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 12)
                .map((entry) => (
                  <li key={entry.id} className="flex gap-3 py-3">
                    <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-3">
                      <FileText className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-label font-semibold">
                          {entry.label}
                        </span>
                        <time className="text-meta text-ink-3">
                          {entry.date}
                        </time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-body text-ink-2">
                        {entry.body}
                      </p>
                      {entry.meta && (
                        <p className="mt-1 text-meta text-ink-3">
                          {entry.meta}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
            </ol>
          )}
        </section>
      </div>
      <aside className="min-w-0 space-y-5 @4xl/page:border-l @4xl/page:border-rule-soft @4xl/page:pl-5">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-subheading font-semibold">Client</h2>
            <ViewTab tab="Client portal" />
          </div>
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-body">
            <dt className="text-meta text-ink-3">Name</dt>
            <dd className="break-words">
              {project.client.name || "No client on file"}
            </dd>
            <dt className="text-meta text-ink-3">Email</dt>
            <dd className="break-words">
              {project.client.email ? (
                <a
                  href={`mailto:${project.client.email}`}
                  className="hover:text-accent"
                >
                  {project.client.email}
                </a>
              ) : (
                "No email on file"
              )}
            </dd>
            {project.client.phone && (
              <>
                <dt className="text-meta text-ink-3">Phone</dt>
                <dd>
                  <a href={`tel:${project.client.phone}`}>
                    {project.client.phone}
                  </a>
                </dd>
              </>
            )}
            <dt className="text-meta text-ink-3">Address</dt>
            <dd className="break-words">
              {project.client.address || "No address on file"}
            </dd>
          </dl>
        </section>
        {showMoney && (
          <section className="border-t border-rule-soft pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-subheading font-semibold">Money</h2>
              <ViewTab tab="Money" section="Invoices" />
            </div>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-body tabular-nums">
              <dt className="text-meta text-ink-3">Job total</dt>
              <dd>{m.contract}</dd>
              <dt className="text-meta text-ink-3">Paid</dt>
              <dd className="text-ok">{m.paid}</dd>
              <dt className="text-meta text-ink-3">Next draw</dt>
              <dd>{nextInvoice ? usd(nextInvoice.amount) : "—"}</dd>
              <dt className="text-meta text-ink-3">Open COs</dt>
              <dd>
                {
                  changeOrders.filter(
                    (c) => c.status === "draft" || c.status === "sent",
                  ).length
                }
              </dd>
            </dl>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-3">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.min(100, Math.max(0, m.billedPct))}%` }}
              />
            </div>
            <p className="mt-1 text-meta text-ink-3">{m.note}</p>
          </section>
        )}
        <section className="border-t border-rule-soft pt-4">
          <h2 className="mb-3 text-subheading font-semibold">Project</h2>
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-body">
            <dt className="text-meta text-ink-3">Stage</dt>
            <dd>{projectStageLabel(project.status)}</dd>
            <dt className="text-meta text-ink-3">Details</dt>
            <dd className="break-words">{project.subtitle}</dd>
            <dt className="text-meta text-ink-3">Next step</dt>
            <dd className="break-words">
              {project.statusChips[0]?.label ||
                projectStageLabel(project.status)}
            </dd>
            {activeRunbooks.map((r) => (
              <ReactRunbook
                key={r.id}
                title={r.runbookTitle}
                step={r.currentStep}
                total={r.stepCount}
              />
            ))}
          </dl>
        </section>
        <section className="border-t border-rule-soft pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-subheading font-semibold">Key dates</h2>
            <ViewTab tab="Schedule" />
          </div>
          {scheduleBlocks.length ? (
            <ul className="space-y-3">
              {scheduleBlocks.slice(0, 4).map((b) => (
                <li key={b.id}>
                  <p className="text-meta text-ink-3">
                    {b.dateLabel} · {b.time}
                  </p>
                  <p className="text-body">{b.label}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-ink-3">
              No dates scheduled. Add the next milestone in Schedule.
            </p>
          )}
        </section>
      </aside>
    </div>
  );

  // ── Schedule panel — real project-scoped blocks (add/remove) + milestones ──
  const schedulePanel = (
    <div className="flex max-w-[680px] flex-col gap-3.5">
      <ProjectSchedule slug={slug} blocks={scheduleBlocks} templates={scheduleTemplates} />
      {project.milestones.length > 0 && (
        <Card className="p-3.5">
          <h3 className="mb-2 font-serif text-[16px] font-semibold text-ink">Milestones</h3>
          <div className="flex flex-col">
            {project.milestones.map((ms, i) => (
              <div
                key={ms.name}
                className={`flex items-center gap-2 py-2 ${i ? "border-t border-rule-soft" : ""}`}
              >
                <span className="flex-1 text-[13px] text-ink">{ms.name}</span>
                <span className="font-mono text-[11px] text-ink-3">{ms.date}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  // ── Subs panel — real project↔sub assignments (assign/remove + contact),
  //    plus any portal invites parked for Joe by an assignment (never sent).
  const subsPanel = (
    <div>
      <ProjectSubs slug={slug} assigned={subsData.assigned} roster={subsData.roster} />
      <SubInvitesPanel slug={slug} invites={subInvites} />
    </div>
  );

  // ── Files panel — real upload/download scoped to the project ───────────────
  const deletedFiles = await getProjectFileTrash(slug);
  const filesPanel = (
    <>
      <ProjectFiles slug={slug} files={projectFiles} showcase={project.files} />
      <DeletedFiles files={deletedFiles} />
    </>
  );

  // ── Money panel — real invoices (curated draw schedule as a
  //    reference only when no invoices exist yet) ──────────────────────────────
  const moneyPanel = (
    <div className="flex flex-col gap-3.5">
      <MoneyPanel slug={slug} money={money} />
      {!realMoney && project.milestones.length > 0 && (
        <Card className="p-3.5">
          <h3 className="mb-2 font-serif text-[16px] font-semibold text-ink">Draw schedule · reference</h3>
          <div className="flex flex-col">
            {project.milestones.map((ms, i) => (
              <div
                key={ms.name}
                className={`flex items-center gap-2 py-2 ${i ? "border-t border-rule-soft" : ""}`}
              >
                <span className={`flex-1 text-[13px] ${ms.status === "queued" ? "text-ink-3" : "text-ink"}`}>
                  {ms.name}
                </span>
                <span className="font-mono text-[11px] text-ink-3">{ms.date}</span>
                <span className="w-[68px] text-right font-mono text-[12px] text-ink-3">{ms.value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  // ── Daily log panel — real project-scoped log history + add ────────────────
  const dailyLogPanel = <ProjectDailyLog slug={slug} logs={dailyLogs} voiceEnabled={whisperAvailable()} />;

  // ── Selections panel — real board: catalog/upload images + client approval ──
  const selectionsPanel = (
    <SelectionsBoard slug={slug} view={selections} catalog={catalogOptions} showBudget={can(viewer, "money")} />
  );

  // ── Bidding panel — packages by trade: packet files, recipients, compare ───
  const biddingPanel = (
    <BiddingBoard slug={slug} view={bidding} roster={biddingRoster} projectFiles={projectFiles} />
  );

  // ── Client portal tab — everything about the client's dashboard in one place:
  //    Activity (what they've done, when), Messages (the real owner ⇄ client
  //    thread, portal:<slug>), Uploads (their photos/files, in the viewer),
  //    Published (what they can currently see), Access (invite link).
  const recentClientActions = clientActivity.filter((r) => r.kind !== "visit").length;
  const clientPortalTab = (
    <PanelSections
      tab="Client portal"
      sections={[
        {
          label: `Activity${recentClientActions ? ` · ${recentClientActions}` : ""}`,
          node: <ClientActivityFeed rows={clientActivity} />,
        },
        {
          label: `Messages${commsThread.length ? ` · ${commsThread.length}` : ""}`,
          node: <ProjectComms slug={slug} thread={commsThread} />,
        },
        {
          label: `Uploads${clientUploads.length ? ` · ${clientUploads.length}` : ""}`,
          node: (
            <ProjectFiles
              slug={slug}
              files={clientUploads}
              showcase={[]}
              title={`${clientUploads.length} uploaded by the client`}
            />
          ),
        },
        {
          label: `Published${publishedRoster.total ? ` · ${publishedRoster.total}` : ""}`,
          node: <PublishedRoster roster={publishedRoster} base={`/projects/${slug}`} />,
        },
        {
          label: "Access",
          node: <PortalAccessPanel scope={{ project: slug }} invite={inviteSummary} />,
        },
      ]}
      focusSections={{
        "activity-": "Activity",
        "message-": "Messages",
        "file-": "Uploads",
      }}
    />
  );

  // ── Punch panel — real, interactive punch-list items (add/toggle/remove) ────
  const punchPanel = <PunchList slug={project.slug} items={project.punch} />;
  // The estimate editor is mounted twice: the formal estimate lives under
  // Documents › Formal Estimate (the client's PDF sits under it, printed from
  // its lines), and Money › Pre-con changes holds client additions/changes
  // priced before the contract is signed. docs/estimates-and-change-orders.md
  const estimateDocManifest = docTemplates.find((t) => t.key === "estimate_doc");
  const estimateDocs = docDrafts.filter((d) => d.template_key === "estimate_doc");
  const formalIds = new Set(estimates.filter((e) => e.kind === "formal").map((e) => e.id));
  // Formal Estimate PDFs not made from a formal estimate on this job (its
  // estimate deleted, or made from a pre-con change) — listed on their own.
  const looseEstimateDocs = estimateDocs.filter((d) => !d.estimate_id || !formalIds.has(d.estimate_id));
  const estimateEditor = (kind: "formal" | "precon_change") => (
    <ProjectEstimate
      slug={slug}
      kind={kind}
      estimates={estimates}
      costItems={costBook.items.filter((i) => !i.archived)}
      defaultMarkup={costBook.defaultMarkup}
      floorplans={floorplans}
      approvalGate={approvalGate}
      phase={scopeChange}
      pdfs={kind === "formal" && estimateDocManifest ? { manifest: estimateDocManifest, drafts: estimateDocs } : undefined}
    />
  );
  const formalEstimatePanel = estimateEditor("formal");
  const preconChangesPanel = estimateEditor("precon_change");
  const changeOrdersPanel = <ChangeOrders slug={slug} orders={changeOrders} phase={scopeChange} />;
  const purchaseOrdersPanel = (
    <PurchaseOrders slug={slug} orders={purchaseOrders} vendors={vendors} assignedSubs={subsData.assigned} />
  );
  const closeoutPanel = <Closeout slug={slug} view={closeoutView} />;
  const safetyPanel = (
    <Safety slug={slug} orientations={orientations} incidents={<Incidents slug={slug} incidents={incidents} />} />
  );

  // ── Floor / Mood — design-tool tabs (real boards, S5D/S5E) ──────────────────
  const floorPanel = <FloorPlan slug={slug} versions={floorplans} designs={planDesigns} />;
  const moodPanel = <MoodBoard slug={slug} boards={mood} catalog={moodCatalog} />;

  // ── Money — what the job was priced at, what's been billed, what changed.
  //    Paperwork (contracts, change orders, etc.) + e-signing live in their own
  //    top-level Documents tab now — see documentsTab below.
  // Overview first: what the job should make and how far along it is, before
  // the paperwork that produces those numbers.
  const financialsPanel = budget ? (
    <BudgetPanel
      slug={slug}
      budget={budget}
      isOwner={viewer?.role === "owner"}
      hasApprovedEstimate={estimates.some((e) => e.status === "approved")}
      poOptions={purchaseOrders
        .filter((po) => po.status !== "void")
        .map((po) => ({ id: po.id, label: [po.poNumber, po.vendorName].filter(Boolean).join(" · ") || `PO ${po.id}` }))}
      today={todayCentral()}
    />
  ) : null;

  const moneyTab = (
    <PanelSections
      tab="Money"
      sections={[
        ...(financialsPanel ? [{ label: "Overview", node: financialsPanel }] : []),
        ...(showEstimates ? [{ label: "Pre-con changes", node: preconChangesPanel }] : []),
        ...(showInvoices ? [{ label: "Invoices", node: moneyPanel }] : []),
        ...(showCOs ? [{ label: "Change orders", node: changeOrdersPanel }] : []),
        ...(showPOs ? [{ label: "Purchase orders", node: purchaseOrdersPanel }] : []),
      ]}
    />
  );

  // ── Documents — one sub-section per template type; each lists every draft of
  //    that type (any status) with its own edit/delete/send. Promoted out of
  //    Money so "the contract" isn't three clicks deep behind Estimate/Documents/
  //    Signatures — a document's status chip (Draft/Sent/Signed) is now the only
  //    "signed" label; there's no separate Signatures tab.
  // Deep links (?focus=signature-<id> / draft-<id>) open the template section
  // that owns that draft.
  const docFocusSections: Record<string, string> = { "formal-estimate": "Formal Estimate" };
  for (const t of docTemplates) {
    for (const d of docDrafts.filter((x) => x.template_key === t.key)) {
      docFocusSections[`draft-${d.id}`] = t.title;
      if (d.signature_request_id) docFocusSections[`signature-${d.signature_request_id}`] = t.title;
    }
  }
  // Documents that are GENERATED FROM one record offer the job's records to
  // pick from — a Formal Estimate or Contract from an estimate's lines, a
  // Change Order from a change order, an Invoice from an invoice — instead of
  // a blank draft (docs/estimates-and-change-orders.md).
  const pickLink = (tab: ProjectTab, section: string, text: string) => (
    <TabLink tab={tab} section={section} className="font-semibold text-accent-2 underline-offset-2 hover:underline">
      {text}
    </TabLink>
  );
  const estimateOption = (e: (typeof estimates)[number]) => ({
    id: e.id,
    label: `#${e.id} ${e.title} · ${ESTIMATE_KIND_LABEL[e.kind]} · ${e.status} · ${fmtUsd(e.total)}`,
  });
  // Formal first: the section's own estimate is the usual source.
  const formalFirst = [...estimates].sort((a, b) => Number(b.kind === "formal") - Number(a.kind === "formal"));
  const docSources: Record<string, DocSourcePicker> = {
    estimate_doc: {
      scopeKey: "estimateId",
      label: "Estimate",
      explainer: "PDF copies of the estimate above, generated from its lines. Regenerate after the lines change.",
      options: formalFirst.map(estimateOption),
      empty: <>No estimate yet. Create the formal estimate above first; the PDF is generated from its lines.</>,
    },
    contract: {
      scopeKey: "estimateId",
      label: "Approved estimate",
      explainer: `Built from the approved formal estimate (${WHERE.formalEstimate}) — its total and draw schedule fill the contract.`,
      options: [...formalFirst].sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved")).map(estimateOption),
      empty: <>No estimate yet. {pickLink("Documents", "Formal Estimate", "Create the formal estimate")} and get it approved first.</>,
    },
    change_order: {
      scopeKey: "changeOrderId",
      label: "Change order",
      explainer: `Generated from a change order in ${WHERE.changeOrders} — a change to the signed contract.`,
      options: changeOrders.map((c) => ({ id: c.id, label: `#${c.id} ${c.title} · ${c.status} · ${c.priceLabel}` })),
      empty:
        scopeChange.path === "change_order" ? (
          <>No change order yet. {pickLink("Money", "Change orders", `Draft one in ${WHERE.changeOrders}`)} first.</>
        ) : (
          <>
            Change orders start once the contract is signed ({scopeChange.statusLabel} now). A client addition or change before that
            is a pre-con change estimate under {pickLink("Money", "Pre-con changes", WHERE.preconChanges)}.
          </>
        ),
    },
    invoice_doc: {
      scopeKey: "invoiceId",
      label: "Invoice",
      explainer: "Generated from an invoice in Money › Invoices.",
      options: money.invoices.map((i) => ({ id: i.id, label: `${i.number} ${i.milestone} · ${i.status} · ${usd(i.amount)}` })),
      empty: <>No invoice yet. {pickLink("Money", "Invoices", "Create one in Money › Invoices")} first.</>,
    },
  };
  // What the job carried over from its lead stage — rough estimate, pre-con
  // agreement, anything else drafted on the lead. Read-only here; the section
  // links back to the lead page for edits. Only when the job came from a lead.
  const LEAD_SECTION = "From the lead";
  for (const d of leadDocDrafts) {
    docFocusSections[`draft-${d.id}`] = LEAD_SECTION;
    if (d.signature_request_id) docFocusSections[`signature-${d.signature_request_id}`] = LEAD_SECTION;
  }
  const leadPaperworkCount = leadDocDrafts.filter((d) => d.status !== "void").length + (leadPaperwork?.roughEstimate ? 1 : 0);
  // Last section: sign on this device. Anything awaiting a signature — template
  // drafts, estimates, change orders, lien waivers, and the lead-stage pre-con
  // or rough estimate — opens on /sign/<id>.
  const allSignatureRequests = [...signatureRequests, ...leadSignatureRequests];
  const awaitingSignature = allSignatureRequests.filter((r) => r.status === "sent").length;
  const documentsTab = (
    <PanelSections
      tab="Documents"
      focusSections={docFocusSections}
      sections={[
        ...docTemplates.map((t) => {
          const panel = (
            <DocTypePanel
              slug={slug}
              templateKey={t.key}
              manifest={t}
              drafts={docDrafts.filter((d) => d.template_key === t.key)}
              source={docSources[t.key]}
            />
          );
          // The Formal Estimate section IS the formal estimate: each estimate
          // carries the client's PDF of it (printed from its lines). Only PDFs
          // not tied to a formal estimate here get a list of their own.
          const node =
            t.key === "estimate_doc" && showEstimates ? (
              <div className="space-y-8">
                {formalEstimatePanel}
                {looseEstimateDocs.length > 0 && (
                  <DocTypePanel
                    slug={slug}
                    templateKey={t.key}
                    manifest={t}
                    drafts={looseEstimateDocs}
                    heading="Other Formal Estimate PDFs"
                    note="Not made from the formal estimate above (its estimate was deleted, or it came from a pre-con change). Make new ones under the estimate."
                  />
                )}
              </div>
            ) : (
              panel
            );
          return { label: t.title, node };
        }),
        // A22 money fence: the lead's rough estimate lines ride in this panel.
        ...(leadPaperwork && showEstimates
          ? [
              {
                label: `${LEAD_SECTION}${leadPaperworkCount ? ` · ${leadPaperworkCount}` : ""}`,
                node: <LeadPaperwork paperwork={leadPaperwork} drafts={leadDocDrafts} />,
              },
            ]
          : []),
        {
          label: `Sign in person${awaitingSignature ? ` · ${awaitingSignature}` : ""}`,
          node: <InPersonSignList requests={allSignatureRequests} />,
        },
      ]}
    />
  );

  // ── Closeout — punch list first (it's the work), then the final paperwork.
  const closeoutTab = (
    <PanelSections
      tab="Closeout"
      focusSections={{ "punch-": "Punch list" }}
      sections={[
        { label: "Punch list", node: punchPanel },
        { label: "Final docs", node: closeoutPanel },
      ]}
    />
  );

  const panels: Partial<Record<ProjectTab, ReactNode>> = {
    Overview: overview,
    Ops: ops ? <RecordOps ops={ops} /> : null,
    Floor: floorPanel,
    Mood: moodPanel,
    Selections: selectionsPanel,
    Bidding: biddingPanel,
    Money: moneyTab,
    Documents: documentsTab,
    Schedule: schedulePanel,
    Subs: subsPanel,
    Files: filesPanel,
    "Daily log": dailyLogPanel,
    "Client portal": clientPortalTab,
    Permits: <PermitPacket slug={slug} permits={permits} />,
    Closeout: closeoutTab,
    Safety: safetyPanel,
  };

  const projectAiContext = projectContext(project);



  const headerBand = (
    <div className="px-4 pb-5 pt-5 @xl/page:px-7">
      <Link href="/projects" className="text-meta text-ink-3 hover:text-ink">
        ← All projects
      </Link>
      <PageHeader
        variant="record"
        title={project.name}
        className="mt-3"
        badge={<Chip kind="accent">{projectStageLabel(project.status)}</Chip>}
        meta={[showMoney ? project.contractValue : null, project.subtitle]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {showMoney && (
              <TabLink
                tab="Money"
                section="Invoices"
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-body font-semibold text-paper hover:bg-ink-hover max-sm:h-11"
              >
                <DollarSign className="size-3.5" />
                Send invoice
              </TabLink>
            )}
            <TabLink
              tab="Daily log"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rule bg-card px-3 text-body font-semibold hover:bg-hover max-sm:h-11"
            >
              <Check className="size-3.5" />
              Log update
            </TabLink>
            <details className="relative">
              <summary
                aria-label="More project actions"
                className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md border border-rule bg-card text-subheading hover:bg-hover max-sm:size-11"
              >
                …
              </summary>
              <div className="absolute right-0 z-30 mt-1 min-w-52 rounded-lg border border-rule-soft bg-card p-2 shadow-pop">
                {nextStatus && (
                  <form action={moveToNextStatus}>
                    <SubmitButton
                      pendingLabel="Moving…"
                      className="w-full rounded-md px-2 py-2 text-left text-body hover:bg-hover"
                    >
                      Move to {nextStatus.label}
                    </SubmitButton>
                  </form>
                )}
                <Button href={`/projects/${slug}/scope`} variant="ghost">
                  Scope register
                </Button>
              </div>
            </details>
          </>
        }
      />
    </div>
  );

  return (
    <Shell
      breadcrumb={`PROJECTS › ${project.name.toUpperCase()}`}
      aiContext={projectAiContext}
    >
      <ProjectTabs
        panels={panels}
        stageTab={stageToolTab(project.status)}
        initialTab={linkedTab}
        focus={linkedFocus}
        header={headerBand}
        hiddenTabs={[
          ...(showEstimates || showInvoices || showPOs || showCOs || showFinancials ? [] : ["Money" as const]),
          ...(showBidding ? [] : ["Bidding" as const]),
        ]}
      />
    </Shell>
  );
}

function ReactRunbook({title,step,total}:{title:string;step:number;total:number}) { return <><dt className="text-meta text-ink-3">Runbook</dt><dd>{title} · step {step}/{total}</dd></>; }
