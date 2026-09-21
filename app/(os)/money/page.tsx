import { Shell } from "@/components/shell/Shell";
import { Eyebrow } from "@/components/ui";
import { CompanyMoney } from "@/components/money/CompanyMoney";
import { getCompanyMoney } from "@/lib/budget";
import { requireAccess } from "@/lib/dal";
import { fmtK, fmtPct } from "@/lib/budget-types";
import { moneyContext } from "@/lib/page-context";

// Every job's money side by side (docs/project-financials-plan.md §5). Fenced
// by the `money` area, like a project's Money › Overview, because it shows
// margins. /books stays reserved for the ledger.
export default async function MoneyPage() {
  await requireAccess("money");
  const data = await getCompanyMoney();
  const t = data.totals;
  const summary = [
    `${t.jobCount} open job${t.jobCount === 1 ? "" : "s"}`,
    `${fmtK(t.contractedCents)} contracted`,
    t.profitJobs ? `${fmtK(t.profitCents)} profit (${fmtPct(t.blendedMarginPct)}) known on ${t.profitJobs}` : "profit not known on any yet",
  ].join(" · ");

  return (
    <Shell breadcrumb="MONEY" aiContext={moneyContext(data)}>
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-7">
        <div className="mb-5">
          <Eyebrow>{summary}</Eyebrow>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">Money</h1>
        </div>
        <CompanyMoney data={data} />
      </div>
    </Shell>
  );
}
