import { Shell } from "@/components/shell/Shell";
import { PageHeader, Eyebrow } from "@/components/ui";
import { requireAccess } from "@/lib/dal";
import { capabilityReport } from "@/lib/measure/capabilities";
import { poolRun } from "@/lib/measure/server";
import { CapabilitiesTable } from "@/components/engine/CapabilitiesTable";

export const dynamic = "force-dynamic";

/** Capability status — implemented / deployed / enabled / proven as four
 *  independent, evidence-backed claims per task and key feature.
 *  See docs/automation-reliability/capabilities.md. */
export default async function CapabilitiesPage() {
  const user = await requireAccess("engine");
  const report = await capabilityReport(poolRun);

  return (
    <Shell breadcrumb="OPERATIONS ENGINE · CAPABILITIES">
      <div className="mx-auto max-w-6xl px-4 @3xl/page:px-6 pb-16 pt-6">
        <div className="mb-4">
          <PageHeader title={<> Capability status </>} meta={<> {report.counts.implemented} implemented · {report.counts.deployed} deployed · {report.counts.enabled} enabled · {report.counts.proven} proven of {report.counts.total} </>} />
          <p className="mt-2 max-w-[640px] text-body leading-relaxed text-ink-3">
            Four separate claims per capability. Code on a branch is implemented; running on the live service is
            deployed; switched on for a stated scope is enabled; observed doing the job on real cases is proven. None
            implies another, and each true needs a dated version and evidence.
          </p>
        </div>
        <CapabilitiesTable report={report} canEdit={user.role === "owner"} />
      </div>
    </Shell>
  );
}
