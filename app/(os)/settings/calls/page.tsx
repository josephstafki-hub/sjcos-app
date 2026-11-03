import { Shell } from "@/components/shell/Shell";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { DiscoveryChecklistSettings, type ChecklistSettingsData } from "@/components/settings/DiscoveryChecklistSettings";
import { PageHeader } from "@/components/ui";
import { ApprovalBadgeSlot } from "@/components/shell/ApprovalBadgeSlot";
import { requireRole } from "@/lib/dal";
import { loadDiscoveryChecklistSettings } from "@/lib/actions/discovery-checklist";

export const dynamic = "force-dynamic";

// Settings › Calls › Discovery checklist (docs/plans/discovery-call-plan.md §3.4).
// Owner only, like every Settings page; staff see the questions on each row's
// sheet in Calls but can't change the list.
export default async function CallsSettingsPage() {
  await requireRole("owner");
  const data = (await loadDiscoveryChecklistSettings()) as ChecklistSettingsData;
  return (
    <Shell breadcrumb="SETTINGS / CALLS">
      <SettingsSection active="/settings/calls">
        {/* The "Decisions N" badge sits by the title: approvals stay compact here
            so they never cover the Save footer (lib/notification-placement.ts). */}
        <PageHeader eyebrow="Calls" title="Discovery checklist" badge={<ApprovalBadgeSlot />} meta={`What the checklist in Calls asks about. Version ${data.version.version}.`} />
        <DiscoveryChecklistSettings initial={data} />
      </SettingsSection>
    </Shell>
  );
}
