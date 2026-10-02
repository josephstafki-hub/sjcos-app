import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { getQboSummary } from "@/lib/accounting/server";
import { confirmQboMapping, importQboNow, rejectQboMapping, setQboSwitch, testQboConnection } from "@/lib/accounting/actions";
import { AccountingSettingsButtons } from "@/components/money/AccountingSettingsButtons";

// Settings › Accounting (A14). Owner-only. QuickBooks Online stays the
// bookkeeping authority: this page shows the connection, the three
// per-direction switches (all OFF = dry-run/read-only), unmapped and
// conflicting records for review, and the import batches. Secrets are env
// variables shown as present/absent only.
export default async function AccountingSettingsPage() {
  await requireRole("owner");
  const s = await getQboSummary();
  const c = s.connection;
  const chip = c?.state === "connected" ? "money" : c?.state === "error" ? "flag" : "ghost";
  const dollars = (cents: number | null) => (cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  const switchRows: { key: "import_read" | "export_invoices" | "export_payments"; label: string; help: string }[] = [
    { key: "import_read", label: "Import posted entities", help: "Read customers, invoices, payments, purchases, bills and deposits from QuickBooks with a cursor. OFF = dry-run (counts only)." },
    { key: "export_invoices", label: "Mirror SJC-issued invoices", help: "Create each issued invoice in QuickBooks once (never drafts, never a second copy)." },
    { key: "export_payments", label: "Mirror settled payments", help: "Apply each settled customer payment to its mirrored invoice once." },
  ];

  return (
    <Shell breadcrumb="SETTINGS / ACCOUNTING">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        <div>
          <Eyebrow>Bookkeeping</Eyebrow>
          <h1 className="mt-1 font-serif text-[24px] font-medium text-ink">QuickBooks Online</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            QuickBooks stays the accounting record; SJC OS mirrors what it must, once, and never overwrites either side silently. The adapter runs in <b>{s.environment}</b> mode
            {s.environment === "fake" ? " (no Intuit connection: an in-memory company, nothing reaches QuickBooks)" : ""}.
          </p>
        </div>

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Connection</span>
            <Chip kind={chip} dot>{c?.state ?? "disconnected"}</Chip>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1 text-[12.5px] text-ink-2 sm:grid-cols-2">
            <div>Company: <span className="font-mono">{c?.company_name || "—"}</span></div>
            <div>Realm: <span className="font-mono">{c?.realm_id ?? "—"}</span></div>
            <div>Last sync: {c?.last_sync_at ?? "never"}</div>
            <div>Last error: {c?.last_error ?? "—"}</div>
            {Object.entries(s.secrets).map(([k, v]) => (
              <div key={k}>
                <span className="font-mono">{k}</span> (env): {v ? "present" : "missing"}
              </div>
            ))}
          </div>
          <div className="mt-3">
            <AccountingSettingsButtons test={testQboConnection} importNow={importQboNow} />
          </div>
        </Card>

        <Card className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Sync directions (each one is a separate decision)</div>
          <ul className="mt-2 flex flex-col gap-2">
            {switchRows.map((r) => (
              <li key={r.key} className="flex items-start gap-3 text-[12.5px]">
                <form action={setQboSwitch}>
                  <input type="hidden" name="key" value={r.key} />
                  <input type="hidden" name="enabled" value={s.switches[r.key] ? "false" : "true"} />
                  <button type="submit" className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold ${s.switches[r.key] ? "border-money bg-money-soft text-money" : "border-rule text-ink-2"}`}>
                    {s.switches[r.key] ? "ON" : "OFF"}
                  </button>
                </form>
                <div>
                  <div className="text-ink">{r.label}</div>
                  <div className="text-ink-3">{r.help}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Mappings</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-ink-2">
            {Object.entries(s.counts).map(([k, n]) => (
              <Chip key={k} kind={k === "conflict" ? "flag" : k === "unmapped" ? "accent" : "ghost"}>{k}: {n}</Chip>
            ))}
            {!Object.keys(s.counts).length && <span className="text-ink-3">nothing imported yet</span>}
          </div>
          {s.conflicts.length > 0 && (
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-flag">Conflicts — QuickBooks changed a record after SJC OS posted it</div>
              <ul className="mt-1 flex flex-col gap-1 text-[12px]">
                {s.conflicts.map((m) => (
                  <li key={m.id} className="rounded-md border border-rule p-2">
                    <span className="font-mono">{m.entity_kind} {m.qbo_id}</span> · {dollars(m.amount_cents)} · {m.note} — decide on <a className="underline" href="/engine/decisions">Decisions</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.unmapped.length > 0 && (
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-ink">Unmapped — proposals only, nothing is attached until you confirm</div>
              <ul className="mt-1 flex flex-col gap-1 text-[12px]">
                {s.unmapped.map((m) => (
                  <li key={m.id} className="rounded-md border border-rule p-2">
                    <div>
                      <span className="font-mono">{m.entity_kind} {m.qbo_id}</span> · {dollars(m.amount_cents)} · {m.txn_date ?? "no date"} · {m.note}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {m.candidates.length > 0 && (
                        <form action={confirmQboMapping} className="flex items-center gap-1">
                          <input type="hidden" name="mapping_id" value={m.id} />
                          <select name="candidate" className="rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink">
                            {m.candidates.map((cand) => (
                              <option key={`${cand.internal_kind}|${cand.internal_id}`} value={`${cand.internal_kind}|${cand.internal_id}`}>
                                {cand.internal_kind} {cand.internal_id} — {cand.why}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper">Confirm</button>
                        </form>
                      )}
                      <form action={rejectQboMapping} className="flex items-center gap-1">
                        <input type="hidden" name="mapping_id" value={m.id} />
                        <input type="hidden" name="reason" value="not an SJC OS record" />
                        <button type="submit" className="rounded-md border border-rule px-2 py-1 text-[11px] text-ink-2">Not ours</button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Import batches</div>
          <table className="mt-2 w-full text-[12px]">
            <thead className="text-ink-3">
              <tr><th className="text-left">When</th><th className="text-left">Entity</th><th>Seen</th><th>New</th><th>Changed</th><th>Conflicts</th><th>Dry run</th></tr>
            </thead>
            <tbody>
              {s.batches.map((b, i) => (
                <tr key={i} className="border-t border-rule text-ink-2">
                  <td>{b.started_at.slice(0, 16)}</td><td>{b.entity_kind}</td><td className="text-center">{b.seen}</td><td className="text-center">{b.created}</td><td className="text-center">{b.updated}</td><td className="text-center">{b.conflicts}</td><td className="text-center">{b.dry_run ? "yes" : "no"}</td>
                </tr>
              ))}
              {!s.batches.length && <tr><td colSpan={7} className="pt-2 text-ink-3">no runs yet</td></tr>}
            </tbody>
          </table>
        </Card>

        <Card kind="soft" className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Setup checklist (Joe / bookkeeper)</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] text-ink-2">
            <li>Create an Intuit developer app for the SJ Carpentry company (sandbox first), copy the client id/secret.</li>
            <li>Authorize it once (OAuth) and store <span className="font-mono">INTUIT_CLIENT_ID</span>, <span className="font-mono">INTUIT_CLIENT_SECRET</span>, <span className="font-mono">QBO_REALM_ID</span>, <span className="font-mono">QBO_REFRESH_TOKEN</span>, <span className="font-mono">QBO_ENV=sandbox</span> in .env.local; restart sjcos.service.</li>
            <li>Press <b>Check connection</b>; the company name above must be the right one.</li>
            <li>Run an import with every switch OFF (dry run) and read the batch counts; then turn <b>Import</b> on and review the unmapped proposals here — confirm only what you are sure of.</li>
            <li>Only after the bookkeeper confirms account, customer, fee/clearing and tax mappings turn the two <b>Mirror</b> switches on, one at a time.</li>
            <li>Enable <span className="font-mono">sjcos-qbo-sync.timer</span> (deploy/).</li>
          </ol>
        </Card>
      </div>
    </Shell>
  );
}
