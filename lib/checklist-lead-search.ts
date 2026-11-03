import "server-only";

// Lead search for the discovery checklist's "Link to a lead" picker. Read
// only. Shared by the GET route the picker uses (so its first page never waits
// behind the checklist's own queued server actions) and the server action.

import { query } from "@/lib/db";
import { orderForCall } from "@/lib/checklist-coverage/lead-order";

export interface ChecklistLeadResult {
  id: string; slug: string; name: string; scope: string; phone: string | null; email: string | null;
  /** This lead's phone is the number on the call the checklist is for. */
  on_call: boolean;
}

const LEAD_COLUMNS = `id, slug, name, COALESCE(scope,'') AS scope, phone, email`;

/** The 12 most recent leads (or matches for `text`), with any lead whose phone
 *  is `callNumber` first and marked `on_call`. */
export async function searchChecklistLeads(text: string, callNumber?: string | null): Promise<ChecklistLeadResult[]> {
  const q = text.trim().slice(0, 80);
  const digits = q.replace(/\D/g, "");
  const callDigits = (callNumber ?? "").replace(/\D/g, "").slice(-10);
  const [onCall, found] = await Promise.all([
    callDigits.length === 10
      ? query<Omit<ChecklistLeadResult, "on_call">>(
          `SELECT ${LEAD_COLUMNS} FROM leads
            WHERE stage <> 'lost' AND right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10) = $1
            ORDER BY last_contact_at DESC NULLS LAST LIMIT 3`,
          [callDigits],
        )
      : Promise.resolve({ rows: [] as Omit<ChecklistLeadResult, "on_call">[] }),
    query<Omit<ChecklistLeadResult, "on_call">>(
      `SELECT ${LEAD_COLUMNS} FROM leads
        WHERE stage <> 'lost'
          AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR scope ILIKE '%' || $1 || '%'
               OR ($2 <> '' AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $2 || '%'))
        ORDER BY last_contact_at DESC NULLS LAST LIMIT 12`,
      [q, digits.length >= 3 ? digits : ""],
    ),
  ]);
  return orderForCall(onCall.rows, found.rows, !!q);
}
