import { Shell } from "@/components/shell/Shell";
import { PageHeader, KpiTile } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { runDirect } from "@/lib/commands/db";
import { timeReview } from "@/lib/owner-time/server";
import { fromBusinessInput } from "@/lib/business-time";
import { TimeReview } from "@/components/time/TimeReview";

export const dynamic = "force-dynamic";

/** Owner job-time review (A19, OWNER_TIME_TRACKING.md "Review"): daily/weekly
 *  list with site/office totals, flags (overlap, long, missing clock-out,
 *  inferred, review, no project), keep/adjust/discard on uncertain intervals,
 *  a manual timer for work outside instrumented tools. Corrections keep their
 *  audit history; nothing here bills a client or books payroll. */
export default async function TimePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireRole("owner");
  const sp = await searchParams;
  const boundary = (value?: string) => {
    if (!value) return null;
    try { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? fromBusinessInput(`${value}T00:00`) : /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; } catch { return null; }
  };
  const to = boundary(sp.to) ?? new Date().toISOString();
  const from = boundary(sp.from) ?? new Date(Date.parse(to) - 7 * 86400_000).toISOString();
  const [review, projects, rates] = await Promise.all([
    timeReview(user.id, from, to),
    runDirect<{ id: string; name: string; slug: string }>(`SELECT id, name, slug FROM projects ORDER BY name`),
    runDirect<{ category: string; rate_cents: number; effective_from: string }>(`SELECT category, rate_cents::int AS rate_cents, effective_from::text AS effective_from FROM owner_labor_rates ORDER BY category, effective_from DESC`).catch(() => []),
  ]);
  const hours = (h: number) => h.toFixed(1); // reviewRange totals are already hours
  return (
    <Shell breadcrumb="TIME">
      <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-6 @3xl/page:px-5 @5xl/page:px-8">
        <PageHeader title="Job time" meta="Confirmed work, recorded hours and corrections · all times Central" />
        <div className="mt-6 grid grid-cols-2 gap-3 @3xl/page:grid-cols-4">
          <KpiTile label="Site" value={`${hours(review.totals.site)} h`} />
          <KpiTile label="Office" value={`${hours(review.totals.office)} h`} />
          <KpiTile label="Overhead" value={`${hours(review.totals.overhead)} h`} />
          <KpiTile label="Review flags" value={review.flags.length} tone={review.flags.length ? "warn" : "default"} />
        </div>
        <form className="mt-6 flex flex-wrap items-end gap-3">
          <label className="text-label text-ink-2">From · Central<input name="from" type="date" defaultValue={new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago"}).format(new Date(from))} className="mt-1.5 block h-9 max-w-full rounded-md border border-rule bg-card px-3 text-body" /></label>
          <label className="text-label text-ink-2">Until · Central<input name="to" type="date" defaultValue={new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago"}).format(new Date(to))} className="mt-1.5 block h-9 max-w-full rounded-md border border-rule bg-card px-3 text-body" /></label>
          <button type="submit" className="h-9 rounded-md border border-rule bg-card px-3 text-body font-semibold hover:bg-hover">Apply dates</button>
        </form>
        <p className="mt-3 text-meta text-ink-3">Overlaps count once. Unconfirmed time stays out of verified job cost until reviewed. These hours do not bill clients or create payroll.</p>
        <TimeReview review={review} projects={projects} rates={rates} from={from} to={to} />
      </div>
    </Shell>
  );
}
