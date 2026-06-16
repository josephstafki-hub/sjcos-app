import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, MessageSquare, Sparkles, Check } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, Avatar, Card, Chip, Eyebrow, Field } from "@/components/ui";
import { SubTabs } from "@/components/subs/SubTabs";
import { getSub } from "@/lib/subs";
import type { JobDot } from "@/lib/subs";

const DOT: Record<JobDot, string> = {
  accent: "bg-accent",
  money: "bg-money",
  ghost: "bg-ink-4",
};

export default async function SubDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sub = await getSub(slug);
  if (!sub) notFound();

  const overview = (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1fr_320px]">
      {/* Reliability + AI summary */}
      <Card className="p-3.5">
        <h3 className="mb-2.5 font-serif text-[15px] font-semibold text-ink">
          Reliability · {sub.jobsCount} jobs
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {sub.reliability.map((r) => (
            <Field key={r.label} label={r.label} value={r.value} />
          ))}
        </div>
        <div className="my-3 border-t border-dashed border-rule" />
        <Eyebrow muted>AI summary</Eyebrow>
        <AiBubble className="mt-1.5">{sub.aiSummary}</AiBubble>
      </Card>

      {/* Recent jobs */}
      <Card className="p-3.5">
        <h3 className="mb-2 font-serif text-[15px] font-semibold text-ink">Recent jobs</h3>
        {sub.recentJobs.length > 0 ? (
          <div className="flex flex-col">
            {sub.recentJobs.map((j, i) => (
              <div
                key={j.name}
                className={`flex items-center gap-2 py-1.5 ${i ? "border-t border-rule-soft" : ""}`}
              >
                <span className={`size-2 flex-none rounded-full ${DOT[j.dot]}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-[13.5px] font-semibold text-ink">
                    {j.name}
                  </div>
                  <div className="text-[11px] text-ink-3">{j.detail}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-ink-3">No recent jobs logged yet.</div>
        )}
      </Card>

      {/* Sidebar: paperwork, rate, tax */}
      <div className="flex flex-col gap-3">
        <Card className="p-3">
          <Eyebrow muted>Paperwork</Eyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            {sub.paperwork.map((p) => (
              <div key={p.label} className="flex items-center gap-2">
                <Check
                  className={`size-3 flex-none ${p.ok ? "text-money" : "text-ink-4"}`}
                  strokeWidth={2}
                />
                <span className="flex-1 text-[12px] text-ink-2">{p.label}</span>
                <span className={`font-mono text-[10px] ${p.ok ? "text-ink-3" : "text-ink-4"}`}>
                  {p.value}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-3">
          <Eyebrow muted>Rate</Eyebrow>
          <div className="mt-1 font-serif text-[26px] font-semibold leading-none text-ink">
            {sub.rate.amount}
            {sub.rate.unit && <span className="text-[14px] text-ink-3">{sub.rate.unit}</span>}
          </div>
          {sub.rate.note && <div className="mt-1.5 text-[11px] text-ink-3">{sub.rate.note}</div>}
        </Card>

        <Card kind="ai" className="p-2.5">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-3 flex-none text-ai-2" strokeWidth={1.5} />
            <span className="text-[11px] leading-snug text-ai-2">{sub.taxNote}</span>
          </div>
        </Card>
      </div>
    </div>
  );

  // ── Jobs panel — full recent-jobs history ──────────────────────────────────
  const jobsPanel =
    sub.recentJobs.length > 0 ? (
      <Card className="max-w-[680px] overflow-hidden p-0">
        <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          {sub.jobsCount} jobs with SJ Carpentry
        </div>
        {sub.recentJobs.map((j, i) => (
          <div
            key={j.name}
            className={`flex items-center gap-2.5 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}
          >
            <span className={`size-2 flex-none rounded-full ${DOT[j.dot]}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-serif text-[13.5px] font-semibold text-ink">{j.name}</div>
              <div className="text-[11px] text-ink-3">{j.detail}</div>
            </div>
          </div>
        ))}
      </Card>
    ) : (
      <Card kind="dashed" className="p-8 text-center">
        <div className="font-serif text-[16px] font-semibold text-ink-2">No jobs yet</div>
        <div className="mt-1 text-[12px] text-ink-3">Assign this sub to a job to start their history.</div>
      </Card>
    );

  // ── Paperwork panel — compliance checklist ─────────────────────────────────
  const paperworkPanel = (
    <Card className="max-w-[520px] p-3.5">
      <Eyebrow muted>Paperwork on file</Eyebrow>
      <div className="mt-2.5 flex flex-col gap-2">
        {sub.paperwork.map((p) => (
          <div key={p.label} className="flex items-center gap-2 border-t border-rule-soft pt-2 first:border-t-0 first:pt-0">
            <Check className={`size-3.5 flex-none ${p.ok ? "text-money" : "text-ink-4"}`} strokeWidth={2} />
            <span className="flex-1 text-[13px] text-ink">{p.label}</span>
            <span className={`font-mono text-[11px] ${p.ok ? "text-ink-3" : "text-flag"}`}>
              {p.ok ? p.value : `${p.value} · needed`}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );

  // ── Pricing panel — rate card + 1099 note ──────────────────────────────────
  const pricingPanel = (
    <div className="grid max-w-[680px] grid-cols-1 gap-3.5 sm:grid-cols-2">
      <Card className="p-3.5">
        <Eyebrow muted>Rate</Eyebrow>
        <div className="mt-1 font-serif text-[30px] font-semibold leading-none text-ink">
          {sub.rate.amount}
          {sub.rate.unit && <span className="text-[15px] text-ink-3">{sub.rate.unit}</span>}
        </div>
        {sub.rate.note && <div className="mt-2 text-[12px] text-ink-3">{sub.rate.note}</div>}
      </Card>
      <Card kind="ai" className="p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-3.5 flex-none text-ai-2" strokeWidth={1.5} />
          <span className="text-[12px] leading-snug text-ai-2">{sub.taxNote}</span>
        </div>
      </Card>
    </div>
  );

  // ── Notes panel — what Claude knows ────────────────────────────────────────
  const notesPanel = (
    <div className="max-w-[680px]">
      <Eyebrow muted>AI summary</Eyebrow>
      <AiBubble className="mt-1.5">{sub.aiSummary}</AiBubble>
    </div>
  );

  const panels: Record<string, ReactNode> = {
    Overview: overview,
    Jobs: jobsPanel,
    Paperwork: paperworkPanel,
    Pricing: pricingPanel,
    Notes: notesPanel,
  };

  return (
    <Shell breadcrumb={`SUBS › ${sub.name.toUpperCase()}`}>
      <div className="mx-auto max-w-[1100px] px-7 pb-14 pt-6">
        <Link href="/subs" className="text-[11px] text-ink-3 hover:text-ink-2">
          ← All subs
        </Link>

        {/* Header */}
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <Avatar initials={sub.initials} kind="accent" size="lg" className="size-14 text-[18px]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {sub.working && (
                <Chip kind="accent" dot>
                  Working this wk
                </Chip>
              )}
              {sub.coiStatus === "expiring" ? (
                <Chip kind="flag" dot>
                  COI expires {sub.coiLabel}
                </Chip>
              ) : (
                <Chip kind="money">COI · {sub.coiLabel}</Chip>
              )}
              <Chip kind="money">W-9 · {sub.w9}</Chip>
            </div>
            <h1 className="mt-1.5 font-serif text-[30px] font-medium leading-none tracking-tight text-accent-2">
              {sub.name} <span className="text-accent">· {sub.tradeLine}</span>
            </h1>
            <div className="mt-1.5 text-[11px] text-ink-3">{sub.contact}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {sub.phone ? (
              <a
                href={`tel:${sub.phone.replace(/[^\d+]/g, "")}`}
                className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-paper-2"
              >
                <Phone className="size-3" strokeWidth={1.5} />
                Call
              </a>
            ) : (
              <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-4">
                <Phone className="size-3" strokeWidth={1.5} />
                Call
              </span>
            )}
            <Link
              href="/chat"
              className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-paper-2"
            >
              <MessageSquare className="size-3" strokeWidth={1.5} />
              Chat
            </Link>
            <button className="rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]">
              Assign to job
            </button>
          </div>
        </div>

        <SubTabs panels={panels} jobsCount={sub.jobsCount} />
      </div>
    </Shell>
  );
}
