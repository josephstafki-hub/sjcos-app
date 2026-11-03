import "server-only";

// Lead search for the discovery checklist's "Link to a lead" picker. Read
// only. Shared by the GET route the picker uses (so its first page never waits
// behind the checklist's own queued server actions) and the server action.
// The statements and their order live in lib/checklist-coverage/lead-search-sql.ts.

import { query } from "@/lib/db";
import { orderForCall } from "@/lib/checklist-coverage/lead-order";
import { leadSearchStatements } from "@/lib/checklist-coverage/lead-search-sql";

/** Only what the picker shows, and the id it links by. */
export interface ChecklistLeadResult {
  id: string; name: string; scope: string; phone: string | null;
  /** This lead's phone is the number on the call the checklist is for. */
  on_call: boolean;
}

type Row = Omit<ChecklistLeadResult, "on_call">;

/** The 12 newest leads (or the best matches for `text`), with any lead whose
 *  phone is `callNumber` first and marked `on_call`. */
export async function searchChecklistLeads(text: string, callNumber?: string | null): Promise<ChecklistLeadResult[]> {
  const s = leadSearchStatements(text, callNumber);
  const [onCall, found] = await Promise.all([
    s.onCall ? query<Row>(s.onCall.sql, s.onCall.params) : Promise.resolve({ rows: [] as Row[] }),
    query<Row>(s.found.sql, s.found.params),
  ]);
  return orderForCall(onCall.rows, found.rows, s.typed);
}
