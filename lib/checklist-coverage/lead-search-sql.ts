// Pure and import-free: the SQL behind the checklist's "Link to a lead"
// picker, so a test can run exactly these statements against the disposable
// harness database (tests/checklist-lead-search-db.test.mjs). Executed by
// lib/checklist-lead-search.ts; ordered for the caller by lead-order.ts.
//
// Only what the picker shows (name, scope, phone) and the id it links by —
// no email or slug in the response.
//
// Order (Joe, discovery-call build review R3):
//   • no text: newest created-or-contacted first, so the lead made a minute
//     ago for this call is at the top of Recent leads;
//   • with text: name matches above scope-only matches — name starts with it,
//     then a word in the name starts with it, then the name contains it, then
//     a phone match — and recency within each.

export const PICKER_COLUMNS = `id, name, COALESCE(scope,'') AS scope, phone`;

/** When a lead was last created or contacted. */
const RECENCY = `GREATEST(created_at, COALESCE(last_contact_at, created_at))`;
const DIGITS = `regexp_replace(COALESCE(phone,''), '\\D', '', 'g')`;

export const PICKER_LIMIT = 12;

export interface LeadSearchStatement { sql: string; params: unknown[] }

/** Escape LIKE wildcards so "50%" or "a_b" match literally. */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function leadSearchStatements(text: string, callNumber?: string | null): {
  typed: boolean; onCall: LeadSearchStatement | null; found: LeadSearchStatement;
} {
  const q = text.trim().slice(0, 80);
  const digits = q.replace(/\D/g, "");
  const callDigits = (callNumber ?? "").replace(/\D/g, "").slice(-10);
  const onCall = callDigits.length === 10 ? {
    sql: `SELECT ${PICKER_COLUMNS} FROM leads
           WHERE stage <> 'lost' AND right(${DIGITS}, 10) = $1
           ORDER BY ${RECENCY} DESC, id LIMIT 3`,
    params: [callDigits],
  } : null;
  if (!q) {
    return {
      typed: false, onCall,
      found: {
        sql: `SELECT ${PICKER_COLUMNS} FROM leads WHERE stage <> 'lost'
               ORDER BY ${RECENCY} DESC, id LIMIT ${PICKER_LIMIT}`,
        params: [],
      },
    };
  }
  const phone = digits.length >= 3 ? digits : "";
  return {
    typed: true, onCall,
    found: {
      sql: `SELECT ${PICKER_COLUMNS} FROM leads
             WHERE stage <> 'lost'
               AND (name ILIKE '%' || $1 || '%' OR scope ILIKE '%' || $1 || '%'
                    OR ($2 <> '' AND ${DIGITS} LIKE '%' || $2 || '%'))
             ORDER BY (name ILIKE $1 || '%') DESC,
                      (name ILIKE '% ' || $1 || '%') DESC,
                      (name ILIKE '%' || $1 || '%') DESC,
                      ($2 <> '' AND ${DIGITS} LIKE '%' || $2 || '%') DESC,
                      ${RECENCY} DESC, id
             LIMIT ${PICKER_LIMIT}`,
      params: [likeLiteral(q), phone],
    },
  };
}
