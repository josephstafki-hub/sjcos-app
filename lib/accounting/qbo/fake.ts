// In-memory QuickBooks company (A14 test/sandbox seam). Deterministic ids,
// version (SyncToken) bumps on edit, voids, and change listing by
// LastUpdatedTime — enough to prove re-import/export idempotency, external
// edits/voids surfacing as conflicts, and gross/fee/net reconciliation
// without any network. `reset()` between tests; `mutate()`/`void_()` are the
// "bookkeeper edited it in QBO" seams.

import type { QboAdapter, QboDoc, QboEntityKind } from "./types.ts";

export class FakeQbo implements QboAdapter {
  readonly environment = "fake" as const;
  private seq = 100;
  private docs = new Map<string, QboDoc[]>();
  private clock = Date.parse("2026-09-20T12:00:00Z");
  realmId = "fake-realm";
  companyName = "SJ Carpentry LLC (fake)";

  reset(): void {
    this.docs.clear();
    this.seq = 100;
    this.clock = Date.parse("2026-09-20T12:00:00Z");
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private list(kind: QboEntityKind): QboDoc[] {
    if (!this.docs.has(kind)) this.docs.set(kind, []);
    return this.docs.get(kind)!;
  }

  async companyInfo() {
    return { realmId: this.realmId, companyName: this.companyName };
  }

  async listChanges(kind: QboEntityKind, sinceIso: string | null): Promise<QboDoc[]> {
    const since = sinceIso ? Date.parse(sinceIso) : -Infinity;
    return this.list(kind)
      .filter((d) => Date.parse(d.MetaData?.LastUpdatedTime ?? "1970-01-01") >= since)
      .sort((a, b) => Date.parse(a.MetaData!.LastUpdatedTime!) - Date.parse(b.MetaData!.LastUpdatedTime!))
      .map((d) => structuredClone(d));
  }

  async get(kind: QboEntityKind, id: string): Promise<QboDoc | null> {
    const d = this.list(kind).find((x) => x.Id === id);
    return d ? structuredClone(d) : null;
  }

  async create(kind: QboEntityKind, doc: Partial<QboDoc>): Promise<QboDoc> {
    const now = this.tick();
    const full: QboDoc = { ...doc, Id: String(++this.seq), SyncToken: "0", MetaData: { CreateTime: now, LastUpdatedTime: now } } as QboDoc;
    this.list(kind).push(full);
    return structuredClone(full);
  }

  /** Test seam: a bookkeeper edited the document in QBO (version bumps). */
  mutate(kind: QboEntityKind, id: string, patch: Partial<QboDoc>): QboDoc {
    const d = this.list(kind).find((x) => x.Id === id);
    if (!d) throw new Error(`fake qbo: no ${kind} ${id}`);
    Object.assign(d, patch);
    d.SyncToken = String(Number(d.SyncToken) + 1);
    d.MetaData = { ...(d.MetaData ?? {}), LastUpdatedTime: this.tick() };
    return structuredClone(d);
  }

  /** Test seam: voided in QBO. */
  void_(kind: QboEntityKind, id: string): QboDoc {
    return this.mutate(kind, id, { Voided: true, TotalAmt: 0 });
  }
}

export const fakeQbo = new FakeQbo();
