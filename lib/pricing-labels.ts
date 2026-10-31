export function historicalAuthor(label: string | null | undefined): string {
  if (!label?.trim() || /\b(undefined|null)\b/i.test(label)) return 'Author not recorded';
  return label.replace(/^(owner|staff):/, '');
}
export function percentLabel(value: number | null | undefined): string {
  return value == null ? 'Not set' : `${value}%`;
}
