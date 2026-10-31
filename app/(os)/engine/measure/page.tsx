import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow, KpiTile, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/dal";
import { measurementSummary } from "@/lib/measure/cases";
import { baselineOwnerTouches } from "@/lib/measure/baseline";
import { listOpenChecks, classifyPendingMemories } from "@/lib/measure/procedures";
import { MEMORY_CLASS_LABEL } from "@/lib/measure/learning";
import { overheadSummary } from "@/lib/overhead/overhead";
import { poolRun, defaultWindow } from "@/lib/measure/server";
import { MeasureActions } from "@/app/(os)/engine/measure/MeasureActions";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(2)}`;
const cents = (c: number) => `$${(c / 100).toFixed(2)}`;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
const human = (value: string) => ({ owner_grants: "Send permissions", work_items: "To-do approvals", owner_touches: "Recorded owner touches", notifications: "Decision notices", decisions: "Decisions", all: "All cases" } as Record<string, string>)[value] ?? value.replaceAll("_", " ");

/** Measurement — honest counts with explicit denominators and observation
 *  window, owner minutes, agent cost, overhead and open procedure checks. */
export default async function MeasurePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireAccess("engine");
  const { days } = await searchParams;
  const n = Math.min(365, Math.max(1, Number(days) || 30));
  const window = defaultWindow(n);
  const [summary, baseline, checks, overhead, memories] = await Promise.all([
    measurementSummary(poolRun, window),
    baselineOwnerTouches(poolRun, window),
    listOpenChecks(poolRun),
    overheadSummary(poolRun),
    classifyPendingMemories(poolRun, 40),
  ]);

  return (
    <Shell breadcrumb="OPERATIONS ENGINE · MEASUREMENT">
      <div className="mx-auto max-w-6xl px-4 @3xl/page:px-6 pb-16 pt-6">
        <div className="mb-4">
          <PageHeader title={<> Measurement </>} meta={<> Window {day(window.from)} → {day(window.to)} ({n} days) · {summary.totals.eligible} eligible case{summary.totals.eligible === 1 ? "" : "s"} </>} />
          <div className="mt-2 flex gap-2 text-meta">
            {[7, 30, 90].map((d) => (
              <a key={d} href={`/engine/measure?days=${d}`} className={`rounded-md border px-2 py-0.5 ${d === n ? "border-accent text-accent-2" : "border-rule text-ink-3"}`}>
                {d} days
              </a>
            ))}
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3 @3xl/page:grid-cols-3">
          <KpiTile label="Recorded agent cost" value={usd(summary.agent_cost.known_total_usd)} meta="Known charges in this window" />
          <KpiTile label="Owner touches" value={summary.owner_touches.touches} meta={`${summary.owner_touches.minutes_known} minutes measured`} />
          <KpiTile label="Eligible cases" value={summary.totals.eligible} meta={`${summary.totals.verified_success} verified successful`} />
        </div>
        <p className="mb-5 text-body text-ink-2" role="status">
          Unknown data: {summary.agent_cost.dev_agent_runs_unknown_cost + summary.agent_cost.agent_runs_unknown_cost + (summary.agent_cost.agent_usage_unknown_cost ?? 0)} runs with unrecorded cost · {summary.owner_touches.touches_unknown_seconds} untimed owner touches.
          {summary.agent_cost.agent_usage_runs === null ? " Worker cost records are unavailable." : ""}
          {summary.totals.eligible === 0 ? " No eligible cases recorded; success rates are not known yet." : ""}
        </p>
        <details className="mb-6 rounded-lg border border-rule-soft px-4 py-3">
          <summary className="cursor-pointer text-body font-semibold text-ink">Methodology, definitions and case detail</summary>
          <p className="mt-2 max-w-[680px] text-body leading-relaxed text-ink-3">
            Every rate on this page names its numerator, denominator and window. Failed, corrected, unknown-effect and
            missed-commitment cases stay in the denominator. One-tap approvals are assisted work, not unattended
            completions. Unknown time or cost is shown as unknown, never as zero.
          </p>
          <p className="my-3 text-meta text-ink-3">On narrow screens, scroll each table horizontally to see all outcomes and effort columns.</p>
        <section className="mb-6">
          <Eyebrow muted>Cases by kind</Eyebrow>
          {/* Two narrower tables (outcomes, then effort) so nothing clips beside the dock. */}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-body tabular-nums">
              <thead>
                <tr className="border-b border-rule text-left text-meta text-ink-3">
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3 text-right">Eligible</th>
                  <th className="py-2 pr-3 text-right">Verified</th>
                  <th className="py-2 pr-3 text-right">Corrected</th>
                  <th className="py-2 pr-3 text-right">Failed</th>
                  <th className="py-2 pr-3 text-right">Unknown</th>
                  <th className="py-2 pr-3 text-right">Missed</th>
                  <th className="py-2 pr-3 text-right">Pending</th>
                  <th className="py-2 text-right">Verified rate</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.kinds, summary.totals].map((k) => (
                  <tr key={human(k.kind)} className={`border-b border-rule-soft ${k.kind === "all" ? "font-semibold" : ""}`}>
                    <td className="py-2 pr-3">{human(k.kind)}{k.excluded ? <span className="ml-1 text-meta font-normal text-ink-3">(+{k.excluded} excluded)</span> : null}</td>
                    <td className="py-2 pr-3 text-right">{k.eligible}</td>
                    <td className="py-2 pr-3 text-right">{k.verified_success}</td>
                    <td className="py-2 pr-3 text-right">{k.corrected}</td>
                    <td className="py-2 pr-3 text-right">{k.failed}</td>
                    <td className="py-2 pr-3 text-right">{k.unknown_effect}</td>
                    <td className="py-2 pr-3 text-right">{k.missed_commitment}</td>
                    <td className="py-2 pr-3 text-right">{k.pending}</td>
                    <td className="py-2 text-right">
                      {pct(k.verified_rate.value)} <span className="text-meta text-ink-3">({k.verified_rate.numerator}/{k.verified_rate.denominator})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-body tabular-nums">
              <thead>
                <tr className="border-b border-rule text-left text-meta text-ink-3">
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3 text-right">Unattended / one-tap / assisted</th>
                  <th className="py-2 pr-3 text-right">Owner minutes</th>
                  <th className="py-2 pr-3 text-right">Cost</th>
                  <th className="py-2 text-right">Median latency</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.kinds, summary.totals].map((k) => (
                  <tr key={human(k.kind)} className={`border-b border-rule-soft ${k.kind === "all" ? "font-semibold" : ""}`}>
                    <td className="py-2 pr-3">{human(k.kind)}</td>
                    <td className="py-2 pr-3 text-right">{k.unattended} / {k.one_tap} / {k.assisted}</td>
                    <td className="py-2 pr-3 text-right">
                      {k.owner_minutes}
                      {k.owner_minutes_unknown ? <span className="text-meta text-ink-3"> (+{k.owner_minutes_unknown} unknown)</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {usd(k.cost_usd)}
                      {k.cost_unknown ? <span className="text-meta text-ink-3"> (+{k.cost_unknown} unknown)</span> : null}
                    </td>
                    <td className="py-2 text-right">{k.latency.median_ms === null ? "—" : `${Math.round(k.latency.median_ms / 1000)}s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-2 flex flex-col gap-0.5 text-meta text-ink-3">
            <li>Cases are included from {day(window.from)} until {day(window.to)}; the end of the window is exclusive.</li>
            <li>Verified rate is successful cases divided by terminal cases. Pending cases are eligible but stay out of rates until resolved.</li>
            <li>Failed, corrected, unknown and missed terminal cases stay in the rate denominator. Unrecorded time and cost stay unknown.</li>
            <li>{summary.totals.owner_minutes_unknown} cases have unrecorded owner time; {summary.totals.cost_unknown} have unrecorded cost. Known totals are lower bounds.</li>
          </ul>
        </section>

        <div className="mb-6 grid gap-4 @3xl/page:grid-cols-3">
          <Card className="px-4 py-3">
            <Eyebrow muted>Owner touches (recorded)</Eyebrow>
            <div className="mt-1 text-title font-medium text-ink">{summary.owner_touches.touches}</div>
            <div className="text-meta text-ink-3">
              {summary.owner_touches.minutes_known} min known · {summary.owner_touches.touches_unknown_seconds} untimed
            </div>
            <ul className="mt-2 text-meta text-ink-2">
              {summary.owner_touches.by_kind.map((k) => (
                <li key={human(k.kind)}>{human(k.kind)}: {k.touches} ({k.minutes_known} min{k.unknown ? `, ${k.unknown} untimed` : ""})</li>
              ))}
            </ul>
          </Card>
          <Card className="px-4 py-3">
            <Eyebrow muted>Baseline from existing records</Eyebrow>
            <div className="mt-1 text-title font-medium text-ink">{baseline.owner_touches_estimated}</div>
            <div className="text-meta text-ink-3">estimated touches · {Math.round(baseline.owner_seconds_known / 60)} min measured</div>
            <ul className="mt-2 text-meta text-ink-2">
              {baseline.sources.map((s) => (
                <li key={s.source} >{human(s.source)}: {s.touches}</li>
              ))}
            </ul>
            <div className="mt-2 text-meta text-ink-3">Derived sources were never timed; this is a touch count over the window, not an automation percentage.</div>
            <div className="mt-2 text-meta text-ink-3">A permission, decision and to-do approval can describe the same action, so estimated touches may overlap. Decision-notice reads are excluded.</div>
          </Card>
          <Card className="px-4 py-3">
            <Eyebrow muted>Agent cost (recorded)</Eyebrow>
            <div className="mt-1 text-title font-medium text-ink">{usd(summary.agent_cost.known_total_usd)}</div>
            <div className="text-meta text-ink-3">
              panel runs {usd(summary.agent_cost.dev_agent_runs_usd)} ({summary.agent_cost.dev_agent_runs}) · ops runs {usd(summary.agent_cost.agent_runs_usd)} ({summary.agent_cost.agent_runs})
              {summary.agent_cost.agent_usage_usd !== null ? ` · worker ${usd(summary.agent_cost.agent_usage_usd)} (${summary.agent_cost.agent_usage_runs})` : ""}
            </div>
            <div className="mt-2 text-meta text-ink-3">Known charges are a lower bound; missing costs are not counted as free work.</div>
          </Card>
        </div>

        </details>

        <section className="mb-6">
          <Eyebrow muted>Overhead · {new Date(`${overhead.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" })}</Eyebrow>
          <Card className="mt-2 px-4 py-3 text-body">
            <div className="flex flex-wrap gap-4">
              <div>Fixed subscriptions <strong>{cents(overhead.fixed.monthly_cents)}</strong>/mo</div>
              <div>Metered charges <strong>{cents(overhead.metered.cents)}</strong></div>
              <div>Known total <strong>{cents(overhead.total_known_cents)}</strong></div>
              {overhead.alert.threshold_cents !== null ? (
                <div>
                  Threshold {cents(overhead.alert.threshold_cents)} {overhead.alert.exceeded ? <Chip kind="flag">over — notify only</Chip> : <Chip kind="ghost">under</Chip>}
                </div>
              ) : null}
            </div>
            <ul className="mt-2 text-meta text-ink-3">
              {overhead.caveats.map((c) => (
                <li key={c}>· {c}</li>
              ))}
            </ul>
            {user.role === "owner" ? (
              <a href="/settings/overhead" className="mt-2 inline-block text-meta text-accent-2 underline">Edit subscriptions and charges</a>
            ) : null}
          </Card>
        </section>

        <section className="mb-6">
          <div className="flex items-center justify-between">
            <Eyebrow muted>Procedure checks · {checks.length} open</Eyebrow>
            {user.role === "owner" ? <MeasureActions /> : null}
          </div>
          <Card className="mt-2 px-4 py-3 text-body">
            {checks.length === 0 ? (
              <div className="text-ink-3">No open findings. Run the checks after changing skills, runbooks, policies or the MCP tool list.</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {checks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <Chip kind={c.check_kind === "unapproved_authority_change" ? "flag" : c.check_kind === "contradiction" ? "accent" : "default"}>{c.check_kind.replace(/_/g, " ")}</Chip>
                    <span className="text-ink-2">{c.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 text-meta text-ink-3">Findings are recorded only. Nothing here approves, retires or promotes a skill, memory or policy.</div>
          </Card>
        </section>

        <section>
          <Eyebrow muted>Pending agent memories · classified ({memories.length})</Eyebrow>
          <Card className="mt-2 px-4 py-3 text-body">
            {memories.length === 0 ? (
              <div className="text-ink-3">Nothing pending.</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {memories.map((m) => (
                  <li key={m.id} className="flex gap-2">
                    <Chip kind={m.unapproved_authority_change ? "flag" : m.classification === "proposed_company_rule" ? "accent" : "ghost"}>{MEMORY_CLASS_LABEL[m.classification]}</Chip>
                    <span className="text-ink-2">{m.summary || m.content.slice(0, 120)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 text-meta text-ink-3">Labels only. Review and approval stay in the Engine; a proposed company rule is not authority until Joe approves it.</div>
          </Card>
        </section>
      </div>
    </Shell>
  );
}
