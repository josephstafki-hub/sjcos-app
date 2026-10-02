// Adapter selection (A14). Fake unless the Intuit credentials are present and
// outbound is allowed; tests always get the fake (SJC_OUTBOUND_DISABLED=1).

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeQbo } from "./fake.ts";
import { HttpsQbo } from "./https.ts";
import type { QboAdapter } from "./types.ts";

export type { QboAdapter, QboDoc, QboEntityKind } from "./types.ts";
export { QboNotConnectedError } from "./types.ts";
export { FakeQbo, fakeQbo } from "./fake.ts";

export function qboEnvironment(env: NodeJS.ProcessEnv = process.env): "fake" | "sandbox" | "production" {
  if (env.SJC_OUTBOUND_DISABLED === "1") return "fake";
  const e = (env.QBO_ENV ?? "").trim().toLowerCase();
  const have = ["INTUIT_CLIENT_ID", "INTUIT_CLIENT_SECRET", "QBO_REALM_ID", "QBO_REFRESH_TOKEN"].every((k) => (env[k] ?? "").trim());
  if ((e === "sandbox" || e === "production") && have) return e;
  return "fake";
}

/** The rotated refresh token lives in a 0600 file outside the repo and the
 *  database (QBO_TOKEN_FILE, default ~/.config/sjcos/qbo-refresh-token). */
export function fileTokenStore(file: string): { load(): string | null; save(token: string): void } {
  return {
    load() {
      try {
        return readFileSync(file, "utf8").trim() || null;
      } catch {
        return null;
      }
    },
    save(token: string) {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, `${token}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
    },
  };
}

let real: HttpsQbo | null = null;

export function getQboAdapter(env: NodeJS.ProcessEnv = process.env): QboAdapter {
  const which = qboEnvironment(env);
  if (which === "fake") return fakeQbo;
  if (!real || real.environment !== which) {
    real = new HttpsQbo({
      clientId: env.INTUIT_CLIENT_ID!.trim(),
      clientSecret: env.INTUIT_CLIENT_SECRET!.trim(),
      realmId: env.QBO_REALM_ID!.trim(),
      refreshToken: env.QBO_REFRESH_TOKEN!.trim(),
      environment: which,
      tokenStore: fileTokenStore((env.QBO_TOKEN_FILE ?? "").trim() || path.join(os.homedir(), ".config", "sjcos", "qbo-refresh-token")),
    });
  }
  return real;
}
