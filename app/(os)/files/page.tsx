import { Shell } from "@/components/shell/Shell";
import { FilesClient } from "@/components/files/FilesClient";
import { getFilesData } from "@/lib/files";

export default async function FilesPage() {
  const data = await getFilesData();

  return (
    <Shell breadcrumb="FILES">
      <FilesClient data={data} />
    </Shell>
  );
}
