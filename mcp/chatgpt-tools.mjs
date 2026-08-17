// SJC OS MCP — `search` / `fetch` (the ChatGPT connector contract)
//
// ChatGPT's custom connectors (and OpenAI's Responses API `mcp` tool in
// "connector" mode) require two specifically-named tools before they will
// accept a server at all — `search` and `fetch` — and expect a fixed result
// shape from each (docs: platform.openai.com/docs/mcp). Without them ChatGPT
// reports the server as unreachable / non-compliant even though the transport
// is fine. These are READ-ONLY, unified views over the same curated queries the
// rest of the surface uses; they add no new data access.
//
// Contract (JSON in a single text content item — that is what ChatGPT parses):
//   search({query})  → { results: [{ id, title, url, text? }] }
//   fetch({id})      → { id, title, text, url, metadata? }
//
// Result ids are namespaced ("project:<slug>", "knowledge:<uuid>", …) so fetch
// can route to the right table. Registered from buildServer():
//   registerChatgptTools(server, { rows, json, appUrl });

import { z } from "zod";

const SEARCH_LIMIT = 20;
const SNIPPET = 300;

const KINDS = ["knowledge", "project", "lead", "sub", "vendor", "work_item"];

function snip(text, n = SNIPPET) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Text content wrapping a JSON payload — ChatGPT reads exactly this. */
function payload(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function registerChatgptTools(server, { rows, json, appUrl }) {
  const base = String(appUrl || "https://os.sjcarpentryllc.com").replace(/\/$/, "");
  const urlFor = (kind, key) => {
    switch (kind) {
      case "project": return `${base}/projects/${encodeURIComponent(key)}`;
      case "lead": return `${base}/leads/${encodeURIComponent(key)}`;
      case "sub": return `${base}/subs/${encodeURIComponent(key)}`;
      case "vendor": return `${base}/vendors/${encodeURIComponent(key)}`;
      case "work_item": return `${base}/engine`;
      case "knowledge": return `${base}/engine`;
      default: return base;
    }
  };

  server.registerTool(
    "search",
    {
      title: "Search SJC OS",
      description:
        "Unified search across SJC OS: knowledge base (notes, decisions, SOPs, lessons), " +
        "projects, leads, subcontractors, vendors and the work queue. Returns a ranked list " +
        "of results, each with an id you can pass to `fetch` for the full record. " +
        "For structured, filtered queries prefer the specific list_*/get_* tools.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      const q = query.trim();
      const like = `%${q}%`;
      const results = [];

      const [knowledge, projects, leads, subs, vendors, work] = await Promise.all([
        rows(
          `SELECT id, kind, left(content, 600) AS content, created_at,
                  ts_rank(search_tsv, websearch_to_tsquery('english', $1)) AS rank
             FROM knowledge_items
            WHERE search_tsv @@ websearch_to_tsquery('english', $1) OR content ILIKE $2
            ORDER BY rank DESC, created_at DESC
            LIMIT 10`,
          [q, like],
        ),
        rows(
          `SELECT slug, name, status, client_name, address, stage_label
             FROM projects
            WHERE name ILIKE $1 OR client_name ILIKE $1 OR address ILIKE $1 OR slug ILIKE $1
            ORDER BY created_at DESC LIMIT 6`,
          [like],
        ),
        rows(
          `SELECT slug, name, scope, stage, address, value_display
             FROM leads
            WHERE name ILIKE $1 OR scope ILIKE $1 OR address ILIKE $1 OR slug ILIKE $1
            ORDER BY last_contact_at DESC NULLS LAST LIMIT 6`,
          [like],
        ),
        rows(
          `SELECT slug, name, trade, coi_status FROM subs
            WHERE name ILIKE $1 OR trade ILIKE $1 OR slug ILIKE $1
            ORDER BY fav DESC, name LIMIT 5`,
          [like],
        ),
        rows(
          `SELECT slug, name, trade FROM vendors
            WHERE name ILIKE $1 OR trade ILIKE $1 OR slug ILIKE $1
            ORDER BY fav DESC, name LIMIT 5`,
          [like],
        ),
        rows(
          `SELECT id, title, left(body, 300) AS body, status, priority, due_at
             FROM work_items
            WHERE (title ILIKE $1 OR body ILIKE $1) AND status <> 'done'
            ORDER BY created_at DESC LIMIT 6`,
          [like],
        ),
      ]);

      // Entities first (a name hit is almost always what the asker meant), then
      // knowledge by rank, then queue items.
      for (const p of projects) {
        results.push({
          id: `project:${p.slug}`,
          title: `Project — ${p.name}${p.client_name ? ` (${p.client_name})` : ""}`,
          url: urlFor("project", p.slug),
          text: snip([p.status, p.stage_label, p.address].filter(Boolean).join(" · ")),
        });
      }
      for (const l of leads) {
        results.push({
          id: `lead:${l.slug}`,
          title: `Lead — ${l.name}`,
          url: urlFor("lead", l.slug),
          text: snip([l.stage, l.scope, l.address, l.value_display].filter(Boolean).join(" · ")),
        });
      }
      for (const s of subs) {
        results.push({
          id: `sub:${s.slug}`,
          title: `Subcontractor — ${s.name}${s.trade ? ` (${s.trade})` : ""}`,
          url: urlFor("sub", s.slug),
          text: snip(`COI: ${s.coi_status ?? "unknown"}`),
        });
      }
      for (const v of vendors) {
        results.push({
          id: `vendor:${v.slug}`,
          title: `Vendor — ${v.name}${v.trade ? ` (${v.trade})` : ""}`,
          url: urlFor("vendor", v.slug),
          text: "",
        });
      }
      for (const k of knowledge) {
        results.push({
          id: `knowledge:${k.id}`,
          title: `${k.kind ?? "note"} — ${snip(k.content, 80)}`,
          url: urlFor("knowledge", k.id),
          text: snip(k.content),
        });
      }
      for (const w of work) {
        results.push({
          id: `work_item:${w.id}`,
          title: `Work item — ${w.title}`,
          url: urlFor("work_item", w.id),
          text: snip([w.status, w.priority, w.due_at ? `due ${w.due_at}` : null, w.body].filter(Boolean).join(" · ")),
        });
      }

      return payload({ results: results.slice(0, SEARCH_LIMIT) });
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch SJC OS record",
      description:
        "Full contents of one record by the id returned from `search` " +
        "(e.g. `project:<slug>`, `lead:<slug>`, `sub:<slug>`, `vendor:<slug>`, " +
        "`knowledge:<uuid>`, `work_item:<uuid>`). A bare uuid is treated as a knowledge item.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const m = /^([a-z_]+):(.+)$/.exec(id.trim());
      const kind = m && KINDS.includes(m[1]) ? m[1] : "knowledge";
      const key = m && KINDS.includes(m[1]) ? m[2] : id.trim();

      const notFound = () =>
        payload({ id, title: "Not found", text: `No ${kind} record for id "${id}".`, url: base, metadata: { kind, found: false } });

      if (kind === "project") {
        const proj = await rows(`SELECT * FROM projects WHERE slug = $1`, [key]);
        if (!proj.length) return notFound();
        const p = proj[0];
        const [invoices, subs, notes] = await Promise.all([
          rows(`SELECT number, milestone, amount, status, sent_at, paid_at FROM invoices WHERE project_id = $1 ORDER BY created_at`, [p.id]),
          rows(`SELECT sub_slug, role_label FROM project_subs WHERE project_id = $1`, [p.id]),
          rows(`SELECT id, kind, left(content, 500) AS content, created_at FROM knowledge_items WHERE project_id = $1 ORDER BY created_at DESC LIMIT 15`, [p.id]),
        ]);
        const paid = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount || 0), 0);
        const outstanding = invoices.filter((i) => i.status === "sent").reduce((s, i) => s + Number(i.amount || 0), 0);
        return payload({
          id,
          title: `Project — ${p.name}`,
          text: JSON.stringify({ project: p, invoices, subs, money: { paid, outstanding }, recent_knowledge: notes }, null, 2),
          url: urlFor("project", p.slug),
          metadata: { kind, status: p.status, client_name: p.client_name },
        });
      }

      if (kind === "lead") {
        const r = await rows(`SELECT * FROM leads WHERE slug = $1`, [key]);
        if (!r.length) return notFound();
        const l = r[0];
        const notes = await rows(
          `SELECT id, kind, left(content, 500) AS content, created_at FROM knowledge_items WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 15`,
          [l.id],
        );
        return payload({
          id,
          title: `Lead — ${l.name}`,
          text: JSON.stringify({ lead: l, recent_knowledge: notes }, null, 2),
          url: urlFor("lead", l.slug),
          metadata: { kind, stage: l.stage },
        });
      }

      if (kind === "sub" || kind === "vendor") {
        const table = kind === "sub" ? "subs" : "vendors";
        const r = await rows(`SELECT * FROM ${table} WHERE slug = $1`, [key]);
        if (!r.length) return notFound();
        return payload({
          id,
          title: `${kind === "sub" ? "Subcontractor" : "Vendor"} — ${r[0].name}`,
          text: JSON.stringify(r[0], null, 2),
          url: urlFor(kind, r[0].slug),
          metadata: { kind, trade: r[0].trade },
        });
      }

      if (kind === "work_item") {
        const r = await rows(
          `SELECT w.*, p.slug AS project_slug, l.slug AS lead_slug
             FROM work_items w
             LEFT JOIN projects p ON p.id = w.project_id
             LEFT JOIN leads l ON l.id = w.lead_id
            WHERE w.id::text = $1`,
          [key],
        );
        if (!r.length) return notFound();
        return payload({
          id,
          title: `Work item — ${r[0].title}`,
          text: JSON.stringify(r[0], null, 2),
          url: urlFor("work_item", r[0].id),
          metadata: { kind, status: r[0].status, priority: r[0].priority },
        });
      }

      // knowledge (default)
      const r = await rows(
        `SELECT k.*, p.slug AS project_slug, l.slug AS lead_slug
           FROM knowledge_items k
           LEFT JOIN projects p ON p.id = k.project_id
           LEFT JOIN leads l ON l.id = k.lead_id
          WHERE k.id::text = $1`,
        [key],
      );
      if (!r.length) return notFound();
      const k = r[0];
      return payload({
        id: `knowledge:${k.id}`,
        title: `${k.kind ?? "note"} — ${snip(k.content, 80)}`,
        text: k.content,
        url: k.source_uri || urlFor("knowledge", k.id),
        metadata: {
          kind: "knowledge",
          item_kind: k.kind,
          source: k.source,
          project_slug: k.project_slug,
          lead_slug: k.lead_slug,
          created_at: k.created_at,
        },
      });
    },
  );

  // `json` is accepted for signature parity with the other modules; the two
  // tools above deliberately use the compact ChatGPT payload shape instead.
  void json;
}
