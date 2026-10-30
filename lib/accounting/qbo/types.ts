// QuickBooks Online adapter contract (A14). QBO stays the bookkeeping
// authority; SJC OS mirrors what it must (issued invoices, confirmed
// payments, fees) once, imports posted entities with versions, and never
// overwrites either side silently. Only the entity shapes this build needs.

export type QboEntityKind = "Customer" | "Invoice" | "Payment" | "Purchase" | "Bill" | "Deposit" | "Refund" | "Expense";

export interface QboDoc {
  Id: string;
  SyncToken: string;
  /** ISO date (YYYY-MM-DD). */
  TxnDate?: string;
  /** Dollars as QBO returns them; converted to cents by the sync layer. */
  TotalAmt?: number;
  DocNumber?: string;
  CustomerRef?: { value: string; name?: string };
  /** Set by QBO when a transaction is voided ("Voided" in PrivateNote / status). */
  Voided?: boolean;
  /** Lines we care about: deposits carry the linked payment + fee line. */
  Line?: Array<{ Amount: number; DetailType?: string; LinkedTxn?: Array<{ TxnId: string; TxnType: string }>; Description?: string }>;
  MetaData?: { LastUpdatedTime?: string; CreateTime?: string };
  [k: string]: unknown;
}

export interface QboAdapter {
  readonly environment: "fake" | "sandbox" | "production";
  /** Company identity check. */
  companyInfo(): Promise<{ realmId: string; companyName: string }>;
  /** Entities changed since `sinceIso` (inclusive), oldest first. */
  listChanges(kind: QboEntityKind, sinceIso: string | null): Promise<QboDoc[]>;
  get(kind: QboEntityKind, id: string): Promise<QboDoc | null>;
  create(kind: QboEntityKind, doc: Partial<QboDoc>): Promise<QboDoc>;
  /** Records whose `field` is exactly `value` (asked of QuickBooks itself, so
   *  an export can see a record the import hasn't pulled yet). */
  findBy(kind: QboEntityKind, field: "DocNumber" | "DisplayName", value: string): Promise<QboDoc[]>;
  /** Records deleted in QuickBooks since `sinceIso` (Change Data Capture; the
   *  query endpoint never returns deleted records). QuickBooks keeps 30 days. */
  listDeleted(kinds: QboEntityKind[], sinceIso: string): Promise<QboDeleted[]>;
}

export interface QboDeleted {
  kind: QboEntityKind;
  id: string;
  /** When QuickBooks deleted it (MetaData.LastUpdatedTime), if given. */
  at: string | null;
}

export class QboNotConnectedError extends Error {
  constructor(msg = "QuickBooks Online is not connected (INTUIT_CLIENT_ID / QBO_REALM_ID / QBO_REFRESH_TOKEN unset).") {
    super(msg);
    this.name = "QboNotConnectedError";
  }
}

/** A QuickBooks API call that came back with an error status. Carries
 *  Intuit's `intuit_tid` (their per-request tracking id: quote it to Intuit
 *  support) and the Fault messages, e.g. a validation error on a create. */
export class QboApiError extends Error {
  readonly status: number;
  readonly intuitTid: string | null;
  readonly faults: string[];
  constructor(input: { method: string; path: string; status: number; intuitTid: string | null; faults: string[]; raw: string }) {
    const detail = input.faults.length ? input.faults.join("; ") : input.raw.slice(0, 300);
    super(`QuickBooks ${input.method} ${input.path} → ${input.status}${input.intuitTid ? ` [intuit_tid ${input.intuitTid}]` : ""}: ${detail}`);
    this.name = "QboApiError";
    this.status = input.status;
    this.intuitTid = input.intuitTid;
    this.faults = input.faults;
  }
}

/** Fault text from an Intuit error body: "Message: Detail (code N)". */
export function qboFaults(raw: string): string[] {
  try {
    const j = JSON.parse(raw) as { Fault?: { Error?: Array<{ Message?: string; Detail?: string; code?: string }> } };
    return (j.Fault?.Error ?? []).map((e) => [e.Message, e.Detail && e.Detail !== e.Message ? e.Detail : null].filter(Boolean).join(": ") + (e.code ? ` (code ${e.code})` : ""));
  } catch {
    return [];
  }
}
