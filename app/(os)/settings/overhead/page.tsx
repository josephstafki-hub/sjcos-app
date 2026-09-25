import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { listSubscriptions, listMeteredCharges, overheadSummary, reconcileWithExpenses, getAlertThreshold } from "@/lib/overhead/overhead";
import { poolRun } from "@/lib/measure/server";
import { OverheadEditor } from "@/app/(os)/settings/overhead/OverheadEditor";

export const dynamic = "force-dynamic";

/** Owner-only overhead editor: fixed subscriptions, metered charges, the
 *  notify-only threshold and the reconciliation proposal (external_ref only). */
export default async function OverheadSettingsPage() {
  await requireRole("owner");
  const [subs, charges, summary, reconcile, threshold] = await Promise.all([
    listSubscriptions(poolRun, { includeEnded: true }),
    listMeteredCharges(poolRun, { limit: 120 }),
    overheadSummary(poolRun),
    reconcileWithExpenses(poolRun),
    getAlertThreshold(poolRun),
  ]);

  return (
    <Shell breadcrumb="SETTINGS · OVERHEAD">
      <div className="mx-auto max-w-[1000px] px-7 pb-16 pt-6">
        <div className="mb-4">
          <Eyebrow>
            {summary.month} · fixed ${(summary.fixed.monthly_cents / 100).toFixed(2)}/mo · metered ${(summary.metered.cents / 100).toFixed(2)}
          </Eyebrow>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">AI and services overhead</h1>
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-3">
            Fixed subscriptions and metered API charges are kept apart — a subscription does not include API
            credits. Owner-reported lines stay flagged until they are reconciled to a bill or QuickBooks by
            external reference; nothing is matched on amount. The threshold only raises a notification.
          </p>
        </div>
        <OverheadEditor subs={subs} charges={charges} summary={summary} reconcile={reconcile} thresholdCents={threshold} />
      </div>
    </Shell>
  );
}
