import { Shell } from "@/components/shell/Shell";
import { AiBubble, AiStream } from "@/components/ui";
import { getComplianceData, getComplianceSummary } from "@/lib/compliance";
import { ComplianceClient } from "@/components/compliance/ComplianceClient";
import { InsuranceSection } from "@/components/insurance/InsuranceSection";
import { getInsurancePolicies } from "@/lib/insurance";

export default async function CompliancePage() {
  const [data, policies] = await Promise.all([getComplianceData(), getInsurancePolicies()]);

  return (
    <Shell breadcrumb="COMPLIANCE · CALENDAR">
      <div className="mx-auto max-w-[1100px] px-7 pb-16 pt-6">
        <ComplianceClient
          eyebrow={data.eyebrow}
          filters={data.filters}
          windows={data.windows}
          timeline={data.timeline}
          aiSlot={
            <AiBubble
              className="mb-3.5"
              actions={
                <a
                  href="#compliance-timeline"
                  className="rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2"
                >
                  View timeline
                </a>
              }
            >
              <AiStream load={() => getComplianceSummary(data.summaryInput)} />
            </AiBubble>
          }
        />
        <InsuranceSection policies={policies} />
      </div>
    </Shell>
  );
}
