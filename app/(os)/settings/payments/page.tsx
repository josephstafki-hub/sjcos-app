import { Shell } from "@/components/shell/Shell";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { squareReadiness } from "@/lib/payments/readiness";
import { Card, Chip, Eyebrow, PageHeader, Button } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { getProviderConfig } from "@/lib/payments/server";
import { squareEnvironment } from "@/lib/payments/square/index";
import { saveSquareConfig, saveOfflineInstructions, saveCardSurcharge, testSquareConnection } from "@/lib/payments/actions";
import { fmtPct, offsetPct, parseSurchargeConfig, surchargeNotice, surchargePct, SURCHARGE_SETTING_KEY } from "@/lib/payments/surcharge";
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
  const surcharge = parseSurchargeConfig((await queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [SURCHARGE_SETTING_KEY]))?.value);
  const surchargeBrands = [
    { key: "VISA", label: "Visa" },
    { key: "MASTERCARD", label: "Mastercard" },
    { key: "AMERICAN_EXPRESS", label: "American Express" },
    { key: "DISCOVER", label: "Discover" },
  ];
  const readiness = squareReadiness(env, cfg);
  const caps = readiness.capabilities as { merchant_approved?: boolean; card?: boolean; ach?: boolean; refunds?: boolean; location_name?: string };
  const state = readiness.connected ? (env === "sandbox" ? "Test account" : "Connected") : "Not connected";
  const chip = readiness.connected ? (env === "sandbox" ? "info" : "money") : "ghost";

  const checklist: { label: string; ok: boolean }[] = [
    { label: "Merchant approval", ok: caps.merchant_approved === true },
    { label: "Card payments", ok: caps.card === true },
    { label: "ACH bank transfers", ok: caps.ach === true },
    { label: "Refunds", ok: caps.refunds === true },
  ];

  return (
    <Shell breadcrumb="SETTINGS / PAYMENTS">
      <SettingsSection active="/settings/payments">
        <PageHeader title="Square payments" meta="Card and bank transfer payments from the client portal." />
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-meta text-ink-3">Connection</span>
            <Chip kind={chip} dot>{state}</Chip>
          </div>
          <div className="mt-3 text-body text-ink-2">
            {!readiness.connected ? <p>Not connected — add your Square keys. <a href="#square-setup" className="text-accent-2 underline">Follow the setup checklist</a>.</p> : <p>{env === 'sandbox' ? 'Test account verified. No real money is charged.' : `Account verified${caps.location_name ? ` · ${caps.location_name}` : ''}.`}</p>}
            {env === 'fake' && <p className="mt-1 text-meta text-ink-3">Test payments are simulated. No Square account is connected.</p>}
            {readiness.connected&&<p className="mt-1 text-meta text-ink-3">Last checked: {cfg?.verified_at ? new Date(cfg.verified_at).toLocaleString() : 'Not yet checked'}</p>}
          </div>
          <ul className="mt-3 flex flex-col gap-1">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-body">
                <span className={`inline-block h-2 w-2 rounded-full ${c.ok ? "bg-money" : "bg-ink-4"}`} />
                <span className={c.ok ? "text-ink" : "text-ink-3"}>{env === "sandbox" && readiness.connected ? `Test · ${c.label}` : c.label}{!readiness.connected ? " · Not verified" : ""}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <PaymentsSettingsButtons test={testSquareConnection} />
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-meta text-ink-3">Public configuration</div>
          <SettingsForm action={saveSquareConfig} className="mt-2 grid grid-cols-1 gap-2 @xl/page:grid-cols-2">
            <label className="flex flex-col gap-1 text-meta text-ink-3">
              Environment
              <select name="environment" defaultValue={cfg?.environment ?? "sandbox"} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-body text-ink">
                <option value="sandbox">sandbox</option>
                <option value="production">production</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-meta text-ink-3">
              Location id
              <input name="locationId" defaultValue={cfg?.location_id ?? ""} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-body text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-meta text-ink-3">
              Application id (public)
              <input name="applicationId" defaultValue={cfg?.application_id ?? ""} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-body text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-meta text-ink-3">
              Notification URL registered with Square
              <input name="notificationUrl" defaultValue={cfg?.notification_url ?? "https://os.sjcarpentryllc.com/api/webhooks/square"} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-body text-ink" />
            </label>

          </SettingsForm>
        </Card>

        <Card className="p-3">
          <div className="text-meta text-ink-3">Credit card surcharge</div>
          <p className="mt-1 text-meta text-ink-3">
            Credit cards pay enough on top of the invoice to cover Square&rsquo;s fee, up to each brand&rsquo;s cap. Debit and prepaid cards, bank transfer and check pay no surcharge. Square&rsquo;s own surcharge setting doesn&rsquo;t reach online payments, so this is what applies on the client portal.
          </p>
          <SettingsForm action={saveCardSurcharge} className="mt-2 grid gap-2 @xl/page:grid-cols-2">
            <label className="flex flex-col gap-1 text-meta text-ink-2">
              Square&rsquo;s fee per card payment (%) — 0 turns the surcharge off
              <input name="feePct" type="number" step="0.01" min="0" max="20" defaultValue={surcharge.feePct} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-body text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-meta text-ink-2">
              Cap for any brand not listed below (%)
              <input name="capPct" type="number" step="0.01" min="0" max="5" defaultValue={surcharge.capPct} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-body text-ink" />
            </label>
            {surchargeBrands.map((b) => (
              <label key={b.key} className="flex flex-col gap-1 text-meta text-ink-2">
                {b.label} cap (%) — blank uses the cap above
                <input name={`cap_${b.key}`} type="number" step="0.01" min="0" max="5" defaultValue={surcharge.brandCapPct[b.key] ?? ""} className="rounded-md border border-rule bg-paper px-2 py-1.5 text-body text-ink" />
              </label>
            ))}
            <div className="@xl/page:col-span-2 text-meta text-ink-3">
              Covering a {fmtPct(surcharge.feePct)} fee in full takes {fmtPct(offsetPct(surcharge))}. Charged now:{" "}
              {surchargeBrands.map((b) => `${b.label} ${fmtPct(surchargePct(surcharge, b.key))}`).join(" · ")}
              {" · other brands "}{fmtPct(surchargePct(surcharge, null))}.
              <br />
              Clients read: {surchargeNotice(surcharge) ?? "(no surcharge notice — surcharge is off)"}
            </div>

          </SettingsForm>
        </Card>

        <Card className="p-3">
          <div className="text-meta text-ink-3">What clients see when online payment is off</div>
          <SettingsForm action={saveOfflineInstructions} className="mt-2 flex flex-col gap-2">
            <textarea name="instructions" rows={3} defaultValue={offline?.value ?? ""} placeholder="Pay by check to SJ Carpentry LLC, or use the payment link Joe sends you." className="rounded-md border border-rule bg-paper px-2 py-1.5 text-body text-ink" />

          </SettingsForm>
        </Card>

        <Card id="square-setup" className="p-4">
          <h2 className="text-subheading font-semibold text-ink">Connect your Square account</h2>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-body text-ink-2">
            <li>Sign in to Square and finish your business verification for SJ Carpentry LLC.</li>
            <li>Open <a href="https://developer.squareup.com/apps" target="_blank" rel="noopener noreferrer" className="text-accent-2 underline">Square applications</a>, select your application, then Credentials. Choose test or production keys.</li>
            <li>Have your account administrator securely install your Square access and payment notification keys. Secret keys cannot be entered on this page.</li>
            <li>Save the matching application and location details above. Select Test connection to check the account.</li>
            <li>Before accepting real payments, have your administrator confirm payment notifications and reconciliation are running.</li>
          </ol>
        </Card>
      </SettingsSection>
    </Shell>
  );
}
