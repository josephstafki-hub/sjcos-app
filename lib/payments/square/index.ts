// Adapter selection (A20). Fake unless the real credentials AND an explicit
// environment are present and outbound is allowed. Tests always get the fake
// because the harness sets SJC_OUTBOUND_DISABLED=1.

import type { SquareAdapter, SquareEnvironment } from "./types.ts";
import { fakeSquare } from "./fake.ts";
import { HttpsSquare } from "./https.ts";

export type { SquareAdapter, SquareEnvironment } from "./types.ts";

export function squareEnvironment(env: NodeJS.ProcessEnv = process.env): SquareEnvironment {
  if (env.SJC_OUTBOUND_DISABLED === "1") return "fake";
  const e = (env.SQUARE_ENV ?? "").trim().toLowerCase();
  if ((e === "sandbox" || e === "production") && (env.SQUARE_ACCESS_TOKEN ?? "").trim()) return e;
  return "fake";
}

let real: HttpsSquare | null = null;

export function getSquareAdapter(env: NodeJS.ProcessEnv = process.env): SquareAdapter {
  const which = squareEnvironment(env);
  if (which === "fake") return fakeSquare;
  if (!real || real.environment !== which) real = new HttpsSquare({ environment: which, accessToken: env.SQUARE_ACCESS_TOKEN!.trim() });
  return real;
}

/** Webhook verification inputs. The signature key and notification URL are
 *  environment / config values, never request-supplied. */
export function squareWebhookConfig(env: NodeJS.ProcessEnv = process.env): { signatureKey: string; notificationUrl: string } {
  return { signatureKey: (env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "").trim(), notificationUrl: (env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? "").trim() };
}
