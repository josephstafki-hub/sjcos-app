import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { getProviderConfig } from "@/lib/payments/server";
import { squareEnvironment } from "@/lib/payments/square/index";
import { saveSquareConfig, saveOfflineInstructions, testSquareConnection } from "@/lib/payments/actions";
import { PaymentsSettingsButtons } from "@/components/money/PaymentsSettingsButtons";

// Settings › Payments (A20). Owner-only. Connection status, environment,
// location, verified capability checklist, "Test connection", the client
// portal's offline instructions, and the setup checklist for Joe. Secrets
// are environment variables — shown as present/absent, never as values.
export default async function PaymentsSettingsPage() {
  await requireRole("owner");
  const cfg = await getProviderConfig();
  const env = squareEnvironment();
  const offline = await queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'payments.offline_instructions'`);
  const caps = (cfg?.capabilities ?? {}) as { merchant_approved?: boolean; card?: boolean; ach?: boolean; refunds?: boolean; location_name?: string | null; note?: string | null };
  const secrets = {
    accessToken: !!(process.env.SQUARE_ACCESS_TOKEN ?? "").trim(),
    signatureKey: !!(process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "").trim(),
    notificationUrl: (process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? "").trim(),
    envName: (process.env.SQUARE_ENV ?? "").trim() || "(unset)",
  };
  const state = cfg?.connection_state ?? "unconfigured";
  const chip = state === "connected" ? "money" : state === "error" ? "flag" : state === "configured" ? "accent" : "ghost";

  const checklist: { label: string; ok: boolean }[] = [
    { label: "Merchant account approved", ok: caps.merchant_approved === true },
    { label: "Card payments", ok: caps.card === true },
    { label: "ACH bank transfers", ok: caps.ach === true },
    { label: "Refunds", ok: caps.refunds === true },
  ];

  return (
    <Shell breadcrumb="SETTINGS / PAYMENTS">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        <div>
          <Eyebrow>Customer payments</Eyebrow>
          <h1 className="mt-1 font-serif text-[24px] font-medium text-ink">Square — card and bank transfer</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            Clients pay open invoices from their portal. The adapter runs in <b>{env}</b> mode
            {env === "fake" ? " (no account connected: payments are recorded as test payments, nothing is charged)" : ""}.
          </p>
        </div>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Connection</span>
            <Chip kind={chip} dot>{state}</Chip>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1 text-[12.5px] text-ink-2 sm:grid-cols-2">
            <div>Environment: <span className="font-mono">{cfg?.environment ?? "sandbox"}</span></div>
            <div>SQUARE_ENV: <span className="font-mono">{secrets.envName}</span></div>
            <div>Location: <span className="font-mono">{cfg?.location_id || "—"}</span>{caps.location_name ? ` (${caps.location_name})` : ""}</div>
            <div>Application id: <span className="font-mono">{cfg?.application_id || "—"}</span></div>
            <div>Access token (env): {secrets.accessToken ? "present" : "missing"}</div>
            <div>Webhook signature key (env): {secrets.signatureKey ? "present" : "missing"}</div>
            <div className="sm:col-span-2">Webhook notification URL (env): <span className="font-mono">{secrets.notificationUrl || "—"}</span></div>
            <div className="sm:col-span-2">Last verified: {cfg?.verified_at ?? "never"}{cfg?.last_error ? ` · error: ${cfg.last_error}` : ""}{caps.note ? ` · ${caps.note}` : ""}</div>
          </div>
          <ul className="mt-3 flex flex-col gap-1">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[12.5px]">
                <span className={`inline-block h-2 w-2 rounded-full ${c.ok ? "bg-money" : "bg-ink-4"}`} />
                <span className={c.ok ? "text-ink" : "text-ink-3"}>{c.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <PaymentsSettingsButtons test={testSquareConnection} />
          </div>
        </Card>

        <Card className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Public configuration</div>
          <form action={saveSquareConfig} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">
              Environment
              <select name="environment" defaultValue={cfg?.environment ?? "sandbox"} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-[13px] text-ink">
                <option value="sandbox">sandbox</option>
                <option value="production">production</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">
              Location id
              <input name="locationId" defaultValue={cfg?.location_id ?? ""} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-[13px] text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">
              Application id (public)
              <input name="applicationId" defaultValue={cfg?.application_id ?? ""} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-[13px] text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">
              Notification URL registered with Square
              <input name="notificationUrl" defaultValue={cfg?.notification_url ?? "https://os.sjcarpentryllc.com/api/webhooks/square"} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-[13px] text-ink" />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper">Save</button>
            </div>
          </form>
        </Card>

        <Card className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">What clients see when online payment is off</div>
          <form action={saveOfflineInstructions} className="mt-2 flex flex-col gap-2">
            <textarea name="instructions" rows={3} defaultValue={offline?.value ?? ""} placeholder="Pay by check to SJ Carpentry LLC, or use the payment link Joe sends you." className="rounded-md border border-rule bg-paper px-2 py-1.5 text-[13px] text-ink" />
            <div>
              <button type="submit" className="rounded-md border border-rule px-3 py-1.5 text-[12px] text-ink">Save text</button>
            </div>
          </form>
        </Card>

        <Card kind="soft" className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Setup checklist (Joe)</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] text-ink-2">
            <li>Open a Square account and complete merchant identity verification (SJ Carpentry LLC).</li>
            <li>In the Square Developer dashboard create an application; copy the <b>sandbox</b> Application ID + Access Token first, then production once approved.</li>
            <li>Enable ACH (bank transfer) on the account; it is a separate Square entitlement.</li>
            <li>Register the webhook subscription (payment.created, payment.updated, refund.created, refund.updated) at the notification URL above and copy the signature key.</li>
            <li>Put <span className="font-mono">SQUARE_ENV</span>, <span className="font-mono">SQUARE_ACCESS_TOKEN</span>, <span className="font-mono">SQUARE_WEBHOOK_SIGNATURE_KEY</span>, <span className="font-mono">SQUARE_WEBHOOK_NOTIFICATION_URL</span> in .env.local and restart sjcos.service.</li>
            <li>Save the location + application id here, press <b>Test connection</b>, and pay a $1 sandbox invoice from a test client portal.</li>
            <li>Enable the <span className="font-mono">sjcos-payments-reconcile.timer</span> (deploy/) so missed webhooks settle within 15 minutes.</li>
          </ol>
        </Card>
      </div>
    </Shell>
  );
}
