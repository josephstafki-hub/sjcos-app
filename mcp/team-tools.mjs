// SJC OS MCP — employee (login) accounts. The agent-side twin of Settings ›
// Team & roles (components/settings/TeamAccess.tsx + lib/actions/users.ts):
// every choice the owner has on that screen is a parameter here, with the
// same rules — except making or touching an owner, which stays in the app.
//
//   import { registerTeamTools } from "./team-tools.mjs";
//   registerTeamTools(server, { rows, json, currentPrincipal });
//
// Who may use them (2026-10-30, after an injected email could have minted an
// owner login): the WRITE tools — create, change areas, reset a password,
// disable / re-enable — run only when the person behind this run is the
// OWNER (currentPrincipal(): SJC_PRINCIPAL_USER_ID / the HTTP principal
// header, role re-read from the users row every call). A staff-started run,
// an unattended worker, a connector with no person behind it, or a disabled /
// signed-out owner is refused with "ask Joe or use Settings › Team". The two
// list tools stay readable by any run (no password material).
//
// What the screen offers, and so what these tools offer (owner runs only):
//   • Role: staff (team member with chosen areas), sub (sub portal login tied
//     to a subs.slug), client (client portal login tied to a projects.slug).
//     NEVER owner: an owner account hands out everything, so it is made only
//     by Joe in the app (Settings › Team) — refused here even on Joe's own run.
//   • Areas for staff: the catalog in lib/permissions.ts, listed live by
//     list_access_areas so an agent never guesses a key. At least one area,
//     exactly like the editor refuses an empty tick-list.
//   • Temp password: given, or generated here and returned ONCE in the result
//     (never stored, never logged; the DB holds the scrypt hash only).
//   • Later: replace/add/remove areas, reset the password, disable / re-enable.
//     Owner rows are never touched: no reset, no disable, no areas, no
//     promotion (no tool changes a role).
//
// Runtime: plain Node ESM importing lib/permissions.ts directly (dependency-
// free by design — Node 22 strips the types). lib/password.ts is "server-only"
// and off limits, so the scrypt hash is produced here in the SAME stored
// format ("<saltHex>:<hashHex>", 16-byte salt, 64-byte key) — lib/password.ts
// verifyPassword accepts it unchanged. NO delete tool: accounts are disabled,
// never removed, so message attribution and audit stay intact.

import { randomBytes, randomInt, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { PERMISSIONS, PERMISSION_KEYS, normalizePermissions } from "../lib/permissions.ts";

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;
const MIN_PASSWORD = 8;
const ROLES = ["staff", "sub", "client", "owner"];

/** Same stored shape as lib/password.ts hashPassword. */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, KEYLEN);
  return `${salt}:${derived.toString("hex")}`;
}

// Unambiguous alphabet (no 0/O, 1/l/I) — Joe reads these out loud or texts them.
const PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function generateTempPassword(len = 14) {
  let out = "";
  for (let i = 0; i < len; i++) out += PW_ALPHABET[randomInt(PW_ALPHABET.length)];
  return out;
}

/** Mirrors initialsOf() in lib/actions/users.ts. */
export function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const USER_SELECT = `SELECT id, name, email, role, initials, link_slug, active, permissions, created_at FROM users`;

function publicUser(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    initials: r.initials,
    link_slug: r.link_slug,
    active: r.active,
    permissions: r.role === "staff" ? normalizePermissions(r.permissions) : [],
    created_at: r.created_at,
  };
}

const areaEnum = z.enum(PERMISSION_KEYS);

const ASK_JOE = "Ask Joe, or use Settings › Team in the app.";

/** Owner accounts are made by Joe in the app, never through MCP — not even on
 *  his own run. */
export const OWNER_CREATE_REFUSAL =
  "MCP can't create an owner account, not even on Joe's own run. Joe adds owners himself in the app under Settings › Team. Nothing was changed.";

/** Owner rows are off limits to every MCP tool (password, access, enable). */
export const OWNER_ROW_REFUSAL =
  "That's an owner login. MCP can never reset or change an owner's password or access. Joe manages it himself in the app under Settings › Team. Nothing was changed.";

/** May THIS run administer logins? Only when the person behind it is the
 *  owner. null = allowed, otherwise the refusal message. Fails closed: no
 *  principal resolver, an unknown person (unattended worker, a connector or
 *  stdio client with nobody behind it), a disabled / signed-out account, or
 *  any non-owner role → refused. */
export async function userAdminRefusal(currentPrincipal) {
  let p = null;
  try {
    p = typeof currentPrincipal === "function" ? await currentPrincipal() : null;
  } catch {
    p = null;
  }
  if (!p?.userId) {
    return `Only Joe can add logins or change access, passwords or who's enabled, and this run isn't acting for him (no signed-in person behind it). Nothing was changed. ${ASK_JOE}`;
  }
  if (p.revoked || p.active === false) {
    return `The account this agent acts for is disabled or was signed out. Nothing was changed. ${ASK_JOE}`;
  }
  if (p.role !== "owner") {
    return `Only Joe can add logins or change access, passwords or who's enabled. Nothing was changed. ${ASK_JOE}`;
  }
  return null;
}

export function registerTeamTools(server, { rows, json, currentPrincipal }) {
  /** The owner-only gate as a tool result, or null when the run may proceed. */
  async function refuse() {
    const why = await userAdminRefusal(currentPrincipal);
    return why ? json({ ok: false, error: why }) : null;
  }

  /** Best-effort audit trail, same shape the app's internal routes write. */
  async function audit(action, summary) {
    try {
      await rows(
        `INSERT INTO agent_runs (runtime_name, status, input_summary, output_summary, finished_at)
         VALUES ('mcp:team', 'succeeded', $1, $2, now())`,
        [action.slice(0, 200), summary.slice(0, 500)],
      );
    } catch {
      /* audit is best-effort */
    }
  }

  /** Give a new staff account its chat identity — a team_members row linked to
   *  the login. Team chat keys DMs on roster slugs, so without one nobody can
   *  message them (they'd read channels and be unreachable). Adopts a matching
   *  display-only roster row rather than creating a duplicate. Best-effort: a
   *  failure here must not cost them the account. Mirrors linkChatIdentity() in
   *  lib/actions/users.ts — keep the two in step. */
  async function linkChatIdentity(userId, name) {
    const clean = String(name ?? "").trim();
    const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "teammate";
    try {
      const adopted = await rows(
        `UPDATE team_members SET user_id = $1, active = true
          WHERE user_id IS NULL AND lower(name) = lower($2) RETURNING slug`,
        [userId, clean],
      );
      if (adopted.length) return adopted[0].slug;
      for (let n = 0; n < 20; n++) {
        const slug = n === 0 ? base : `${base}-${n + 1}`;
        const taken = await rows(`SELECT 1 FROM team_members WHERE slug = $1`, [slug]);
        if (taken.length) continue;
        await rows(
          `INSERT INTO team_members (slug, name, role_label, active, user_id)
           VALUES ($1, $2, 'Team', true, $3)`,
          [slug, clean, userId],
        );
        return slug;
      }
    } catch {
      /* the account is what matters; chat identity can be added by hand */
    }
    return null;
  }

  /** Find one account by id (uuid) or email. */
  async function findUser(user) {
    const key = String(user ?? "").trim();
    if (!key) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    const found = await rows(
      isUuid ? `${USER_SELECT} WHERE id = $1` : `${USER_SELECT} WHERE lower(email) = lower($1)`,
      [key],
    );
    return found[0] ?? null;
  }

  server.registerTool(
    "list_access_areas",
    {
      title: "List access areas (staff permissions catalog)",
      description:
        "The areas a team-member (staff) account can be given — the same tick-boxes as Settings › " +
        "Team & roles. Each entry: key (pass these in `permissions`), label, what it unlocks, the " +
        "routes it opens, and whether it's sensitive (money surfaces; `ai` is effectively everything). " +
        "Read this before create_user / update_user_access so you pick real keys.",
      inputSchema: {},
    },
    async () =>
      json({
        areas: PERMISSIONS.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.description,
          paths: p.paths,
          sensitive: Boolean(p.sensitive),
        })),
        roles: [
          { role: "staff", label: "Team member — chosen areas", needs: "permissions (≥1 area)" },
          { role: "sub", label: "Sub — portal access", needs: "link_slug = the sub's slug (list_subs)" },
          { role: "client", label: "Client — portal access", needs: "link_slug = the project slug (list_projects)" },
          { role: "owner", label: "Owner — full app", needs: "not available through MCP — Joe adds owners in the app (Settings › Team)" },
        ],
        owner_only_paths: ["/settings", "/engine/permissions", "/client-portal", "/sub-portal"],
      }),
  );

  server.registerTool(
    "list_users",
    {
      title: "List login accounts (team & roles)",
      description:
        "Every login account: owner, staff (with their areas), sub and client portal logins. " +
        "Disabled accounts are included with active=false. Optional role filter. Never returns " +
        "password material.",
      inputSchema: {
        role: z.enum(ROLES).optional(),
        include_inactive: z.boolean().optional().describe("Default true."),
      },
    },
    async ({ role, include_inactive }) => {
      const where = [];
      const params = [];
      if (role) {
        params.push(role);
        where.push(`role = $${params.length}`);
      }
      if (include_inactive === false) where.push(`active = true`);
      const list = await rows(
        `${USER_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
          ORDER BY (role = 'owner') DESC, (role = 'staff') DESC, name`,
        params,
      );
      return json({ users: list.map(publicUser), count: list.length });
    },
  );

  server.registerTool(
    "create_user",
    {
      title: "Create a login account (employee / portal login)",
      description:
        "Provision a login exactly like Settings › Team & roles › Add. `role`: 'staff' = team member " +
        "limited to the `permissions` areas you list (at least one; keys from list_access_areas); " +
        "'sub' / 'client' = portal login tied by `link_slug` to a sub slug / project slug (checked). " +
        "'owner' is always refused — Joe adds owner accounts himself in the app (Settings › Team). " +
        "Only works on a run acting for Joe; any other run is refused. `temp_password` (≥8 chars) or " +
        "leave it out and one is generated and returned ONCE — hand it to the person; there is no " +
        "self-serve reset (use reset_user_password). Refuses a duplicate email. Nothing is emailed.",
      inputSchema: {
        name: z.string().min(1),
        email: z.string().email(),
        role: z.enum(ROLES).optional().describe("Default 'staff'. 'owner' is always refused here."),
        permissions: z.array(areaEnum).optional().describe("Staff only: areas they may open."),
        link_slug: z.string().optional().describe("sub / client only: subs.slug or projects.slug."),
        temp_password: z.string().optional().describe("≥8 chars; generated when omitted."),
        active: z.boolean().optional().describe("Default true; false parks the login disabled."),
      },
    },
    async ({ name, email, role = "staff", permissions, link_slug, temp_password, active = true }) => {
      // Never an owner through MCP, whoever is asking — checked first so even
      // Joe's own run gets the plain answer.
      if (role === "owner") return json({ ok: false, error: OWNER_CREATE_REFUSAL });
      if (!ROLES.includes(role)) return json({ ok: false, error: `Unknown role "${role}".` });
      const refused = await refuse();
      if (refused) return refused;
      const cleanName = name.trim();
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanName) return json({ ok: false, error: "Name is required." });

      let perms = [];
      let slug = null;
      if (role === "staff") {
        perms = normalizePermissions(permissions ?? []);
        if (perms.length === 0) {
          return json({ ok: false, error: "Staff accounts need at least one area in `permissions` (see list_access_areas)." });
        }
      } else if (role === "sub" || role === "client") {
        slug = String(link_slug ?? "").trim();
        if (!slug) return json({ ok: false, error: `Portal logins need link_slug (${role === "sub" ? "the sub's slug" : "the project slug"}).` });
        const hit =
          role === "sub"
            ? await rows(`SELECT slug FROM subs WHERE slug = $1`, [slug])
            : await rows(`SELECT slug FROM projects WHERE slug = $1`, [slug]);
        if (hit.length === 0) return json({ ok: false, error: `No ${role === "sub" ? "sub" : "project"} with slug "${slug}".` });
      }

      const generated = !temp_password;
      const password = temp_password ?? generateTempPassword();
      if (password.length < MIN_PASSWORD) return json({ ok: false, error: `temp_password needs at least ${MIN_PASSWORD} characters.` });

      const dup = await rows(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [cleanEmail]);
      if (dup.length) return json({ ok: false, error: "A user with that email already exists." });

      const hash = await hashPassword(password);
      const inserted = await rows(
        `INSERT INTO users (email, password_hash, name, role, initials, link_slug, active, permissions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, email, role, initials, link_slug, active, permissions, created_at`,
        [cleanEmail, hash, cleanName, role, initialsOf(cleanName), slug, active, perms],
      );
      const user = publicUser(inserted[0]);
      const chatSlug = role === "staff" ? await linkChatIdentity(inserted[0].id, cleanName) : null;
      await audit("create_user", `${role} ${cleanEmail}${perms.length ? ` [${perms.join(",")}]` : ""}${slug ? ` → ${slug}` : ""}${active ? "" : " (disabled)"}`);
      return json({
        ok: true,
        user,
        chat_slug: chatSlug ?? undefined,
        temp_password: generated ? password : undefined,
        note: generated
          ? "Temp password shown once — pass it to the person; it is not stored in clear anywhere."
          : "Password set as given.",
        login_url: "/login",
      });
    },
  );

  server.registerTool(
    "update_user_access",
    {
      title: "Change a team member's areas",
      description:
        "Edit which areas a staff account may open (Settings › Team & roles › edit). Either replace the " +
        "whole set with `permissions`, or adjust it with `add` / `remove`. Keys from list_access_areas. " +
        "The result must keep at least one area — disable the account instead of emptying it. Only " +
        "staff rows carry areas; owner logins are never touched. Takes effect on their next request. " +
        "Only works on a run acting for Joe; any other run is refused.",
      inputSchema: {
        user: z.string().describe("User id or email."),
        permissions: z.array(areaEnum).optional().describe("Replace the full set."),
        add: z.array(areaEnum).optional(),
        remove: z.array(areaEnum).optional(),
      },
    },
    async ({ user, permissions, add, remove }) => {
      const refused = await refuse();
      if (refused) return refused;
      const row = await findUser(user);
      if (!row) return json({ ok: false, error: `No user "${user}".` });
      if (row.role === "owner") return json({ ok: false, error: OWNER_ROW_REFUSAL });
      if (row.role !== "staff") return json({ ok: false, error: "Only team-member (staff) accounts have areas." });
      if (!permissions && !add?.length && !remove?.length) {
        return json({ ok: false, error: "Pass `permissions` (replace) or `add` / `remove`." });
      }
      let next = permissions ? new Set(permissions) : new Set(normalizePermissions(row.permissions));
      for (const k of add ?? []) next.add(k);
      for (const k of remove ?? []) next.delete(k);
      const perms = normalizePermissions([...next]);
      if (perms.length === 0) return json({ ok: false, error: "That would leave no areas — use set_user_active to disable the account instead." });
      const updated = await rows(
        `UPDATE users SET permissions = $2 WHERE id = $1 AND role = 'staff'
         RETURNING id, name, email, role, initials, link_slug, active, permissions, created_at`,
        [row.id, perms],
      );
      await audit("update_user_access", `${row.email} → [${perms.join(",")}]`);
      return json({ ok: true, user: publicUser(updated[0]), before: normalizePermissions(row.permissions) });
    },
  );

  server.registerTool(
    "reset_user_password",
    {
      title: "Reset a login's password",
      description:
        "Set a new password for a staff / sub / client login (Settings › Team & roles › Reset password). " +
        "Give `new_password` (≥8 chars) or omit it to have one generated and returned ONCE. Owner " +
        "accounts are never reset through MCP. Only works on a run acting for Joe; any other run is " +
        "refused. Nothing is emailed — hand it to the person.",
      inputSchema: {
        user: z.string().describe("User id or email."),
        new_password: z.string().optional(),
      },
    },
    async ({ user, new_password }) => {
      const refused = await refuse();
      if (refused) return refused;
      const row = await findUser(user);
      if (!row) return json({ ok: false, error: `No user "${user}".` });
      if (row.role === "owner") return json({ ok: false, error: OWNER_ROW_REFUSAL });
      const generated = !new_password;
      const password = new_password ?? generateTempPassword();
      if (password.length < MIN_PASSWORD) return json({ ok: false, error: `Password needs at least ${MIN_PASSWORD} characters.` });
      const hash = await hashPassword(password);
      const res = await rows(`UPDATE users SET password_hash = $2 WHERE id = $1 AND role <> 'owner' RETURNING id`, [row.id, hash]);
      if (res.length === 0) return json({ ok: false, error: OWNER_ROW_REFUSAL });
      await audit("reset_user_password", row.email);
      return json({
        ok: true,
        user: publicUser(row),
        temp_password: generated ? password : undefined,
        note: generated ? "Temp password shown once — not stored in clear anywhere." : "Password set as given.",
      });
    },
  );

  server.registerTool(
    "set_user_active",
    {
      title: "Disable or re-enable a login",
      description:
        "Flip an account's active flag (Settings › Team & roles › Disable / Enable). Disabled logins " +
        "are refused at sign-in and their portal links stop working; the row and its history stay. " +
        "Owner accounts are protected (no lock-out). Only works on a run acting for Joe; any other " +
        "run is refused. There is deliberately no delete tool.",
      inputSchema: {
        user: z.string().describe("User id or email."),
        active: z.boolean(),
      },
    },
    async ({ user, active }) => {
      const refused = await refuse();
      if (refused) return refused;
      const row = await findUser(user);
      if (!row) return json({ ok: false, error: `No user "${user}".` });
      if (row.role === "owner") return json({ ok: false, error: OWNER_ROW_REFUSAL });
      const res = await rows(
        `UPDATE users SET active = $2 WHERE id = $1 AND role <> 'owner'
         RETURNING id, name, email, role, initials, link_slug, active, permissions, created_at`,
        [row.id, active],
      );
      if (res.length === 0) return json({ ok: false, error: OWNER_ROW_REFUSAL });
      await audit("set_user_active", `${row.email} → ${active ? "enabled" : "disabled"}`);
      return json({ ok: true, user: publicUser(res[0]) });
    },
  );
}
