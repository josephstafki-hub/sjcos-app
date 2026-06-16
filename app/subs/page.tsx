import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { SubsClient } from "@/components/subs/SubsClient";
import { OnboardSubButton } from "@/components/subs/OnboardSubButton";
import { getSubsData } from "@/lib/subs";

export default async function SubsPage() {
  const data = await getSubsData();

  return (
    <Shell breadcrumb="SUBS · DIRECTORY">
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        {/* Header */}
        <div className="mb-3.5 flex items-end gap-4">
          <div className="flex-1">
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
