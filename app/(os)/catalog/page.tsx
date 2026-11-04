import { Search } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { PageHeader } from "@/components/ui";
import { CatalogClient } from "@/components/catalog/CatalogClient";
import { AddMaterialButton } from "@/components/catalog/AddMaterialButton";
import { getCatalogData } from "@/lib/catalog";

export default async function CatalogPage() {
  const data = await getCatalogData();

  return (
    <Shell breadcrumb="CATALOG · MATERIAL LIBRARY">
      <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-6 @2xl/page:px-7">
        <PageHeader
          title="Catalog"
          meta={data.eyebrow}
          actions={<AddMaterialButton />}
        />

        <CatalogClient data={data} />
      </div>
    </Shell>
  );
}
