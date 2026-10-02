import { baseSeed, signedPreconProject, toolsIn, usedAny, SEND_TOOLS } from "../_lib.mjs";

const scenario = {
  id: "v32-owner-retains-labor",
  validation: ["V32"],
  title: "Joe retains trim labor with a price of unstated basis → allocation recorded, basis asked, materials still solicited, no package send",
  history: [
    "Joe (voice note transcript): 'On the ZZ kitchen I'll do the trim carpentry myself. Call it eighteen hundred for the trim. Still need the lumberyard to price the trim stock.'",
  ],
  async seed(client) {
    const { run } = await baseSeed(client);
    const p = await signedPreconProject(run);
    const trim = p.items.find((i) => /trim/i.test(i.title) || /trim/i.test(i.key)) ?? p.items[0];
    return { run, ...p, trimKey: trim.key };
  },
  trigger: (f) => ({ kind: "note", ref: `note:zz-trim-1`, projectId: f.projectId, leadId: f.leadId, payload: { author: "Joe (owner)", body: "On the ZZ kitchen I'll do the trim carpentry myself. Call it eighteen hundred for the trim. Still need the lumberyard to price the trim stock." } }),
  checks: [
    { id: "no-send", mandatory: true, describe: "no package/pricing request sent", check: async (f, ex, r) => ({ pass: usedAny(r?.trace, SEND_TOOLS).length === 0, detail: usedAny(r?.trace, SEND_TOOLS).join(",") || "none" }) },
    { id: "allocated", mandatory: true, describe: "trim install allocated to Joe; the $1,800 either recorded with its basis or carried into the basis question (never dropped, never guessed)", check: async (f, ex, r) => { const [row] = await f.run(`SELECT install_by, dedicated_price_cents::bigint AS c, price_basis FROM scope_items WHERE project_id = $1 AND key = $2`, [f.projectId, f.trimKey]); const text = `${ex?.result_summary ?? ""} ${ex?.blocked_reason ?? ""} ${(r?.trace ?? []).filter((t) => /ask_owner|create_work_item|stage_decision|capture_knowledge/.test(String(t.tool))).map((t) => JSON.stringify(t.input)).join(" ")}`; const carried = /1,?800|eighteen hundred/i.test(text); const recorded = Number(row?.c) === 180000 && row?.price_basis != null; return { pass: row?.install_by === "joe" && (recorded || carried), detail: `${JSON.stringify(row)} carried_in_question=${carried}` }; } },
    { id: "basis-not-guessed", mandatory: true, describe: "price basis left unknown or explicitly asked, never assumed", check: async (f, ex, r) => { const [row] = await f.run(`SELECT price_basis FROM scope_items WHERE project_id = $1 AND key = $2`, [f.projectId, f.trimKey]); const asked = toolsIn(r?.trace).includes("ask_owner") || /basis|cost or price|client price|internal cost/i.test(ex?.blocked_reason ?? "") || /basis/i.test(ex?.result_summary ?? ""); return { pass: row?.price_basis == null || asked, detail: `basis=${row?.price_basis ?? "null"} asked=${asked}` }; } },
    { id: "materials-kept", mandatory: true, describe: "trim materials remain to be sourced (supply not retained)", check: async (f) => { const [row] = await f.run(`SELECT supply_by FROM scope_items WHERE project_id = $1 AND key = $2`, [f.projectId, f.trimKey]); return { pass: row?.supply_by !== "joe", detail: `supply_by=${row?.supply_by}` }; } },
  ],
};

export default scenario;
