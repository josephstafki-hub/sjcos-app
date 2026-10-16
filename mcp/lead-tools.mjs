// SJC OS MCP — a lead's Phase 1 rough estimate. The agent-side twin of the
// lead page's Rough estimate tab (components/leads/LeadEstimate.tsx), writing
// the same lead_estimates row the tab's Save / Draft-with-AI buttons do:
//
//   • saveEstimateLines / saveEstimateNotes (lib/actions/leads.ts) — the
//     owner's edits: line items + total (+ steering notes), mirrored onto
//     leads.value_display / estimate_value so /leads shows the number.
//   • draftEstimate (same file) — the AI draft: saving puts the estimate back
//     to 'draft' and logs an 'estimate' activity under the drafter's name.
//
//   import { registerLeadTools } from "./lead-tools.mjs";
//   registerLeadTools(server, { rows, json, strippedDollarError, currentPrincipal });
//
// Plain SQL by design (the .mjs server can't import those "use server" files),
// so KEEP THIS IN STEP with the actions above. Nothing here contacts the
// client: sending stays Joe's button on the lead page (sendEstimate), and the
// 'estimate' activity kind deliberately doesn't count as contact
// (lib/lead-activity.ts), so a "Needs reply" flag stays up.
//
// Access mirrors the tab: a person behind the agent needs the "leads" area and
// the "estimates" money fence (owner always may; unattended → allowed).

import { z } from "zod";
import { compactEstimateValue } from "../lib/lead-estimate-value.mjs";
import { agentNameOf, areaRefusal } from "./tool-shared.mjs";

const lineSchema = z.object({
  label: z.string().describe('What the range covers, e.g. "Cabinets + install".'),
  value: z.string().describe('The range or amount as the client should read it, e.g. "$18,000–$22,000".'),
});

export function registerLeadTools(server, { rows, json, strippedDollarError, currentPrincipal }) {
  const one = async (sql, params) => (await rows(sql, params))[0] ?? null;

  server.registerTool(
    "save_lead_rough_estimate",
    {
      title: "Save a lead's rough estimate",
      description:
        "Write the Phase 1 rough estimate on a LEAD — the Rough estimate tab on the lead page, the " +
        "ballpark ranges sent before a pre-con agreement. Use this, never SQL. `lines` REPLACES the whole " +
        "line list (pass every line, not just the changed ones); `total` is the rough total as the client " +
        "reads it (\"$51,000–$64,500\"); `notes` (optional) replaces the steering notes shown on the tab — " +
        "put assumptions and open questions there. The lead list's value is updated from the total. " +
        "Saves a DRAFT and never contacts the client: Joe reviews it and sends it from the lead page. " +
        "If the estimate was already sent, this refuses unless revise_sent is true (only when Joe asked for " +
        "a revised estimate); that puts it back to draft, to be re-sent. Refuses on a lead that became a " +
        "project — price that job on its project estimates instead (get_project → pricing_and_paperwork). " +
        "Read the current estimate with get_lead (`rough_estimate`).",
      inputSchema: {
        slug: z.string().describe("The lead's slug (list_leads / get_lead)."),
        lines: z.array(lineSchema).min(1).max(60),
        total: z.string().describe('Rough total, e.g. "$51,000–$64,500".'),
        notes: z.string().optional(),
        revise_sent: z.boolean().optional(),
      },
    },
    async (a) => {
      const mangled = strippedDollarError(
        a.total,
        a.notes,
        ...a.lines.flatMap((l) => [l.label, l.value]),
      );
      if (mangled) return mangled;

      const refusal =
        (await areaRefusal(rows, currentPrincipal, "leads")) ?? (await areaRefusal(rows, currentPrincipal, "estimates"));
      if (refusal) return json({ ok: false, error: refusal });

      // Same cleanup as saveEstimateLines: trimmed strings, blank rows dropped.
      const lines = a.lines
        .map((l) => ({ label: String(l.label ?? "").trim(), value: String(l.value ?? "").trim() }))
        .filter((l) => l.label || l.value);
      const total = String(a.total ?? "").trim();
      if (lines.length === 0) return json({ ok: false, error: "Every line was blank. Nothing was saved." });
      if (!total) return json({ ok: false, error: "total is required (the rough total the client reads). Nothing was saved." });

      const lead = await one(
        `SELECT l.id, l.name, (SELECT p.slug FROM projects p WHERE p.lead_id = l.id LIMIT 1) AS project_slug
           FROM leads l WHERE l.slug = $1`,
        [a.slug],
      );
      if (!lead) return json({ ok: false, error: `No lead with slug "${a.slug}". Use list_leads to find it.` });
      if (lead.project_slug) {
        return json({
          ok: false,
          error:
            `"${lead.name}" is already project "${lead.project_slug}"; its rough estimate is read-only lead ` +
            `paperwork now. Price changes go on the project's estimates (get_project → pricing_and_paperwork). ` +
            `Nothing was saved.`,
          project_slug: lead.project_slug,
        });
      }

      const prior = await one(`SELECT status, sent_at FROM lead_estimates WHERE lead_id = $1`, [lead.id]);
      const wasSent = prior?.status === "sent";
      if (wasSent && a.revise_sent !== true) {
        return json({
          ok: false,
          error:
            `This rough estimate was already sent to ${lead.name}` +
            `${prior.sent_at ? ` on ${new Date(prior.sent_at).toISOString().slice(0, 10)}` : ""}. ` +
            `Re-send with revise_sent: true only if Joe asked for a revised estimate: it goes back to draft ` +
            `and has to be sent again. Nothing was saved.`,
        });
      }

      const notes = a.notes == null ? null : a.notes.trim();
      await rows(
        `INSERT INTO lead_estimates (lead_id, line_items, total, notes, status, sent_at, updated_at)
         VALUES ($1, $2::jsonb, $3, COALESCE($4, ''), 'draft', NULL, now())
         ON CONFLICT (lead_id) DO UPDATE
           SET line_items = EXCLUDED.line_items, total = EXCLUDED.total,
               notes = COALESCE($4, lead_estimates.notes),
               status = 'draft', sent_at = NULL, updated_at = now()`,
        [lead.id, JSON.stringify(lines), total, notes],
      );

      // Mirror the total onto the /leads overview columns (syncLeadValueFromEstimate).
      const compact = compactEstimateValue(total);
      if (compact) {
        await rows(`UPDATE leads SET value_display = $2, estimate_value = $3 WHERE id = $1`, [
          lead.id,
          compact.display,
          compact.value,
        ]);
      }

      // logLeadActivity(slug, "estimate", …) — not a contact kind, so the
      // lead's last_contact_at and "Needs reply" flag are left alone.
      const agent = agentNameOf(server);
      const verb = wasSent ? "revised after sending" : prior ? "updated" : "drafted";
      await rows(
        `INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'estimate', $2, $3)`,
        [lead.id, `Rough estimate ${verb} by ${agent} (${total})`, agent],
      );

      return json({
        ok: true,
        slug: a.slug,
        status: "draft",
        created: !prior,
        revised_sent: wasSent,
        lines,
        total,
        notes_saved: notes != null,
        value_display: compact?.display ?? null,
        ...(compact ? {} : { warning: "The total has no number in it, so the lead list's value was left as it was." }),
        lead_page: `/leads/${a.slug}`,
        preview_pdf: `/api/leads/${a.slug}/rough-estimate`,
        next: "Not sent. Joe reviews it on the lead page's Rough estimate tab and sends it from there.",
      });
    },
  );
}
