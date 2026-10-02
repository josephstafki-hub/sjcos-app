import { NextResponse } from "next/server";
import { servicePrincipal } from "@/lib/commands/db";
import { runPaymentsReconcile } from "@/lib/payments/server";

// GET/POST /api/cron/payments-reconcile — poll pending / unknown Square
// attempts (missed webhooks, accepted-then-timeout), settle or fail them
// from provider state, escalate stale pending via a 'payment_stale' decision.
// Machine-triggered by deploy/sjcos-payments-reconcile.timer; CRON_SECRET.
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const principal = servicePrincipal(req, "cron:payments-reconcile");
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runPaymentsReconcile(principal);
  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), ...result });
}

export const GET = handle;
export const POST = handle;
