/** Presentation shared by portal summaries; no narrative is used as invoice truth. */
export function invoiceState(invoice: { pending: number; status: string; lifecycle: string }): string {
  return invoice.pending > 0 ? "Processing" : invoice.lifecycle === "disputed" ? "In review" : invoice.status === "paid" ? "Paid" : "Due";
}

export function schedulePresentation<T extends { iso: string }>(blocks: T[], today: string, requested?: string) {
  const upcoming = blocks.filter(b => b.iso >= today).sort((a, b) => a.iso.localeCompare(b.iso));
  const past = blocks.filter(b => b.iso < today).sort((a, b) => b.iso.localeCompare(a.iso));
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested)
    ? requested : (upcoming[0]?.iso ?? today).slice(0, 7);
  return { month, upcoming, past };
}

export function messageParts(body: string): { text?: string; href?: string; label?: string }[] {
  return body.split(/(https?:\/\/[^\s<>]+)/g).flatMap<{ text?: string; href?: string; label?: string }>(part => {
    if (!/^https?:\/\//.test(part)) return [{ text: part }];
    const href = part.replace(/[.,;!?)]+$/, "");
    let url: URL;
    try { url = new URL(href); } catch { return [{ text: part }]; }
    let filename = url.pathname.split('/').pop() || '';
    try { filename = decodeURIComponent(filename); } catch { /* preserve malformed legacy filenames */ }
    const label = url.hostname === "docs.google.com" && url.pathname.startsWith("/document/") ? "Shared Google document"
      : url.hostname === "docs.google.com" && url.pathname.startsWith("/spreadsheets/") ? "Shared spreadsheet"
      : /sign-doc|\/sign\//.test(url.pathname) ? "Review document"
      : /\/pay\//.test(url.pathname) ? "View invoice"
      : /\.(pdf|docx?)$/i.test(filename) ? filename.replace(/[-_]/g, ' ')
      : /plan|floor/.test(url.pathname) ? "View floor plan" : `Open ${url.hostname}`;
    return part.length > href.length ? [{ href, label }, { text: part.slice(href.length) }] : [{ href, label }];
  });
}

/** Pending payments are never offered for repayment. Future dated invoices
 * stay separate from money due today; narrative notes are not a due-date source. */
export function portalInvoiceSummary<T extends { status: string; lifecycle: string; amount: number; balance: number; pending: number; dueAt: string | null }>(invoices: T[], today: string, currentCents?: number, outsidePaidCents = 0) {
  const issued = invoices.filter(i => i.status !== "draft" && i.lifecycle !== "void");
  const processing = issued.filter(i => i.pending > 0);
  const settled = issued.filter(i => i.pending <= 0 && i.balance <= 0);
  const open = issued.filter(i => i.pending <= 0 && i.balance > 0);
  const review = open.filter(i => i.lifecycle === "disputed");
  const payable = open.filter(i => i.lifecycle !== "disputed")
    .sort((a, b) => (a.dueAt ?? today).localeCompare(b.dueAt ?? today));
  const due = payable.filter(i => !i.dueAt || i.dueAt <= today);
  const upcoming = payable.filter(i => i.dueAt && i.dueAt > today);
  return {
    due, processing, settled, review, upcoming,
    dueCents: due.reduce((sum, i) => sum + i.balance, 0),
    processingCents: processing.reduce((sum, i) => sum + i.pending, 0),
    stillToBillCents: currentCents == null ? null : Math.max(0, currentCents - outsidePaidCents - issued.reduce((sum, i) => sum + i.amount, 0)),
  };
}
