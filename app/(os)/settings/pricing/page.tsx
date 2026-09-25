import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
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
      <div className="mx-auto max-w-[1000px] px-7 pb-16 pt-6">
        <div className="mb-4">
          <Eyebrow>{active ? `active v${active.version} · markup ${active.config.markup_pct ?? "unset"}% · margin target ${active.config.margin_target_pct ?? "unset"}%` : "no active pricing setup — estimates use the legacy default markup only"}</Eyebrow>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">Pricing setup</h1>
          <p className="mt-2 max-w-[660px] text-[13px] leading-relaxed text-ink-3">
            The rates, markup, allowances and uncertainty rules new estimate pricing uses. A proposal is drafted from the cost
            book and closed jobs with its evidence; anything unsupported stays empty with a reason, never zero. Activating a
            version is a markup decision you approve here (recorded). Offers already sent keep their prices.
          </p>
        </div>
        <PricingSetup setups={setups} />
      </div>
    </Shell>
  );
}
