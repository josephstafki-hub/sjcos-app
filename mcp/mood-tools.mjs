// SJC OS — MCP mood-board tools (AI-agnostic).
//
// Lives in its own module rather than in sjcos-mcp.mjs so this surface can be
// developed without colliding with concurrent work on that file. Wire it up with
// one line inside buildServer():
//
//   import { registerMoodTools } from "./mood-tools.mjs";
//   ...
//   registerMoodTools(server, { rows, json, uploadDir: UPLOAD_DIR });
//
// WHAT THIS EXPOSES: everything an agent needs to build a project's mood boards
// end to end — create per-room boards, pin images sourced from the web, drop
// colour swatches and direction text, and compose the whole thing into a real
// mood-board layout instead of a grid.
//
// WHAT IT DELIBERATELY DOES NOT EXPOSE: deletes. The server's stated policy is
// "no destructive tools (no deletes/drops)", and mood items are cheap to re-add
// but expensive to lose, so removing pins stays an owner action in the app.
// Nothing here is client-facing either — a mood board is internal until the
// owner pushes selections, which remains owner-approved.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import path from "node:path";
import { z } from "zod";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ITEMS_PER_BOARD = 300;
const MAX_NOTE = 500;
const MAX_LABEL = 200;
const MAX_ROOM = 60;

// Layout bounds — must match lib/actions/mood.ts, which clamps every write.
const MIN_W = 0.08, MAX_W = 0.6, MIN_H = 0.06, MAX_H = 0.9, EDGE = 0.975;
const ASPECT = 1.6; // 16:10 board: h_fraction = ASPECT * w_fraction / imageAspect

const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || "").trim()) ? String(v).trim().toLowerCase() : "");
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const cleanRoom = (v) => String(v ?? "").trim().slice(0, MAX_ROOM);

/** Block SSRF: only public http(s) hosts may be fetched. An agent chooses these
 *  URLs, so the server must assume they are untrusted — a link to 169.254.169.254
 *  or an internal host would otherwise turn this tool into a proxy into the
 *  private network. Every resolved address must be public. */
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("image_url is not a valid URL."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("image_url must be http(s).");
  const addrs = await dnsLookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Could not resolve ${u.hostname}.`);
  for (const { address, family } of addrs) {
    const bad =
      family === 4
        ? /^(0|10|127)\./.test(address) ||
          /^169\.254\./.test(address) ||
          /^192\.168\./.test(address) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
          /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)
        : /^(::1?$|fc|fd|fe80|::ffff:)/i.test(address);
    if (bad) throw new Error(`Refusing to fetch a private address (${address}).`);
  }
  return u;
}

export function registerMoodTools(server, { rows, json, uploadDir }) {
  const UPLOAD_DIR = uploadDir;

  const projectId = async (slug) => {
    const r = await rows(`SELECT id FROM projects WHERE slug = $1`, [String(slug || "").trim()]);
    if (!r.length) throw new Error(`Project '${slug}' not found. Use list_projects to find the slug.`);
    return r[0].id;
  };
  const ensureBoard = (pid, room) =>
    rows(
      `INSERT INTO project_mood_boards (project_id, room) VALUES ($1,$2)
       ON CONFLICT (project_id, room) DO NOTHING`,
      [pid, room],
    );
  const nextSort = async (pid, room) => {
    const r = await rows(
      `SELECT COALESCE(MAX(sort_order)+1,0) AS n FROM project_mood WHERE project_id=$1 AND room=$2`,
      [pid, room],
    );
    return Number(r[0]?.n ?? 0);
  };
  const assertRoom = async (pid, room) => {
    const r = await rows(
      `SELECT COUNT(*)::int AS n FROM project_mood WHERE project_id=$1 AND room=$2`,
      [pid, room],
    );
    if (r[0].n >= MAX_ITEMS_PER_BOARD) throw new Error(`Board '${room}' is full (${MAX_ITEMS_PER_BOARD} items).`);
  };
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });

  // ── READ ───────────────────────────────────────────────────────────────────
  server.registerTool(
    "list_mood_boards",
    {
      title: "List mood boards",
      description:
        "Every mood board on a project, one per room, with its items. Items are " +
        "'pin' (an image), 'swatch' (a colour chip) or 'text' (a direction note). " +
        "Positions are fractions of the board (x/w of width, y/h of height); null " +
        "means the item has never been placed and the canvas auto-lays it out.",
      inputSchema: { project_slug: z.string().describe("Project slug, e.g. 'libby-mahowald'.") },
    },
    async ({ project_slug }) => {
      try {
        const pid = await projectId(project_slug);
        const boards = await rows(
          `SELECT room, title, bg_color FROM project_mood_boards WHERE project_id=$1 ORDER BY room`,
          [pid],
        );
        const items = await rows(
          `SELECT m.id, m.room, m.kind, m.label, m.note, m.swatch, m.price_label,
                  m.pos_x, m.pos_y, m.pos_w, m.pos_h, m.pos_rot, m.sort_order,
                  f.name AS file_name, f.subtitle AS source
             FROM project_mood m
             LEFT JOIN files f ON f.id = m.image_file_id
            WHERE m.project_id=$1 ORDER BY m.room, m.sort_order, m.id`,
          [pid],
        );
        const byRoom = new Map(boards.map((b) => [b.room, { ...b, items: [] }]));
        for (const it of items) {
          if (!byRoom.has(it.room)) byRoom.set(it.room, { room: it.room, title: "", bg_color: "", items: [] });
          const { room, ...rest } = it;
          byRoom.get(it.room).items.push(rest);
        }
        return json({ project: project_slug, boards: [...byRoom.values()] });
      } catch (e) { return fail(e); }
    },
  );

  // ── BOARDS ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "create_mood_board",
    {
      title: "Create a mood board",
      description:
        "Create an empty mood board for a room (idempotent). Useful for standing " +
        "up the full room programme from a floor plan before any inspiration exists.",
      inputSchema: {
        project_slug: z.string(),
        room: z.string().describe("Room name, e.g. 'Primary Bedroom'. Doubles as the board key."),
        title: z.string().optional().describe("Optional display title shown above the canvas."),
        background_color: z.string().optional().describe("Optional '#rrggbb' board background."),
      },
    },
    async ({ project_slug, room, title, background_color }) => {
      try {
        const pid = await projectId(project_slug);
        const r = cleanRoom(room);
        if (!r) throw new Error("room is required.");
        await ensureBoard(pid, r);
        if (title !== undefined || background_color !== undefined) {
          await rows(
            `UPDATE project_mood_boards SET title=COALESCE($3,title), bg_color=COALESCE($4,bg_color)
              WHERE project_id=$1 AND room=$2`,
            [pid, r, title === undefined ? null : String(title).slice(0, MAX_LABEL),
             background_color === undefined ? null : hex(background_color)],
          );
        }
        return json({ ok: true, room: r });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "set_mood_board_settings",
    {
      title: "Set mood board title/background",
      description: "Set a board's display title and/or background colour. Empty background_color restores the default paper.",
      inputSchema: {
        project_slug: z.string(),
        room: z.string(),
        title: z.string().optional(),
        background_color: z.string().optional().describe("'#rrggbb', or '' to clear."),
      },
    },
    async ({ project_slug, room, title, background_color }) => {
      try {
        const pid = await projectId(project_slug);
        const r = cleanRoom(room);
        await ensureBoard(pid, r);
        await rows(
          `UPDATE project_mood_boards SET title=COALESCE($3,title), bg_color=COALESCE($4,bg_color)
            WHERE project_id=$1 AND room=$2`,
          [pid, r, title === undefined ? null : String(title).slice(0, MAX_LABEL),
           background_color === undefined ? null : hex(background_color)],
        );
        return json({ ok: true, room: r });
      } catch (e) { return fail(e); }
    },
  );

  // ── ITEMS ──────────────────────────────────────────────────────────────────
  server.registerTool(
    "add_mood_image_from_url",
    {
      title: "Pin an image to a mood board",
      description:
        "Download a publicly reachable image and pin it to a room's board. The " +
        "source URL is recorded so provenance survives on the board. IMPORTANT: " +
        "only pin images you have actually looked at and confirmed show what the " +
        "room needs — an unverified image in front of a client is worse than an " +
        "empty board. Private/loopback addresses are refused.",
      inputSchema: {
        project_slug: z.string(),
        room: z.string(),
        image_url: z.string().describe("Direct http(s) URL to an image file."),
        note: z.string().optional().describe("Short caption naming the concrete design cues."),
        source_url: z.string().optional().describe("Page the image came from, for provenance."),
      },
    },
    async ({ project_slug, room, image_url, note, source_url }) => {
      try {
        const pid = await projectId(project_slug);
        const r = cleanRoom(room) || "General";
        await assertRoom(pid, r);
        const u = await assertPublicUrl(image_url);

        const res = await fetch(u, { headers: { "User-Agent": "SJC-OS-MCP/1.0" }, redirect: "follow" });
        if (!res.ok) throw new Error(`Fetch failed (HTTP ${res.status}).`);
        const ctype = (res.headers.get("content-type") || "").split(";")[0].trim();
        if (!ctype.startsWith("image/")) throw new Error(`Not an image (content-type: ${ctype || "unknown"}).`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error("Empty image.");
        if (buf.length > MAX_IMAGE_BYTES) throw new Error("Image is too large (max 12 MB).");

        const ext = ctype === "image/png" ? "png" : ctype === "image/webp" ? "webp" : "jpg";
        const id = `mood-${randomUUID()}`;
        const base = `${r.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(5, 13)}.${ext}`;
        const stored = `${id}__${base}`;
        await mkdir(UPLOAD_DIR, { recursive: true });
        await writeFile(path.join(UPLOAD_DIR, stored), buf);

        const kb = buf.length < 1024 * 1024
          ? `${Math.round(buf.length / 1024)} KB`
          : `${(buf.length / 1048576).toFixed(1)} MB`;
        await rows(
          `INSERT INTO files (id, project_key, type, name, tag, ai_origin, modified_label,
                              size_label, subtitle, ai_tags, sort, storage_path, mime_type)
           VALUES ($1,'','img',$2,'MOOD · SOURCED',true,'just now',$3,$4,'{}',-1,$5,$6)`,
          [id, base, kb, String(source_url || u.href).slice(0, 500), stored, ctype],
        );
        await ensureBoard(pid, r);
        await rows(
          `INSERT INTO project_mood (project_id, room, kind, image_file_id, note, sort_order)
           VALUES ($1,$2,'pin',$3,$4,$5)`,
          [pid, r, id, String(note || "").trim().slice(0, MAX_NOTE), await nextSort(pid, r)],
        );
        return json({ ok: true, room: r, file_id: id, bytes: buf.length });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "add_mood_swatch",
    {
      title: "Add a colour swatch",
      description:
        "Add a solid colour chip to a room's board — paint, stain, grout. Prefer " +
        "colours actually drawn from the project's own imagery over invented ones.",
      inputSchema: {
        project_slug: z.string(),
        room: z.string(),
        color: z.string().describe("'#rrggbb'."),
        label: z.string().optional().describe("e.g. 'SW 7036 Accessible Beige' or 'Sage — vanity'."),
      },
    },
    async ({ project_slug, room, color, label }) => {
      try {
        const pid = await projectId(project_slug);
        const r = cleanRoom(room) || "General";
        const c = hex(color);
        if (!c) throw new Error("color must be '#rrggbb'.");
        await assertRoom(pid, r);
        await ensureBoard(pid, r);
        await rows(
          `INSERT INTO project_mood (project_id, room, kind, swatch, label, sort_order)
           VALUES ($1,$2,'swatch',$3,$4,$5)`,
          [pid, r, c, String(label || "").trim().slice(0, MAX_LABEL), await nextSort(pid, r)],
        );
        return json({ ok: true, room: r, color: c });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "add_mood_text",
    {
      title: "Add a text block",
      description:
        "Add a standalone direction note to a room's board — a heading or an " +
        "instruction. Ground it in real plan facts (dimensions, fixtures) rather " +
        "than generic styling language.",
      inputSchema: { project_slug: z.string(), room: z.string(), text: z.string() },
    },
    async ({ project_slug, room, text }) => {
      try {
        const pid = await projectId(project_slug);
        const r = cleanRoom(room) || "General";
        const t = String(text || "").trim().slice(0, MAX_LABEL);
        if (!t) throw new Error("text is required.");
        await assertRoom(pid, r);
        await ensureBoard(pid, r);
        await rows(
          `INSERT INTO project_mood (project_id, room, kind, label, sort_order)
           VALUES ($1,$2,'text',$3,$4)`,
          [pid, r, t, await nextSort(pid, r)],
        );
        return json({ ok: true, room: r });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "update_mood_item",
    {
      title: "Edit a mood board item",
      description:
        "Edit an item's caption, note, or (for a swatch) its colour. Get item ids " +
        "from list_mood_boards. Does not move or delete anything.",
      inputSchema: {
        item_id: z.number().int().positive(),
        label: z.string().optional().describe("Caption; for a text block this IS the words."),
        note: z.string().optional(),
        color: z.string().optional().describe("'#rrggbb', swatches only."),
      },
    },
    async ({ item_id, label, note, color }) => {
      try {
        const cur = await rows(`SELECT id, kind FROM project_mood WHERE id=$1`, [item_id]);
        if (!cur.length) throw new Error(`Item ${item_id} not found.`);
        if (label !== undefined) {
          const l = String(label).trim().slice(0, MAX_LABEL);
          if (!l && cur[0].kind === "text") throw new Error("A text block's words cannot be emptied.");
          await rows(`UPDATE project_mood SET label=$2 WHERE id=$1`, [item_id, l]);
        }
        if (note !== undefined) {
          await rows(`UPDATE project_mood SET note=$2 WHERE id=$1`, [item_id, String(note).trim().slice(0, MAX_NOTE)]);
        }
        if (color !== undefined) {
          const c = hex(color);
          if (!c) throw new Error("color must be '#rrggbb'.");
          await rows(`UPDATE project_mood SET swatch=$2 WHERE id=$1 AND kind='swatch'`, [item_id, c]);
        }
        return json({ ok: true, item_id });
      } catch (e) { return fail(e); }
    },
  );

  // ── COMPOSE ────────────────────────────────────────────────────────────────
  server.registerTool(
    "arrange_mood_board",
    {
      title: "Compose a mood board",
      description:
        "Lay a room's board out the way interior designers actually compose one: " +
        "a dominant hero image anchoring the top-left, supporting images masonry- " +
        "packed at varied scale with slight rotation, colour swatches clustered as " +
        "a palette strip in a bottom band, and the direction text beside it. " +
        "Items are sized by visual AREA using each photo's true aspect ratio, so a " +
        "portrait and a landscape shot carry equal weight. Without this, items sit " +
        "in a uniform auto grid that reads as a contact sheet. Deterministic — " +
        "re-running reproduces the same board rather than reshuffling it.",
      inputSchema: {
        project_slug: z.string(),
        room: z.string().optional().describe("Omit to compose every board on the project."),
      },
    },
    async ({ project_slug, room }) => {
      try {
        const pid = await projectId(project_slug);
        const all = await rows(
          `SELECT m.id, m.room, m.kind, m.pos_w, f.storage_path, f.tag
             FROM project_mood m LEFT JOIN files f ON f.id=m.image_file_id
            WHERE m.project_id=$1 ${room ? "AND m.room=$2" : ""}
            ORDER BY m.room, m.sort_order, m.id`,
          room ? [pid, cleanRoom(room)] : [pid],
        );
        if (!all.length) throw new Error(room ? `Board '${room}' has no items.` : "No mood items on this project.");

        // Real pixel dimensions, so sizing reflects each photo's actual shape.
        let sharp = null;
        try { sharp = (await import("sharp")).default; } catch { /* fall back to 4:3 */ }
        const aspectOf = async (p) => {
          if (!sharp || !p) return 1.33;
          try {
            const m = await sharp(path.join(UPLOAD_DIR, p)).metadata();
            return m.width && m.height ? m.width / m.height : 1.33;
          } catch { return 1.33; }
        };

        const byRoom = new Map();
        for (const it of all) {
          if (!byRoom.has(it.room)) byRoom.set(it.room, []);
          byRoom.get(it.room).push(it);
        }

        const updates = [];
        for (const [rm, list] of byRoom) {
          // Seeded per room so the composition is stable across runs.
          let h0 = 2166136261;
          for (const ch of rm) { h0 ^= ch.charCodeAt(0); h0 = Math.imul(h0, 16777619); }
          const rand = () => { h0 += 0x6d2b79f5; let t = h0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

          const pins = list.filter((i) => i.kind === "pin");
          const swatches = list.filter((i) => i.kind === "swatch");
          const texts = list.filter((i) => i.kind === "text");
          for (const p of pins) p.aspect = await aspectOf(p.storage_path);

          // The owner's own pins lead: a client-curated image becomes the hero.
          const heroIdx = Math.max(0, pins.findIndex((p) => p.tag === "MOOD"));
          const hero = pins[heroIdx];
          const supports = pins.filter((_, i) => i !== heroIdx);

          let z = 0;
          const put = (item, x, y, w, h, rot) =>
            updates.push({
              id: item.id,
              x: clamp(x, 0.012, EDGE - w),
              y: clamp(y, 0.012, h === null ? 0.82 : EDGE - h),
              w, h, rot, z: z++,
            });

          const L = 0.03, GAP = 0.026, SW = 0.08, SWGAP = 0.008;
          const hasBand = swatches.length > 0 || texts.length > 0;
          const TOP = 0.04, BOT = hasBand ? 0.815 : 0.962;

          let heroW = 0, heroBottom = TOP;
          if (hero) {
            heroW = 0.345;
            let hh = (ASPECT * heroW) / hero.aspect;
            if (hh > BOT - TOP) { hh = BOT - TOP; heroW = (hh * hero.aspect) / ASPECT; }
            put(hero, L, TOP, clamp(heroW, MIN_W, MAX_W), clamp(hh, MIN_H, MAX_H), 0);
            heroBottom = TOP + hh;
          }

          const rx = hero ? L + heroW + GAP : L;
          const nRight = supports.length >= 3 ? 2 : 1;
          const colW = (EDGE - rx - GAP * (nRight - 1)) / nRight;
          const baseCols = [];
          // Space under a short hero is a column too — otherwise a landscape
          // hero leaves a dead quadrant on the left.
          if (hero && BOT - heroBottom > 0.17) baseCols.push({ x: L, w: heroW, y: heroBottom + 0.022 });
          for (let i = 0; i < nRight; i++) baseCols.push({ x: rx + i * (colW + GAP), w: colW, y: TOP });

          let scale = 1, packed = [];
          for (let a = 0; a < 16; a++) {
            const cols = baseCols.map((c) => ({ ...c }));
            packed = supports.map((p, i) => {
              const ci = cols.reduce((acc, c, idx) => (c.y < cols[acc].y ? idx : acc), 0);
              const c = cols[ci];
              const w = clamp(c.w * scale * (0.95 + rand() * 0.05), MIN_W, MAX_W);
              const hh = clamp((ASPECT * w) / p.aspect, MIN_H, MAX_H);
              const y = c.y;
              c.y = y + hh + 0.019 - rand() * 0.012;
              return { p, x: c.x + (c.w - w) / 2, y, w, h: hh, i, ci };
            });
            if (!packed.length || Math.max(...packed.map((q) => q.y + q.h)) <= BOT) break;
            scale *= 0.93;
          }

          // Justify each column so none stops short, but cap the growth: a card
          // with an explicit height renders object-cover, so extra height CROPS.
          // Filling completely is not worth turning a room shot into a tall slot
          // of blank wall — a little breathing room reads better.
          for (let ci = 0; ci < baseCols.length; ci++) {
            const col = packed.filter((q) => q.ci === ci).sort((a, b) => a.y - b.y);
            if (!col.length) continue;
            const last = col[col.length - 1];
            const slack = BOT - (last.y + last.h);
            if (slack < 0.02) continue;
            const bump = slack / col.length;
            let cy = col[0].y;
            for (const q of col) {
              q.y = cy;
              q.h = clamp(Math.min(q.h + bump, Math.min(q.h * 1.3, (ASPECT * q.w) / 0.62)), MIN_H, MAX_H);
              cy = q.y + q.h + 0.019;
            }
          }
          packed.forEach(({ p, x, y, w, h, i }) =>
            put(p, x, y, w, h, i % 3 === 2 ? 0 : (i % 2 === 0 ? 1 : -1) * +(1 + rand() * 1.4).toFixed(1)));

          if (hasBand) {
            const bandY = BOT + 0.035;
            let bandX = L;
            if (swatches.length) {
              swatches.forEach((sw, i) => put(sw, L + i * (SW + SWGAP), bandY, SW, ASPECT * SW, 0));
              bandX = L + swatches.length * (SW + SWGAP) + 0.02;
            }
            // h null => the card sizes to its own words.
            texts.forEach((t) => put(t, bandX, bandY, clamp(EDGE - bandX, 0.24, 0.6), null, 0));
          }
        }

        for (const u of updates) {
          await rows(
            `UPDATE project_mood SET pos_x=$2,pos_y=$3,pos_w=$4,pos_h=$5,pos_rot=$6,sort_order=$7
              WHERE id=$1`,
            [u.id, u.x, u.y, u.w, u.h, u.rot, u.z],
          );
        }
        return json({ ok: true, boards: byRoom.size, items_positioned: updates.length });
      } catch (e) { return fail(e); }
    },
  );
}
