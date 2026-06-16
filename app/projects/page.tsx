import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { getProjectsData } from "@/lib/projects";

const DOT: Record<string, string> = {
  accent: "bg-accent",
  ai: "bg-ai",
  ghost: "bg-ink-4",
};

export default async function ProjectsPage() {
  const { summary, groups } = await getProjectsData();

  return (
    <Shell breadcrumb="PROJECTS">
      <div className="mx-auto max-w-[1100px] px-7 py-6">
        {/* Header */}
        <div className="mb-3.5 flex items-end gap-4">
          <div className="flex-1">
            <Eyebrow>{summary}</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Projects
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <Chip kind="solid">All open</Chip>
            <Chip kind="ghost">Active</Chip>
            <Chip kind="ghost">Pre-con</Chip>
            <Chip kind="ghost">Closed</Chip>
            <NewProjectButton />
          </div>
        </div>

        {groups.map((g) => (
          <section key={g.key} className="mb-6">
            <div className="mb-2 flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${DOT[g.dot]}`} />
              <h2 className="font-serif text-[16px] font-semibold text-ink">{g.title}</h2>
              <span className="text-[11px] text-ink-3">{g.items.length}</span>
            </div>

            <div className="flex flex-col gap-2">
              {g.items.map((p) => (
                <Link key={p.slug} href={`/projects/${p.slug}`}>
                  <Card className="flex items-center gap-3 p-3.5 transition-colors hover:bg-paper-2">
                    <div className="size-10 flex-none rounded border-[1.5px] border-accent bg-accent-soft" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-serif text-[16px] font-semibold text-ink">{p.name}</span>
                        <Chip kind={g.chip} dot>
                          {p.stage}
                        </Chip>
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-3">{p.sub}</div>
                    </div>
                    <div className="hidden w-[220px] sm:block">
                      <div className="mb-1 flex items-center">
                        <span className="flex-1 font-mono text-[11px] text-ink-3">{p.billed}% billed</span>
                        <span className="font-mono text-[12px] text-ink-2">{p.value}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-paper-3">
                        <div className={`h-full ${g.bar}`} style={{ width: `${p.billed}%` }} />
                      </div>
                    </div>
                    <ChevronRight className="size-3.5 flex-none text-ink-3" strokeWidth={1.5} />
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
