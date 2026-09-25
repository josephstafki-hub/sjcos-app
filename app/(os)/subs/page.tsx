import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { SubsClient } from "@/components/subs/SubsClient";
import { OnboardSubButton } from "@/components/subs/OnboardSubButton";
import { getSubsData } from "@/lib/subs";
import { can, getCurrentUser } from "@/lib/dal";

export default async function SubsPage() {
  const raw = await getSubsData();
  // A22 money fence: sub rates ("$60/hr") are financial — blank them for a
  // viewer without the `money` area (lib/permissions.ts).
  const viewer = await getCurrentUser();
  const data = can(viewer, "money") ? raw : { ...raw, subs: raw.subs.map((s) => ({ ...s, rate: "" })) };

  return (
    <Shell breadcrumb="SUBS · DIRECTORY">
      <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 sm:px-7">
        {/* Header */}
        <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="min-w-0 flex-1">
            <Eyebrow>{data.summary}</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Subs
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <OnboardSubButton />
          </div>
        </div>

        <SubsClient data={data} />
      </div>
    </Shell>
  );
}
