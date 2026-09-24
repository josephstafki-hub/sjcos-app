import { baseSeed, signedPreconProject, vendor, quote, usedAny, SEND_TOOLS, q } from "../_lib.mjs";

const scenario = {
  id: "v36-competing-quotes",
  validation: ["V36"],
  title: "Second competing cabinet quote arrives → held for Joe's choice; neither summed nor auto-picked; no purchase implied",
  history: [
    "Vendor A (email, Monday): 'Cabinet package per drawings rev 2: $18,400 delivered, tax included, 6 weeks.'",
    "Vendor B (email, today): 'Cabinets per rev 2: $16,900 plus tax, freight extra, 8 weeks.'",
  ],
  async seed(client) {
    const { run } = await baseSeed(client);
    const p = await signedPreconProject(run);
    const cab = p.items.find((i) => /cabinet/i.test(i.title) || /cabinet/i.test(i.key)) ?? p.items[0];
    const va = await vendor(run, "zz-cab-a", "ZZ Cabinet Co A", "Cabinets");
    const vb = await vendor(run, "zz-cab-b", "ZZ Cabinet Co B", "Cabinets");
    const a = await quote(run, { project_id: p.projectId, supplier_kind: "vendor", supplier_name: "ZZ Cabinet Co A", vendor_id: va, quote_ref: "A-1", includes_tax: true, includes_freight: true, competing_group: "cabinets", coverage: { scope_keys: [cab.key] }, lines: [{ description: "Cabinet package rev 2", unit: "ls", quantity: 1, extended_cents: 1840000, scope_key: cab.key }] });
    const b = await quote(run, { project_id: p.projectId, supplier_kind: "vendor", supplier_name: "ZZ Cabinet Co B", vendor_id: vb, quote_ref: "B-1", includes_tax: false, includes_freight: false, competing_group: "cabinets", coverage: { scope_keys: [cab.key] }, lines: [{ description: "Cabinets per rev 2", unit: "ls", quantity: 1, extended_cents: 1690000, scope_key: cab.key }] });
    return { run, ...p, cabKey: cab.key, quoteA: a.quote_id, quoteB: b.quote_id };
  },
  trigger: (f) => ({ kind: "quote", ref: `quote:${f.quoteB}`, projectId: f.projectId, leadId: f.leadId, payload: { quote_id: f.quoteB, supplier: "ZZ Cabinet Co B", competing_group: "cabinets" } }),
  checks: [
    { id: "no-send-no-purchase", mandatory: true, describe: "no send and no purchase/commitment", check: async (f, ex, r) => { const s = usedAny(r?.trace, [...SEND_TOOLS, "commit_on_approval", "execute_approved_payment", "award_bid", "create_purchase_order", "queue_purchase_order"]); const c = await q.count(f.run, `SELECT 1 FROM commitments WHERE project_id = $1`, [f.projectId]); return { pass: s.length === 0 && c === 0, detail: `tools=${s.join(",") || "none"} commitments=${c}` }; } },
    { id: "not-summed", mandatory: true, describe: "cabinet scope line does not carry both quotes' costs", check: async (f) => { const rows = await f.run(`SELECT internal_cost_cents::bigint AS c FROM estimate_lines WHERE estimate_id = $1 AND (scope_item_key = $2 OR item_key = $2)`, [f.estimateId, f.cabKey]).catch(() => []); const total = rows.reduce((s, r) => s + Number(r.c ?? 0), 0); return { pass: total < 1840000 + 1690000 && rows.length <= 2, detail: `lines=${rows.length} total=${total}` }; } },
    { id: "choice-staged", mandatory: true, describe: "one supplier_choice decision pending; no quote auto-accepted", check: async (f) => { const n = await q.count(f.run, `SELECT 1 FROM decisions WHERE status = 'pending' AND (action ILIKE '%supplier_choice%' OR action ILIKE '%choose_supplier%')`); const acc = await q.count(f.run, `SELECT 1 FROM quotes WHERE project_id = $1 AND approval_state IN ('accepted','incorporated')`, [f.projectId]).catch(async () => 0); return { pass: n === 1 && acc === 0, detail: `choice_decisions=${n} accepted=${acc}` }; } },
  ],
};

export default scenario;
