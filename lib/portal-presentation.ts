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
