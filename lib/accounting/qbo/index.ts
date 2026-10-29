// Adapter selection (A14). Fake unless the Intuit app keys are present and
// outbound is allowed; tests always get the fake (SJC_OUTBOUND_DISABLED=1).
//
// Which company the adapter talks to comes from, in order:
//   1. the connection file written by "Connect to QuickBooks"
//      (QBO_CONNECTION_FILE, default ~/.config/sjcos/qbo-connection.json),
//      but only when it was written for the current QBO_ENV.
//      A "disconnected" record there means the owner pressed Disconnect, and
//      the adapter refuses every call until Connect runs again.
//   2. QBO_REALM_ID + QBO_REFRESH_TOKEN in .env.local, the older
//      playground-pasted setup. It stays as a fallback so an existing
//      connection keeps working until the owner reconnects with the button.

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeQbo } from "./fake.ts";
import { HttpsQbo } from "./https.ts";
import { QboNotConnectedError, type QboAdapter, type QboDoc } from "./types.ts";

export type { QboAdapter, QboDoc, QboEntityKind } from "./types.ts";
export { QboNotConnectedError } from "./types.ts";
export { FakeQbo, fakeQbo } from "./fake.ts";

type RealEnv = "sandbox" | "production";

/** Intuit app keys present for the chosen QBO_ENV. That is all "Connect"
 *  needs. The company itself is picked at Intuit. */
export function qboOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const e = (env.QBO_ENV ?? "").trim().toLowerCase();
  return (e === "sandbox" || e === "production") && ["INTUIT_CLIENT_ID", "INTUIT_CLIENT_SECRET"].every((k) => (env[k] ?? "").trim());
}

export function qboEnvironment(env: NodeJS.ProcessEnv = process.env): "fake" | "sandbox" | "production" {
  if (env.SJC_OUTBOUND_DISABLED === "1") return "fake";
  if (!qboOAuthConfigured(env)) return "fake";
  return (env.QBO_ENV ?? "").trim().toLowerCase() as RealEnv;
}

export function qboTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  return (env.QBO_TOKEN_FILE ?? "").trim() || path.join(os.homedir(), ".config", "sjcos", "qbo-refresh-token");
}

export function qboConnectionFile(env: NodeJS.ProcessEnv = process.env): string {
  return (env.QBO_CONNECTION_FILE ?? "").trim() || path.join(os.homedir(), ".config", "sjcos", "qbo-connection.json");
}

function writePrivate(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** The rotated refresh token lives in a 0600 file outside the repo and the
 *  database, so no agent tool can read it. */
export function fileTokenStore(file: string): { load(): string | null; save(token: string): void; clear(): void } {
  return {
    load() {
      try {
        return readFileSync(file, "utf8").trim() || null;
      } catch {
        return null;
      }
    },
    save(token: string) {
      writePrivate(file, `${token}\n`);
    },
    clear() {
      rmSync(file, { force: true });
    },
  };
}

export type QboConnectionRecord = { environment: RealEnv; realmId: string | null; disconnected?: boolean; at: string };

export function readConnectionRecord(file: string): QboConnectionRecord | null {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as Partial<QboConnectionRecord>;
    if (j.environment !== "sandbox" && j.environment !== "production") return null;
    return { environment: j.environment, realmId: typeof j.realmId === "string" && j.realmId ? j.realmId : null, disconnected: j.disconnected === true, at: String(j.at ?? "") };
  } catch {
    return null;
  }
}

export function writeConnectionRecord(file: string, rec: QboConnectionRecord): void {
  writePrivate(file, `${JSON.stringify(rec, null, 2)}\n`);
}

/** Where the current connection comes from. `refreshSeed` is only the env
 *  token, used solely for the env setup: a button connection never falls back
 *  to a token that may belong to a different company. */
export type QboConnectionSource = { realmId: string | null; refreshSeed: string; disconnected: boolean; via: "button" | "env" | "none" };

export function qboConnectionSource(env: NodeJS.ProcessEnv = process.env): QboConnectionSource {
  const which = (env.QBO_ENV ?? "").trim().toLowerCase();
  const rec = readConnectionRecord(qboConnectionFile(env));
  if (rec && rec.environment === which) {
    if (rec.disconnected) return { realmId: rec.realmId, refreshSeed: "", disconnected: true, via: "button" };
    if (rec.realmId) return { realmId: rec.realmId, refreshSeed: "", disconnected: false, via: "button" };
  }
  const realm = (env.QBO_REALM_ID ?? "").trim();
  const seed = (env.QBO_REFRESH_TOKEN ?? "").trim();
  if (realm && seed) return { realmId: realm, refreshSeed: seed, disconnected: false, via: "env" };
  return { realmId: realm || null, refreshSeed: "", disconnected: false, via: "none" };
}

/** Stand-in when there is no company to talk to: every call says why. */
class NotConnectedQbo implements QboAdapter {
  readonly environment: RealEnv;
  private why: string;
  constructor(environment: RealEnv, why: string) {
    this.environment = environment;
    this.why = why;
  }
  private fail(): Promise<never> {
    return Promise.reject(new QboNotConnectedError(this.why));
  }
  companyInfo(): Promise<{ realmId: string; companyName: string }> {
    return this.fail();
  }
  listChanges(): Promise<QboDoc[]> {
    return this.fail();
  }
  get(): Promise<QboDoc | null> {
    return this.fail();
  }
  create(): Promise<QboDoc> {
    return this.fail();
  }
}

export const QBO_DISCONNECTED_MESSAGE = "QuickBooks was disconnected in SJC OS. Use Connect to QuickBooks on Settings › Accounting to reconnect.";
export const QBO_NEVER_CONNECTED_MESSAGE = "QuickBooks is not connected yet. Use Connect to QuickBooks on Settings › Accounting.";

let cached: { key: string; adapter: QboAdapter } | null = null;

/** The adapter for the current connection. Rebuilt whenever the connection
 *  changes, so a Connect or Disconnect in the app takes effect in every
 *  process (app, worker, MCP) on its next call, with no restart. */
export function getQboAdapter(env: NodeJS.ProcessEnv = process.env): QboAdapter {
  const which = qboEnvironment(env);
  if (which === "fake") return fakeQbo;
  const src = qboConnectionSource(env);
  const key = `${which}|${src.via}|${src.realmId ?? ""}|${src.disconnected}|${src.refreshSeed}`;
  if (cached?.key === key) return cached.adapter;
  let adapter: QboAdapter;
  if (src.disconnected) adapter = new NotConnectedQbo(which, QBO_DISCONNECTED_MESSAGE);
  else if (!src.realmId || src.via === "none") adapter = new NotConnectedQbo(which, QBO_NEVER_CONNECTED_MESSAGE);
  else
    adapter = new HttpsQbo({
      clientId: env.INTUIT_CLIENT_ID!.trim(),
      clientSecret: env.INTUIT_CLIENT_SECRET!.trim(),
      realmId: src.realmId,
      refreshToken: src.refreshSeed,
      environment: which,
      tokenStore: fileTokenStore(qboTokenFile(env)),
    });
  cached = { key, adapter };
  return adapter;
}

/** Drop the cached adapter (after a new token is saved for the same company). */
export function resetQboAdapter(): void {
  cached = null;
}
