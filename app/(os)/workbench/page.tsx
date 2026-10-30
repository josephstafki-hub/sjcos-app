import Link from "next/link";
import { ScanSearch } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { WorkbenchLive } from "@/components/panel/WorkbenchLive";
import { requireAccess } from "@/lib/dal";
import { STATUS_LABEL } from "@/lib/engine-constants";
import type { WorkItemStatus } from "@/lib/types";
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
  searchParams: Promise<{ s?: string; q?: string; page?: string }>;
}) {
  const { s, q = "", page } = await searchParams;
  const currentPage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page) || 1)) : 1;
  const offset = (currentPage - 1) * 30;
  const user = await requireAccess("today");
  // With nothing picked, offer the to-dos that moved most recently (the owner's
  // view only — staff to-dos are per account and live on their own Today).
  const recent = s || user.role !== "owner" ? [] : (await query<{ id: string; title: string; status: string; updated: string; job: string | null }>(
    `SELECT w.id, w.title, w.status, COALESCE(p.name, l.name) AS job, to_char(w.updated_at AT TIME ZONE 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') AS updated
       FROM work_items w
       LEFT JOIN projects p ON p.id = w.project_id
       LEFT JOIN leads l ON l.id = w.lead_id
      WHERE w.archived_at IS NULL AND w.status NOT IN ('done','cancelled')
        AND ($1 = '' OR w.title ILIKE $2 OR w.body ILIKE $2 OR p.name ILIKE $2 OR l.name ILIKE $2)
      ORDER BY w.updated_at DESC, w.id LIMIT 31 OFFSET $3`,
    [q.trim(), `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`, offset],
  )).rows;

  return (
    <Shell breadcrumb="WORKBENCH">
      <div className="mx-auto max-w-[860px] px-4 py-6 @3xl/page:px-7">
        {s ? (
          <><Button href="/workbench" variant="secondary" className="mb-4">All open to-dos</Button><WorkbenchLive subjectId={s} /></>
        ) : (
          <>
            <PageHeader title="Workbench" meta="Everything an agent or you is working on for one to-do, live." />
            {user.role === "owner" && <form action="/workbench" className="mt-4 flex gap-2">
              <input type="search" name="q" defaultValue={q} aria-label="Search all open to-dos" placeholder="Search all open to-dos…" className="min-w-0 flex-1 rounded-md border border-rule bg-card px-3 py-2 text-body" />
              <Button type="submit" variant="secondary">Search</Button>
            </form>}
            {recent.length > 0 ? (
              <section className="mt-6">
                <h2 className="text-subheading font-semibold text-ink">All open to-dos</h2>
                <ul className="mt-2 divide-y divide-rule-soft border-y border-rule">
                  {recent.slice(0, 30).map((w) => (
                    <li key={w.id}>
                      <Link href={`/workbench?s=${w.id}`} className="flex min-h-11 items-center gap-3 py-2.5 hover:bg-hover">
                        <span className="min-w-0 flex-1 text-body text-ink">{w.title}<span className="mt-1 block text-meta text-ink-3">{w.job ? `${w.job} · ` : ""}{STATUS_LABEL[w.status as WorkItemStatus] ?? w.status.replaceAll("_", " ")}</span></span>
                        <span className="flex-none text-meta text-ink-3">{w.updated}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <nav aria-label="To-do pages" className="mt-3 flex gap-3">
                  {currentPage > 1 && <Button href={`/workbench?q=${encodeURIComponent(q)}&page=${currentPage - 1}`} variant="secondary">Previous</Button>}
                  {recent.length > 30 && <Button href={`/workbench?q=${encodeURIComponent(q)}&page=${currentPage + 1}`} variant="secondary">Next</Button>}
                </nav>
                <p className="mt-3 text-meta text-ink-3">
                  View on a queue card in the operator panel opens its to-do here too, and the workbench follows an agent you hand an item to.
                </p>
              </section>
            ) : (
              <EmptyState
                icon={ScanSearch}
                title={q ? "No matching open to-dos" : "Nothing to inspect yet"}
                description="Use View on a queue card in the operator panel, or hand a to-do to an agent; the workbench follows it here."
                action={user.role === "owner" ? { children: "All open to-dos", href: "/workbench" } : { children: "Open Today", href: "/today" }}
              />
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
