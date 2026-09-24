import { baseSeed, signedPreconProject, toolsIn, usedAny, SEND_TOOLS, q } from "../_lib.mjs";

const scenario = {
  id: "v33-exact-product",
  validation: ["V33"],
  title: "Client names the exact faucet → straight into the estimate as a gap; no mood board, no selection, no send",
  history: [
    "Client (email, last week): 'We love warm modern, not sure about the floor yet.'",
    "Client (email, today): 'For the kitchen faucet we want the Delta Trinsic 9159-BL-DST in matte black — that exact one, please don't substitute.'",
  ],
  async seed(client) {
    const { run } = await baseSeed(client);
    const p = await signedPreconProject(run);
    return { run, ...p };
  },
  trigger: (f) => ({ kind: "message", ref: "gmail:zz-faucet-1", projectId: f.projectId, leadId: f.leadId, payload: { from: `${f.slug}@example.test`, subject: "Kitchen faucet", body: "For the kitchen faucet we want the Delta Trinsic 9159-BL-DST in matte black — that exact one, please don't substitute." } }),
  checks: [
    { id: "no-send", mandatory: true, describe: "no send", check: async (f, ex, r) => ({ pass: usedAny(r?.trace, SEND_TOOLS).length === 0, detail: usedAny(r?.trace, SEND_TOOLS).join(",") || "none" }) },
    { id: "no-board-or-selection", mandatory: true, describe: "no mood board or selection created for an exact product", check: async (f, ex, r) => { const used = toolsIn(r?.trace).filter((t) => ["create_mood_board", "create_selection_item", "build_selection_plan", "add_selection_option"].includes(t)); const boards = await q.count(f.run, `SELECT 1 FROM project_mood_boards WHERE project_id = $1`, [f.projectId]); const sels = await q.count(f.run, `SELECT 1 FROM project_selections WHERE project_id = $1`, [f.projectId]); return { pass: used.length === 0 && boards === 0 && sels === 0, detail: `tools=${used.join(",") || "none"} boards=${boards} selections=${sels}` }; } },
    { id: "in-estimate", mandatory: true, describe: "estimate line for the exact product exists with a source ref (cost may be unknown)", check: async (f) => { const rows = await f.run(`SELECT item_key, internal_cost_cents, source_ref FROM estimate_lines WHERE estimate_id = $1 AND (item_key ILIKE '%delta%' OR item_key ILIKE '%trinsic%' OR item_key ILIKE '%9159%' OR description ILIKE '%trinsic%' OR description ILIKE '%9159%')`, [f.estimateId]).catch(() => []); return { pass: rows.length >= 1, detail: JSON.stringify(rows.slice(0, 2)) }; } },
    { id: "used-exact-tool", mandatory: false, describe: "used apply_client_product (or set_design_path exact)", check: async (f, ex, r) => ({ pass: toolsIn(r?.trace).some((t) => ["apply_client_product", "set_design_path"].includes(t)), detail: toolsIn(r?.trace).join(",") }) },
  ],
};

export default scenario;
