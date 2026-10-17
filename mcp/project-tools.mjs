// SJC OS MCP — create a project. The agent-side twin of the app's two ways a
// job comes into being, with the same rows written in the same order:
//
//   • lead_slug → convertLeadToProject (lib/actions/leads.ts): the Convert
//     button on the lead page. Pre-con project linked to the lead; carries the
//     client portal login/invite/chat, lead-stage files and the chat room
//     across; feed card. Idempotent — an already-converted lead returns its
//     project.
//   • name      → createProject (lib/actions/projects.ts): the "New project"
//     form. Blank project at the first lifecycle stage + its chat room.
//
//   import { registerProjectTools } from "./project-tools.mjs";
//   registerProjectTools(server, { rows, json, strippedDollarError, currentPrincipal });
//
// Plain SQL by design (the .mjs server can't import those "use server" files),
// so KEEP THIS IN STEP with the two actions above, plus suggestedProjectName
// (lib/leads.ts), openEntityRoom / carryRoomMembership / closeEntityRoom
// (lib/rooms.ts) and emit (lib/notify.ts). Like the app, only the project row
// is essential; room, portal and feed bookkeeping are best-effort.
//
// Access mirrors the buttons: a person behind the agent needs the "leads" area
// to convert and "projects" for a blank one (owner always may); no person
// (unattended clients Joe runs) → allowed, as for every MCP write.

import { z } from "zod";
import { areaRefusal } from "./tool-shared.mjs";

/** Mirrors slugify() in lib/actions/projects.ts. */
function slugify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

/** Mirrors suggestedProjectName() in lib/leads.ts. */
export function suggestedProjectName(leadName, scope) {
  const words = leadName.replace(/\([^)]*\)/g, "").trim().split(/\s+/).filter(Boolean);
  const lastName = words[words.length - 1] || leadName;
  const scopeHead = (scope.split(/[·,.]/)[0] ?? "").trim() || scope.trim();
  return [lastName, scopeHead].filter(Boolean).join(" · ").slice(0, 80);
}

const roomKey = (slug) => `room:${slug}`;
const leadRoomKey = (slug) => `room:lead:${slug}`;

export function registerProjectTools(server, { rows, json, strippedDollarError, currentPrincipal }) {
  const one = async (sql, params) => (await rows(sql, params))[0] ?? null;

  async function uniqueProjectSlug(name) {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; ; i++) {
      if (!(await one(`SELECT 1 FROM projects WHERE slug = $1`, [slug]))) return slug;
      slug = `${base}-${i}`;
    }
  }

  /** null = allowed; otherwise the refusal message. */
  const accessRefusal = (area) => areaRefusal(rows, currentPrincipal, area);

  /** openEntityRoom("project", slug, name) — upsert, so it also reopens (unless
   *  the owner archived it by hand: chat_rooms.hold, see lib/rooms.ts). */
  const openProjectRoom = (slug, name) =>
    rows(
      `INSERT INTO chat_rooms (key, entity_type, entity_ref, name)
       VALUES ($1, 'project', $2, $3)
       ON CONFLICT (key) DO UPDATE
          SET closed_at = CASE WHEN chat_rooms.hold = 'archived' THEN chat_rooms.closed_at END,
              hold = NULLIF(chat_rooms.hold, 'open'),
              name = EXCLUDED.name`,
      [roomKey(slug), slug, name],
    );

  async function createBlank({ name, client_name, address, value_display }) {
    const projectName = name.trim();
    const addr = (address ?? "").trim() || null;
    const slug = await uniqueProjectSlug(projectName);
    await rows(
      `INSERT INTO projects (slug, name, status, client_name, address, value_display, sub_label)
       VALUES ($1, $2, 'precon_signed', $3, $4, $5, $6)`,
      [slug, projectName, (client_name ?? "").trim(), addr, (value_display ?? "").trim() || null, addr],
    );
    try {
      await openProjectRoom(slug, projectName);
    } catch {
      /* room bookkeeping must never block project creation */
    }
    return { ok: true, slug, name: projectName, created: true, from_lead: null };
  }

  async function convertLead(slug, nameInput) {
    const lead = await one(`SELECT id, name, scope, scope_city, value_display FROM leads WHERE slug = $1`, [slug]);
    if (!lead) return { ok: false, error: `No lead with slug "${slug}".` };

    const existing = await one(`SELECT slug, name FROM projects WHERE lead_id = $1`, [lead.id]);
    if (existing) {
      return {
        ok: true,
        slug: existing.slug,
        name: existing.name,
        created: false,
        from_lead: slug,
        note: "This lead was already converted — returned its existing project.",
      };
    }

    // Prefer the intake "Address" answer for the job site; fall back to scope_city.
    const intakeAddr = await one(`SELECT answer FROM lead_intake WHERE lead_id = $1 AND question = 'Address'`, [lead.id]);
    const address = intakeAddr?.answer?.trim() || lead.scope_city || null;
    const projectName = (nameInput ?? "").trim().slice(0, 80) || suggestedProjectName(lead.name, lead.scope ?? "");

    const pslug = await uniqueProjectSlug(projectName);
    await rows(
      `INSERT INTO projects (slug, name, status, client_name, address, value_display, sub_label, lead_id)
       VALUES ($1, $2, 'floor_plan', $3, $4, $5, $6, $7)`,
      [pslug, projectName, lead.name, address, lead.value_display, address, lead.id],
    );
    // logLeadActivity(slug, "note", …) — actor defaults to "Joe" there too.
    await rows(
      `INSERT INTO lead_activity (lead_id, kind, summary, actor) VALUES ($1, 'note', $2, 'Joe')`,
      [lead.id, `Converted to project "${projectName}"`],
    ).catch(() => {});

    // Portal login, invite, portal chat and lead-stage files follow the lead
    // onto the project. Best-effort — never block the conversion.
    try {
      await rows(
        `UPDATE users
            SET link_slug = $2,
                email = CASE WHEN email = $3 THEN $4 ELSE email END
          WHERE role = 'client' AND link_slug = $1`,
        [`lead:${slug}`, pslug, `lead-${slug}@client-portal.invalid`, `${pslug}@client-portal.invalid`],
      );
      await rows(`UPDATE client_portal_invites SET project_slug = $2, lead_slug = NULL WHERE lead_slug = $1`, [slug, pslug]);
      await rows(`UPDATE chat_messages SET channel_key = $2 WHERE channel_key = $1`, [`portal:lead:${slug}`, `portal:${pslug}`]);
      await rows(
        `UPDATE files
            SET project_key = $2,
                client_slug = CASE WHEN client_slug = $3 THEN $2 ELSE client_slug END
          WHERE lead_slug = $1 AND (project_key IS NULL OR project_key = '')`,
        [slug, pslug, `lead:${slug}`],
      );
    } catch {
      /* portal carry-over must never block the conversion */
    }

    // The conversation moves from the lead room to the new project room.
    try {
      const from = leadRoomKey(slug);
      const to = roomKey(pslug);
      await openProjectRoom(pslug, projectName);
      await rows(
        `INSERT INTO chat_members (channel_key, sub_slug)
         SELECT $2, sub_slug FROM chat_members WHERE channel_key = $1 ON CONFLICT DO NOTHING`,
        [from, to],
      );
      await rows(
        `INSERT INTO chat_team_members (channel_key, member_slug)
         SELECT $2, member_slug FROM chat_team_members WHERE channel_key = $1 ON CONFLICT DO NOTHING`,
        [from, to],
      );
      await rows(
        `INSERT INTO chat_room_clients (room_key, name, email)
         SELECT $2, name, email FROM chat_room_clients WHERE room_key = $1
         ON CONFLICT (room_key, name) DO NOTHING`,
        [from, to],
      );
      const closed = await rows(`UPDATE chat_rooms SET closed_at = now() WHERE key = $1 AND closed_at IS NULL AND hold IS DISTINCT FROM 'open' RETURNING key`, [from]);
      if (closed.length) {
        await rows(
          `INSERT INTO chat_reads_by_user (channel_key, user_id, last_read_at)
             SELECT $1, u.id, now() FROM users u
              WHERE u.active
                AND (u.role = 'owner'
                     OR EXISTS (
                       SELECT 1 FROM chat_team_members tm
                         JOIN team_members t ON t.slug = tm.member_slug
                        WHERE tm.channel_key = $1 AND t.user_id = u.id
                     ))
           ON CONFLICT (channel_key, user_id) DO UPDATE SET last_read_at = now()`,
          [from],
        );
      }
    } catch {
      /* room bookkeeping must never block the conversion */
    }

    // Feed card, same as emit({ kind: "job", … }).
    await rows(
      `INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href)
       VALUES ('job', 'Job', 'accent', 'project', $1, $2, 'Just now', false, $3)`,
      [`New project · ${projectName}`, `Converted from lead · ${lead.name}`, `/projects/${pslug}`],
    ).catch(() => {});

    return { ok: true, slug: pslug, name: projectName, created: true, from_lead: slug };
  }

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Create a project — the same as the app's buttons. Two ways: " +
        "(1) `lead_slug` = convert that lead (the Convert button on the lead page): a pre-construction " +
        "project linked to the lead, carrying its client, address, value, portal access, files and chat room. " +
        "Idempotent — a lead that already has a project returns it with created: false. `name` optionally " +
        "overrides the suggested \"<Last name> · <scope>\" name. " +
        "(2) No lead = the \"New project\" form: `name` required, plus optional `client_name`, `address`, " +
        "`value_display` (a label like \"$48,000\"; set the real contract amount with set_project_contract_value). " +
        "When the job came from a lead, ALWAYS convert the lead instead of creating a blank project — check " +
        "list_leads / get_lead first. Returns the project's slug.",
      inputSchema: {
        lead_slug: z.string().optional(),
        name: z.string().optional(),
        client_name: z.string().optional(),
        address: z.string().optional(),
        value_display: z.string().optional(),
      },
    },
    async (a) => {
      const leadSlug = a.lead_slug?.trim();
      if (!leadSlug && !a.name?.trim()) return json({ ok: false, error: "Give lead_slug (convert a lead) or name (blank project)." });
      if (leadSlug && (a.client_name || a.address || a.value_display)) {
        return json({ ok: false, error: "Converting a lead takes client, address and value from the lead — pass only lead_slug (and optionally name)." });
      }
      const mangled = strippedDollarError(a.name, a.value_display);
      if (mangled) return mangled;
      const refusal = await accessRefusal(leadSlug ? "leads" : "projects");
      if (refusal) return json({ ok: false, error: refusal });
      try {
        return json(leadSlug ? await convertLead(leadSlug, a.name) : await createBlank(a));
      } catch (e) {
        return json({ ok: false, error: e?.message ?? String(e) });
      }
    },
  );
}
