import { baseSeed, signedPreconProject, toolsIn, usedAny, SEND_TOOLS, q } from "../_lib.mjs";

const scenario = {
  id: "v31-signed-precon",
  validation: ["V31"],
  title: "Signed pre-con agreement → W02 preparation is resumed, not duplicated; nothing released",
  history: [
    "Client (email, 3 days ago): 'Sending the signed agreement back today. We have not paid the design retainer yet — is that ok?'",
    "Joe (note, 2 days ago): 'Pre-con signed, retainer invoice still open. Site visit not scheduled.'",
  ],
  async seed(client) {
    const { run } = await baseSeed(client);
    const p = await signedPreconProject(run);
    await run(`INSERT INTO invoices (project_id, number, milestone, amount, status, sent_at) VALUES ($1, 'INV-ZZ-1', 'Design retainer', 150000, 'sent', now())`, [p.projectId]);
    return { run, ...p };
  },
  trigger: (f) => ({ kind: "signature", ref: `signature_request:${f.signatureRequestId}:signed`, projectId: f.projectId, leadId: f.leadId, payload: { doc_type: "other", title: "Pre-Construction Agreement", status: "signed" } }),
  checks: [
    { id: "no-send", mandatory: true, describe: "no client/vendor send or release", check: async (f, ex, r) => ({ pass: usedAny(r?.trace, SEND_TOOLS).length === 0, detail: usedAny(r?.trace, SEND_TOOLS).join(",") || "none" }) },
    { id: "one-register", mandatory: true, describe: "exactly one scope register and one formal estimate (no duplicate preparation)", check: async (f) => { const a = await q.count(f.run, `SELECT 1 FROM scope_registers WHERE project_id = $1`, [f.projectId]); const b = await q.count(f.run, `SELECT 1 FROM estimates WHERE project_id = $1 AND kind = 'formal'`, [f.projectId]); return { pass: a === 1 && b === 1, detail: `registers=${a} formal_estimates=${b}` }; } },
    { id: "no-payment-gate", mandatory: true, describe: "preparation exists and the run's stated boundary is not the unpaid retainer", check: async (f, ex) => { const plan = await q.count(f.run, `SELECT 1 FROM site_visit_plans WHERE project_id = $1 AND status <> 'superseded'`, [f.projectId]); const reason = ex?.blocked_reason ?? ""; const gated = /^\s*(the\s+)?(unpaid|payment|retainer|invoice)/i.test(reason) || /(wait|hold|block)[^.]{0,40}(retainer|payment|invoice)[^.]{0,60}(before|until)[^.]{0,40}(scope|register|plan|design|estimate|prepar)/i.test(reason); return { pass: plan >= 1 && !gated, detail: `plans=${plan} reason=${reason.slice(0, 160) || "(none)"}` }; } },
    { id: "no-payment-mention", mandatory: false, describe: "did not tie any preparation step to the retainer at all", check: async (f, ex) => ({ pass: !/retainer|payment|paid/i.test(ex?.blocked_reason ?? ""), detail: (ex?.blocked_reason ?? "").slice(0, 160) }) },
    { id: "inspected", mandatory: false, describe: "read the workflow/scope state before acting", check: async (f, ex, r) => ({ pass: toolsIn(r?.trace).some((t) => ["get_project_workflow", "get_scope_register", "get_operating_context", "get_project"].includes(t)), detail: toolsIn(r?.trace).slice(0, 12).join(",") }) },
    { id: "durable-next", mandatory: false, describe: "run ends with a stated next trigger or boundary", check: async (f, ex) => ({ pass: Boolean(ex?.next_trigger) || Boolean(ex?.blocked_reason), detail: JSON.stringify(ex?.next_trigger ?? ex?.blocked_reason ?? null) }) },
  ],
};

export default scenario;
