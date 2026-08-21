// SJC OS — MCP bidding tools (AI-agnostic).
//
// Lives in its own module (same pattern as mood-tools.mjs) so this surface can
// be developed without colliding with concurrent work on sjcos-mcp.mjs. Wire it
// up with one line inside buildServer():
//
//   import { registerBiddingTools } from "./bidding-tools.mjs";
//   ...
//   registerBiddingTools(server, { rows, json, biddingCall });
//
// WHAT THIS EXPOSES: staging and reading the owner's Bidding-tab surface —
// create a bid package for a category of work, attach the project's
// plans/takeoffs, pick recipients from the sub roster by trade, customize the
// per-sub note, watch recorded bids come back, compare them side by side, and
// award a winner.
//
// THE LINE: there is NO send tool. Sending a bid package emails the packet
// straight to each sub's inbox (the app's Gmail connector), and client-facing
// sends stay owner-approved — so agents stage everything and Joe presses Send
// on the Bidding tab. (Earlier, send was agent-callable because it only
// published to sub portals; bids are email-only now, so the line moved back.)
// Bid replies land in Joe's inbox and he records the numbers in the app.
//
// Deletes: only two, both draft-only and cheap to re-create (a packet-file row
// and an unsent invite) — the same precedent as draft PO lines. Submitted bids
// are business records; nothing here can touch them.

import { z } from "zod";

const t = (v, max = 300) => String(v ?? "").trim().slice(0, max);

export function registerBiddingTools(server, { rows, json, biddingCall }) {
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });

  const projectBySlug = async (slug) => {
    const r = await rows(`SELECT id, slug, name FROM projects WHERE slug = $1`, [t(slug, 80)]);
    if (!r.length) throw new Error(`Project '${slug}' not found. Use list_projects to find the slug.`);
    return r[0];
  };

  const packageById = async (id) => {
    const r = await rows(
      `SELECT b.*, p.slug AS project_slug, p.name AS project_name
         FROM bid_packages b JOIN projects p ON p.id = b.project_id
        WHERE b.id = $1`,
      [Number(id)],
    );
    if (!r.length) throw new Error(`Bid package ${id} not found. Use list_bid_packages.`);
    return r[0];
  };

  const inviteById = async (id) => {
    const r = await rows(
      `SELECT i.*, s.name AS sub_name, s.trade AS sub_trade, b.title, b.status AS package_status
         FROM bid_invites i
         JOIN subs s ON s.slug = i.sub_slug
         JOIN bid_packages b ON b.id = i.package_id
        WHERE i.id = $1`,
      [Number(id)],
    );
    if (!r.length) throw new Error(`Bid invite ${id} not found. Use get_bid_package.`);
    return r[0];
  };

  /** Latest submission (with lines + files) per invite id. */
  const latestSubmissions = async (inviteIds) => {
    if (!inviteIds.length) return new Map();
    const subs = await rows(
      `SELECT DISTINCT ON (invite_id) id, invite_id, total, notes, exclusions, lead_time,
              revision, submitted_at
         FROM bid_submissions WHERE invite_id = ANY($1::bigint[])
        ORDER BY invite_id, revision DESC`,
      [inviteIds],
    );
    const ids = subs.map((s) => Number(s.id));
    const lines = ids.length
      ? await rows(
          `SELECT submission_id, description, amount FROM bid_submission_lines
            WHERE submission_id = ANY($1::bigint[]) ORDER BY submission_id, sort_order, id`,
          [ids],
        )
      : [];
    const files = ids.length
      ? await rows(
          `SELECT sf.submission_id, sf.file_id, f.name FROM bid_submission_files sf
             JOIN files f ON f.id = sf.file_id WHERE sf.submission_id = ANY($1::bigint[])`,
          [ids],
        )
      : [];
    const map = new Map();
    for (const s of subs) {
      map.set(Number(s.invite_id), {
        total_cents: s.total,
        total_usd: (s.total / 100).toFixed(2),
        notes: s.notes,
        exclusions: s.exclusions,
        lead_time: s.lead_time,
        revision: s.revision,
        submitted_at: s.submitted_at,
        lines: lines
          .filter((l) => Number(l.submission_id) === Number(s.id))
          .map((l) => ({ description: l.description, amount_cents: l.amount })),
        files: files
          .filter((f) => Number(f.submission_id) === Number(s.id))
          .map((f) => ({ file_id: f.file_id, name: f.name })),
      });
    }
    return map;
  };

  // ── READ ───────────────────────────────────────────────────────────────────

  server.registerTool(
    "list_bid_packages",
    {
      title: "List bid packages",
      description:
        "Bid packages (requests for sub pricing), optionally filtered by project, trade, or " +
        "status (draft|open|awarded|closed). Shows invite/submission counts and the low bid. " +
        "Sorted by trade so packages group by category of work.",
      inputSchema: {
        project_slug: z.string().optional().describe("Limit to one project."),
        trade: z.string().optional().describe("Category of work, e.g. 'Framing'."),
        status: z.enum(["draft", "open", "awarded", "closed"]).optional(),
      },
    },
    async ({ project_slug, trade, status }) => {
      try {
        const where = ["1=1"];
        const params = [];
        if (project_slug) {
          params.push((await projectBySlug(project_slug)).id);
          where.push(`b.project_id = $${params.length}`);
        }
        if (trade) {
          params.push(t(trade, 80));
          where.push(`b.trade ILIKE $${params.length}`);
        }
        if (status) {
          params.push(status);
          where.push(`b.status = $${params.length}`);
        }
        return json(
          await rows(
            `SELECT b.id, p.slug AS project, b.title, b.trade, b.status, b.due_date, b.sent_at,
                    count(i.id) FILTER (WHERE i.status <> 'draft')            AS subs_invited,
                    count(i.id) FILTER (WHERE i.status = 'draft')             AS subs_unsent,
                    count(i.id) FILTER (WHERE i.status IN ('submitted','awarded')) AS bids_in,
                    min(sub.total) FILTER (WHERE i.status <> 'declined')      AS low_bid_cents
               FROM bid_packages b
               JOIN projects p ON p.id = b.project_id
               LEFT JOIN bid_invites i ON i.package_id = b.id
               LEFT JOIN LATERAL (
                 SELECT total FROM bid_submissions WHERE invite_id = i.id
                  ORDER BY revision DESC LIMIT 1) sub ON true
              WHERE ${where.join(" AND ")}
              GROUP BY b.id, p.slug
              ORDER BY b.trade, b.created_at DESC`,
            params,
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_bid_package",
    {
      title: "Get a bid package",
      description:
        "Everything on one bid package: scope, packet files, every invited sub (with their " +
        "per-sub note and status: draft|sent|viewed|submitted|declined|awarded|not_awarded), " +
        "and each sub's latest submission with line items, exclusions, and uploaded docs.",
      inputSchema: { package_id: z.number().int().describe("From list_bid_packages.") },
    },
    async ({ package_id }) => {
      try {
        const pkg = await packageById(package_id);
        const files = await rows(
          `SELECT bf.id, bf.file_id, bf.label, f.name, f.size_label
             FROM bid_package_files bf JOIN files f ON f.id = bf.file_id
            WHERE bf.package_id = $1 ORDER BY bf.sort_order, bf.id`,
          [pkg.id],
        );
        const invites = await rows(
          `SELECT i.id, i.sub_slug, s.name, s.trade, s.email, i.message, i.status,
                  i.sent_at, i.viewed_at, i.responded_at
             FROM bid_invites i JOIN subs s ON s.slug = i.sub_slug
            WHERE i.package_id = $1 ORDER BY s.trade, s.name`,
          [pkg.id],
        );
        const submissions = await latestSubmissions(invites.map((i) => Number(i.id)));
        return json({
          id: pkg.id,
          project: pkg.project_slug,
          title: pkg.title,
          trade: pkg.trade,
          status: pkg.status,
          scope_notes: pkg.scope_notes,
          due_date: pkg.due_date,
          sent_at: pkg.sent_at,
          awarded_invite_id: pkg.awarded_invite_id,
          packet_files: files,
          invites: invites.map((i) => ({ ...i, submission: submissions.get(Number(i.id)) ?? null })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "compare_bids",
    {
      title: "Compare bids",
      description:
        "Submitted bids on a package sorted low to high, each with its delta over the low bid, " +
        "line items, exclusions, lead time, and docs — the agent-side version of the owner's " +
        "compare view. Use it to brief the owner before an award.",
      inputSchema: { package_id: z.number().int() },
    },
    async ({ package_id }) => {
      try {
        const pkg = await packageById(package_id);
        const invites = await rows(
          `SELECT i.id, s.name, s.trade, i.status FROM bid_invites i
             JOIN subs s ON s.slug = i.sub_slug
            WHERE i.package_id = $1 AND i.status IN ('submitted','awarded','not_awarded')`,
          [pkg.id],
        );
        const submissions = await latestSubmissions(invites.map((i) => Number(i.id)));
        const bids = invites
          .filter((i) => submissions.has(Number(i.id)))
          .map((i) => ({ invite_id: Number(i.id), sub: i.name, trade: i.trade, status: i.status, ...submissions.get(Number(i.id)) }))
          .sort((a, b) => a.total_cents - b.total_cents);
        const low = bids[0]?.total_cents ?? 0;
        return json({
          package: pkg.title,
          status: pkg.status,
          bids: bids.map((b) => ({ ...b, over_low_cents: b.total_cents - low })),
          declined: (
            await rows(
              `SELECT s.name FROM bid_invites i JOIN subs s ON s.slug = i.sub_slug
                WHERE i.package_id = $1 AND i.status = 'declined'`,
              [pkg.id],
            )
          ).map((r) => r.name),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_project_files",
    {
      title: "List project files",
      description:
        "Uploaded files on a project (plans, takeoff PDFs, photos) — the pool attach_bid_file " +
        "draws from. Returns file ids with names, types, and sizes.",
      inputSchema: { project_slug: z.string() },
    },
    async ({ project_slug }) => {
      try {
        const project = await projectBySlug(project_slug);
        return json(
          await rows(
            `SELECT id, name, type, tag, size_label, created_at FROM files
              WHERE project_key = $1 AND storage_path IS NOT NULL
              ORDER BY created_at DESC`,
            [project.slug],
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── WRITE (direct, internal-record) ────────────────────────────────────────

  server.registerTool(
    "create_bid_package",
    {
      title: "Create a bid package",
      description:
        "Start a bid request for one category of work on a project. Lands as a DRAFT — nothing " +
        "reaches a sub until the owner emails it from the Bidding tab (there is no agent send). " +
        "Attach files and add invites next.",
      inputSchema: {
        project_slug: z.string(),
        title: z.string().describe('What\'s being bid, e.g. "Framing — main house".'),
        trade: z.string().optional().describe("Category of work; groups the board and the picker."),
        scope_notes: z.string().optional().describe("Shared scope every invited sub sees."),
        due_date: z.string().optional().describe("YYYY-MM-DD."),
      },
    },
    async ({ project_slug, title, trade, scope_notes, due_date }) => {
      try {
        const project = await projectBySlug(project_slug);
        if (!t(title, 200)) throw new Error("title is required.");
        const r = await rows(
          `INSERT INTO bid_packages (project_id, title, trade, scope_notes, due_date)
           VALUES ($1, $2, $3, $4, NULLIF($5,'')::date) RETURNING id`,
          [project.id, t(title, 200), t(trade, 80), t(scope_notes, 4000), t(due_date, 10)],
        );
        return json({ ok: true, package_id: Number(r[0].id) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_bid_package",
    {
      title: "Update a bid package",
      description: "Edit title / trade / scope notes / due date. Omitted fields keep their value.",
      inputSchema: {
        package_id: z.number().int(),
        title: z.string().optional(),
        trade: z.string().optional(),
        scope_notes: z.string().optional(),
        due_date: z.string().optional().describe("YYYY-MM-DD, or '' to clear."),
      },
    },
    async ({ package_id, title, trade, scope_notes, due_date }) => {
      try {
        const pkg = await packageById(package_id);
        await rows(
          `UPDATE bid_packages
              SET title = COALESCE($2, title), trade = COALESCE($3, trade),
                  scope_notes = COALESCE($4, scope_notes),
                  due_date = CASE WHEN $5::text IS NULL THEN due_date ELSE NULLIF($5,'')::date END,
                  updated_at = now()
            WHERE id = $1`,
          [
            pkg.id,
            title == null ? null : t(title, 200),
            trade == null ? null : t(trade, 80),
            scope_notes == null ? null : t(scope_notes, 4000),
            due_date == null ? null : t(due_date, 10),
          ],
        );
        return json({ ok: true });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "attach_bid_file",
    {
      title: "Attach a file to the packet",
      description:
        "Put an existing project file (see list_project_files) into a package's packet, with an " +
        "optional label the sub sees ('Material takeoff'). Only files belonging to the package's " +
        "own project can be attached.",
      inputSchema: {
        package_id: z.number().int(),
        file_id: z.string(),
        label: z.string().optional(),
      },
    },
    async ({ package_id, file_id, label }) => {
      try {
        const pkg = await packageById(package_id);
        const ok = await rows(
          `SELECT id FROM files WHERE id = $1 AND project_key = $2 AND storage_path IS NOT NULL`,
          [t(file_id, 80), pkg.project_slug],
        );
        if (!ok.length) throw new Error("That file doesn't belong to this package's project.");
        await rows(
          `INSERT INTO bid_package_files (package_id, file_id, label, sort_order)
           VALUES ($1, $2, $3,
                   COALESCE((SELECT MAX(sort_order)+1 FROM bid_package_files WHERE package_id = $1), 0))
           ON CONFLICT (package_id, file_id) DO UPDATE SET label = EXCLUDED.label`,
          [pkg.id, t(file_id, 80), t(label, 120)],
        );
        return json({ ok: true });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "remove_bid_file",
    {
      title: "Remove a packet file",
      description:
        "Pull a file out of a DRAFT package's packet (the underlying files row survives). " +
        "Once a package is out to subs the packet is what they priced — it stays.",
      inputSchema: { bid_file_id: z.number().int().describe("bid_package_files.id from get_bid_package.") },
    },
    async ({ bid_file_id }) => {
      try {
        const r = await rows(
          `DELETE FROM bid_package_files bf
            USING bid_packages b
            WHERE bf.id = $1 AND b.id = bf.package_id AND b.status = 'draft'
            RETURNING bf.id`,
          [Number(bid_file_id)],
        );
        if (!r.length) throw new Error("Not found, or the package already went out (packet is locked).");
        return json({ ok: true });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_bid_invites",
    {
      title: "Add subs to a bid",
      description:
        "Invite subs (by slug — see list_subs, which includes each sub's trade for grouping) to a " +
        "package. Lands as DRAFT invites; nothing reaches a sub until the owner presses Send " +
        "(which emails the packet). Duplicates are ignored, so re-adding a trade group is safe.",
      inputSchema: {
        package_id: z.number().int(),
        sub_slugs: z.array(z.string()).min(1).describe("e.g. every sub whose trade matches the package."),
        message: z.string().optional().describe("Optional same note for all of these subs."),
      },
    },
    async ({ package_id, sub_slugs, message }) => {
      try {
        const pkg = await packageById(package_id);
        const valid = await rows(`SELECT slug FROM subs WHERE slug = ANY($1)`, [
          sub_slugs.map((s) => t(s, 80)),
        ]);
        if (!valid.length) throw new Error("No matching subs. Use list_subs for slugs.");
        let added = 0;
        for (const { slug } of valid) {
          const r = await rows(
            `INSERT INTO bid_invites (package_id, sub_slug, message)
             VALUES ($1, $2, $3) ON CONFLICT (package_id, sub_slug) DO NOTHING RETURNING id`,
            [pkg.id, slug, t(message, 2000)],
          );
          added += r.length;
        }
        return json({ ok: true, added, already_on: valid.length - added });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "set_bid_invite_message",
    {
      title: "Set a per-sub note",
      description:
        "The personal note one sub sees on top of the shared scope — how a packet is customized " +
        "per recipient ('your number should include the detached garage').",
      inputSchema: { invite_id: z.number().int(), message: z.string() },
    },
    async ({ invite_id, message }) => {
      try {
        const invite = await inviteById(invite_id);
        await rows(`UPDATE bid_invites SET message = $2 WHERE id = $1`, [invite.id, t(message, 2000)]);
        return json({ ok: true });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "remove_bid_invite",
    {
      title: "Remove an unsent invite",
      description: "Take a sub off a bid BEFORE it goes out. Sent invites are records and stay.",
      inputSchema: { invite_id: z.number().int() },
    },
    async ({ invite_id }) => {
      try {
        const r = await rows(`DELETE FROM bid_invites WHERE id = $1 AND status = 'draft' RETURNING id`, [
          Number(invite_id),
        ]);
        if (!r.length) throw new Error("Not found, or the invite already went out.");
        return json({ ok: true });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "close_bid_package",
    {
      title: "Close a bid package",
      description: "End bidding without awarding (descoped, went another way).",
      inputSchema: { package_id: z.number().int() },
    },
    async ({ package_id }) => {
      try {
        const pkg = await packageById(package_id);
        await rows(`UPDATE bid_packages SET status = 'closed', updated_at = now() WHERE id = $1`, [pkg.id]);
        return json({ ok: true });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── WRITE (through the app — same code path as the owner's buttons) ────────

  server.registerTool(
    "award_bid",
    {
      title: "Award a bid",
      description:
        "Pick the winner: that invite goes 'awarded', every other sub still in the running goes " +
        "'not_awarded', and the package closes. Only a submitted (recorded) bid can win.",
      inputSchema: { invite_id: z.number().int() },
    },
    async ({ invite_id }) => json(await biddingCall("award_bid", { invite_id })),
  );
}
