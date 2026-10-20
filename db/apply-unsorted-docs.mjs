// Throwaway migration runner for Unsorted documents (Joe, 2026-10-15): the
// invoices / receipts / rebates Hermes pulls from email but can't tie to a
// project land in `unsorted_docs`, and Joe sorts them on /unsorted. Agents
// file the ones they ARE sure of through the same table, so every email
// document filed has one audit row (and an Undo).
//
// Also allows the 'filing' agent trigger: sorting a document starts a small
// agent run (Haiku) that finishes it at once (lib/agent-kick.ts).
//
// Also moves the `file-invoice-receipt-rebate` skill to v2: SJC OS is the
// filing cabinet now (file_email_document / stage_unsorted_document), not
// folders under /home/joe/SJC OS Temp. Joe asked for this change himself, so
// v2 lands approved and becomes the current version.
//
// Additive and idempotent — safe to re-run. Mirrors db/schema.sql.
//
//   node db/apply-unsorted-docs.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const SKILL_V2 = `# File invoice / receipt / rebate (v2 — SJC OS is the filing cabinet)

Every financial document that arrives by email ends up in SJC OS. Never save
copies under \`/home/joe/SJC OS Temp\` or Google Drive.

1. **Start each pass with Joe's notes.** \`list_unsorted_documents\` with
   status \`needs_agent\`: Joe looked at these on the Unsorted page and typed
   where they go (\`owner_note\`). Do what the note says with
   \`file_unsorted_document\` (project, overhead or dismiss). If the note is
   still ambiguous, \`ask_owner\` — don't guess.
2. **Sure which project it belongs to → \`file_email_document\`** with the
   Gmail message id and \`project_slug\`. The app pulls the email and its
   attachments from Gmail itself and attaches them to the project's Files.
   Sure means one of: the client's name or the job address is on the
   document, an invoice/order/PO number already tied to one project, the same
   Gmail thread as a document already filed there, or Joe forwarded it with
   the project named. Vendor, date or card alone is NOT sure.
3. **Clearly company overhead → \`file_email_document\` with
   \`target: "overhead"\`.** Software and subscriptions (Google Workspace,
   Anthropic, OpenAI, Telnyx), phone, insurance, loan and tax payments,
   utilities, office supplies — anything that is never a job cost.
4. **Not sure → \`stage_unsorted_document\`.** Give your best 1–3 project
   guesses with a short reason each, \`overhead_likely\` when it might be
   overhead, and one line on why you couldn't decide. Joe sorts it with one tap.
5. **Costs.** Filing to a project logs the cost by default: an invoice is
   owed (Money › sub invoices), a receipt is spent (Money › expenses). Pass
   \`log_cost: false\` when the cost is already recorded (a PO payment, an
   invoice you or Joe already entered) so it never counts twice. Rebates and
   statements are filed without a cost — a statement repeats invoices.
6. **Files Joe hands you** (dropped into the Ask window): pass their path as
   \`file_paths\` to the same tools instead of a Gmail id.
7. **Answer on the document** with \`reply_on_unsorted_document\`: where you
   put its cost, a likely duplicate, or — with \`give_back: true\` — a
   question when you can't tell where it goes. Never guess.
8. **Gmail labels stay as before:** invoices keep \`Invoices\` and their
   unread state; rebates get \`Rebates\` + \`Unclaimed Rebates\` and may be
   marked read; receipts get \`Receipts\`.
9. Houzz notification emails are NOT client emails.
`;

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS unsorted_docs (
     id                  bigserial PRIMARY KEY,
     source_ref          text NOT NULL UNIQUE,
     doc_kind            text NOT NULL DEFAULT 'invoice'
                           CHECK (doc_kind IN ('invoice','receipt','rebate','statement','other')),
     gmail_message_id    text,
     gmail_thread_id     text,
     from_label          text NOT NULL DEFAULT '',
     subject             text NOT NULL DEFAULT '',
     received_at         timestamptz,
     vendor_label        text NOT NULL DEFAULT '',
     amount_cents        integer,
     doc_date            date,
     doc_number          text NOT NULL DEFAULT '',
     summary             text NOT NULL DEFAULT '',
     why_unsure          text NOT NULL DEFAULT '',
     suggestions         jsonb NOT NULL DEFAULT '[]',
     overhead_likely     boolean NOT NULL DEFAULT false,
     email_file_id       text,
     attachment_file_ids text[] NOT NULL DEFAULT '{}',
     status              text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','needs_agent','filed','dismissed')),
     owner_note          text NOT NULL DEFAULT '',
     filed_to            text CHECK (filed_to IN ('project','overhead')),
     filed_project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
     cost_source         text CHECK (cost_source IN ('expense','sub_invoice')),
     cost_id             bigint,
     cost_created        boolean NOT NULL DEFAULT false,
     staged_by           text NOT NULL DEFAULT '',
     resolved_by         text NOT NULL DEFAULT '',
     resolved_at         timestamptz,
     created_at          timestamptz NOT NULL DEFAULT now(),
     updated_at          timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_unsorted_docs_open ON unsorted_docs(status, received_at DESC) WHERE status IN ('pending','needs_agent')`,
  // The agent's answer on a doc: where it put the cost, or a question for Joe.
  `ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS agent_note text NOT NULL DEFAULT ''`,
  `ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS agent_note_at timestamptz`,
  // 'filing' agent trigger (db/migrations/0026_filing_trigger.sql).
  `ALTER TABLE agent_triggers DROP CONSTRAINT IF EXISTS agent_triggers_kind_check`,
  `ALTER TABLE agent_triggers ADD CONSTRAINT agent_triggers_kind_check
     CHECK (kind IN ('signature','message','note','quote','selection','payment','field_report','approval','signoff','sweep','permit','filing'))`,
  `CREATE INDEX IF NOT EXISTS idx_unsorted_docs_resolved ON unsorted_docs(resolved_at DESC) WHERE status IN ('filed','dismissed')`,
  // Receipt scanning (db/migrations/0030_receipt_scan.sql).
  `ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS extracted jsonb`,
  `ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS extract_state text CHECK (extract_state IN ('reading','done','failed'))`,
  `ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS extract_error text NOT NULL DEFAULT ''`,
  `ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS extract_started_at timestamptz`,
  `ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS sender_note text NOT NULL DEFAULT ''`,
  `ALTER TABLE unsorted_docs ADD COLUMN IF NOT EXISTS sender_project_id uuid REFERENCES projects(id) ON DELETE SET NULL`,
  {
    sql: `WITH s AS (SELECT id FROM skills WHERE slug = 'file-invoice-receipt-rebate'),
          v AS (
            INSERT INTO skill_versions (skill_id, version, body_markdown, change_summary, status, created_by)
            SELECT s.id, 2, $1, 'SJC OS is the filing cabinet: file_email_document / stage_unsorted_document, Unsorted page (Joe, 2026-10-15)', 'approved', 'user'
              FROM s
            ON CONFLICT (skill_id, version) DO UPDATE SET body_markdown = EXCLUDED.body_markdown
            RETURNING id, skill_id)
          UPDATE skills k SET current_version_id = v.id, updated_at = now()
            FROM v WHERE k.id = v.skill_id`,
    params: [SKILL_V2],
  },
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envFile = process.env.SJCOS_ENV ?? path.join(process.cwd(), ".env.local");
  const env = readFileSync(envFile, "utf8");
  const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
  if (!url) throw new Error(`DATABASE_URL not found in ${envFile}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const s of STATEMENTS) {
      const sql = typeof s === "string" ? s : s.sql;
      const r = await client.query(sql, typeof s === "string" ? [] : s.params);
      console.log(`ok: ${sql.split("\n")[0].trim()}${sql.startsWith("WITH") ? ` (${r.rowCount} rows)` : ""}`);
    }
    await client.query(`INSERT INTO app_change_log (scope, source) VALUES ('unsorted_docs', 'migration')`);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
  console.log("Unsorted documents applied.");
}
