import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, DollarSign, Sparkles, MoreHorizontal, Mail, FileText } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, AckButton, AiStream, Card, Chip, Avatar, Eyebrow } from "@/components/ui";
import { ProjectTabs } from "@/components/projects/ProjectTabs";
import { PunchList } from "@/components/projects/PunchList";
import { StageSuggest } from "@/components/projects/StageSuggest";
import { MoneyPanel } from "@/components/projects/MoneyPanel";
import { SelectionsBoard } from "@/components/projects/SelectionsBoard";
import { MoodBoard } from "@/components/projects/MoodBoard";
import { FloorPlan } from "@/components/projects/FloorPlan";
import { getProject, getProjectFiles, getProjectSubsData, getProjectDailyLogs, getProjectWeeklyStatus, PROJECT_STATUSES, stageToolTab } from "@/lib/projects";
import { ProjectSubs } from "@/components/projects/ProjectSubs";
import { ProjectDailyLog } from "@/components/projects/ProjectDailyLog";
import { ProjectFiles } from "@/components/projects/ProjectFiles";
import { ProjectComms } from "@/components/projects/ProjectComms";
import { ProjectSchedule } from "@/components/projects/ProjectSchedule";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { getProjectScheduleBlocks } from "@/lib/schedule";
import { getProjectMoney, usd } from "@/lib/money";
import { getProjectSelections } from "@/lib/selections";
import { getProjectMood } from "@/lib/mood";
import { getProjectFloorplans } from "@/lib/floorplans";
import { getCatalogData } from "@/lib/catalog";
import { projectContext } from "@/lib/page-context";
import { advanceProjectStatus } from "@/lib/actions/projects";

const DOT: Record<string, string> = {
  accent: "bg-accent",
  ai: "bg-ai",
  ghost: "bg-ink-4",
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [project, money, selections, mood, floorplans, catalog, projectFiles] = await Promise.all([
    getProject(slug),
    getProjectMoney(slug),
    getProjectSelections(slug),
    getProjectMood(slug),
    getProjectFloorplans(slug),
    getCatalogData(),
    getProjectFiles(slug),
  ]);
  const commsThread = await getPortalThread(portalChannel("client", slug));
  const scheduleBlocks = await getProjectScheduleBlocks(slug);
  const subsData = await getProjectSubsData(slug);
  const dailyLogs = await getProjectDailyLogs(slug);
  if (!project) notFound();

  const catalogOptions = catalog.materials.map((m) => ({ id: m.id, name: m.name }));

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
            <h3 className="mb-2 font-serif text-[16px] font-semibold text-ink">Milestones</h3>
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
            <h3 className="mb-2 font-serif text-[16px] font-semibold text-ink">This week · on site</h3>
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
              <AckButton label="Review" ackLabel="Marked reviewed" />
            </div>
          </Card>
        )}
      </div>

      {/* Column 3 — right rail */}
      <div className="flex flex-col gap-3">
        <Card className="p-3">
          <Eyebrow muted>Money</Eyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            <Row label="Contract" value={m.contract} />
            <Row label="Paid" value={realMoney ? usd(money.paidTotal) : m.paid} valueClass="text-money" />
            <Row
              label="Next draw"
              value={realMoney ? (nextInvoice ? usd(nextInvoice.amount) : "—") : m.nextDraw}
              valueClass="text-accent-2"
            />
            {realMoney ? (
              <Row label="Retainer bal." value={usd(money.retainer.balance)} />
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
            <Eyebrow muted>Subs</Eyebrow>
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
            <Eyebrow muted>Files · {project.filesCount}</Eyebrow>
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
      <ProjectSchedule slug={slug} blocks={scheduleBlocks} />
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

  // ── Subs panel — real project↔sub assignments (assign/remove + contact) ────
  const subsPanel = (
    <ProjectSubs slug={slug} assigned={subsData.assigned} roster={subsData.roster} />
  );

  // ── Files panel — real upload/download scoped to the project ───────────────
  const filesPanel = (
    <ProjectFiles slug={slug} files={projectFiles} showcase={project.files} />
  );

  // ── Money panel — real invoices + retainer (curated draw schedule as a
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
  const dailyLogPanel = <ProjectDailyLog slug={slug} logs={dailyLogs} />;

  // ── Selections panel — real board: catalog/upload images + client approval ──
  const selectionsPanel = (
    <SelectionsBoard slug={slug} selections={selections} catalog={catalogOptions} />
  );

  // ── Comms panel — real owner ⇄ client thread (portal:<slug>) ───────────────
  const commsPanel = <ProjectComms slug={slug} thread={commsThread} />;

  // ── Punch panel — real, interactive punch-list items (add/toggle/remove) ────
  const punchPanel = <PunchList slug={project.slug} items={project.punch} />;

  // ── Floor / Mood — design-tool tabs (real boards, S5D/S5E) ──────────────────
  const floorPanel = <FloorPlan slug={slug} versions={floorplans} />;
  const moodPanel = <MoodBoard slug={slug} rooms={mood} />;

  const panels: Record<string, ReactNode> = {
    Overview: overview,
    Floor: floorPanel,
    Mood: moodPanel,
    Schedule: schedulePanel,
    Selections: selectionsPanel,
    Subs: subsPanel,
    Files: filesPanel,
    Money: moneyPanel,
    "Daily log": dailyLogPanel,
    Comms: commsPanel,
    Punch: punchPanel,
  };

  return (
    <Shell breadcrumb={`PROJECTS › ${project.name.toUpperCase()}`} aiContext={projectContext(project)}>
      {/* Header band */}
      <div className="border-b border-rule bg-paper-2 px-7 py-4">
        <Link href="/projects" className="text-[11px] text-ink-3 hover:text-ink-2">
          ← All projects
        </Link>
        <div className="mt-2 flex flex-wrap items-start gap-3.5">
          <div className="size-12 flex-none rounded border-[1.5px] border-accent bg-accent-soft" />
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
          <div className="flex items-center gap-1.5">
            <AckButton variant="outline" icon={<Check className="size-3" strokeWidth={1.75} />} label="Log update" ackLabel="Update logged" />
            <AckButton
              variant="outline"
              icon={<DollarSign className="size-3" strokeWidth={1.75} />}
              label="Send invoice"
              ackLabel="Invoice queued"
            />
            <Link
              href="/ai"
              className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-ai-2"
            >
              <Sparkles className="size-3" strokeWidth={1.5} />
              Ask
            </Link>
            {nextStatus && (
              <>
                <StageSuggest slug={slug} />
                <form action={moveToNextStatus}>
                  <button
                    type="submit"
                    className="rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
                  >
                    Move to {nextStatus.label}
                  </button>
                </form>
              </>
            )}
            <AckButton
              variant="outline"
              className="px-1.5 text-ink-3"
              icon={<MoreHorizontal className="size-3.5" strokeWidth={1.5} />}
              label=""
              ackLabel="Noted"
            />
          </div>
        </div>
      </div>

      <ProjectTabs panels={panels} stageTab={stageToolTab(project.status)} />
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
