// Adapter selection (A14). Fake unless the Intuit credentials are present and
// outbound is allowed; tests always get the fake (SJC_OUTBOUND_DISABLED=1).

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
    });
  }
  return real;
}
