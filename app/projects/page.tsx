import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { ProjectsClient } from "@/components/projects/ProjectsClient";
import { getProjectsData } from "@/lib/projects";
import { projectsContext } from "@/lib/page-context";

export default async function ProjectsPage() {
  const data = await getProjectsData();
  const { summary, groups } = data;

  return (
    <Shell breadcrumb="PROJECTS" aiContext={projectsContext(data)}>
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-7">
        {/* Header */}
        <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="min-w-0 flex-1">
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
