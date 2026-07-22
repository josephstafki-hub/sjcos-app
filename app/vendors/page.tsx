import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { VendorsClient } from "@/components/vendors/VendorsClient";
import { OnboardVendorButton } from "@/components/vendors/OnboardVendorButton";
import { getVendorsData } from "@/lib/vendors";

export default async function VendorsPage() {
  const data = await getVendorsData();

  return (
    <Shell breadcrumb="VENDORS · DIRECTORY">
      <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-6 sm:px-7">
        <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="min-w-0 flex-1">
            <Eyebrow>{data.summary}</Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Vendors
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <OnboardVendorButton />
          </div>
        </div>

        <VendorsClient data={data} />
      </div>
    </Shell>
  );
}
