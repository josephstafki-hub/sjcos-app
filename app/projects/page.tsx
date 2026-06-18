import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { ProjectsClient } from "@/components/projects/ProjectsClient";
import { getProjectsData } from "@/lib/projects";

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
            <NewProjectButton />
          </div>
        </div>

        <ProjectsClient groups={groups} />
      </div>
    </Shell>
  );
}
