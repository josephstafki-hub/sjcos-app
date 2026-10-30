import Link from "next/link";
import { ScanSearch } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { EmptyState, PageHeader } from "@/components/ui";
import { WorkbenchLive } from "@/components/panel/WorkbenchLive";
import { requireAccess } from "@/lib/dal";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The operator console's live workbench as a full page. `?s=<subject>` is a
 *  work_items uuid or a synthetic ref ("lead:slug" / "job:slug" /
 *  "warranty:id") — the same ids the queue and agent runs carry. The panel's
 *  Inspect chips and run auto-navigation point here; it behaves like any other
 *  app page, so it shows in the app view or a second window for free. */
export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const { s } = await searchParams;
  const user = await requireAccess("today");
  // With nothing picked, offer the to-dos that moved most recently (the owner's
  // view only — staff to-dos are per account and live on their own Today).
  const recent = s || user.role !== "owner" ? [] : (await query<{ id: string; title: string; status: string; updated: string }>(
    `SELECT id, title, status, to_char(updated_at AT TIME ZONE 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') AS updated
       FROM work_items
      WHERE archived_at IS NULL AND status NOT IN ('done','cancelled')
      ORDER BY updated_at DESC LIMIT 8`,
  ).catch(() => ({ rows: [] }))).rows;

  return (
    <Shell breadcrumb="WORKBENCH">
      <div className="mx-auto max-w-[860px] px-4 py-6 sm:px-7">
        {s ? (
          <WorkbenchLive subjectId={s} />
        ) : (
          <>
            <PageHeader title="Workbench" meta="Everything an agent or you is working on for one to-do, live." />
            {recent.length > 0 ? (
              <section className="mt-6">
                <h2 className="text-subheading font-semibold text-ink">Open one</h2>
                <ul className="mt-2 divide-y divide-rule-soft border-y border-rule">
                  {recent.map((w) => (
                    <li key={w.id}>
                      <Link href={`/workbench?s=${w.id}`} className="flex min-h-11 items-center gap-3 py-2.5 hover:bg-hover">
                        <span className="min-w-0 flex-1 truncate text-body text-ink">{w.title}</span>
                        <span className="flex-none text-meta text-ink-3">{w.updated}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-meta text-ink-3">
                  View on a queue card in the operator panel opens its to-do here too, and the workbench follows an agent you hand an item to.
                </p>
              </section>
            ) : (
              <EmptyState
                icon={ScanSearch}
                title="Nothing to inspect yet"
                description="Use View on a queue card in the operator panel, or hand a to-do to an agent; the workbench follows it here."
                action={{ children: "Open Today", href: "/today" }}
              />
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
