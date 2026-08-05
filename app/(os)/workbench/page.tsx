import { Shell } from "@/components/shell/Shell";
import { WorkbenchLive } from "@/components/panel/WorkbenchLive";

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

  return (
    <Shell breadcrumb="WORKBENCH">
      <div className="mx-auto max-w-[860px] px-4 py-6 sm:px-7">
        {s ? (
          <WorkbenchLive subjectId={s} />
        ) : (
          <p className="text-[13px] text-ink-3">
            Nothing to inspect yet — use a queue card&apos;s Inspect chip in the operator
            panel, or hand an item to an agent and the workbench will follow it.
          </p>
        )}
      </div>
    </Shell>
  );
}
