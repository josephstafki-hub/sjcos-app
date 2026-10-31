// Invoice lines may include credits. Never clamp signed money to zero.
export function cleanInvoiceLines(raw: { label: string; amount: number | string }[]) {
  return raw.map(l => {
    const text = String(l.amount).replace(/[$,\s]/g, '');
    const n = Number(text);
    const amount = Math.round(n);
    if (!Number.isFinite(n) || !Number.isSafeInteger(amount)) throw new Error('Each invoice line needs a valid amount in cents.');
    return { label: String(l.label ?? '').trim(), amount };
  }).filter(l => l.label !== '' || l.amount !== 0);
}
