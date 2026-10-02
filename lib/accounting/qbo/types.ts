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
}

export class QboNotConnectedError extends Error {
  constructor(msg = "QuickBooks Online is not connected (INTUIT_CLIENT_ID / QBO_REALM_ID / QBO_REFRESH_TOKEN unset).") {
    super(msg);
    this.name = "QboNotConnectedError";
  }
}
