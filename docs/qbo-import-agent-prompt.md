# QuickBooks full import: agent prompt

Paste everything below the line into a new Claude session running on GCServer
(terminal or a T3 thread) with the `sjcos` MCP server. Written 2026-10-29,
against build `l2-0DgW22qmCczskcD_oC` (main `83f521b`).

---

You are running the first full import of SJ Carpentry's real QuickBooks Online books into SJC OS, then cleaning up what it brings in. Joe Stafki owns the business and approves anything that is a judgment call. Work carefully and in order. Stop and ask Joe whenever a stop condition below is hit.

The work has **two parts**. Joe will tell you which one to run.

- **Part A (now):** steps 0 to 3, step 4a, step 4b, step 5, then the Part A hand-off in step 6. This is the import, the sure matches, and a cleanup list for Joe's bookkeeper.
- **Part B (after the bookkeeper has cleaned up QuickBooks):** the Part B steps at the end of this file, then the Part B hand-off.

His QuickBooks categories are unreliable until the bookkeeper is done. So in Part A, do **not** set records aside as "not job money", and do not work through near matches or unmatched job costs. Those wait for Part B.

## What is already true (checked 2026-10-29)

- SJC OS is connected to the **production** QuickBooks company **SJCarpentry LLC** (company id `9341453358881531`) through the in-app Connect to QuickBooks button. The plan is **Simple Start**.
- The live build pages past 500 records, keeps payee, accounts and memo on every imported record, skips a record type the plan refuses, and logs every QuickBooks error with its `intuit_tid`.
- All three sync switches are **off**: `import_read`, `export_invoices`, `export_payments`.
- A dry run through the live route saw exactly:

  | Customer | Invoice | Payment | Purchase | Bill | Deposit | Total |
  |---|---|---|---|---|---|---|
  | 64 | 14 | 13 | 1294 | 1 | 257 | 1643 |

- The import never writes to QuickBooks. It stores a read-only copy of each record in SJC OS as an **unmapped** row in `qbo_mappings`, with proposed matches (`candidates`) to SJC OS invoices, payments and expenses. Nothing is attached to an SJC OS record until a mapping is confirmed.

## Hard rules

1. **Never write to QuickBooks.** Do not turn on `export_invoices` or `export_payments`. Do not call any create or update on the QuickBooks API. Check that both are still `false` before every import pass.
2. **Do not build, deploy, restart services, edit code, or run git commands.** Several other Claude sessions share this server. If something looks broken in the code, stop and tell Joe.
3. **Never print secrets.** Read `DATABASE_URL` and `CRON_SECRET` from `~/sjcos-app/.env.local` into shell variables, as shown below, and never echo them.
4. **Confirming or rejecting mappings needs Joe's approval**, given per batch. You propose; Joe says yes or no per group. The one exception is rows whose QuickBooks record no longer exists (step 4a): those you may reject without asking, but report the count.
5. **Do not install the hourly sync timer** (`sjcos-qbo-sync.timer`) without Joe saying so.
6. Record your work in SJC OS: `record_agent_run` at the start and the end, `record_receipt` for the import and for each approved batch, and one `capture_knowledge` summary at the end.
7. Talk to Joe in short, plain messages, in his words. Lead with the result. No jargon such as "mapping", "realm" or "cursor" unless he uses it first.

## Shell setup (every new shell)

```bash
cd ~/sjcos-app
DB=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)
CS=$(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2-)
REALM=9341453358881531
q() { psql "$DB" -X -At -c "$1"; }
```

## Step 0: preflight (stop if any check fails)

```bash
q "select environment, state, company_name from qbo_connection where realm_id = '$REALM'"
#   expect: production|connected|SJCarpentry LLC
q "select key, enabled from qbo_sync_settings order by key"
#   expect all three false
git -C ~/sjcos-app merge-base --is-ancestor 83f521b HEAD && echo "fixes present"
q "select count(*) from qbo_mappings where realm_id = '$REALM'"
#   expect 0 (nothing imported yet). If not 0, stop and ask Joe.
bash ~/bin/sjcos-backup --db-only 2>&1 | tail -1
#   expect {"ok":true,...}. This is your restore point.
```

Then do a dry run and compare its counts with the table above. A small difference is fine if Joe entered new records today. Report it.

```bash
curl -s --max-time 900 -H "Authorization: Bearer $CS" "http://127.0.0.1:3017/api/cron/qbo-sync?dry=1" \
  | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d["ok"], {k:v["seen"] for k,v in d["kinds"].items()}, "skipped", d["skipped"], "exported", d["exported"])'
```

Call `record_agent_run` saying you are starting the QuickBooks full import.

## Step 1: the import

```bash
q "update qbo_sync_settings set enabled = true, updated_by = 'agent:qbo-import', updated_at = now() where key = 'import_read'"
q "select key, enabled from qbo_sync_settings order by key"   # import_read true, both export_* false
START=$(date -Is)
curl -s --max-time 1800 -H "Authorization: Bearer $CS" "http://127.0.0.1:3017/api/cron/qbo-sync" > /tmp/qbo-import-pass1.json
python3 -I -c 'import json; d=json.load(open("/tmp/qbo-import-pass1.json")); print(d.get("ok"), d.get("dry_run"), {k:(v["seen"],v["created"]) for k,v in d.get("kinds",{}).items()}, "skipped", d.get("skipped"), "conflicts", d.get("conflicts"), "exported", d.get("exported"), d.get("error"))'
```

The pass runs in one database transaction. It either imports everything or nothing.

## Step 2: monitor and verify

```bash
journalctl --user -u sjcos.service --since "$START" --no-pager -o cat | grep '\[qbo\]'   # expect nothing
q "select coalesce(last_error,'none') from qbo_connection where realm_id = '$REALM'"
q "select entity_kind, count(*) from qbo_mappings where realm_id = '$REALM' group by 1 order by 1"
q "select entity_kind, error from qbo_import_batches where realm_id = '$REALM' and error is not null and started_at > '$START'"
```

The per-type counts must equal the pass-1 `seen` numbers. Then run the same curl a second time (pass 2). It must create **0** new rows. That proves the import doesn't duplicate.

**Stop conditions.** If any of these happens, turn `import_read` back off and ask Joe:
- A count doesn't match.
- Any `[qbo]` log line, `last_error`, or batch error appears.
- An export switch is found on.
- The connection isn't production / SJCarpentry LLC.

To turn the import off:

```bash
q "update qbo_sync_settings set enabled = false, updated_by = 'agent:qbo-import', updated_at = now() where key = 'import_read'"
```

Call `record_receipt` for the import with the counts.

## Step 3: helper for confirm and reject

Use the app's own functions, never hand-written UPDATEs, for confirming or rejecting. Write the script to `/tmp`, not inside the repo:

```bash
cat > /tmp/qbo-apply.mjs <<'EOF'
// usage: node /tmp/qbo-apply.mjs actions.json
// actions.json: [{"op":"confirm","id":"<mapping uuid>","internal_kind":"expense","internal_id":"123"},
//                {"op":"reject","id":"<mapping uuid>","reason":"..."}]
import { readFileSync } from "node:fs";
import { loadEnvFile } from "/home/joe/sjcos-app/lib/worker/load-app.mjs";
loadEnvFile("/home/joe/sjcos-app/.env.local");
const { confirmMapping, rejectMapping } = await import("/home/joe/sjcos-app/lib/accounting/qbo/sync.ts");
const pg = (await import("/home/joe/sjcos-app/node_modules/pg/lib/index.js")).default;
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const run = async (sql, p) => (await c.query(sql, p)).rows;
const by = "agent:qbo-import (approved by Joe)";
let ok = 0, failed = [];
await c.query("BEGIN");
try {
  for (const a of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
    const r = a.op === "confirm"
      ? await confirmMapping(run, { mappingId: a.id, internalKind: a.internal_kind, internalId: a.internal_id, by })
      : { ok: await rejectMapping(run, a.id, by, a.reason) };
    if (r.ok) ok++; else failed.push({ id: a.id, reason: r.reason ?? "not unmapped/conflict" });
  }
  await c.query("COMMIT");
} catch (e) { await c.query("ROLLBACK"); throw e; }
console.log(JSON.stringify({ ok, failed }));
await c.end();
EOF
```

A rejected row is kept with `state = 'rejected'` and a note. If Joe changes his mind, set it back with `update qbo_mappings set state = 'unmapped' where id = '<uuid>'`, and tell him you did.

## Step 4: cleanup in SJC OS

Part A does **4a and 4b only**. 4c to 4f are Part B.

For each group, show Joe a short summary, for example "41 bank-fee and loan payments, not job costs: mark as not ours?", with three examples. Apply only what he approves.

**a. Gone from QuickBooks (no approval needed).** List each record type fresh from QuickBooks and reject unmapped rows whose QuickBooks id is no longer present, with the reason `deleted or merged in QuickBooks`. The import cannot see deletions, so this is the only way they get cleared. Use `getQboAdapter().listChanges(kind, null)` from `/home/joe/sjcos-app/lib/accounting/qbo/index.ts`, set up the same way as the helper above.

**b. Sure matches.** Rows with exactly one candidate at score 0.9, meaning the same amount and the same date:

```sql
select id, entity_kind, amount_cents, txn_date, snapshot->>'Payee' payee, candidates->0->>'internal_kind' ik, candidates->0->>'internal_id' iid, candidates->0->>'why' why
from qbo_mappings where realm_id = '<REALM>' and state = 'unmapped'
  and jsonb_array_length(candidates) = 1 and (candidates->0->>'score')::numeric >= 0.9;
```

Propose confirming them as one batch. Also check that the payee or memo agrees with the SJC OS record, and leave out any that look wrong.

**c. Likely matches (Part B).** Rows with candidates at score 0.6 (same amount, different date), or more than one candidate. Show them to Joe in small batches of 10 to 20, with your recommendation for each.

**d. Company overhead and money movement (Part B).** Purchases and deposits whose accounts are not job costs: Owner Draw, Loan, MCA Servicing, Bank Charges and Fees, Accounting Software, Advertising, Google business, and transfers coded to a bank account such as `PER CHECKING (9891) - 1` or `BUS CHECKING (8207) - 1`. Group them by account with counts and totals. Propose marking each group "not an SJC OS job record". They stay on file as rejected rows. Find them with:

```sql
select a.acct, count(*), sum(m.amount_cents)/100.0 dollars
from qbo_mappings m, jsonb_array_elements_text(coalesce(m.snapshot->'Accounts','[]'::jsonb)) a(acct)
where m.realm_id = '<REALM>' and m.state = 'unmapped' and m.entity_kind in ('Purchase','Deposit')
group by 1 order by 2 desc;
```

**e. Possible missing job costs (Part B).** Unmatched purchases in job-cost accounts (Supplies, Subcontractor Pay, Disposal, and similar) with no candidate. Do not reject these. List them for Joe by vendor and month. They may be costs never recorded against a job in SJC OS.

**f. Customers (Part B).** The 64 customers have no automatic match. Leave them unmapped. Report the likely duplicates: Matt McDonnell / Mathew McDonnell, and Tony Bianconi / Anthony Bianconi.

After each approved batch, run the helper, check the `ok` count equals the batch size, and call `record_receipt`.

## Step 5: QuickBooks bookkeeping findings (report only, do not fix)

From the read-only check on 2026-10-29, confirm or update each of these from the imported data:

- 410 of 1,294 purchases have no payee.
- 16 expense lines sit in Uncategorized or Ask My Accountant.
- 28 possible duplicate purchases have the same date, amount and payee.
- 82 purchases are coded to the bank account `PER CHECKING (9891) - 1` as if it were an expense, probably transfers.
- Deposits are coded to expense accounts: Supplies 54, Owner Draw 41, Bank Charges 12. Likely refunds, owner money in, or miscoding.
- 108 deposits go straight to Services income, and only 6 are linked to customer payments. Income is being recorded as deposits, not invoices.
- There are 2 duplicate customer pairs.

Create **one** SJC OS work item, `create_work_item`, titled "QuickBooks bookkeeping cleanup (for bookkeeper)", listing these with counts and a few examples each. Do not change anything in QuickBooks.

## Step 6: hand-off

### Part A hand-off

1. Leave `import_read` **on** and both export switches **off**. Do not install the hourly timer.
2. Final check on Settings › Accounting (`/settings/accounting`): the page loads, and the counts match the database.
3. Call `capture_knowledge` with a short summary covering what was imported, how many sure matches were confirmed, how many rows were cleared as deleted in QuickBooks, and the bookkeeping findings. Then call `record_agent_run` to close.
4. Send Joe the result in five lines or fewer: imported counts, sure matches confirmed, the bookkeeper to-do created, and that Part B waits until the bookkeeper is done. Tell him to start Part B by saying "run Part B".

## Part B (only after Joe says the bookkeeper is done)

1. Repeat the step 0 checks, except that `qbo_mappings` will no longer be empty. Then take a fresh database backup: `bash ~/bin/sjcos-backup --db-only`.
2. Run one import pass (the step 1 curl, without `?dry=1`). The bookkeeper's fixes then update the stored copies. Check for errors as in step 2.
3. Redo 4a. Duplicates the bookkeeper deleted or merged must be cleared.
4. Redo 4b. Cleaned-up records can produce new sure matches.
5. Work through 4c, 4d, 4e and 4f, each with Joe's approval per batch.
6. Close the bookkeeper to-do from Part A if the bookkeeper's work is reflected in the data. Otherwise add a note saying what is still off.
7. Ask Joe whether to turn on the hourly sync timer. Mention that the "send invoices" and "send payments" switches stay off until he and the bookkeeper agree how income is recorded, because otherwise the same money can be counted twice.
8. Call `capture_knowledge` with a summary, then `record_agent_run`. Send Joe the result in five lines or fewer: matched, set aside as not job money, possible missing job costs for him to review, and anything still open.
