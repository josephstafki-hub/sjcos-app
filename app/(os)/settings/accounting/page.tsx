import { Shell } from "@/components/shell/Shell";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Card, Chip, Eyebrow, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { getQboSummary } from "@/lib/accounting/server";
import { confirmQboMapping, disconnectQboConnection, importQboNow, rejectQboMapping, setQboSwitch, testQboConnection } from "@/lib/accounting/actions";
import { AccountingSettingsButtons } from "@/components/money/AccountingSettingsButtons";
import { QboConnectButtons } from "@/components/money/QboConnectButtons";

/** "Payee · Account · memo" for a review row, from the import snapshot. */
function recordLabel(snapshot: unknown): string {
  const x = (snapshot ?? {}) as { Name?: string | null; Payee?: string | null; Accounts?: string[]; Memo?: string | null };
  return [x.Name ?? x.Payee, x.Accounts?.length ? x.Accounts.join(", ") : null, x.Memo].filter(Boolean).join(" · ");
}

/** What the Connect round trip came back with (app/api/qbo/oauth/callback). */
const CONNECT_NOTICE: Record<string, { tone: "ok" | "flag"; text: string }> = {
  connected: { tone: "ok", text: "QuickBooks connected. Check the company name below is the right one." },
  cancelled: { tone: "flag", text: "Connecting was cancelled at Intuit. Nothing changed." },
  csrf: { tone: "flag", text: "That sign-in couldn't be verified, so it was ignored and nothing changed. Press Connect to QuickBooks again and finish within 10 minutes, in this same browser." },
  failed: { tone: "flag", text: "Intuit didn't complete the connection." },
  not_configured: { tone: "flag", text: "The Intuit app keys aren't set yet, so Connect can't start." },
};

// Settings › Accounting (A14). Owner-only. QuickBooks Online stays the
// bookkeeping authority: this page shows the connection, the three
// per-direction switches (all OFF = dry-run/read-only), unmapped and
// conflicting records for review, and the import batches. Secrets are env
// variables shown as present/absent only.
export default async function AccountingSettingsPage({ searchParams }: { searchParams: Promise<{ qbo?: string; reason?: string }> }) {
  await requireRole("owner");
  const s = await getQboSummary();
  const { qbo } = await searchParams;
  const notice = qbo ? CONNECT_NOTICE[qbo] : undefined;
  const c = s.environment === "fake" ? null : s.connection;
  const chip = c?.state === "connected" ? "money" : c?.state === "error" ? "flag" : "ghost";
  const dollars = (cents: number | null) => (cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  const switchRows: { key: "import_read" | "export_invoices" | "export_payments"; label: string; help: string }[] = [
    { key: "import_read", label: "Import posted entities", help: "Read customers, invoices, payments, purchases, bills and deposits from QuickBooks with a cursor. OFF = dry-run (counts only)." },
    { key: "export_invoices", label: "Mirror SJC-issued invoices", help: "Create each issued invoice in QuickBooks once (never drafts, never a second copy)." },
    { key: "export_payments", label: "Mirror settled payments", help: "Apply each settled customer payment to its mirrored invoice once." },
  ];

  return (
    <Shell breadcrumb="SETTINGS / ACCOUNTING">
      <SettingsSection active="/settings/accounting">
        <PageHeader title="QuickBooks Online" meta="Review your bookkeeping connection, sync directions and imported records." />
        {s.environment === 'fake' && <p className="text-body text-ink-3">Not connected. Imports use a sample company for testing; your QuickBooks books are untouched.</p>}

        {notice && (
          <div className={`rounded-lg border px-4 py-3 text-body leading-snug ${notice.tone === "ok" ? "border-money/40 bg-money-soft text-ink" : "border-flag/30 bg-flag/5 text-ink-2"}`}>
            {notice.text}

          </div>
        )}

        <Card className="p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-meta text-ink-3">Connection</span>
            <Chip kind={chip} dot>{c?.state ?? "disconnected"}</Chip>
          </div>
          <dl className="mt-3 space-y-2 text-body">
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-ink-3">Company</dt><dd>{c?.company_name || 'Not connected'}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-ink-3">Last sync</dt><dd>{c?.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : 'No sync yet'}</dd></div>
          </dl>
          <div className="mt-4">
            {s.environment !== "fake" && s.oauthConfigured ? <QboConnectButtons connected={c?.state === "connected"} configured disconnect={disconnectQboConnection} /> : <p className="text-body text-ink-2">Not connected — add your QuickBooks keys with your account administrator. <a href="#quickbooks-setup" className="text-accent-2 underline">Setup checklist</a></p>}
            <div className="mt-3"><AccountingSettingsButtons test={testQboConnection} importNow={importQboNow} /></div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-meta text-ink-3">Sync directions (each one is a separate decision)</div>
          <ul className="mt-2 flex flex-col gap-2">
            {switchRows.map((r) => (
              <li key={r.key} className="flex items-start gap-3 text-body">
                <form action={setQboSwitch}>
                  <input type="hidden" name="key" value={r.key} />
                  <input type="hidden" name="enabled" value={s.switches[r.key] ? "false" : "true"} />
                  <button type="submit" className={`rounded-md border px-2.5 py-1 text-meta font-semibold ${s.switches[r.key] ? "border-money bg-money-soft text-money" : "border-rule text-ink-2"}`}>
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
          <div className="text-meta text-ink-3">Mappings</div>
          <div className="mt-2 flex flex-wrap gap-2 text-meta text-ink-2">
            {Object.entries(s.counts).map(([k, n]) => (
              <Chip key={k} kind={k === "conflict" ? "flag" : k === "unmapped" ? "accent" : "ghost"}>{k}: {n}</Chip>
            ))}
            {!Object.keys(s.counts).length && <span className="text-ink-3">nothing imported yet</span>}
          </div>
          {s.conflicts.length > 0 && (
            <div className="mt-3">
              <div className="text-meta font-semibold text-flag">Conflicts — QuickBooks changed a record after SJC OS posted it</div>
              <ul className="mt-1 flex flex-col gap-1 text-meta">
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
              <div className="text-meta font-semibold text-ink">Unmapped — proposals only, nothing is attached until you confirm</div>
              <ul className="mt-1 flex flex-col gap-1 text-meta">
                {s.unmapped.map((m) => (
                  <li key={m.id} className="rounded-md border border-rule p-2">
                    <div>
                      <span className="font-mono">{m.entity_kind} {m.qbo_id}</span> · {dollars(m.amount_cents)} · {m.txn_date ?? "no date"}
                      {recordLabel(m.snapshot) ? <> · <b className="font-medium text-ink">{recordLabel(m.snapshot)}</b></> : null} · {m.note}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {m.candidates.length > 0 && (
                        <form action={confirmQboMapping} className="flex items-center gap-1">
                          <input type="hidden" name="mapping_id" value={m.id} />
                          <select name="candidate" className="rounded-md border border-rule bg-paper px-2 py-1 text-meta text-ink">
                            {m.candidates.map((cand) => (
                              <option key={`${cand.internal_kind}|${cand.internal_id}`} value={`${cand.internal_kind}|${cand.internal_id}`}>
                                {cand.internal_kind} {cand.internal_id} — {cand.why}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="rounded-md border border-ink bg-ink px-2 py-1 text-meta font-semibold text-paper">Confirm</button>
                        </form>
                      )}
                      <form action={rejectQboMapping} className="flex items-center gap-1">
                        <input type="hidden" name="mapping_id" value={m.id} />
                        <input type="hidden" name="reason" value="not an SJC OS record" />
                        <button type="submit" className="rounded-md border border-rule px-2 py-1 text-meta text-ink-2">Not ours</button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-3">
          <div className="text-meta text-ink-3">Import batches</div>
          <div className="mt-2 max-w-full overflow-x-auto"><table className="w-full text-meta">
            <thead className="text-ink-3">
              <tr><th className="text-left">When</th><th className="text-left">Entity</th><th>Seen</th><th>New</th><th>Changed</th><th>Conflicts</th><th>Dry run</th></tr>
            </thead>
            <tbody>
              {s.batches.map((b, i) =>
                b.error ? (
                  <tr key={i} className="border-t border-rule text-ink-3">
                    <td>{b.started_at.slice(0, 16)}</td><td>{b.entity_kind}</td>
                    <td colSpan={5} className="italic">skipped: {b.error}</td>
                  </tr>
                ) : (
                  <tr key={i} className="border-t border-rule text-ink-2">
                    <td>{b.started_at.slice(0, 16)}</td><td>{b.entity_kind}</td><td className="text-center">{b.seen}</td><td className="text-center">{b.created}</td><td className="text-center">{b.updated}</td><td className="text-center">{b.conflicts}</td><td className="text-center">{b.dry_run ? "yes" : "no"}</td>
                  </tr>
                ),
              )}
              {!s.batches.length && <tr><td colSpan={7} className="pt-2 text-ink-3">no runs yet</td></tr>}
            </tbody>
          </table></div>
        </Card>

        <Card id="quickbooks-setup" className="p-4">
          <h2 className="text-subheading font-semibold">Connect QuickBooks</h2>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-body text-ink-2">
            <li>Ask your account administrator to prepare your QuickBooks connection keys. Secret keys cannot be entered on this page.</li>
            <li>Return to Settings › Accounting, choose Connect to QuickBooks, sign in and select SJ Carpentry LLC. Check the company name here.</li>
            <li>Run an import with all sync switches off to preview counts. Then enable imports and review the proposed matches below.</li>
            <li>Have your bookkeeper confirm the account and tax mappings before enabling invoice or payment sync.</li>
            <li>Ask your administrator to confirm regular syncing is running.</li>
          </ol>
        </Card>
      </SettingsSection>
    </Shell>
  );
}
