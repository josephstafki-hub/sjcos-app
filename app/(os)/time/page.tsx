import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { runDirect } from "@/lib/commands/db";
import { timeReview } from "@/lib/owner-time/server";
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
  const to = sp.to && Number.isFinite(Date.parse(sp.to)) ? new Date(sp.to).toISOString() : new Date().toISOString();
  const from = sp.from && Number.isFinite(Date.parse(sp.from)) ? new Date(sp.from).toISOString() : new Date(Date.parse(to) - 7 * 86400_000).toISOString();
  const [review, projects, rates] = await Promise.all([
    timeReview(user.id, from, to),
    runDirect<{ id: string; name: string; slug: string }>(`SELECT id, name, slug FROM projects WHERE status NOT IN ('warranty') ORDER BY name`),
    runDirect<{ category: string; rate_cents: number; effective_from: string }>(`SELECT category, rate_cents::int AS rate_cents, effective_from::text AS effective_from FROM owner_labor_rates ORDER BY category, effective_from DESC`).catch(() => []),
  ]);
  const hours = (s: number) => (s / 3600).toFixed(1);
  return (
    <Shell breadcrumb="TIME">
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        <div className="mb-4">
          <Eyebrow>
            site {hours(review.totals.site)} h · office {hours(review.totals.office)} h · overhead {hours(review.totals.overhead)} h · {review.flags.length} to review
          </Eyebrow>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">Job time</h1>
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-3">
            Site clock-ins come from the phone&apos;s job-site prompts you confirmed; office time from real work in the designer.
            Overlaps are counted once. Inferred and review rows stay out of verified job cost until you keep or discard them.
            Hours are valued only by a dated rate you approved; otherwise a job reads &ldquo;cost not configured&rdquo;. Nothing here
            bills a client, creates payroll or posts to QuickBooks.
          </p>
        </div>
        <TimeReview review={review} projects={projects} rates={rates} from={from} to={to} />
      </div>
    </Shell>
  );
}
