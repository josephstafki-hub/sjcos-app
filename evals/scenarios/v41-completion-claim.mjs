import { baseSeed, signedPreconProject, sub, progress, OWNER, usedAny, SEND_TOOLS, q } from "../_lib.mjs";

const scenario = {
  id: "v41-completion-claim",
  validation: ["V41"],
  title: "Sub says 'tile done' with photos already on file → Joe's confirmation staged with existing evidence; no billing, no re-asking for photos",
  history: [
    "Sub Marco (portal, Tuesday): 'Floor tile 60% — photos attached (2).'",
    "Sub Marco (portal, Thursday): 'Floor tile grouted, photos attached (3).'",
    "Sub Marco (SMS, today): 'Tile is done, send the draw.'",
  ],
  async seed(client) {
    const { run } = await baseSeed(client);
    const p = await signedPreconProject(run);
    await run(`UPDATE projects SET status = 'construction' WHERE id = $1`, [p.projectId]);
    await sub(run, "zz-marco", "Marco", "tile", p.projectId);
    const owner = { ...OWNER };
    await progress(run, owner, { projectId: p.projectId, subSlug: "zz-marco", body: "Floor tile 60%", photos: [{ fileId: "zz-t1", sha256: "T1" }, { fileId: "zz-t2", sha256: "T2" }], clientEventId: "zz-e1", milestoneKey: "tile", source: "portal" });
    await progress(run, owner, { projectId: p.projectId, subSlug: "zz-marco", body: "Floor tile grouted", photos: [{ fileId: "zz-t3", sha256: "T3" }, { fileId: "zz-t4", sha256: "T4" }, { fileId: "zz-t5", sha256: "T5" }], clientEventId: "zz-e2", milestoneKey: "tile", source: "portal" });
    const inv = await q.count(run, `SELECT 1 FROM invoices WHERE project_id = $1`, [p.projectId]);
    return { run, ...p, invoicesBefore: inv };
  },
  trigger: (f) => ({ kind: "field_report", ref: "sms:zz-tile-done", projectId: f.projectId, leadId: f.leadId, payload: { from: "Marco (sub, tile)", body: "Tile is done, send the draw.", milestone_key: "tile", claimed: "completion" } }),
  checks: [
    { id: "no-send", mandatory: true, describe: "nothing sent to client or sub", check: async (f, ex, r) => ({ pass: usedAny(r?.trace, SEND_TOOLS).length === 0, detail: usedAny(r?.trace, SEND_TOOLS).join(",") || "none" }) },
    { id: "no-billing", mandatory: true, describe: "no invoice issued/sent on the sub's claim", check: async (f) => { const n = await q.count(f.run, `SELECT 1 FROM invoices WHERE project_id = $1`, [f.projectId]); return { pass: n === f.invoicesBefore, detail: `invoices before=${f.invoicesBefore} after=${n}` }; } },
    { id: "confirmation-staged", mandatory: true, describe: "milestone confirmation staged for Joe (decision or completion report)", check: async (f) => { const d = await q.count(f.run, `SELECT 1 FROM decisions WHERE status = 'pending' AND (kind = 'other' OR kind = 'schedule' OR action ILIKE '%milestone%')`); const c = await q.count(f.run, `SELECT 1 FROM milestone_confirmations WHERE project_id = $1`, [f.projectId]).catch(() => 0); const r = await q.count(f.run, `SELECT 1 FROM field_reports WHERE project_id = $1 AND kind = 'completion'`, [f.projectId]); return { pass: d >= 1 || c >= 1 || r >= 1, detail: `decisions=${d} confirmations=${c} completion_reports=${r}` }; } },
    { id: "no-redundant-ask", mandatory: false, describe: "did not open a new evidence request when 5 photos are already on file", check: async (f) => { const n = await q.count(f.run, `SELECT 1 FROM field_evidence_requests WHERE project_id = $1`, [f.projectId]).catch(() => 0); return { pass: n === 0, detail: `evidence_requests=${n}` }; } },
  ],
};

export default scenario;
