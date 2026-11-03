/** Pure length parser. Storage is inches rounded to 1/16; no expression evaluation. */
export interface LengthOptions { range?: readonly [number, number]; precision?: number }
export type LengthResult = { ok: true; inches: number; display: string; interpreted_as: 'in' | 'ft' | 'm' | 'mm' }
  | { ok: false; error: 'invalid_length' | 'out_of_range'; input: string };
const fractions: Record<string, string> = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
function normalize(input: string): string {
  return input.trim().replace(/[′’]/g, "'").replace(/[″“”]/g, '"')
    .replace(/[¼½¾⅛⅜⅝⅞]/g, (f) => ` ${fractions[f]}`).replace(/\s+/g, ' ');
}
function scalar(input: string): number | null {
  const match = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(input.trim());
  if (match) {
    const denominator = Number(match[3]);
    if (![2, 4, 8, 16].includes(denominator) || Number(match[2]) >= denominator) return null;
    return Number(match[1] ?? 0) + Number(match[2]) / denominator;
  }
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input.trim()) ? Number(input) : null;
}
export function formatLength(inches: number, precision = 1 / 8, inchesOnly = false): string {
  if (!Number.isFinite(inches) || inches < 0 || ![1/16, 1/8, 1/4, 1/2, 1].includes(precision)) throw new Error('invalid_length');
  const denominator = 1 / precision;
  const ticks = Math.round(inches * denominator);
  const feet = inchesOnly ? 0 : Math.floor(ticks / (12 * denominator));
  const remainder = ticks - feet * 12 * denominator;
  const whole = Math.floor(remainder / denominator);
  let numerator = remainder % denominator, divisor = denominator;
  while (numerator && numerator % 2 === 0) { numerator /= 2; divisor /= 2; }
  return `${feet ? `${feet}′ ` : ''}${whole}${numerator ? ` ${numerator}/${divisor}` : ''}″`;
}
export function parseLength(input: string, options: LengthOptions = {}): LengthResult {
  const text = normalize(input);
  let value: number | null = null, interpreted: 'in' | 'ft' | 'm' | 'mm' = 'in';
  const metric = /^(.*?)\s*(mm|m)$/i.exec(text);
  const feet = /^(.*?)\s*(?:'|ft)(?:\s*(.*?)\s*(?:"|in)?)?$/i.exec(text);
  const inches = /^(.*?)\s*(?:"|in)$/i.exec(text);
  if (metric) {
    const n = scalar(metric[1]); interpreted = metric[2].toLowerCase() as 'm' | 'mm';
    value = n === null ? null : n * (interpreted === 'm' ? 1000 : 1) / 25.4;
  } else if (feet) {
    const f = scalar(feet[1]), i = feet[2] ? scalar(feet[2]) : 0;
    value = f === null || i === null || i >= 12 ? null : f * 12 + i; interpreted = 'ft';
  } else if (inches) value = scalar(inches[1]);
  else {
    const compound = /^(\d+)\s+(\d+)\s+(\d+\/\d+)$/.exec(text);
    if (compound) {
      const i = scalar(`${compound[2]} ${compound[3]}`);
      value = i === null || i >= 12 ? null : Number(compound[1]) * 12 + i; interpreted = 'ft';
    } else {
      value = scalar(text);
      if (value !== null && options.range && !(value >= options.range[0] && value <= options.range[1]) && value * 12 >= options.range[0] && value * 12 <= options.range[1]) { value *= 12; interpreted = 'ft'; }
    }
  }
  if (value === null || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 16) return { ok: false, error: 'invalid_length', input };
  if (options.range && (value < options.range[0] || value > options.range[1])) return { ok: false, error: 'out_of_range', input };
  value = Math.round(value * 16) / 16;
  return { ok: true, inches: value, display: formatLength(value, options.precision), interpreted_as: interpreted };
}
export function parseLengthPair(input: string, options: readonly [LengthOptions, LengthOptions] = [{}, {}]) {
  const parts = input.split(/\s*[x×]\s*/i);
  if (parts.length !== 2) return { ok: false as const, error: 'invalid_length_pair' as const };
  const width = parseLength(parts[0], options[0]), height = parseLength(parts[1], options[1]);
  return width.ok && height.ok ? { ok: true as const, inches: [width.inches, height.inches] as [number, number], display: `${width.display} × ${height.display}` } : { ok: false as const, error: 'invalid_length_pair' as const, width, height };
}

const VULGAR: Record<string, string> = { "1/8": "⅛", "1/4": "¼", "3/8": "⅜", "1/2": "½", "5/8": "⅝", "3/4": "¾", "7/8": "⅞" };
/** §6.6 typography: 8′ 1¼″ — primes, never straight quotes; common fractions as one glyph. */
export function prettyLength(t: string): string {
  return t.replace(/'/g, "′").replace(/"/g, "″").replace(/(\d) (\d\/\d)(?=″|$|\s|×)/g, (m, d: string, f: string) => (VULGAR[f] ? `${d}${VULGAR[f]}` : m));
}

export function displayLength(inches:number, precision=1/8):string { return formatLength(inches,precision,inches<48); }
