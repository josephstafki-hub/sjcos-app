import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow } from "@/components/ui";
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
const day = (iso: string) => iso.slice(0, 10);

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
      <div className="mx-auto max-w-[1120px] px-7 pb-16 pt-6">
        <div className="mb-4">
          <Eyebrow>
            Window {day(window.from)} → {day(window.to)} ({n} days) · {summary.totals.eligible} eligible case{summary.totals.eligible === 1 ? "" : "s"}
          </Eyebrow>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">Measurement</h1>
          <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-ink-3">
            Every rate on this page names its numerator, denominator and window. Failed, corrected, unknown-effect and
            missed-commitment cases stay in the denominator. One-tap approvals are assisted work, not unattended
            completions. Unknown time or cost is shown as unknown, never as zero.
          </p>
          <div className="mt-2 flex gap-2 text-[12px]">
            {[7, 30, 90].map((d) => (
              <a key={d} href={`/engine/measure?days=${d}`} className={`rounded-md border px-2 py-0.5 ${d === n ? "border-accent text-accent-2" : "border-rule text-ink-3"}`}>
                {d} days
              </a>
            ))}
          </div>
        </div>

        <section className="mb-6">
          <Eyebrow>Cases by kind</Eyebrow>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Eligible</th>
                  <th className="py-2 pr-3">Verified</th>
                  <th className="py-2 pr-3">Corrected</th>
                  <th className="py-2 pr-3">Failed</th>
                  <th className="py-2 pr-3">Unknown effect</th>
                  <th className="py-2 pr-3">Missed</th>
                  <th className="py-2 pr-3">Pending</th>
                  <th className="py-2 pr-3">Rate</th>
                  <th className="py-2 pr-3">Unattended / one-tap / assisted</th>
                  <th className="py-2 pr-3">Owner min</th>
                  <th className="py-2 pr-3">Cost</th>
                  <th className="py-2 pr-3">Median latency</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.kinds, summary.totals].map((k) => (
                  <tr key={k.kind} className={`border-b border-rule-soft ${k.kind === "all" ? "font-semibold" : ""}`}>
                    <td className="py-2 pr-3">{k.kind}{k.excluded ? <span className="ml-1 text-[11px] font-normal text-ink-4">(+{k.excluded} excluded)</span> : null}</td>
                    <td className="py-2 pr-3">{k.eligible}</td>
                    <td className="py-2 pr-3">{k.verified_success}</td>
                    <td className="py-2 pr-3">{k.corrected}</td>
                    <td className="py-2 pr-3">{k.failed}</td>
                    <td className="py-2 pr-3">{k.unknown_effect}</td>
                    <td className="py-2 pr-3">{k.missed_commitment}</td>
                    <td className="py-2 pr-3">{k.pending}</td>
                    <td className="py-2 pr-3">
                      {pct(k.verified_rate.value)} <span className="text-[11px] text-ink-4">({k.verified_rate.numerator}/{k.verified_rate.denominator})</span>
                    </td>
                    <td className="py-2 pr-3">{k.unattended} / {k.one_tap} / {k.assisted}</td>
                    <td className="py-2 pr-3">
                      {k.owner_minutes}
                      {k.owner_minutes_unknown ? <span className="text-[11px] text-ink-4"> (+{k.owner_minutes_unknown} unknown)</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      {usd(k.cost_usd)}
                      {k.cost_unknown ? <span className="text-[11px] text-ink-4"> (+{k.cost_unknown} unknown)</span> : null}
                    </td>
                    <td className="py-2 pr-3">{k.latency.median_ms === null ? "—" : `${Math.round(k.latency.median_ms / 1000)}s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-2 flex flex-col gap-0.5 text-[12px] text-ink-3">
            {summary.caveats.map((c) => (
              <li key={c}>· {c}</li>
            ))}
          </ul>
        </section>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card className="px-4 py-3">
            <Eyebrow>Owner touches (recorded)</Eyebrow>
            <div className="mt-1 text-[22px] font-medium text-ink">{summary.owner_touches.touches}</div>
            <div className="text-[12px] text-ink-3">
              {summary.owner_touches.minutes_known} min known · {summary.owner_touches.touches_unknown_seconds} untimed
            </div>
            <ul className="mt-2 text-[12px] text-ink-2">
              {summary.owner_touches.by_kind.map((k) => (
                <li key={k.kind}>{k.kind}: {k.touches} ({k.minutes_known} min{k.unknown ? `, ${k.unknown} untimed` : ""})</li>
              ))}
            </ul>
          </Card>
          <Card className="px-4 py-3">
            <Eyebrow>Baseline from existing records</Eyebrow>
            <div className="mt-1 text-[22px] font-medium text-ink">{baseline.owner_touches_estimated}</div>
            <div className="text-[12px] text-ink-3">estimated touches · {Math.round(baseline.owner_seconds_known / 60)} min measured</div>
            <ul className="mt-2 text-[12px] text-ink-2">
              {baseline.sources.map((s) => (
                <li key={s.source} title={s.what}>{s.source}: {s.touches}</li>
              ))}
            </ul>
            <div className="mt-2 text-[11px] text-ink-4">Derived sources were never timed; this is a touch count over the window, not an automation percentage.</div>
          </Card>
          <Card className="px-4 py-3">
            <Eyebrow>Agent cost (recorded)</Eyebrow>
            <div className="mt-1 text-[22px] font-medium text-ink">{usd(summary.agent_cost.known_total_usd)}</div>
            <div className="text-[12px] text-ink-3">
              panel runs {usd(summary.agent_cost.dev_agent_runs_usd)} ({summary.agent_cost.dev_agent_runs}) · ops runs {usd(summary.agent_cost.agent_runs_usd)} ({summary.agent_cost.agent_runs})
              {summary.agent_cost.agent_usage_usd !== null ? ` · worker ${usd(summary.agent_cost.agent_usage_usd)} (${summary.agent_cost.agent_usage_runs})` : ""}
            </div>
            <div className="mt-2 text-[11px] text-ink-4">{summary.agent_cost.caveat}</div>
          </Card>
        </div>

        <section className="mb-6">
          <Eyebrow>Overhead · {overhead.month}</Eyebrow>
          <Card className="mt-2 px-4 py-3 text-[13px]">
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
            <ul className="mt-2 text-[12px] text-ink-3">
              {overhead.caveats.map((c) => (
                <li key={c}>· {c}</li>
              ))}
            </ul>
            {user.role === "owner" ? (
              <a href="/settings/overhead" className="mt-2 inline-block text-[12px] text-accent-2 underline">Edit subscriptions and charges</a>
            ) : null}
          </Card>
        </section>

        <section className="mb-6">
          <div className="flex items-center justify-between">
            <Eyebrow>Procedure checks · {checks.length} open</Eyebrow>
            {user.role === "owner" ? <MeasureActions /> : null}
          </div>
          <Card className="mt-2 px-4 py-3 text-[13px]">
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
            <div className="mt-2 text-[11px] text-ink-4">Findings are recorded only. Nothing here approves, retires or promotes a skill, memory or policy.</div>
          </Card>
        </section>

        <section>
          <Eyebrow>Pending agent memories · classified ({memories.length})</Eyebrow>
          <Card className="mt-2 px-4 py-3 text-[13px]">
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
            <div className="mt-2 text-[11px] text-ink-4">Labels only. Review and approval stay in /engine; a proposed company rule is not authority until Joe approves it.</div>
          </Card>
        </section>
      </div>
    </Shell>
  );
}
