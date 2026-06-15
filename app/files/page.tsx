import { Shell } from "@/components/shell/Shell";
import { FilesClient } from "@/components/files/FilesClient";
import { getFilesData } from "@/lib/files";

export default async function FilesPage() {
  const data = await getFilesData();

  // hideCmd: the 3-pane fills the viewport; the ⌘K pill would overlap the list.
  return (
    <Shell breadcrumb="FILES › PROJECTS / 2026 / HENDERSON KITCHEN" hideCmd>
      <FilesClient data={data} />
    </Shell>
  );
}
