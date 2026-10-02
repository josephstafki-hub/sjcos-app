"use server";

// Owner-only settings actions for customer payments (A20). Public config
// only — the access token and webhook signature key are environment
// variables and are never written here.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { query } from "@/lib/db";
import { withTransaction, userPrincipal } from "@/lib/commands/db";
import { getSquareAdapter, squareEnvironment } from "./square/index";
import { stageRefundDecision, executeRefund } from "./service";

type Result = { ok: boolean; error?: string };

export async function saveSquareConfig(formData: FormData): Promise<void> {
  await requireRole("owner");
  const environment = String(formData.get("environment") ?? "sandbox") === "production" ? "production" : "sandbox";
  const locationId = String(formData.get("locationId") ?? "").trim();
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  const notificationUrl = String(formData.get("notificationUrl") ?? "").trim();
  const state = locationId && applicationId ? "configured" : "unconfigured";
  await query(
    `INSERT INTO payment_provider_config (provider, environment, location_id, application_id, notification_url, connection_state)
     VALUES ('square', $1, $2, $3, $4, $5)
     ON CONFLICT (provider) DO UPDATE SET environment = EXCLUDED.environment, location_id = EXCLUDED.location_id, application_id = EXCLUDED.application_id,
       notification_url = EXCLUDED.notification_url,
       connection_state = CASE WHEN payment_provider_config.connection_state = 'connected' AND EXCLUDED.connection_state = 'configured' THEN 'configured' ELSE EXCLUDED.connection_state END,
       verified_at = NULL`,
    [environment, locationId, applicationId, notificationUrl, state],
  );
  revalidatePath("/settings/payments");
}

export async function saveOfflineInstructions(formData: FormData): Promise<void> {
  await requireRole("owner");
  const text = String(formData.get("instructions") ?? "").trim().slice(0, 2000);
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('payments.offline_instructions', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [text],
  );
  revalidatePath("/settings/payments");
}

/** "Test connection": asks the adapter (fake in tests / unconfigured
 *  installs) for the location's verified capabilities and records them. */
export async function testSquareConnection(): Promise<Result & { capabilities?: Record<string, unknown> }> {
  await requireRole("owner");
  const rows = await query<{ location_id: string }>(`SELECT location_id FROM payment_provider_config WHERE provider = 'square'`);
  const locationId = rows.rows[0]?.location_id || null;
  const adapter = getSquareAdapter();
  try {
    const caps = await adapter.verifyConnection(locationId);
    const connected = caps.merchantApproved && (caps.card || caps.ach);
    await query(
      `INSERT INTO payment_provider_config (provider, connection_state, capabilities, verified_at, last_error)
       VALUES ('square', $1, $2::jsonb, now(), NULL)
       ON CONFLICT (provider) DO UPDATE SET connection_state = EXCLUDED.connection_state, capabilities = EXCLUDED.capabilities, verified_at = now(), last_error = NULL`,
      [connected ? "connected" : "configured", JSON.stringify({ merchant_approved: caps.merchantApproved, card: caps.card, ach: caps.ach, refunds: caps.refunds, location_name: caps.locationName ?? null, note: caps.note ?? null, adapter: squareEnvironment() })],
    );
    revalidatePath("/settings/payments");
    return { ok: true, capabilities: caps as unknown as Record<string, unknown> };
  } catch (err) {
    await query(
      `INSERT INTO payment_provider_config (provider, connection_state, last_error) VALUES ('square', 'error', $1)
       ON CONFLICT (provider) DO UPDATE SET connection_state = 'error', last_error = EXCLUDED.last_error`,
      [String((err as Error).message).slice(0, 500)],
    );
    revalidatePath("/settings/payments");
    return { ok: false, error: (err as Error).message };
  }
}

/** Stage the one-tap refund decision for a completed payment. */
export async function requestRefund(attemptId: string, input: { amountCents: number; reason: string }): Promise<Result & { decisionId?: string }> {
  const user = await requireRole("owner", "staff");
  try {
    const { decision } = await withTransaction((run) => stageRefundDecision(run, { attemptId, amountCents: Math.round(Number(input.amountCents)), reason: input.reason, principal: userPrincipal(user) }));
    return { ok: true, decisionId: decision.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Execute an approved refund decision (the decision surface calls this). */
export async function executeApprovedRefund(decisionId: string): Promise<Result> {
  const user = await requireRole("owner", "staff");
  const r = await executeRefund(withTransaction, getSquareAdapter(), { decisionId, principal: userPrincipal(user) });
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}
