import type { ComponentProps } from "react";
import { Table } from "@/components/ui";

/** Dense ledger on wide pages; name first, amount and actions below on phones.
 * Keep semantic table markup and local scrolling as a last resort for long values. */
export function FinancialTable({ className = "", ...props }: ComponentProps<typeof Table>) {
  return <Table density="compact" className={`
    @max-xl/page:[&_thead]:sr-only
    @max-xl/page:[&_tbody]:block @max-xl/page:[&_tfoot]:block
    @max-xl/page:[&_tr]:grid @max-xl/page:[&_tr]:grid-cols-[minmax(0,1fr)_auto]
    @max-xl/page:[&_td]:!h-auto @max-xl/page:[&_td]:min-w-0
    @max-xl/page:[&_td:first-child]:col-span-2
    @max-xl/page:[&_td[colspan]]:col-span-2
    @max-xl/page:[&_tfoot_td:first-child]:col-span-1
    @max-xl/page:[&_button]:min-h-11 @max-xl/page:[&_button]:min-w-11
    ${className}`} {...props} />;
}
