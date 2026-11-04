import { Shell } from "@/components/shell/Shell";
import { PageHeader } from "@/components/ui";
import { VendorsClient } from "@/components/vendors/VendorsClient";
import { OnboardVendorButton } from "@/components/vendors/OnboardVendorButton";
import { getVendorsData } from "@/lib/vendors";

export default async function VendorsPage() {
  const data = await getVendorsData();

  return (
    <Shell breadcrumb="VENDORS · DIRECTORY">
      <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 @2xl/page:px-7">
        <PageHeader
          title="Vendors"
          meta={data.summary}
          actions={<OnboardVendorButton />}
        />

        <VendorsClient data={data} />
      </div>
    </Shell>
  );
}
