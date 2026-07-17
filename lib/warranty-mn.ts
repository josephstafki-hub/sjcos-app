// Minnesota statutory home warranties (Minn. Stat. §327A.02 subd. 1). SJ
// Carpentry does residential remodeling / carpentry ("home improvement"), so
// these three statutory tiers define WHAT is warrantied on every closed job and
// for HOW LONG, measured from the warranty date (substantial completion). We
// encode the periods here and derive each project's per-item expirations on
// read (lib/warranty.ts) — items drop off the list as they lapse, and once all
// three have lapsed the project leaves warranty entirely. No background job:
// everything is computed live against CURRENT_DATE at page-load time.

export interface MnWarrantyTier {
  key: "workmanship" | "systems" | "structural";
  /** Short label shown on the card, e.g. "1-yr workmanship & materials". */
  label: string;
  /** Statutory term in months from the warranty (substantial-completion) date. */
  months: number;
  /** Plain-language coverage + statute cite. */
  detail: string;
}

/** The MN §327A.02 subd. 1 tiers, longest-lived last. */
export const MN_WARRANTY_TIERS: MnWarrantyTier[] = [
  {
    key: "workmanship",
    label: "1-yr workmanship & materials",
    months: 12,
    detail:
      "Faulty workmanship or defective materials from noncompliance with building standards. Minn. Stat. §327A.02 subd. 1(a).",
  },
  {
    key: "systems",
    label: "2-yr systems",
    months: 24,
    detail:
      "Faulty installation of plumbing, electrical, heating & cooling systems. Minn. Stat. §327A.02 subd. 1(b).",
  },
  {
    key: "structural",
    label: "10-yr major structural",
    months: 120,
    detail:
      "Major construction (structural) defects. Minn. Stat. §327A.02 subd. 1(c).",
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a Date as "May 23 2027" (matches the SQL to_char used elsewhere). */
function fmt(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

/** Parse a 'YYYY-MM-DD' string at local midnight; null on missing/bad input. */
function parseISODate(iso: string | null): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Add whole months, letting JS normalize day/month overflow. */
function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}

export interface DerivedWarrantyItem {
  key: MnWarrantyTier["key"];
  label: string;
  detail: string;
  /** "ends May 23 2027". */
  expires: string;
  expired: boolean;
}

export interface DerivedWarranty {
  /** Every statutory item with its computed expiration + lapsed flag. */
  items: DerivedWarrantyItem[];
  /** Just the still-covered items — what the card lists. */
  active: DerivedWarrantyItem[];
  /** True once every tier has lapsed → the project is out of warranty. */
  allExpired: boolean;
}

/** Derive the MN statutory coverage for one project from its warranty start
 *  date. `startISO`/`todayISO` are 'YYYY-MM-DD'. Returns null when the start
 *  date is unknown (imported records with no closed date on file) — the caller
 *  keeps such projects on the grid but can't itemize their periods. */
export function deriveWarranty(startISO: string | null, todayISO: string): DerivedWarranty | null {
  const start = parseISODate(startISO);
  const today = parseISODate(todayISO);
  if (!start || !today) return null;
  const items: DerivedWarrantyItem[] = MN_WARRANTY_TIERS.map((t) => {
    const end = addMonths(start, t.months);
    return {
      key: t.key,
      label: t.label,
      detail: t.detail,
      expires: `ends ${fmt(end)}`,
      expired: end.getTime() < today.getTime(),
    };
  });
  return {
    items,
    active: items.filter((i) => !i.expired),
    allExpired: items.every((i) => i.expired),
  };
}
