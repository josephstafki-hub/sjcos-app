import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { PageHeader, Eyebrow } from "@/components/ui";
import { requireAccess } from "@/lib/dal";
import { getEngineData } from "@/lib/engine";
import { getRecentKnowledge } from "@/lib/brain";
import { getSkillsLibrary } from "@/lib/skills";
import { getMemoriesData } from "@/lib/memories";
import { getActiveRunbookInstances } from "@/lib/runbook-engine";
import { EngineClient } from "@/components/engine/EngineClient";

export const dynamic = "force-dynamic";

export default async function EnginePage() {
  // Owner-only: the operations engine coordinates AI runs + approvals.
  const user = await requireAccess("engine");

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
      <div className="mx-auto max-w-6xl px-4 @3xl/page:px-6 pb-16 pt-6">
        <div className="mb-4">
          <PageHeader title={<> Operations engine </>} meta={<> {counts.total} work item{counts.total === 1 ? "" : "s"} · {counts.approval} awaiting approval ·{" "}
            {counts.waiting} waiting · {skills.proposed.length} skill proposal
            {skills.proposed.length === 1 ? "" : "s"} · {memories.pending.length} memor
            {memories.pending.length === 1 ? "y" : "ies"} pending </>} />
          <p className="mt-2 max-w-[640px] text-body leading-relaxed text-ink-3">
            The shared work queue, knowledge base, and skill library that Joe, Hermes, Claude Code and
            other agents coordinate through. Agent writes are logged and reversible; anything
            client-facing waits for your approval.
          </p>
          <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta">
            {[
              { href: "/engine/decisions", label: "Decisions" },
              ...(user.role === "owner" ? [{ href: "/engine/permissions", label: "Permissions" }] : []),
              { href: "/engine/capabilities", label: "Capabilities" },
              { href: "/engine/measure", label: "Measurement" },
              { href: "/engine/houzz-exit", label: "Houzz exit" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="text-accent-2 underline-offset-2 hover:underline">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <EngineClient
          engine={engine}
          knowledge={knowledge}
          skills={skills}
          memories={memories}
          activeRunbooks={activeRunbooks}
          canAssign={user.role === "owner"}
          meId={user.id}
        />
      </div>
    </Shell>
  );
}
