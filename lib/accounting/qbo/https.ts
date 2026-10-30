// Real QuickBooks Online adapter (A14) — Intuit API v3 over HTTPS with an
// OAuth2 refresh-token flow. Only constructed when every credential is
// present AND outbound is allowed; it never runs in tests. Endpoints follow
// https://developer.intuit.com/app/developer/qbo/docs/api/accounting — the
// entity query uses the documented `query` endpoint with LastUpdatedTime.
// Nothing here is called until Joe connects the company (setup item).

import type { QboAdapter, QboDeleted, QboDoc, QboEntityKind } from "./types.ts";
import { QboApiError, QboNotConnectedError, qboFaults } from "./types.ts";

export interface IntuitCredentials {
  clientId: string;
  clientSecret: string;
  realmId: string;
  refreshToken: string;
  environment: "sandbox" | "production";
  /** Where the rotated refresh token is kept between runs. */
  tokenStore?: { load(): string | null; save(token: string): void };
}

const BASE = { sandbox: "https://sandbox-quickbooks.api.intuit.com", production: "https://quickbooks.api.intuit.com" } as const;
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
/** QuickBooks' maximum rows per query page. */
export const QBO_PAGE_SIZE = 1000;
/** Pages per record type per pass (50,000 rows); more resumes next pass. */
export const QBO_PAGE_CAP = 50;

export class HttpsQbo implements QboAdapter {
  readonly environment: "sandbox" | "production";
  private access: { token: string; expiresAt: number } | null = null;
  private creds: IntuitCredentials;
  constructor(creds: IntuitCredentials) {
    this.creds = creds;
    this.environment = creds.environment;
  }

  /** Intuit ROTATES the refresh token (the value can change on any refresh and
   *  the old one stops working about a day later). The newest one is kept in
   *  the token store — a 0600 file outside the repo and the database, so no
   *  agent tool can read it. "Connect to QuickBooks" writes it; for the older
   *  env setup, QBO_REFRESH_TOKEN in .env.local is the seed, and a stale stored
   *  value falls through to it. */
  private async token(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token;
    const stored = this.creds.tokenStore?.load() ?? null;
    const candidates = [...new Set([stored, this.creds.refreshToken].filter((t): t is string => Boolean(t)))];
    let lastStatus = 0;
    let lastTid: string | null = null;
    for (const refreshToken of candidates) {
      const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64");
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        lastStatus = res.status;
        lastTid = res.headers?.get?.("intuit_tid") ?? lastTid;
        continue; // a stale stored token falls through to the env seed
      }
      const j = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
      if (j.refresh_token && j.refresh_token !== stored) this.creds.tokenStore?.save(j.refresh_token);
      this.access = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
      return this.access.token;
    }
    const msg = `Intuit token refresh failed (${lastStatus})${lastTid ? ` [intuit_tid ${lastTid}]` : ""}; reconnect QuickBooks: use Connect to QuickBooks on Settings › Accounting.`;
    console.error(`[qbo] ${msg}`);
    throw new QboNotConnectedError(msg);
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const t = await this.token();
    const res = await fetch(`${BASE[this.environment]}/v3/company/${this.creds.realmId}${path}${path.includes("?") ? "&" : "?"}minorversion=73`, {
      method,
      headers: { Authorization: `Bearer ${t}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const raw = await res.text();
      const err = new QboApiError({ method, path: path.split("?")[0], status: res.status, intuitTid: res.headers?.get?.("intuit_tid") ?? null, faults: qboFaults(raw), raw });
      // The service journal is the shareable log: one line per failed call,
      // with the intuit_tid Intuit support asks for.
      console.error(`[qbo] ${err.message}`);
      throw err;
    }
    return (await res.json()) as T;
  }

  async companyInfo() {
    const r = await this.call<{ CompanyInfo: { CompanyName: string } }>("GET", `/companyinfo/${this.creds.realmId}`);
    return { realmId: this.creds.realmId, companyName: r.CompanyInfo.CompanyName };
  }

  /** Every record of `kind` changed since `sinceIso`, oldest first. Pages
   *  through QuickBooks' 1000-row query limit with STARTPOSITION. One page
   *  used to be the whole answer, so a company with more than 500 purchases
   *  got only the first 500 per pass, and 500+ records saved in the same
   *  second could stall the cursor for good. Stops after QBO_PAGE_CAP pages;
   *  the cursor then resumes from the newest record seen. */
  async listChanges(kind: QboEntityKind, sinceIso: string | null): Promise<QboDoc[]> {
    const where = sinceIso ? ` WHERE Metadata.LastUpdatedTime >= '${sinceIso}'` : "";
    const all: QboDoc[] = [];
    for (let page = 0; page < QBO_PAGE_CAP; page++) {
      const start = page * QBO_PAGE_SIZE + 1;
      const q = encodeURIComponent(`SELECT * FROM ${kind}${where} ORDERBY Metadata.LastUpdatedTime ASC STARTPOSITION ${start} MAXRESULTS ${QBO_PAGE_SIZE}`);
      const r = await this.call<{ QueryResponse: Record<string, QboDoc[] | undefined> }>("GET", `/query?query=${q}`);
      const rows = r.QueryResponse[kind] ?? [];
      all.push(...rows);
      if (rows.length < QBO_PAGE_SIZE) break;
    }
    return all;
  }

  async get(kind: QboEntityKind, id: string): Promise<QboDoc | null> {
    try {
      const r = await this.call<Record<string, QboDoc>>("GET", `/${kind.toLowerCase()}/${id}`);
      return r[kind] ?? null;
    } catch {
      return null;
    }
  }

  async create(kind: QboEntityKind, doc: Partial<QboDoc>): Promise<QboDoc> {
    const r = await this.call<Record<string, QboDoc>>("POST", `/${kind.toLowerCase()}`, doc);
    return r[kind];
  }

  async findBy(kind: QboEntityKind, field: "DocNumber" | "DisplayName", value: string): Promise<QboDoc[]> {
    // QuickBooks query strings escape a quote with a backslash.
    const v = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = encodeURIComponent(`SELECT * FROM ${kind} WHERE ${field} = '${v}' MAXRESULTS 20`);
    const r = await this.call<{ QueryResponse: Record<string, QboDoc[] | undefined> }>("GET", `/query?query=${q}`);
    return r.QueryResponse[kind] ?? [];
  }

  /** Change Data Capture: the only QuickBooks endpoint that reports deletes
   *  (as `status: "Deleted"`). It refuses a changedSince older than 30 days,
   *  so the window is clamped. */
  async listDeleted(kinds: QboEntityKind[], sinceIso: string): Promise<QboDeleted[]> {
    if (!kinds.length) return [];
    const floor = Date.now() - 29 * 86_400_000;
    const since = new Date(Math.max(Date.parse(sinceIso) || floor, floor)).toISOString();
    const r = await this.call<{ CDCResponse?: Array<{ QueryResponse?: Array<Record<string, Array<QboDoc & { status?: string }> | undefined>> }> }>(
      "GET",
      `/cdc?entities=${kinds.join(",")}&changedSince=${encodeURIComponent(since)}`,
    );
    const out: QboDeleted[] = [];
    for (const qr of r.CDCResponse?.[0]?.QueryResponse ?? []) {
      for (const kind of kinds) {
        for (const d of qr[kind] ?? []) if (d.status === "Deleted") out.push({ kind, id: d.Id, at: d.MetaData?.LastUpdatedTime ?? null });
      }
    }
    return out;
  }
}
