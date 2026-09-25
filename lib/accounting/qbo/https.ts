// Real QuickBooks Online adapter (A14) — Intuit API v3 over HTTPS with an
// OAuth2 refresh-token flow. Only constructed when every credential is
// present AND outbound is allowed; it never runs in tests. Endpoints follow
// https://developer.intuit.com/app/developer/qbo/docs/api/accounting — the
// entity query uses the documented `query` endpoint with LastUpdatedTime.
// Nothing here is called until Joe connects the company (setup item).

import type { QboAdapter, QboDoc, QboEntityKind, } from "./types.ts";
import { QboNotConnectedError } from "./types.ts";

export interface IntuitCredentials {
  clientId: string;
  clientSecret: string;
  realmId: string;
  refreshToken: string;
  environment: "sandbox" | "production";
}

const BASE = { sandbox: "https://sandbox-quickbooks.api.intuit.com", production: "https://quickbooks.api.intuit.com" } as const;
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export class HttpsQbo implements QboAdapter {
  readonly environment: "sandbox" | "production";
  private access: { token: string; expiresAt: number } | null = null;
  constructor(private creds: IntuitCredentials) {
    this.environment = creds.environment;
  }

  private async token(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token;
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.creds.refreshToken }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new QboNotConnectedError(`Intuit token refresh failed (${res.status}); reconnect QuickBooks from Settings › Accounting.`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.access = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return this.access.token;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const t = await this.token();
    const res = await fetch(`${BASE[this.environment]}/v3/company/${this.creds.realmId}${path}${path.includes("?") ? "&" : "?"}minorversion=73`, {
      method,
      headers: { Authorization: `Bearer ${t}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`QuickBooks ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  async companyInfo() {
    const r = await this.call<{ CompanyInfo: { CompanyName: string } }>("GET", `/companyinfo/${this.creds.realmId}`);
    return { realmId: this.creds.realmId, companyName: r.CompanyInfo.CompanyName };
  }

  async listChanges(kind: QboEntityKind, sinceIso: string | null): Promise<QboDoc[]> {
    const where = sinceIso ? ` WHERE Metadata.LastUpdatedTime >= '${sinceIso}'` : "";
    const q = encodeURIComponent(`SELECT * FROM ${kind}${where} ORDERBY Metadata.LastUpdatedTime ASC MAXRESULTS 500`);
    const r = await this.call<{ QueryResponse: Record<string, QboDoc[] | undefined> }>("GET", `/query?query=${q}`);
    return r.QueryResponse[kind] ?? [];
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
}
