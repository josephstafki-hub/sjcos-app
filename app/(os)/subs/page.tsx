import { Shell } from "@/components/shell/Shell";
import { PageHeader } from "@/components/ui";
import { SubsClient } from "@/components/subs/SubsClient";
import { OnboardSubButton } from "@/components/subs/OnboardSubButton";
import { getSubsData } from "@/lib/subs";
import { can, getCurrentUser } from "@/lib/dal";

export default async function SubsPage() {
  const raw = await getSubsData();
  // A22 money fence: sub rates ("$60/hr") are financial — blank them for a
  // viewer without the `money` area (lib/permissions.ts).
  const viewer = await getCurrentUser();
  const data = can(viewer, "money")
    ? raw
    : { ...raw, subs: raw.subs.map((s) => ({ ...s, rate: "" })) };

  return (
    <Shell breadcrumb="SUBS · DIRECTORY">
      <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 @2xl/page:px-7">
        <PageHeader
          title="Subs"
          meta={data.summary}
          actions={<OnboardSubButton />}
        />

        <SubsClient data={data} />
      </div>
    </Shell>
  );
}
