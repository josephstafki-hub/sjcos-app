// SJC OS — MCP floor-plan designer tools (AI-agnostic).
//
// Own module, same shape as mood-tools.mjs. Wire it up with one line inside
// buildServer():
//
//   import { registerFloorTools } from "./floor-tools.mjs";
//   ...
//   registerFloorTools(server, { rows, json });
//
// WHAT THIS EXPOSES: the designer's agent surface from
// docs/floor-plan-designer-plan.md §12 — list/read designs, create one from a
// room template or a rectangle, edit it with the SAME op language the canvas
// uses (lib/plan-ops.ts, applied server-side through applyOps so agents and
// humans can never produce different geometry from the same intent), read the
// derived measures and checks, save immutable versions, and leave comments.
//
// WHAT IT DELIBERATELY DOES NOT EXPOSE: deletes of any row, the estimate
// generator, rendering/publishing sheets, or sending for signature. Those are
// Next server actions (lib/actions/plan-*.ts) and the client-facing ones sit
// behind the owner grant (§10). `stage_plan_sheet` therefore only records the
// request as a comment the owner sees in the designer — it does not render.
//
// Runtime note: this is plain Node ESM importing the pure TypeScript libs
// directly (Node 22 strips types unflagged; every lib/plan-*.ts imports its
// siblings with explicit .ts extensions for exactly this reason). Only the
// pure plan-*.ts modules may be imported here — nothing with "server-only"
// or next/* (lib/plan-designs.ts, lib/actions/*).

import { z } from "zod";
import { DEFAULTS, docCounts, emptyDoc, fmtIn, migrateDoc, parseDoc, pointInPolygon, wallLength } from "../lib/plan-doc.ts";
import { applyOps, opLabel, PlanOpError } from "../lib/plan-ops.ts";
import { computeMeasures, productLines, summarizeMeasures } from "../lib/plan-measures.ts";
import { runChecks } from "../lib/plan-checks.ts";
import { FINISH_PRESETS, ROOM_TEMPLATES, roomTemplate, searchLibrary } from "../lib/plan-library.ts";
import { withRooms } from "../lib/plan-geometry.ts";

const MAX_NAME = 120;
const MAX_OPS = 200;
const MAX_LIBRARY = 60;
const MAX_BODY = 2000;

const cleanName = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
const ft = (inches) => fmtIn(inches, { frac: 2 });
const lf = (inches) => Math.round((inches / 12) * 10) / 10;

/** Room name for prose: the pinned name, else a "label" note sitting inside
 *  the polygon (room templates label rooms that way), else the derived name. */
function roomName(doc, r) {
  if (r.name && !/^Room \d+$/.test(r.name)) return r.name;
  const note = doc.notes.find((n) => n.kind === "label" && n.levelId === r.levelId && pointInPolygon({ x: n.x, y: n.y }, r.polygon));
  return note?.text?.trim() || r.name || "room";
}

/** Bounding-box width × depth of a room polygon, in inches. */
function roomSize(poly) {
  if (!poly?.length) return { w: 0, d: 0 };
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
}

const DESIGN_SELECT = `
  SELECT d.id, d.name, d.project_id, p.slug AS project_slug, p.name AS project_name,
         d.lead_slug, l.name AS lead_name, d.is_template, d.rev, d.updated_at, d.doc,
         (SELECT count(*) FROM plan_design_versions v WHERE v.design_id = d.id) AS version_count
    FROM plan_designs d
    LEFT JOIN projects p ON p.id = d.project_id
    LEFT JOIN leads l ON l.slug = d.lead_slug`;

// One reference for the op language; agents write these by hand, so it has to
// be complete enough to work from without reading lib/plan-ops.ts.
const OPS_REFERENCE = `
Coordinates are INCHES in plan space, +x right, +y DOWN (screen style). Pt = {x, y}. Item (x, y) is the footprint CENTRE; rotDeg 0 faces +y. levelId defaults to the first level ("L1"). Wall "side": for a room drawn with addRoomRect the interior is the wall's RIGHT side (walls run clockwise: top, right, bottom, left). placeItem snaps to the nearest wall by default (snapToWall: false to place freely; islands/furniture never snap) and nudges against neighbouring cabinets. Wall/element ids are generated — read them from the response ("created") or get_plan_design before referencing them. Phase: "existing" | "remove" | "new" | "relocate".

STRUCTURE
- addRoomRect {p: Pt, q: Pt, name?, kind?, thickIn?, heightIn?} — four walls (min 12in each way); name pins the detected room.
- addWall {a: Pt, b: Pt, kind?: "existing"|"remove"|"new", thickIn?, heightIn?, id?}
- addWalls {walls: Wall[]}  ·  updateWall {id, patch: {a?, b?, kind?, thickIn?, heightIn?}}
- moveCorner {from: Pt, to: Pt}  ·  splitWall {id, atIn}  ·  joinWalls {idA, idB}
- addOpening {wallId, atIn (from wall.a to the opening START), kind: "door"|"window"|"opening", subtype?, widthIn?, heightIn?, sillIn?, hand?: "L"|"R", swing?: "left"|"right", phase?, tag?, id?}
- updateOpening {id, patch}
- addStair {at: Pt, toLevelId?, rotDeg?, shape?: "straight"|"L"|"U", widthIn?, riserCount?, riserIn?, treadIn?, phase?}  ·  updateStair {id, patch}
- addStructure {kind: "column"|"beam"|"soffit", a: Pt, b?: Pt, wIn?, hIn?, zIn?, phase?, label?}  ·  updateStructure {id, patch}

ITEMS (cabinets, appliances, fixtures, furniture — see list_plan_library for keys)
- placeItem {libraryKey | catalog: {id, name, kind, w, d, h, z?, tag?}, at: Pt, rotDeg?, snapToWall?, snapToNeighbors?, phase?, overrides?}
- placeRun {wallId, side: "left"|"right", startIn, keys: string[], phase?} — a whole cabinet run along a wall, in order from wall.a; e.g. keys ["base-LS36","base-SB36","appl-dw-24","base-B24"].
- updateItem {id, patch}  ·  moveItems {ids, dx, dy, snapToWall?}  ·  rotateItems {ids, deltaDeg}
- duplicateItems {ids, dx?, dy?}  ·  setItemPhase {ids, phase}  ·  setItemProps {ids, props}

COUNTERS + FINISHES (material = a finish preset key from list_plan_finishes, or a {key,label,color} ref)
- regenerateCounters {material?} — rebuilds counters over every base run (runs after cabinet edits anyway)
- addCounter {polygon: Pt[], material?, thickIn?, backsplashIn?}  ·  updateCounter {id, patch}
- setRoom {id, patch: {name?, ceilingIn?, trim?}}  ·  setFloorFinish {roomId, material|null}  ·  setCeilingFinish {roomId, material|null}
- setWallFinish {wallId, side, material|null, heightIn?}  ·  addFinishRegion {region}  ·  updateFinishRegion {id, patch}
- addTrim {wallId? | roomId?, profile: "base"|"crown"|"casing"|"chair", heightIn?}

ELECTRICAL / HVAC
- addDevice {type, at: Pt, heightAff?, wallId?, circuit?, phase?} — type: outlet, gfci, outlet240, switch, switch3, dimmer, recessed, pendant, sconce, underCab, surface, fan, panel, smoke, data, register, return, exhaust, miniSplit
- updateDevice {id, patch}  ·  linkSwitch {switchId, lightId, on: boolean}

ANNOTATION
- addDim {a: Pt, b: Pt, offsetIn?, kind?: "aligned"|"linear"|"chain", chain?}  ·  updateDim {id, patch}
- addNote {at: Pt, text, kind?: "note"|"label"|"cloud"|"north", leaderTo?}  ·  updateNote {id, patch}
- addCamera {name, pos: [x,y,z], target: [x,y,z], fov?, mode?: "orbit"|"walk"|"plan"}  ·  updateCamera {id, patch}
- addSection {a: Pt, b: Pt, depthIn?, flip?, label?}  ·  addPhoto {at: Pt, fileId, caption?}  ·  setUnderlay {underlay|null}

GENERIC
- move {ids, dx, dy}  ·  delete {ids} (removes drawing elements from the doc only; the design row is never deleted)
- addLevel {name, elevationIn?, ceilingIn?, copyWallsFrom?}  ·  updateLevel {id, patch}  ·  removeLevel {id}
- setSettings {patch: {snapIn?, angleSnap?, defaults?}}  ·  ignoreCheck {id, on}  ·  replace {doc}
`.trim();

export function registerFloorTools(server, { rows, json }) {
  const fail = (e) => json({ ok: false, error: e instanceof Error ? e.message : String(e) });

  // ── scope + row helpers ────────────────────────────────────────────────────
  const projectId = async (slug) => {
    const r = await rows(`SELECT id FROM projects WHERE slug = $1`, [String(slug || "").trim()]);
    if (!r.length) throw new Error(`Project '${slug}' not found. Use list_projects to find the slug.`);
    return r[0].id;
  };
  const leadSlug = async (slug) => {
    const r = await rows(`SELECT slug FROM leads WHERE slug = $1`, [String(slug || "").trim()]);
    if (!r.length) throw new Error(`Lead '${slug}' not found. Use list_leads to find the slug.`);
    return r[0].slug;
  };
  /** Designer defaults from app_settings (designer.* keys), like the app. */
  const designerDefaults = async () => {
    const out = { ...DEFAULTS };
    const r = await rows(`SELECT key, value FROM app_settings WHERE key LIKE 'designer.%'`).catch(() => []);
    for (const s of r) {
      const k = String(s.key).slice("designer.".length);
      if (!(k in out)) continue;
      if (typeof out[k] === "number") {
        const n = Number(s.value);
        if (Number.isFinite(n)) out[k] = n;
      } else out[k] = String(s.value);
    }
    return out;
  };
  const designRow = async (id) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new Error("design_id must be a positive integer.");
    const r = await rows(`${DESIGN_SELECT} WHERE d.id = $1`, [n]);
    if (!r.length) throw new Error(`Design ${n} not found. Use list_plan_designs.`);
    return r[0];
  };
  const summary = (r, doc) => ({
    id: Number(r.id),
    name: r.name,
    project_slug: r.project_slug ?? null,
    project_name: r.project_name ?? null,
    lead_slug: r.lead_slug ?? null,
    lead_name: r.lead_name ?? null,
    is_template: !!r.is_template,
    rev: Number(r.rev),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    counts: docCounts(doc),
    version_count: Number(r.version_count ?? 0),
  });
  const checkView = (c) => ({ id: c.id, code: c.code, group: c.group, severity: c.severity, message: c.message, elementIds: c.elementIds });
  const wallView = (w) => ({ id: w.id, levelId: w.levelId, a: w.a, b: w.b, kind: w.kind, thickIn: w.thickIn, length: ft(wallLength(w)) });
  const itemView = (i) => ({
    id: i.id, kind: i.kind, tag: i.tag, label: i.label, x: i.x, y: i.y, rotDeg: i.rotDeg,
    w: i.w, d: i.d, h: i.h, phase: i.phase, catalogId: i.catalogId, libraryKey: i.libraryKey, wallId: i.wallId ?? null,
  });
  const openingView = (o) => ({ id: o.id, wallId: o.wallId, kind: o.kind, subtype: o.subtype, atIn: o.atIn, widthIn: o.widthIn, heightIn: o.heightIn, sillIn: o.sillIn, phase: o.phase, tag: o.tag });
  const roomView = (doc) => (r) => {
    const s = roomSize(r.polygon);
    return { id: r.id, levelId: r.levelId, name: roomName(doc, r), size: `${ft(s.w)} x ${ft(s.d)}`, areaSf: Math.round(r.areaSf), perimLf: Math.round(r.perimLf * 10) / 10, floor: r.floor?.label ?? null };
  };
  const insertDesign = async ({ projectId: pid, leadSlug: ls, name, doc }) => {
    const r = await rows(
      `INSERT INTO plan_designs (project_id, lead_slug, name, is_template, doc, rev)
       VALUES ($1, $2, $3, false, $4::jsonb, 0) RETURNING id`,
      [pid, ls, name, JSON.stringify(doc)],
    );
    return Number(r[0].id);
  };
  const resolveScope = async ({ project_slug, lead_slug }) => {
    if (project_slug) return { projectId: await projectId(project_slug), leadSlug: null };
    if (lead_slug) return { projectId: null, leadSlug: await leadSlug(lead_slug) };
    throw new Error("A design needs a project_slug or a lead_slug.");
  };

  /** Plain-language paragraph for chat (kept short). */
  const describe = (name, doc) => {
    const parts = [];
    const rooms = doc.rooms;
    if (rooms.length) {
      const list = rooms.slice(0, 6).map((r) => {
        const s = roomSize(r.polygon);
        return `${roomName(doc, r)} ${ft(s.w)} x ${ft(s.d)} (${Math.round(r.areaSf)} sf)`;
      });
      parts.push(`${name}: ${rooms.length} room${rooms.length === 1 ? "" : "s"} — ${list.join(", ")}${rooms.length > 6 ? ", …" : ""}.`);
    } else {
      parts.push(`${name}: no enclosed rooms yet (${doc.walls.length} wall${doc.walls.length === 1 ? "" : "s"}).`);
    }
    const tier = (k) => doc.items.filter((i) => i.kind === k);
    const cab = [["base", tier("base")], ["wall", tier("wall")], ["tall", tier("tall")]].filter(([, l]) => l.length);
    if (cab.length) {
      const lay = cab.map(([k, l]) => `${l.length} ${k} (${lf(l.reduce((s, i) => s + i.w, 0))} lf)`).join(", ");
      const extra = [tier("vanity").length && `${tier("vanity").length} vanity`, tier("island").length && `${tier("island").length} island`].filter(Boolean);
      parts.push(`Cabinets: ${lay}${extra.length ? `, ${extra.join(", ")}` : ""}.`);
    }
    const byLabel = (l) => {
      const m = new Map();
      for (const i of l) m.set(i.label, (m.get(i.label) ?? 0) + 1);
      return [...m].map(([label, n]) => (n > 1 ? `${n}x ${label}` : label)).join(", ");
    };
    const appl = tier("appliance");
    if (appl.length) parts.push(`Appliances: ${byLabel(appl)}.`);
    const fix = tier("plumbing");
    if (fix.length) parts.push(`Fixtures: ${byLabel(fix)}.`);
    const wallLf = (kind) => lf(doc.walls.filter((w) => w.kind === kind).reduce((s, w) => s + wallLength(w), 0));
    const demo = wallLf("remove");
    const neu = wallLf("new");
    if (demo || neu) parts.push(`Walls: ${demo ? `${demo} lf demo` : ""}${demo && neu ? ", " : ""}${neu ? `${neu} lf new` : ""}.`);
    const doors = doc.openings.filter((o) => o.kind === "door").length;
    const wins = doc.openings.filter((o) => o.kind === "window").length;
    if (doors || wins) parts.push(`${doors} door${doors === 1 ? "" : "s"}, ${wins} window${wins === 1 ? "" : "s"}.`);
    if (doc.electrical.length) parts.push(`${doc.electrical.length} electrical device${doc.electrical.length === 1 ? "" : "s"}.`);
    const checks = runChecks(doc);
    parts.push(checks.length ? `${checks.length} open check${checks.length === 1 ? "" : "s"}.` : "No open checks.");
    return parts.join(" ");
  };

  // ── READ ───────────────────────────────────────────────────────────────────
  server.registerTool(
    "list_plan_designs",
    {
      title: "List floor-plan designs",
      description:
        "Floor-plan designs (the designer at /floor/<id>), newest first, with element counts and " +
        "version count. Filter by project_slug or lead_slug; with neither you get every non-template design.",
      inputSchema: {
        project_slug: z.string().optional().describe("Project slug, e.g. 'libby-mahowald'."),
        lead_slug: z.string().optional().describe("Lead slug (designs can be lead-scoped before a project exists)."),
      },
    },
    async ({ project_slug, lead_slug }) => {
      try {
        const where = [];
        const params = [];
        if (project_slug) {
          params.push(String(project_slug).trim());
          where.push(`p.slug = $${params.length}`);
        } else if (lead_slug) {
          params.push(String(lead_slug).trim());
          where.push(`d.lead_slug = $${params.length}`);
        } else where.push(`d.is_template = false`);
        const r = await rows(`${DESIGN_SELECT} WHERE ${where.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 200`, params);
        return json({ ok: true, designs: r.map((row) => summary(row, migrateDoc(row.doc))) });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "get_plan_design",
    {
      title: "Get a floor-plan design",
      description:
        "One design in full: scope, rev, counts, levels, rooms (with sizes), items (cabinets, appliances, " +
        "fixtures — with ids, position, size, phase), walls (ids and lengths), openings, the derived " +
        "measures (takeoff quantities) and the open checks. Pass include_doc: true for the raw PlanDoc " +
        "json (large). Use the ids here when writing apply_plan_ops.",
      inputSchema: {
        design_id: z.number().int().positive(),
        include_doc: z.boolean().optional().describe("Also return the raw PlanDoc (default false)."),
      },
    },
    async ({ design_id, include_doc }) => {
      try {
        const r = await designRow(design_id);
        const doc = migrateDoc(r.doc);
        const out = {
          ok: true,
          ...summary(r, doc),
          levels: doc.levels,
          rooms: doc.rooms.map(roomView(doc)),
          items: doc.items.map(itemView),
          walls: doc.walls.map(wallView),
          openings: doc.openings.map(openingView),
          devices: doc.electrical.map((d) => ({ id: d.id, type: d.type, x: d.x, y: d.y, heightAff: d.heightAff, circuit: d.circuit, phase: d.phase })),
          measures: summarizeMeasures(computeMeasures(doc)),
          checks: runChecks(doc).map(checkView),
        };
        if (include_doc) out.doc = doc;
        return json(out);
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "describe_plan_design",
    {
      title: "Describe a design in plain language",
      description:
        "A short paragraph for chat: rooms with sizes, cabinet layout (counts and lineal feet by tier), " +
        "appliances and fixtures, demo/new wall footage, openings, and how many checks are open.",
      inputSchema: { design_id: z.number().int().positive() },
    },
    async ({ design_id }) => {
      try {
        const r = await designRow(design_id);
        return json({ ok: true, id: Number(r.id), description: describe(r.name, migrateDoc(r.doc)) });
      } catch (e) { return fail(e); }
    },
  );

  // ── CREATE ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "create_plan_design",
    {
      title: "Create a floor-plan design",
      description:
        "Create a design on a project or a lead. Seed it from a room template (template_key from " +
        "list_plan_library: kitchen-galley, kitchen-l, kitchen-u, kitchen-g, kitchen-island, bath-5x8, " +
        "bath-6x10, laundry-6x8, bedroom-12x12, empty-12x12), or from a bare rectangle (room_width_in x " +
        "room_depth_in, interior inches), or leave both out for an empty sheet. Returns the new design id; " +
        "then build it up with apply_plan_ops.",
      inputSchema: {
        project_slug: z.string().optional(),
        lead_slug: z.string().optional(),
        name: z.string().describe("Design name shown in the app, e.g. 'Kitchen — option A'."),
        template_key: z.string().optional().describe("Room template key to stamp at the origin."),
        room_width_in: z.number().positive().optional().describe("Interior width in inches (with room_depth_in)."),
        room_depth_in: z.number().positive().optional().describe("Interior depth in inches (with room_width_in)."),
      },
    },
    async ({ project_slug, lead_slug, name, template_key, room_width_in, room_depth_in }) => {
      try {
        const scope = await resolveScope({ project_slug, lead_slug });
        const title = cleanName(name) || "Kitchen";
        const defaults = await designerDefaults();
        let doc = emptyDoc(defaults);
        if (template_key) {
          const t = roomTemplate(String(template_key).trim());
          if (!t) throw new Error(`Unknown room template '${template_key}'. Keys: ${ROOM_TEMPLATES.map((x) => x.key).join(", ")}.`);
          const built = t.build(doc.levels[0].id, { x: 0, y: 0 }, defaults);
          doc.walls = built.walls;
          doc.openings = built.openings;
          doc.items = built.items;
          doc.notes = built.notes ?? [];
          doc.meta = { ...doc.meta, templateOf: t.key };
          doc = withRooms(doc);
        } else if (room_width_in || room_depth_in) {
          if (!(room_width_in >= 12 && room_depth_in >= 12)) throw new Error("room_width_in and room_depth_in must both be given (>= 12in).");
          const t = defaults.wallThickIn;
          doc = applyOps(doc, [{ op: "addRoomRect", p: { x: 0, y: 0 }, q: { x: room_width_in + t, y: room_depth_in + t }, name: title }], { defaults });
        }
        const parsed = parseDoc(doc);
        if (!parsed.ok) throw new Error(parsed.error);
        const id = await insertDesign({ ...scope, name: title, doc: parsed.doc });
        return json({ ok: true, id, name: title, counts: docCounts(parsed.doc), url: `/floor/${id}` });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "duplicate_plan_design",
    {
      title: "Duplicate a design",
      description: "Copy a design (same project/lead) as a new design with rev 0 — the way to try an option B without touching A.",
      inputSchema: {
        design_id: z.number().int().positive(),
        name: z.string().optional().describe("Name for the copy (default '<name> (copy)')."),
      },
    },
    async ({ design_id, name }) => {
      try {
        const r = await designRow(design_id);
        const doc = migrateDoc(r.doc);
        doc.meta = { ...doc.meta, createdFrom: { designId: Number(r.id), versionId: null } };
        const parsed = parseDoc(doc);
        if (!parsed.ok) throw new Error(parsed.error);
        const title = cleanName(name) || `${r.name} (copy)`;
        const id = await insertDesign({ projectId: r.project_id ?? null, leadSlug: r.lead_slug ?? null, name: title, doc: parsed.doc });
        return json({ ok: true, id, name: title, copied_from: Number(r.id), url: `/floor/${id}` });
      } catch (e) { return fail(e); }
    },
  );

  // ── EDIT ───────────────────────────────────────────────────────────────────
  server.registerTool(
    "apply_plan_ops",
    {
      title: "Apply design ops",
      description:
        "Edit a design with a batch of ops — the same reducer actions the canvas uses, validated and " +
        "applied server-side. All-or-nothing: a bad op returns ok:false and nothing is written. Pass " +
        "expected_rev (from get_plan_design) to refuse the write if someone else saved in between. Returns " +
        "the new rev, counts, the labels applied, the ids of elements this batch created, and the checks " +
        "that are NEW compared with before (what you just caused).\n\nOP REFERENCE\n" + OPS_REFERENCE,
      inputSchema: {
        design_id: z.number().int().positive(),
        ops: z.array(z.object({ op: z.string().min(1).max(40) }).passthrough()).min(1).max(MAX_OPS)
          .describe("Ordered list of ops; each is {op: '<name>', ...fields} per the reference."),
        expected_rev: z.number().int().nonnegative().optional().describe("Refuse to write unless the stored rev equals this."),
      },
    },
    async ({ design_id, ops, expected_rev }) => {
      try {
        const r = await designRow(design_id);
        const before = migrateDoc(r.doc);
        if (expected_rev != null && Number(r.rev) !== expected_rev)
          throw new Error(`Design ${design_id} is at rev ${r.rev}, not ${expected_rev}. Re-read it and retry.`);
        const defaults = await designerDefaults();
        let after;
        try {
          after = applyOps(before, ops, { defaults });
        } catch (e) {
          if (e instanceof PlanOpError) throw new Error(`Op rejected: ${e.message}`);
          throw e;
        }
        const parsed = parseDoc(after);
        if (!parsed.ok) throw new Error(parsed.error);
        after = parsed.doc;
        const upd = await rows(
          `UPDATE plan_designs SET doc = $2::jsonb, rev = rev + 1, updated_at = now()
            WHERE id = $1 AND ($3::int IS NULL OR rev = $3) RETURNING rev`,
          [Number(r.id), JSON.stringify(after), expected_rev ?? null],
        );
        if (!upd.length) throw new Error(`Design ${design_id} changed underneath you (rev moved past ${expected_rev}). Re-read it and retry.`);
        const newIds = (prev, next) => {
          const seen = new Set(prev.map((x) => x.id));
          return next.filter((x) => !seen.has(x.id)).map((x) => x.id);
        };
        const beforeChecks = new Set(runChecks(before).map((c) => c.id));
        const newChecks = runChecks(after).filter((c) => !beforeChecks.has(c.id)).map(checkView);
        return json({
          ok: true,
          id: Number(r.id),
          rev: Number(upd[0].rev),
          applied: ops.map((o) => opLabel(o)),
          counts: docCounts(after),
          created: {
            walls: newIds(before.walls, after.walls),
            openings: newIds(before.openings, after.openings),
            items: newIds(before.items, after.items),
            devices: newIds(before.electrical, after.electrical),
            rooms: newIds(before.rooms, after.rooms),
          },
          walls: after.walls.map(wallView),
          new_checks: newChecks,
        });
      } catch (e) { return fail(e); }
    },
  );

  // ── LIBRARY ────────────────────────────────────────────────────────────────
  server.registerTool(
    "list_plan_library",
    {
      title: "Search the placement library",
      description:
        "Generic placeable items (cabinets by nominal size, appliances, plumbing fixtures, electrical, " +
        "lighting, hvac, furniture, structure) with the library keys placeItem/placeRun take, plus the room " +
        "template keys when the query is empty. Sizes are inches (w x d x h). Capped at 60 rows — narrow with " +
        "query (e.g. 'B36', 'fridge', 'sink 33'), kind (base, wall, tall, appliance, plumbing, …) or family.",
      inputSchema: {
        query: z.string().optional(),
        kind: z.string().optional().describe("PlaceKind filter: base, wall, tall, vanity, island, appliance, plumbing, electrical, lighting, hvac, furniture, …"),
        family: z.string().optional().describe("Family filter: cabinet, appliance, plumbing, electrical, lighting, hvac, furniture, structure."),
      },
    },
    async ({ query, kind, family }) => {
      try {
        let list = searchLibrary(String(query ?? ""), kind ? String(kind) : undefined);
        if (family) list = list.filter((i) => i.family === family);
        const total = list.length;
        const out = {
          ok: true,
          total,
          items: list.slice(0, MAX_LIBRARY).map((i) => ({ key: i.key, kind: i.kind, family: i.family, label: i.label, tag: i.tag, w: i.w, d: i.d, h: i.h, z: i.z })),
        };
        if (!String(query ?? "").trim() && !kind && !family)
          out.room_templates = ROOM_TEMPLATES.map((t) => ({ key: t.key, label: t.label, description: t.description, widthIn: t.widthIn, depthIn: t.depthIn }));
        return json(out);
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "list_plan_finishes",
    {
      title: "List finish presets",
      description: "Finish presets (paint, wood, cabinet, stone, quartz, tile, flooring, …) whose keys the finish/counter ops accept as `material`.",
      inputSchema: {},
    },
    async () => {
      try {
        return json({ ok: true, finishes: FINISH_PRESETS.map((f) => ({ key: f.key, label: f.label, category: f.category, color: f.color })) });
      } catch (e) { return fail(e); }
    },
  );

  // ── MEASURES + CHECKS ──────────────────────────────────────────────────────
  server.registerTool(
    "get_plan_measures",
    {
      title: "Get takeoff measures",
      description:
        "Read-only takeoff from the design: every measure row (key, qty, unit, phase, material tag, detail) " +
        "plus one product line per placed catalog/library item. Turning these into estimate lines is the " +
        "app's 'Generate from plan' action, not an MCP tool.",
      inputSchema: { design_id: z.number().int().positive() },
    },
    async ({ design_id }) => {
      try {
        const r = await designRow(design_id);
        const doc = migrateDoc(r.doc);
        const measures = computeMeasures(doc);
        return json({
          ok: true,
          id: Number(r.id),
          summary: summarizeMeasures(measures),
          measures: measures.map((m) => ({ key: m.key, label: m.label, unit: m.unit, qty: m.qty, phase: m.phase, materialTag: m.materialTag, detail: m.detail, levelId: m.levelId })),
          products: productLines(doc),
        });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "run_plan_checks",
    {
      title: "Run design checks",
      description: "Geometry, clearance and code checks over the design (aisle widths, door swings, DW-to-sink, GFCI, outlet spacing, …). Ignore one with the ignoreCheck op.",
      inputSchema: { design_id: z.number().int().positive() },
    },
    async ({ design_id }) => {
      try {
        const r = await designRow(design_id);
        const checks = runChecks(migrateDoc(r.doc)).map(checkView);
        return json({ ok: true, id: Number(r.id), count: checks.length, checks });
      } catch (e) { return fail(e); }
    },
  );

  // ── VERSIONS ───────────────────────────────────────────────────────────────
  server.registerTool(
    "save_plan_version",
    {
      title: "Save a version snapshot",
      description: "Store the current doc as an immutable numbered version (what the owner publishes or signs from). Nothing is rendered or sent.",
      inputSchema: {
        design_id: z.number().int().positive(),
        label: z.string().optional().describe("Short label, e.g. 'Option A — island'."),
      },
    },
    async ({ design_id, label }) => {
      try {
        const r = await designRow(design_id);
        const doc = migrateDoc(r.doc);
        const n = await rows(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM plan_design_versions WHERE design_id = $1`, [Number(r.id)]);
        const number = Number(n[0]?.n ?? 1);
        const ins = await rows(
          `INSERT INTO plan_design_versions (design_id, number, label, doc) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, number`,
          [Number(r.id), number, cleanName(label), JSON.stringify(doc)],
        );
        return json({ ok: true, design_id: Number(r.id), version_id: Number(ins[0].id), number: Number(ins[0].number), label: cleanName(label), counts: docCounts(doc) });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "list_plan_versions",
    {
      title: "List saved versions",
      description: "Saved versions of a design, newest first, with element counts for a quick diff.",
      inputSchema: { design_id: z.number().int().positive() },
    },
    async ({ design_id }) => {
      try {
        const r = await designRow(design_id);
        const v = await rows(
          `SELECT id, number, label, created_at, doc FROM plan_design_versions WHERE design_id = $1 ORDER BY number DESC`,
          [Number(r.id)],
        );
        return json({
          ok: true,
          design_id: Number(r.id),
          versions: v.map((x) => ({
            id: Number(x.id), number: Number(x.number), label: x.label,
            created_at: x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at,
            counts: docCounts(migrateDoc(x.doc)),
          })),
        });
      } catch (e) { return fail(e); }
    },
  );

  // ── COMMENTS + SHEET REQUEST ───────────────────────────────────────────────
  const insertComment = async ({ designId, versionId, anchor, authorName, body }) => {
    const r = await rows(
      `INSERT INTO plan_design_comments (design_id, version_id, anchor, author_role, author_name, body)
       VALUES ($1, $2, $3::jsonb, 'agent', $4, $5) RETURNING id`,
      [designId, versionId, JSON.stringify(anchor), authorName, body],
    );
    return Number(r[0].id);
  };

  server.registerTool(
    "stage_plan_sheet",
    {
      title: "Request a drawing sheet",
      description:
        "Ask the owner to render the drawing set. This does NOT render, publish, or send anything — " +
        "rendering is an app action (Open /floor/<id> → Print). It records the request as an agent comment " +
        "on the design so it shows in the designer's Comments tab. Publishing to the client portal and " +
        "sending for signature stay behind the owner grant.",
      inputSchema: {
        design_id: z.number().int().positive(),
        version_id: z.number().int().positive().optional().describe("A saved version to render (default: the live doc)."),
        note: z.string().optional().describe("What the sheet is for / which views matter."),
      },
    },
    async ({ design_id, version_id, note }) => {
      try {
        const r = await designRow(design_id);
        const doc = migrateDoc(r.doc);
        let versionId = null;
        if (version_id != null) {
          const v = await rows(`SELECT id, number FROM plan_design_versions WHERE id = $1 AND design_id = $2`, [version_id, Number(r.id)]);
          if (!v.length) throw new Error(`Version ${version_id} is not a version of design ${design_id}.`);
          versionId = Number(v[0].id);
        }
        const body = `Sheet requested: ${String(note ?? "").trim().slice(0, MAX_BODY) || "render the drawing set"}`;
        const commentId = await insertComment({
          designId: Number(r.id), versionId,
          anchor: { levelId: doc.levels[0]?.id ?? "L1", x: 0, y: 0 },
          authorName: "MCP", body,
        });
        return json({
          ok: true,
          design_id: Number(r.id),
          version_id: versionId,
          comment_id: commentId,
          rendered: false,
          instructions: `Open /floor/${Number(r.id)} → Print to render and publish; publishing to the client and sending for signature need the owner grant.`,
        });
      } catch (e) { return fail(e); }
    },
  );

  server.registerTool(
    "add_plan_comment",
    {
      title: "Add a comment pin",
      description: "Pin a comment at a plan point (inches) or on an item, shown in the designer's Comments tab as an agent note. Not client-facing.",
      inputSchema: {
        design_id: z.number().int().positive(),
        level_id: z.string().optional().describe("Level id (default: first level)."),
        x: z.number(),
        y: z.number(),
        item_id: z.string().optional().describe("Anchor the pin to this item id."),
        body: z.string().min(1).max(MAX_BODY),
        agent_name: z.string().optional().describe("Shown as the author (default 'Agent')."),
      },
    },
    async ({ design_id, level_id, x, y, item_id, body, agent_name }) => {
      try {
        const r = await designRow(design_id);
        const doc = migrateDoc(r.doc);
        const levelId = level_id ? String(level_id) : doc.levels[0]?.id ?? "L1";
        if (!doc.levels.some((l) => l.id === levelId)) throw new Error(`Unknown level '${levelId}'.`);
        if (item_id && !doc.items.some((i) => i.id === item_id)) throw new Error(`Unknown item '${item_id}'.`);
        const anchor = { levelId, x: Number(x), y: Number(y) };
        if (item_id) anchor.itemId = String(item_id);
        const commentId = await insertComment({
          designId: Number(r.id), versionId: null, anchor,
          authorName: cleanName(agent_name) || "Agent", body: String(body).trim(),
        });
        return json({ ok: true, design_id: Number(r.id), comment_id: commentId, anchor });
      } catch (e) { return fail(e); }
    },
  );
}
