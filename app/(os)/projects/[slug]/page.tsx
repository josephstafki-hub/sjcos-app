import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, DollarSign, Mail, FileText, ChevronRight } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, AiStream, Card, Chip, Avatar, Eyebrow } from "@/components/ui";
import { ProjectTabs } from "@/components/projects/ProjectTabs";
import { PanelSections } from "@/components/projects/PanelSections";
import { TabLink } from "@/components/projects/TabNav";
import type { ProjectTab } from "@/lib/project-tabs";
import { WeeklyStatusSend } from "@/components/projects/WeeklyStatusSend";
import { PunchList } from "@/components/projects/PunchList";
import { MoneyPanel } from "@/components/projects/MoneyPanel";
import { SelectionsBoard } from "@/components/projects/SelectionsBoard";
import { BiddingBoard } from "@/components/projects/BiddingBoard";
import { getProjectBidding, listAllSubs } from "@/lib/bidding";
import { MoodBoard } from "@/components/projects/MoodBoard";
import { FloorPlan } from "@/components/projects/FloorPlan";
import { getProject, getProjectFiles, getProjectSubsData, getProjectDailyLogs, getProjectWeeklyStatus, PROJECT_STATUSES, stageToolTab } from "@/lib/projects";
import { ProjectSubs } from "@/components/projects/ProjectSubs";
import { SubInvitesPanel } from "@/components/projects/SubInvitesPanel";
import { getQueuedSubInvites } from "@/lib/sub-invites";
import { ProjectDailyLog } from "@/components/projects/ProjectDailyLog";
import { ProjectFiles } from "@/components/projects/ProjectFiles";
import { ProjectComms } from "@/components/projects/ProjectComms";
import { PortalAccessPanel, type PortalInviteSummary } from "@/components/portal/PortalAccessPanel";
import { getClientInvite, getPortalClaim } from "@/lib/client-invites";
import { getClientActivity } from "@/lib/client-activity";
import { getClientUploadsForOwner, getPublishedRoster } from "@/lib/portal-roster";
import { ClientActivityFeed } from "@/components/portal-admin/ClientActivityFeed";
import { PublishedRoster } from "@/components/portal-admin/PublishedRoster";
import { ProjectSchedule } from "@/components/projects/ProjectSchedule";
import { DocTypePanel } from "@/components/projects/DocTypePanel";
import { listDocDrafts, listDocTemplates } from "@/lib/doc-drafts";
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
import { getProjectEstimates } from "@/lib/estimates";
import { getApprovalGate } from "@/lib/approval-gate";
import { getCostBook } from "@/lib/cost-book";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { getProjectScheduleBlocks, getScheduleTemplates } from "@/lib/schedule";
import { getProjectMoney, usd } from "@/lib/money";
import { getProjectSelections } from "@/lib/selections";
import { getProjectMood } from "@/lib/mood";
import { getProjectFloorplans } from "@/lib/floorplans";
import { getCatalogData } from "@/lib/catalog";
import { projectContext } from "@/lib/page-context";
import { advanceProjectStatus } from "@/lib/actions/projects";
import { whisperAvailable } from "@/lib/transcribe";
import { RecordOps } from "@/components/engine/RecordOps";
import { getRecordOps } from "@/lib/record-ops";

const DOT: Record<string, string> = {
  accent: "bg-accent",
  ai: "bg-ai",
  ghost: "bg-ink-4",
};

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
  const [
    project,
    money,
    selections,
    mood,
    floorplans,
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
  ] = await Promise.all([
    getProject(slug),
    getProjectMoney(slug),
    getProjectSelections(slug),
    getProjectMood(slug),
    getProjectFloorplans(slug),
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
  ]);
  const docTemplates = listDocTemplates().filter((t) => t.scope !== "lead");
  if (!project) notFound();

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
              : invite.expiresAt < new Date()
                ? ("expired" as const)
                : ("active" as const),
          toEmail: invite.toEmail,
          expiresLabel: invite.expiresAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
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
  const nextInvoice = money.invoices.find((i) => i.status === "sent") ?? money.invoices.find((i) => i.status === "draft");

  const statusIdx = PROJECT_STATUSES.findIndex((s) => s.key === project.status);
  const nextStatus = PROJECT_STATUSES[statusIdx + 1];

  async function moveToNextStatus() {
    "use server";
    await advanceProjectStatus(slug);
  }

  const m = project.money;

  const overview = (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1fr_300px]">
      {/* Column 1 — pulse + milestones */}
      <div className="flex flex-col gap-3">
        <AiBubble>
          <div className="mb-1 font-serif text-[13.5px] font-semibold text-ai-2">
            Project pulse · synthesized from this week
          </div>
          <div>{project.pulse}</div>
        </AiBubble>

        {project.milestones.length > 0 && (
          <Card className="p-3.5">
            <div className="mb-2 flex items-center">
              <h3 className="flex-1 font-serif text-[16px] font-semibold text-ink">Milestones</h3>
              <ViewTab tab="Schedule" />
            </div>
            <div className="flex flex-col">
              {project.milestones.map((ms, i) => (
                <div
                  key={ms.name}
                  className={`flex items-center gap-2 py-2 ${i ? "border-t border-rule-soft" : ""}`}
                >
                  <span
                    className={[
                      "size-3.5 flex-none rounded-[3px] border",
                      ms.status === "paid"
                        ? "border-accent-2 bg-accent-2"
                        : ms.status === "next"
                          ? "border-accent bg-accent"
                          : "border-ink-4",
                    ].join(" ")}
                  />
                  <span
                    className={`flex-1 text-[13px] ${ms.status === "queued" ? "text-ink-3" : "text-ink"}`}
                  >
                    {ms.name}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3">{ms.date}</span>
                  <span
                    className={[
                      "w-[68px] text-right font-mono text-[12px]",
                      ms.status === "paid"
                        ? "text-money"
                        : ms.status === "next"
                          ? "text-accent-2"
                          : "text-ink-3",
                    ].join(" ")}
                  >
                    {ms.value}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Column 2 — this week + latest log + weekly status */}
      <div className="flex flex-col gap-3">
        {project.thisWeek.length > 0 && (
          <Card className="p-3.5">
            <div className="mb-2 flex items-center">
              <h3 className="flex-1 font-serif text-[16px] font-semibold text-ink">This week · on site</h3>
              <ViewTab tab="Schedule" />
            </div>
            <div className="flex flex-col gap-1.5">
              {project.thisWeek.map((w, i) => (
                <div key={i} className="flex items-center gap-2 py-0.5">
                  <span className="w-7 font-mono text-[11px] text-ink-3">{w.day}</span>
                  <span className={`size-1.5 rounded-full ${DOT[w.dot]}`} />
                  <span className="flex-1 text-[13px] text-ink">{w.label}</span>
                  <span className="font-mono text-[11px] text-ink-3">{w.time}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {project.latestLog && (
          <Card className="p-3.5">
            <div className="flex items-center">
              <h3 className="flex-1 font-serif text-[16px] font-semibold text-ink">
                Latest daily log
              </h3>
              <span className="font-mono text-[11px] text-ink-3">{project.latestLog.date}</span>
              <ViewTab tab="Daily log" />
            </div>
            <p className="mt-2 text-[13px] text-ink-2">{project.latestLog.body}</p>
            <div className="mt-2.5 flex items-center gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="size-12 rounded-[3px] border border-rule bg-paper-3" />
              ))}
              {project.latestLog.photos > 4 && (
                <Chip kind="ghost">+ {project.latestLog.photos - 4} photos</Chip>
              )}
            </div>
          </Card>
        )}

        {(project.weeklyStatus || project.weeklyStatusName) && (
          <Card kind="ai" className="p-3">
            <div className="flex items-start gap-2">
              <Mail className="mt-0.5 size-4 flex-none text-ai-2" strokeWidth={1.5} />
              <div className="flex-1">
                <div className="font-serif text-[13.5px] font-semibold text-ai-2">
                  Weekly status email — drafted
                </div>
                <div className="mt-0.5 text-[11px] text-ai-2">
                  {project.weeklyStatus ? (
                    project.weeklyStatus
                  ) : (
                    <AiStream load={() => getProjectWeeklyStatus(project.weeklyStatusName!)} />
                  )}
                </div>
              </div>
              <WeeklyStatusSend slug={slug} />
            </div>
          </Card>
        )}
      </div>

      {/* Column 3 — right rail */}
      <div className="flex flex-col gap-3">
        <Card className="p-3">
          <div className="flex items-center">
            <Eyebrow muted>Money</Eyebrow>
            <span className="ml-auto">
              <ViewTab tab="Money" section="Invoices" />
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            <Row label="Contract" value={m.contract} />
            <Row label="Paid" value={realMoney ? usd(money.paidTotal) : m.paid} valueClass="text-money" />
            <Row
              label="Next draw"
              value={realMoney ? (nextInvoice ? usd(nextInvoice.amount) : "—") : m.nextDraw}
              valueClass="text-accent-2"
            />
            {realMoney ? (
              <Row label="Outstanding" value={usd(money.outstanding)} />
            ) : (
              <Row label="Open COs" value={m.openCOs} />
            )}
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-paper-3">
            <div className="h-full bg-money" style={{ width: `${m.billedPct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-ink-3">{m.note}</div>
        </Card>

        {project.subs.length > 0 && (
          <Card className="p-3">
            <div className="flex items-center">
              <Eyebrow muted>Subs</Eyebrow>
              <span className="ml-auto">
                <ViewTab tab="Subs" />
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {project.subs.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <Avatar initials={s.initials} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-[13px] font-semibold text-ink">
                      {s.name} · {s.trade}
                    </div>
                    <div className="text-[11px] text-ink-3">{s.coi}</div>
                  </div>
                  <Check className="size-3 flex-none text-money" strokeWidth={2} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {project.files.length > 0 && (
          <Card className="p-3">
            <div className="flex items-center">
              <Eyebrow muted>Files · {project.filesCount}</Eyebrow>
              <span className="ml-auto">
                <ViewTab tab="Files" />
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {project.files.map((f) => (
                <div key={f} className="flex items-center gap-1.5">
                  <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                  <span className="truncate text-[12px] text-ink-2">{f}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
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
  const filesPanel = (
    <ProjectFiles slug={slug} files={projectFiles} showcase={project.files} />
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
    <SelectionsBoard slug={slug} view={selections} catalog={catalogOptions} />
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
  const estimatePanel = (
    <ProjectEstimate
      slug={slug}
      estimates={estimates}
      costItems={costBook.items.filter((i) => !i.archived)}
      defaultMarkup={costBook.defaultMarkup}
      floorplans={floorplans}
      approvalGate={approvalGate}
    />
  );
  const changeOrdersPanel = <ChangeOrders slug={slug} orders={changeOrders} />;
  const purchaseOrdersPanel = (
    <PurchaseOrders slug={slug} orders={purchaseOrders} vendors={vendors} assignedSubs={subsData.assigned} />
  );
  const closeoutPanel = <Closeout slug={slug} view={closeoutView} />;
  const safetyPanel = (
    <Safety slug={slug} orientations={orientations} incidents={<Incidents slug={slug} incidents={incidents} />} />
  );

  // ── Floor / Mood — design-tool tabs (real boards, S5D/S5E) ──────────────────
  const floorPanel = <FloorPlan slug={slug} versions={floorplans} />;
  const moodPanel = <MoodBoard slug={slug} boards={mood} catalog={moodCatalog} />;

  // ── Money — what the job was priced at, what's been billed, what changed.
  //    Paperwork (contracts, change orders, etc.) + e-signing live in their own
  //    top-level Documents tab now — see documentsTab below.
  const moneyTab = (
    <PanelSections
      tab="Money"
      sections={[
        { label: "Estimate", node: estimatePanel },
        { label: "Invoices", node: moneyPanel },
        { label: "Change orders", node: changeOrdersPanel },
        { label: "Purchase orders", node: purchaseOrdersPanel },
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
  const docFocusSections: Record<string, string> = {};
  for (const t of docTemplates) {
    for (const d of docDrafts.filter((x) => x.template_key === t.key)) {
      docFocusSections[`draft-${d.id}`] = t.title;
      if (d.signature_request_id) docFocusSections[`signature-${d.signature_request_id}`] = t.title;
    }
  }
  const documentsTab = (
    <PanelSections
      tab="Documents"
      focusSections={docFocusSections}
      sections={docTemplates.map((t) => ({
        label: t.title,
        node: (
          <DocTypePanel
            slug={slug}
            templateKey={t.key}
            manifest={t}
            drafts={docDrafts.filter((d) => d.template_key === t.key)}
          />
        ),
      }))}
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

  const outlineBtn =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-paper-2";

  const projectAiContext = projectContext(project);

  const headerBand = (
    <div className="border-b border-rule bg-paper-2 px-4 py-4 sm:px-7">
      <Link href="/projects" className="text-[11px] text-ink-3 hover:text-ink-2">
        ← All projects
      </Link>
      <div className="mt-3 flex flex-wrap items-start gap-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {project.statusChips.map((c) => (
              <Chip key={c.label} kind={c.kind} dot={c.dot}>
                {c.label}
              </Chip>
            ))}
          </div>
          <h1 className="mt-1.5 font-serif text-[30px] font-medium leading-none tracking-tight text-accent-2">
            {project.name}{" "}
            <span className="font-serif text-[18px] italic text-accent">
              · {project.contractValue}
            </span>
          </h1>
          <div className="mt-1.5 text-[11px] text-ink-3">{project.subtitle}</div>
        </div>
        {/* Wraps as a group under the title on phones; buttons never squash
            their labels onto two lines. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <TabLink tab="Daily log" className={outlineBtn}>
            <Check className="size-3" strokeWidth={1.75} />
            Log update
          </TabLink>
          <TabLink tab="Money" section="Invoices" className={outlineBtn}>
            <DollarSign className="size-3" strokeWidth={1.75} />
            Send invoice
          </TabLink>
          {nextStatus && (
            <form action={moveToNextStatus}>
              <button
                type="submit"
                className="whitespace-nowrap rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
              >
                Move to {nextStatus.label}
              </button>
            </form>
          )}
        </div>
      </div>
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
      />
    </Shell>
  );
}

function Row({
  label,
  value,
  valueClass = "text-ink-2",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center">
      <span className="flex-1 text-[12px] text-ink-2">{label}</span>
      <span className={`font-mono text-[12px] ${valueClass}`}>{value}</span>
    </div>
  );
}
