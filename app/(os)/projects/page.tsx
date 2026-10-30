import { Shell } from "@/components/shell/Shell";
import { PageHeader } from "@/components/ui";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { ProjectsClient } from "@/components/projects/ProjectsClient";
import { getProjectsData } from "@/lib/projects";
import { projectsContext } from "@/lib/page-context";

export default async function ProjectsPage() {
  const data = await getProjectsData();
  const { summary, groups } = data;

  return (
    <Shell breadcrumb="PROJECTS" aiContext={projectsContext(data)}>
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-7">
        <PageHeader title="Projects" meta={summary} actions={<NewProjectButton />} className="mb-5" />

        <ProjectsClient groups={groups} />
      </div>
    </Shell>
  );
}
