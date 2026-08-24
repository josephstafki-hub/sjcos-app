import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { getEngineData } from "@/lib/engine";
import { getRecentKnowledge } from "@/lib/brain";
import { getSkillsLibrary } from "@/lib/skills";
import { getMemoriesData } from "@/lib/memories";
import { getActiveRunbookInstances } from "@/lib/runbook-engine";
import { EngineClient } from "@/components/engine/EngineClient";

export const dynamic = "force-dynamic";

export default async function EnginePage() {
  // Owner-only: the operations engine coordinates AI runs + approvals.
  await requireRole("owner");

  const [engine, knowledge, skills, memories, activeRunbooks] = await Promise.all([
    getEngineData(),
    getRecentKnowledge(40),
    getSkillsLibrary(),
    getMemoriesData(),
    getActiveRunbookInstances(),
  ]);

  const { counts } = engine;

  return (
    <Shell breadcrumb="OPERATIONS ENGINE">
      <div className="mx-auto max-w-[1120px] px-7 pb-16 pt-6">
        <div className="mb-4">
          <Eyebrow>
            {counts.total} work item{counts.total === 1 ? "" : "s"} · {counts.approval} awaiting approval ·{" "}
            {counts.waiting} waiting · {skills.proposed.length} skill proposal
            {skills.proposed.length === 1 ? "" : "s"} · {memories.pending.length} memor
            {memories.pending.length === 1 ? "y" : "ies"} pending
          </Eyebrow>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
            Operations engine
          </h1>
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-3">
            The shared work queue, knowledge base, and skill library that Joe, Hermes, Claude Code and
            other agents coordinate through. Agent writes are logged and reversible; anything
            client-facing waits for your approval.
          </p>
        </div>

        <EngineClient
          engine={engine}
          knowledge={knowledge}
          skills={skills}
          memories={memories}
          activeRunbooks={activeRunbooks}
        />
      </div>
    </Shell>
  );
}
