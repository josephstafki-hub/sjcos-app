import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { PageHeader } from "@/components/ui";
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
          <PageHeader title={<> Operations engine </>} meta={<> {counts.approval} approvals · {counts.active} active · {counts.waiting} waiting </>} />
          <details className="mt-2">
          <summary className="cursor-pointer py-1 text-meta text-ink-2">Engine tools and record counts</summary>
          <p className="mt-2 max-w-[640px] text-body leading-relaxed text-ink-3">
            The shared work queue, knowledge base, and skill library that Joe, Hermes, Claude Code and
            other agents coordinate through. Agent writes are logged and reversible; anything
            client-facing waits for your approval.
          </p>
          <p className="mt-2 text-meta text-ink-2">The work-item total covers all unarchived records, including done and cancelled. Approval and waiting counts cover all folders; waiting includes blocked work. Folder counts cover open work; “Waiting on me” narrows the current folder and filters to work waiting on you.</p>
          <nav className="mt-4 flex flex-wrap gap-2">
            {[
              { href: "/engine/decisions", label: "Decisions" },
              ...(user.role === "owner" ? [{ href: "/engine/permissions", label: "Permissions" }] : []),
              { href: "/engine/capabilities", label: "Capabilities" },
              { href: "/engine/measure", label: "Measurement" },
              { href: "/engine/houzz-exit", label: "Houzz exit" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md border border-rule bg-paper-2 px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent-2"
              >
                {l.label} →
              </Link>
            ))}
          </nav>
          </details>
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
