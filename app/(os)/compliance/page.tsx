import { Shell } from "@/components/shell/Shell";
import { getComplianceData } from "@/lib/compliance";
import { ComplianceClient } from "@/components/compliance/ComplianceClient";
import { InsuranceSection } from "@/components/compliance/InsuranceSection";
import { getInsurancePolicies } from "@/lib/insurance";
export default async function CompliancePage() {
  const [data, policies] = await Promise.all([
    getComplianceData(),
    getInsurancePolicies(true),
  ]);
  return (
    <Shell breadcrumb="COMPLIANCE">
      <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-6 @3xl/page:px-5 @5xl/page:px-8">
        <ComplianceClient
          eyebrow={data.eyebrow}
          filters={data.filters}
          windows={data.windows}
          timeline={data.timeline}
          history={data.history}
        />
        <InsuranceSection policies={policies} />
      </div>
    </Shell>
  );
}
