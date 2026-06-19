import { Shell } from "@/components/shell/Shell";
import { AiBubble, AiStream, AckButton } from "@/components/ui";
import { getComplianceData, getComplianceSummary } from "@/lib/compliance";
import { ComplianceClient } from "@/components/compliance/ComplianceClient";

export default async function CompliancePage() {
  const data = await getComplianceData();

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
              actions={<AckButton label="Open both" ackLabel="Flagged for review" />}
            >
              <AiStream load={() => getComplianceSummary(data.summaryInput)} />
            </AiBubble>
          }
        />
      </div>
    </Shell>
  );
}
