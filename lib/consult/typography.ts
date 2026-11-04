/**
 * Smart punctuation for text the visitor or the client reads (r4 R4-9): ’ for apostrophes,
 * “ ” and ‘ ’ for quotes, ′ ″ after a number (6′ 9″). Display text only — never option values,
 * keys or condition values, which stay byte-for-byte as stored.
 */
export function curly(s: string): string {
  if (!s || !/['"]/.test(s)) return s;
  return s
    .replace(/(\d)"/g, '$1″')
    .replace(/(\d)'(?=[\s\d×x-]|$)/g, '$1′')
    .replace(/(^|[\s([{—–/-])"/g, '$1“').replace(/"/g, '”')
    .replace(/(^|[\s([{—–/-])'(?=\w)/g, '$1‘').replace(/'/g, '’');
}
