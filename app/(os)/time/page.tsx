import { Shell } from "@/components/shell/Shell";
import { Button, PageHeader, KpiTile } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { runDirect } from "@/lib/commands/db";
import { timeReview } from "@/lib/owner-time/server";
import { businessReviewRange } from "@/lib/business-time";
import { durationLabel } from "@/lib/owner-time/labels";
import { TimeReview } from "@/components/time/TimeReview";

export const dynamic = "force-dynamic";

/** Owner job-time review (A19, OWNER_TIME_TRACKING.md "Review"): daily/weekly
 *  list with site/office totals, flags (overlap, long, missing clock-out,
 *  inferred, review, no project), keep/adjust/discard on uncertain intervals,
 *  a manual timer for work outside instrumented tools. Corrections keep their
 *  audit history; nothing here bills a client or books payroll. */
export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireRole("owner");
  const sp = await searchParams;
  const { from, to, error } = businessReviewRange(sp);
  const [review, projects, rates] = await Promise.all([
    timeReview(user.id, from, to),
    runDirect<{ id: string; name: string; slug: string }>(
      `SELECT id, name, slug FROM projects ORDER BY name`,
    ),
    runDirect<{ category: string; rate_cents: number; effective_from: string }>(
      `SELECT category, rate_cents::int AS rate_cents, effective_from::text AS effective_from FROM owner_labor_rates ORDER BY category, effective_from DESC`,
    ).catch(() => []),
  ]);
  const hours = (h: number) => durationLabel(h * 3600_000); // totals arrive in hours
  return (
    <Shell breadcrumb="TIME">
      <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-6 @3xl/page:px-5 @5xl/page:px-8">
        <PageHeader
          title="Job time"
          meta="Confirmed work, recorded hours and corrections · all times Central"
        />
        <TimeReview
          review={review}
          projects={projects}
          rates={rates}
          from={from}
          to={to}
        >
        <div className="mt-6 grid grid-cols-2 gap-3 @xl/page:grid-cols-4">
          <KpiTile label="Site" value={hours(review.totals.site)} />
          <KpiTile label="Office" value={hours(review.totals.office)} />
          <KpiTile
            label="Overhead"
            value={hours(review.totals.overhead)}
          />
          <KpiTile
            label="Review flags"
            value={review.flags.length}
            tone={review.flags.length ? "warn" : "default"}
          />
        </div>
        <form className="mt-6 flex flex-wrap items-end gap-3">
          <label className="text-label text-ink-2">
            From · Central
            <input
              name="from"
              type="date"
              defaultValue={new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Chicago",
              }).format(new Date(from))}
              className="mt-1.5 block h-9 max-w-full rounded-md border border-rule bg-card px-3 text-body"
            />
          </label>
          <label className="text-label text-ink-2">
            Through · Central
            <input
              name="to"
              type="date"
              defaultValue={new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Chicago",
              }).format(new Date(Date.parse(to) - 1))}
              className="mt-1.5 block h-9 max-w-full rounded-md border border-rule bg-card px-3 text-body"
            />
          </label>
          <Button type="submit" variant="secondary">
            Apply dates
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-meta text-flag">
            {error} Showing the last seven days.
          </p>
        )}
        <p className="mt-3 text-meta text-ink-3">
          Overlaps count once. Unconfirmed time stays out of verified job cost
          until reviewed. These hours do not bill clients or create payroll.
        </p>
        </TimeReview>
      </div>
    </Shell>
  );
}
