import { Shell } from "@/components/shell/Shell";
import { PageHeader } from "@/components/ui";
import { CompanyMoney } from "@/components/money/CompanyMoney";
import { getCompanyMoney } from "@/lib/budget";
import { requireAccess } from "@/lib/dal";
import { fmtK } from "@/lib/budget-types";
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
  ].join(" · ");

  return (
    <Shell breadcrumb="MONEY" aiContext={moneyContext(data)}>
      <div className="mx-auto max-w-[1100px] px-4 py-3 @xl/page:py-6 @3xl/page:px-7">
        <PageHeader title="Money" meta={summary} className="mb-2 @xl/page:mb-5" />
        <CompanyMoney data={data} />
      </div>
    </Shell>
  );
}
