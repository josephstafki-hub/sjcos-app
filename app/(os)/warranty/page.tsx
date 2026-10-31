import { Suspense } from "react";
import { Shell } from "@/components/shell/Shell";
import { FocusScroll } from "@/components/shell/FocusScroll";
import { WarrantyClient } from "@/components/warranty/WarrantyClient";
import { getWarrantyData, getWarrantyProjectOptions } from "@/lib/warranty";
import { warrantyContext } from "@/lib/page-context";
export default async function WarrantyPage() {
  const [data, projects] = await Promise.all([
    getWarrantyData(),
    getWarrantyProjectOptions(),
  ]);
  return (
    <Shell
      breadcrumb="WARRANTY"
      aiContext={warrantyContext({
        ...data,
        claims: data.claims.filter((c) => !c.resolved),
        projects: data.projects.filter((p) => p.status === "active"),
      })}
    >
      <Suspense fallback={null}>
        <FocusScroll />
      </Suspense>
      <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-6 @3xl/page:px-5 @5xl/page:px-8">
        <WarrantyClient data={data} projects={projects} />
      </div>
    </Shell>
  );
}
