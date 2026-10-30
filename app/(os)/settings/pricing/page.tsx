import { percentLabel } from "@/lib/pricing-labels";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Shell } from "@/components/shell/Shell";
import { PageHeader, Eyebrow } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { runDirect } from "@/lib/commands/db";
import { listPricingSetups } from "@/lib/estimating/setup";
import { PricingSetup } from "@/components/settings/PricingSetup";

export const dynamic = "force-dynamic";

/** Pricing setup (A15): versioned labor rates, markup, margin target, default
 *  allowances and uncertainty rules. Draft → owner activates (a recorded
 *  markup decision). Estimates already offered never change. */
export default async function PricingSettingsPage() {
  await requireRole("owner");
  const setups = await listPricingSetups(runDirect);
  const active = setups.find((s) => s.state === "active") ?? null;
  return (
    <Shell breadcrumb="SETTINGS · PRICING">
      <SettingsSection active="/settings/pricing">
        <div className="mb-4">
          <PageHeader title={<> Pricing setup </>} meta={<> {active ? `active v${active.version} · markup ${percentLabel(active.config.markup_pct)} · margin target ${percentLabel(active.config.margin_target_pct)}` : "no active pricing setup — estimates use the legacy default markup only"} </>} />
          <p className="mt-2 max-w-[660px] text-body leading-relaxed text-ink-3">
            The rates, markup, allowances and uncertainty rules new estimate pricing uses. A proposal is drafted from the cost
            book and closed jobs with its evidence; anything unsupported stays empty with a reason, never zero. Activating a
            version is a markup decision you approve here (recorded). Offers already sent keep their prices.
          </p>
        </div>
        <PricingSetup setups={setups} />
      </SettingsSection>
    </Shell>
  );
}
