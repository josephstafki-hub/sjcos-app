# Floor-Plan Designer (2D + 3D) — full product plan
*Drafted 2026-09-16, expanded the same day into a complete spec. Turns the
`/floor` structural shell into the Rail-1 designer from `docs/sjc-os-plan.md`:
a 2D drafting canvas, a derived 3D model, products placed from the catalog,
demo / existing / new walls, elevations, a printable drawing set that the
client e-signs, and an estimate generated from the plan. Deferred since
`docs/plan-vs-build.md` 3a.*

> **Status: BUILT 2026-09-16** (branch t3code/5753bd07). Sections 1–12 are the
> product spec and now describe what exists; §13 was the build order. What
> shipped: `lib/plan-*.ts` (doc contract + zod, geometry, runs, library,
> ops — the single edit language, measures, checks, draw ops, print core),
> `components/floor/*` (Designer shell, Canvas2D, Scene3D via react-three-fiber
> loaded client-only, ElevationView, inspector panels, sheet builder), routes
> `/floor` + `/floor/[id]`, Floor-tab / lead-tab design strips, Settings →
> Floor-plan designer defaults, Cost book → Plan rules, catalog placement
> fields, portal `/client-portal/plans/[id]` 3D viewer + comment pins,
> `mcp/floor-tools.mjs` (14 tools), migration `db/apply-floor-designer.mjs`.
> **Still stretch (§13 phase 10):** glTF product models beyond the built-in set,
> walkthrough video export, DXF export, photo-measure assist, clipper
> dimension capture, curved walls, roof outline. L/U stairs render straight in 3D.

---

## 0. Why this was stalled, and why it no longer is

The epic was parked because the host box has no usable GPU. That constraint
applies to *server-side* rendering only. This design never renders on the server:

| Work | Where it runs | Server GPU needed? |
|---|---|---|
| 2D drafting (walls, openings, products, dimensions) | Browser, SVG | No |
| 3D model, walkthrough, section cuts, elevations | Browser, WebGL via three.js | No — the viewer's GPU |
| Materials / textures | Browser; static images under `public/` | No |
| Autosave / load a design | Postgres, one jsonb document | No |
| Drawing set (signable PDF) | Server, `pdfkit` vector drawing + PNGs the browser captured | No — same path as every doc template |
| Estimate from plan | Server, arithmetic on the JSON | No |
| Agent-built plans via MCP | Writes JSON; never renders | No |

The only hard requirement is a WebGL-capable browser on the *viewing* device,
which every current desktop and mobile browser is, including iPhone and iPad
Safari. `docs/phase-2-b5-b6-plan.md` set the precedent: "pure JS, no headless
browser — important on this GPU-less box."

---

## 1. Who uses it and for what

| User | Device | Job to be done |
|---|---|---|
| Joe, at the client's house | iPad, sometimes iPhone | Measure and sketch the existing room in 20 minutes; drop rough cabinets to talk layout; capture a 3D view to text the client later. |
| Joe, at the desk | Desktop browser | Refine the design; place real catalog products; build elevations; print the set; generate the estimate; send for signature. |
| Staff (projects area) | Desktop | Same as Joe minus send/publish (owner-grant rule). |
| In-app Claude / Hermes / MCP clients | None (JSON only) | Build a first-pass plan from a lead's description and photos; regenerate the estimate; stage the drawing set. |
| Client | Phone / laptop via portal | View published plan versions, spin the 3D model, leave pinned comments, approve. |

Design scope in v1 is **interior remodels** (kitchens, baths, basements, whole-floor
remodels) and **single-storey additions**. Multi-level with stairs is supported
in the model so basements and second floors work; roof modelling is out.

---

## 2. Screen layout

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Shell breadcrumb: FLOOR PLAN › HENDERSON › KITCHEN v3           [Shell chrome] │
├────────────────────────────────────────────────────────────────────────────────┤
│ TOP BAR  [Plan][3D][Elevation][Split]  Level ▾  ↶ ↷  Saved 2s ago               │
│          Snap 1" ▾  Scale 1/4" ▾  100% ▾  Layers ▾  Checks (2)  Print  Publish  │
├──────┬─────────────────────────────────────────────────────────┬───────────────┤
│ TOOL │                                                         │ INSPECTOR     │
│ RAIL │                   CANVAS                                │ (context)     │
│ 72px │   2D SVG  |  3D WebGL  |  Elevation SVG  |  Split       │ 300px         │
│      │                                                         │ ─────────────  │
│ Draw │                                                         │ Catalog /     │
│ Place│                                                         │ Materials /   │
│ Anno │                                                         │ Layers /      │
│ View │                                                         │ Rooms /       │
│      │                                                         │ Checks tabs   │
├──────┴─────────────────────────────────────────────────────────┴───────────────┤
│ STATUS  x 128.5"  y 96"   ∠ 90°   L 8' 4½"   Kitchen 168 sf · 52 lf  ⌨ hint    │
└────────────────────────────────────────────────────────────────────────────────┘
```

Reuses the existing `Shell`, `Card`, `Chip`, `Field` components and the palette
in `components/floor/ToolPalette.tsx`. On screens under 1024 px the inspector
becomes a bottom sheet and the rail collapses to a scrollable strip (iPad
portrait). On phones the designer opens in **view + markup** mode only (orbit,
measure, note, comment); drafting needs a tablet or desktop.

### 2.1 Top bar
- **View switcher**: Plan · 3D · Elevation · Split (2D left, 3D right, linked
  selection). Hotkeys `1` `2` `3` `4`.
- **Level selector**: Main / Basement / Upper …; "+ Level" copies exterior walls
  from the level below as a starting outline.
- **Undo / redo** with a history dropdown (last 50 steps, labelled: "Move base
  cabinet", "Split wall").
- **Save state**: "Saved" / "Saving…" / "Offline — 3 changes queued" /
  "Conflict — reload". Explicit **Save version** (creates an immutable snapshot
  in `plan_design_versions`; see §10).
- **Snap** menu: 1", ½", ¼", off; angle snap 15° / 45° / 90°; object snap
  toggles (endpoints, midpoints, wall faces, centres, grid).
- **Scale / zoom**: 1/8", 1/4", 1/2", fit, 100%; zoom to selection.
- **Layers** dropdown (visibility + lock per layer; see §6).
- **Checks (n)** badge: opens the validation panel (§9).
- **Print** → drawing-set builder (§8). **Publish** → version / portal / sign (§10).
- **Design menu**: rename, duplicate, templates, import underlay, export
  (PDF, PNG, JSON, DXF stretch), settings, delete.

### 2.2 Tool rail (grouped, hotkeys from `lib/floor.ts` kept and extended)

| Group | Tool | Key | What it does |
|---|---|---|---|
| **Navigate** | Select / Move | `S` / `V` | Click, marquee, shift-add, drag, rotate handle, nudge with arrows (1", shift = 12"). |
| | Pan | `H` / space-drag | Pan canvas. |
| **Structure** | Wall | `W` | Click-click polyline; Esc ends; auto-joins to existing wall ends; type picker (existing / demo / new). |
| | Room (rectangle) | `R` | Drag a rectangle → four walls + a room, fastest way to start. |
| | Door | `D` | Hover a wall, click to place; swing side/hand flips with `F`; width presets 24/28/30/32/36; pocket, bifold, sliding, French, cased opening. |
| | Window | `N` | Same placement; width/height/sill; types: single, double, picture, casement, slider, bay (three segments). |
| | Opening | `O` | Cased / pass-through / arched opening. |
| | Stairs | `K` | Straight, L, U; width, riser count auto from level height; opening cut in the floor above. |
| | Column / Beam | `B` | Post (square/round) and header/beam spans (LVL, rendered in 3D, listed in schedule). |
| | Soffit / Bulkhead | `Shift+B` | Boxed drop below ceiling, snaps to walls. |
| **Cabinets** | Base cabinet | `C` | Places from the generic cabinet library or the catalog; snaps to wall face, auto-rotates to face room, joins into a run. |
| | Wall cabinet | `Shift+C` | Same, at wall-cabinet height. |
| | Tall / pantry | `Alt+C` | Full-height boxes. |
| | Island / peninsula | `I` | Free-standing run with seating overhang side. |
| | Filler / panel | `Shift+F` | End panels, fillers, toe-kick, crown, light rail (run accessories). |
| | Countertop | `T` | Auto-generated from base runs (overhang, seams, backsplash height); edit to add L-returns, bar tops, waterfall ends. |
| **Fixtures** | Appliance | `A` | Range, cooktop, wall oven, fridge, DW, micro, hood, washer/dryer — generic sizes or catalog. |
| | Plumbing | `P` | Sink (base + fixture), faucet, toilet, tub, shower base, vanity sink, laundry, water heater; stub-out markers. |
| | Electrical | `E` | Outlet, GFCI, 240V, switch (1/3/4-way, dimmer), light (recessed, pendant, sconce, under-cab), fan, panel, smoke/CO, data. Draws on the Electrical layer, with symbol per type. |
| | HVAC | `Shift+H` | Register, return, exhaust fan, mini-split head. |
| | Furniture | `U` | Table, chairs, sofa, bed, desk — for space planning. |
| **Finishes** | Floor finish region | `L` | Polygon over a room (or auto = room) assigned a flooring material; drives SF. |
| | Wall finish / paint | `Shift+L` | Per wall face: paint colour, tile field (with height), wainscot; drives SF. |
| | Tile pattern | `Shift+T` | Straight / offset / herringbone / diagonal with tile size + grout, shown in 2D and 3D. |
| | Trim | `M` (Shift) | Base, casing, crown, chair rail per wall or room; drives LF. |
| **Annotate** | Measure | `M` | Temporary readout, click-click; hold to keep as a dimension. |
| | Dimension | `Shift+M` | Persistent dimension string; aligned / linear / continuous chain / angle. |
| | Text / note | `X` | Leader note; room label; north arrow; revision cloud. |
| | Comment pin | `Shift+X` | Threaded comment anchored to a point/item (owner + client). |
| | Photo pin | `Shift+P` | Attach a site photo (from project files or camera) to a spot. |
| **View** | Camera | `Shift+V` | Drop a named camera in 2D; 3D jumps to it; used in drawing set. |
| | Section line | `Shift+S` | Cut line for an elevation / section view. |

Every tool: `Esc` cancels, `Enter` commits, `Tab` cycles numeric fields in the
inspector, double-click on a placed item opens its properties.

### 2.3 Inspector (right panel, tabs)
- **Properties** — context-sensitive: wall (type, thickness, height, finish per
  face, length editable → stretches wall), opening (type, W/H/sill, hand, swing,
  header), cabinet (nominal size, catalog product, door style, finish, hardware,
  hinge side, drawer stack, glass, accessories), counter (material, thickness,
  overhang per edge, edge profile, backsplash height, seams), appliance (model,
  power/gas, venting), electrical (type, circuit tag, height AFF), room (name,
  ceiling height, floor finish, ceiling finish, trim set, occupancy notes),
  finish (material, pattern, grout), stairs (rise/run/width/headroom check).
- **Catalog** — search, category chips (existing `CATEGORIES`), "placeable
  only", size filter, price, supplier, series; drag or click to place. Recent
  and "Used in this design" sections. Uses the catalog grid components.
- **Materials** — flooring, tile, counter, paint, cabinet finish swatches;
  catalog-backed where a product exists, generic where not; drag onto a
  surface in 2D or 3D. Mood-board swatches from the project show up here.
- **Layers** — visibility, lock, opacity; layer order.
- **Rooms** — live schedule: name, area, perimeter, ceiling, finishes, counts
  of cabinets/appliances/fixtures; click to zoom.
- **Checks** — warnings list (§9), click to locate.
- **Comments** — thread list (owner + client), resolve, jump-to.

### 2.4 Status bar
Cursor coordinates, current segment length and angle while drawing, hovered
room stats, active snap, and the keyboard hint for the active tool.

---

## 3. 2D drafting canvas (SVG)

- **Coordinate system**: inches, origin at first wall; y-down in SVG, converted
  once at the boundary. Pan/zoom by CSS transform on a single `<g>`; the grid is
  a pattern that rescales with zoom (minor 1", major 12" at 1/4" scale; fewer
  lines when zoomed out).
- **Wall model**: centreline segments with thickness; corners auto-mitre; T- and
  cross-junctions clean up; wall faces are computed (this is what cabinets snap
  to). Splitting a wall at a point, joining collinear walls, dragging a corner
  moves both adjoining walls. Curved walls: out of v1 (arc approximated by
  segments if imported).
- **Openings** live *on* a wall (wall id + offset), so moving a wall moves its
  doors. Dragging along the wall slides; dragging off deletes with confirm.
- **Rooms** are detected from closed wall loops (face-based polygon detection),
  cached in the doc, and re-derived on any wall change. Area (sf), perimeter
  (lf), and net wall SF (minus openings) are available to the inspector and
  the estimate.
- **Snapping** (priority order): endpoints → wall faces → midpoints → item
  edges → grid. Visual cues: green dot (endpoint), dashed alignment guides
  (extend lines from other items), angle ticks at 0/45/90.
- **Cabinet run logic**: bases snap back-to-wall-face and end-to-end; nominal
  widths tile along the wall; gaps < 6" show a suggested filler; corner
  conditions offer blind corner / lazy susan / diagonal; an island is a run
  with no wall. Counters are auto-generated per base run (default 1½" overhang
  front, flush at walls, 12" seating overhang where flagged), then editable.
  Wall cabinets align to base run ends by default with 18" gap.
- **Demo / existing / new**: wall `kind` drives line style (existing solid,
  demo hatched grey, new bold). A **Phase filter** in the top bar shows
  Existing · Demo plan · New plan, which is also how the drawing set makes
  separate sheets from one model. Items carry the same `phase` field
  (`existing` / `remove` / `new` / `relocate`).
- **Selection layer** (ghosts): chosen selection options that resolve to a
  catalog item render as dashed ghosts in the room they belong to; one click
  promotes a ghost into a placed item and links the two.
- **Underlay**: a plan image or PDF page from `project_floorplans` (or a fresh
  upload) placed behind the grid with opacity; **calibrate** by clicking two
  points and typing the real distance; lock; trace walls over it.
- **Photo-measure assist** (stretch): a photo pin with a known reference
  length yields a rough dimension.
- **Undo/redo**: reducer with an immutable doc; each user action is one entry;
  drag = one entry on pointer-up.
- **Touch**: one finger draws/moves with the active tool, two fingers pan/zoom,
  long-press = context menu, Apple Pencil supported as a pointer. Minimum hit
  target 32 px with a magnifier loupe when placing on tablet.

---

## 4. 3D view (three.js via react-three-fiber)

Derived entirely from the same document; nothing is edited *only* in 3D except
camera and materials (which write back to the doc).

- **Geometry**: walls extruded to their height, split at openings (no CSG);
  door leaves and frames, window glass + frames + sills; floor slab per room with
  its finish; ceiling per room (hidden in dollhouse mode); soffits; stairs from
  parameters; columns and beams.
- **Cabinets**: parametric boxes with door/drawer fronts generated from the
  item's door style (slab, shaker, raised), toe kick, crown and light rail from
  run accessories, hardware as simple pulls/knobs. Catalog product image as a
  front texture when the item has one and no parametric style is set.
- **Counters** with edge profile and thickness; backsplash slab; **tile
  patterns** rendered as a repeating texture with grout lines from the finish
  parameters.
- **Appliances & fixtures**: a small built-in glTF library (range, fridge,
  DW, hood, sink, faucet, toilet, tub, shower, vanity, washer, dryer, pendants,
  recessed can) under `public/models/`, licensed CC0; anything without a model
  renders as a labelled box of the right size.
- **Materials**: PBR-lite (colour, roughness, metalness, optional texture);
  presets for paint, wood species, painted cabinet colours, stone, quartz,
  tile, LVP, hardwood, carpet. Drag from the Materials tab onto a surface.
- **Lighting**: hemisphere + directional with soft shadows; placed lights emit
  in "Night" mode; a **sun** slider (time of day) for windows.
- **Cameras**: Orbit (default), **Walk** (WASD/arrows + drag look, eye 66",
  collides with walls), **Plan** (top-down ortho), named cameras from the 2D
  tool, "Look from here" on any point.
- **Dollhouse** toggle hides ceilings and clips walls to 48" so the layout reads
  from above.
- **Section plane**: drag a cut plane along X or Y; also feeds elevations.
- **Phase view**: Existing / Demo (removed items ghosted red) / New; same
  filter as 2D.
- **Render styles**: Materials · White model · Wireframe · Sketch (edge lines).
- **Measure in 3D**: point-to-point readout.
- **Capture**: PNG at 1×/2×/4× of the viewport, with or without labels;
  captures go to `files` and appear in the Captures list for the drawing set
  and the portal.
- **Walkthrough tour**: order named cameras, "Play" tweens between them; also
  exported as a short WebM in-browser (MediaRecorder) — stretch.
- **Performance**: `frameloop="demand"`, instanced cabinet boxes, texture atlas
  for tile, dispose on unmount, resolution scaling on low-end devices, context
  loss handler ("3D paused — tap to resume"). Target ≥ 30 fps on an iPhone for
  a full kitchen.

---

## 5. Elevation and section views (SVG, derived)

Kitchen and bath elevations are a standard deliverable, so they are first-class.

- **Wall elevation**: pick a wall (or a section line) → orthographic SVG of that
  wall face with cabinets, counters, backsplash, windows/doors, outlets and
  lights, trim, dimension strings (cabinet widths, heights AFF), and a cabinet
  callout tag per box (`B36`, `W3030`, `SB36`).
- **Auto-elevations**: every wall with a cabinet run gets an elevation
  automatically for the drawing set; ordered clockwise from the entry door.
- **Section**: same renderer along a section line, showing ceiling height, soffit,
  counter height, wall cabinet height.
- Editable in place: drag cabinet width handles in elevation; the plan updates.

---

## 6. Layers, phases, levels

**Layers** (visibility, lock, opacity): Underlay · Walls · Openings · Cabinets ·
Counters · Appliances · Plumbing · Electrical · Lighting · HVAC · Furniture ·
Finishes · Trim · Dimensions · Notes · Comments · Photos · Selections ghosts ·
Cameras.

**Phases**: `existing` · `remove` · `new` · `relocate` on walls and items.
Views and sheets filter on phase. "Relocate" shows the item ghosted at the old
spot on the demo plan and solid at the new spot on the new plan.

**Levels**: each level has an elevation (inches from main floor), a default
ceiling height, and its own walls/items. Stairs link two levels and cut a floor
opening above. 3D stacks levels; the level selector isolates one.

---

## 7. Libraries and templates

- **Generic cabinet library** (no catalog needed to start): base (B9–B48, SB,
  DB, 3-drawer, corner BLC/LS/diag), wall (W-widths × 12/15/18/24/30/36/42 h,
  corner, over-fridge, over-range), tall (pantry, oven, utility), vanity (VB,
  VSB, VDB), accessories (filler, end panel, toe, crown, light rail, refrigerator
  panel). Sizes in inches; door style and finish are properties.
- **Appliance library** with standard footprints (30" / 36" / 48" range, 36"
  fridge, 24" DW, 30" hood, 27" / 30" wall oven, 24" micro, W/D).
- **Fixture library** (sinks, faucets, toilets, tubs 60/66/72, showers, vanity
  sinks).
- **Electrical symbol set** following common residential drawing conventions.
- **Room templates**: galley, L, U, G, island kitchens; 5×8 / 6×10 baths; laundry;
  each a small PlanDoc fragment inserted at a click.
- **Design templates**: duplicate any existing design as a starting point;
  "Save as template" on any design (stored with `project_id = null`).
- **Catalog placeables**: catalog items with dimensions + `place_kind` appear
  alongside generics and override the generic box when dropped.
- **Standards / defaults** (Settings → Designer): wall thickness (4½" / 6½"),
  ceiling height (96"), counter height (36"), backsplash (18"), wall-cab
  height off counter (18"), toe kick (4½"), overhangs (1½" / 12" seating), door
  sizes, trim set, default door style + finish, snap.

---

## 8. Drawing set and print

`lib/plan-print.ts` renders with pdfkit from the doc (vectors), plus captured
PNGs. Letter / 11×17 / 24×36, scale auto-fit to 1/4" or 1/2" (or chosen). Title
block: company, license, project, client, address, design name, version, date,
sheet n/N, scale, north arrow, revision table.

Sheet builder lets Joe tick sheets and drag order:

| Sheet | Contents |
|---|---|
| Cover | Project, client, 3D hero capture, sheet index |
| Existing plan | Phase = existing; dimensions, room labels |
| Demo plan | Existing + `remove` items hatched, demo notes, legend |
| New construction plan | Phase = new; walls, openings, dimensions, door/window tags |
| Cabinet plan | Runs with callout tags, counters, appliances, seams |
| Electrical / lighting plan | Symbols, switch legs (drawn as arcs), circuit tags, legend |
| Finish plan | Floor regions with material tags, tile direction, wall finishes |
| Elevations | One per auto-elevation, 2–4 per sheet, tagged |
| Sections | From section lines |
| 3D views | Named-camera captures, 1–2 per sheet |
| Schedules | Door, window, cabinet (tag, nominal, product, finish, qty), appliance, plumbing fixture, electrical device counts, finish, room |
| Notes | General notes, demo notes, allowances, "not for construction" watermark until signed |

Output paths: download PDF, save to project files, **create plan version**
(§10), **send for signature** (§10). PNG export of any single view.
DXF export of walls/openings/items as lines and blocks is a stretch goal for
handing off to an architect.

---

## 9. Checks (validation panel)

Live warnings, none blocking, each with "locate" and "ignore on this design":

- **Geometry**: unclosed room loop; overlapping walls; opening wider than wall;
  item overlapping wall; item overlapping item; cabinet run gap < 1" or an
  unfilled gap; counter seam over a sink or cooktop; wall cabinet over range
  without hood clearance (30" gas / 24" electric).
- **Clearances (NKBA-style guidance)**: work aisle < 42" (< 48" two-cook);
  walkway < 36"; door swing conflicts (door into door / into appliance door);
  DW not within 36" of sink; landing space beside range/fridge/sink < 15";
  seating overhang < 12"; toilet centreline < 15" from wall; shower < 30×30;
  tub deck / door clearance.
- **Code-ish flags (advisory, not legal)**: egress window in a bedroom below
  5.7 sf clear; stair rise > 7¾" or run < 10"; headroom < 80"; GFCI missing at
  wet locations; outlet spacing > 48" along counter; no light at stair; range
  outlet 240V present when a range is placed.
- **Estimate readiness**: measure with no cost rule; placed catalog item with no
  price; generic cabinet with no product picked (allowance flagged).

Rules live in `lib/plan-checks.ts` as pure functions over the doc, with
per-design ignores stored in the doc.

---

## 10. Versions, publishing, signature, client portal

- **Autosave** writes `plan_designs.doc` (rev+1) 1.5 s after the last change;
  offline queue in memory with retry; a stale `rev` returns the newer doc and
  prompts "Reload (lose 3 changes) / Save as copy".
- **Save version** stores an immutable snapshot row in `plan_design_versions`
  (doc, label, created_by). Version list shows diffs in counts (walls, items,
  area) and lets Joe restore or duplicate.
- **Publish plan version** renders the chosen sheets to PDF, stores it and the
  cover capture via `storeBuffer`, and inserts a `project_floorplans` row with
  `design_id`, `design_version_id`, `preview_file_id`. From there the **existing**
  publish switch, portal page, typed-name approval, and owner notification run
  unchanged. Lead-scoped designs publish to the lead's portal the same way.
- **Send for signature** creates a `signature_requests` row with
  `doc_type='design'` and `file_id` = the sheet PDF through the document-draft
  path, so agents stage and Joe sends (owner-grant rule).
- **Portal 3D**: `/client-portal/plans/[versionId]/3d` serves the versioned doc
  read-only to the same client-only viewer (orbit, walk, dollhouse, captures) —
  no editing. Client can drop **comment pins** (stored like mood feedback) and
  approve the version. Owner sees pins in the designer's Comments tab.

---

## 11. Estimate from the plan

- `lib/plan-measures.ts` (pure): doc → `{ measure, qty, unit, phase, detail }[]`:
  wall demo LF and SF, new wall LF (framed) and SF (drywall two sides), floor SF
  per finish, ceiling SF, wall finish SF per finish (net of openings), tile SF
  and LF of trim, base/wall/tall cabinet LF and counts by size, counter SF and
  edge LF per material, backsplash SF, doors/windows/openings by type and size,
  trim LF by profile, plumbing fixtures by type, electrical devices by type,
  lights by type, appliances, stairs (risers), beams/columns, and one product
  line per placed catalog item.
- `plan_cost_rules` maps each measure (optionally per material tag) to a cost
  item; product lines use `catalog_items.price_cents` and the paired
  `cost_item_id` for install labour.
- `generateEstimateFromDesign(designId, target)` writes through
  `addTakeoffLines()` into a section per phase (`Demo — from plan`, `New — from
  plan`, `Products — from plan`), replacing prior plan-generated lines and
  leaving hand-added lines alone. Unmapped measures return as a checklist, never
  silently dropped. Rail is set to `design_build`.
- Estimate tab gets "Generate from plan" and a delta view when regenerating
  ("+2 base cabinets, −4 lf demo wall").
- Selections tie-in: a placed item whose catalog product differs from the
  chosen selection option raises a check; promoting a ghost keeps them linked.

---

## 12. Agents (MCP) and in-app Claude

`mcp/floor-tools.mjs`, registered with one line like the other modules. No
deletes, no client-facing sends.

- `list_plan_designs`, `get_plan_design` (doc, rooms, measures, checks),
  `create_plan_design` (from template or room dimensions), `duplicate_plan_design`.
- `apply_plan_ops(designId, ops[])` — validated op language: `add_room_rect`,
  `add_wall`, `split_wall`, `set_wall_kind`, `add_opening`, `place_item`,
  `place_run` (a whole cabinet run from a list of nominals along a wall),
  `set_counter`, `set_finish`, `add_electrical`, `add_note`, `add_dimension`,
  `set_camera`. Ops are the same reducer actions the UI uses, run server-side.
- `describe_plan_design` — a plain-language summary for chat ("12'×14' kitchen,
  U layout, 22 lf base…").
- `generate_estimate_from_design`, `run_plan_checks`, `save_plan_version`,
  `stage_plan_sheet` (renders the set to a document draft; publishing and
  signature stay behind the owner grant).
- In-app Claude (Ask window) gets these automatically; a "Draft from photos +
  notes" button on a lead calls Claude with the lead's photos and intake
  answers and applies the returned ops as a starting design.

---

## 13. Build order

Each phase ends with `tsc`, `next build --webpack` in the worktree, and a live
flow check via the copy + `next dev` recipe. Effort is rough calendar time for
one focused builder.

### Phase 0 — Spike and foundations (2–3 days)
- Deps: `three`, `@react-three/fiber`, `@react-three/drei`. Client-only load via
  a `"use client"` wrapper using `dynamic(() => import("./Scene3D"), { ssr:
  false })` — Next 16 forbids `ssr:false` in server components (verified in
  `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`).
- Throwaway `/floor/spike`: extruded L-room, orbit, a texture; check that the
  3D chunk is route-split and absent from the server bundle; frame rate on
  Joe's desktop, iPhone, iPad.
- `lib/plan-doc.ts`: types, zod schema, `migrateDoc()`, `emptyDoc()`.
  `db/apply-floor-designer.mjs` with the tables in §15. Route skeleton
  `/floor/[id]` with `requireAccess("projects")`.

### Phase 1 — 2D drafting MVP (1½–2 weeks)
- Designer shell: top bar, rail, inspector, status bar; reducer + undo/redo;
  autosave with rev conflict.
- Tools: Select/Move, Pan, Wall, Room rect, Door, Window, Opening, Measure,
  Dimension, Text. Wall kinds and the phase filter. Room detection with sf/lf.
- Snapping, alignment guides, keyboard shortcuts, touch gestures on iPad.
- Entry points: project Floor tab and lead Floor plan tab get the Designs strip.
- Exit criterion: Joe drafts an existing kitchen on site on an iPad in under
  20 minutes and it survives reload.

### Phase 2 — Cabinets, counters, fixtures (1½ weeks)
- Generic cabinet / appliance / fixture libraries; run logic; fillers; corner
  options; counters auto-generated with overhang and seams; backsplash.
- Tools: Base, Wall, Tall, Island, Filler/Panel, Countertop, Appliance,
  Plumbing, Electrical, HVAC, Furniture.
- Catalog migration (dimensions, `place_kind`, `price_cents`, `cost_item_id`),
  catalog form fields, Catalog inspector tab, drag-to-place; selections ghosts.
- Rooms inspector tab; first checks (geometry + run gaps + hood clearance).

### Phase 3 — 3D (1½–2 weeks)
- Scene from the doc: walls with openings, floors, ceilings, cabinets with door
  styles, counters, backsplash, tile textures, appliances/fixtures (boxes first,
  glTF library second), lighting, sun slider.
- Cameras: orbit, walk, plan, named cameras; dollhouse; section plane; phase
  view; render styles; measure; capture to `files`.
- Materials tab with drag-to-surface in 2D and 3D; mood-board swatches surfaced.
- Split view with linked selection. Performance pass + context-loss handling.

### Phase 4 — Finishes, trim, elevations, checks (1 week)
- Floor regions, wall finishes, tile patterns, trim per wall/room; finish plan.
- Elevation and section renderer (SVG), auto-elevations, in-elevation editing.
- Full checks catalogue (§9) with ignores.

### Phase 5 — Drawing set, versions, publish, sign (1 week)
- `lib/plan-print.ts`: all sheets in §8, sheet builder UI, title block from
  `app_settings` company info.
- `plan_design_versions`, Save version, restore/duplicate; Publish → floorplans
  version; Send for signature through the document-draft path.
- Docs: `docs/routes.md`, README §4.4, `docs/plan-vs-build.md` 3a.

### Phase 6 — Estimate from plan (1 week)
- `lib/plan-measures.ts` with unit tests; `plan_cost_rules` + Settings panel;
  `generateEstimateFromDesign` via `addTakeoffLines`; Estimate tab button and
  delta view; readiness checks.

### Phase 7 — Portal 3D + comments (3–4 days)
- Read-only portal viewer of a published version; comment pins; approval
  unchanged; owner notification on comments through `emit`.

### Phase 8 — Agents (3–4 days)
- `mcp/floor-tools.mjs` with the op language; `describe_plan_design`; lead
  "Draft from photos + notes"; `mcp/README.md`.

### Phase 9 — Levels, stairs, underlay, templates (1 week)
- Multi-level, stairs with floor openings, soffits, columns/beams; underlay
  import + calibrate + trace; room and design templates; Settings → Designer
  defaults.

### Phase 10 — Stretch (as prioritised)
- glTF models for more products; walkthrough tour + WebM; DXF export; photo
  measure assist; clipper captures dimensions; curved walls; roof outline for
  additions.

---

## 14. Decisions (defaults in bold; say otherwise and the plan changes)

1. Units: **imperial UI, inches internally** (feet-inches formatting helper).
2. 2D is the **source of truth**; 3D edits only camera and materials in v1.
3. **One document per design, saved whole with a rev counter** (not per-row
   like the mood board) — geometry is one graph and undo must be atomic.
4. Designs attach to **projects or leads** (mirrors estimates).
5. Cabinet library is **generic nominals first**, catalog products override —
   Joe can design before a product is picked.
6. 3D materials are **PBR-lite presets + catalog photos**, no photoreal renderer.
7. Wall thickness default **4½"**, ceiling **96"**, counter **36"**, backsplash
   **18"**, all editable in Settings → Designer.
8. Cost rules ship **unmapped** with a readiness checklist; Joe maps once.
9. Phones are **view + markup only**; drafting needs tablet or desktop.
10. Client portal 3D viewer is **in scope** (Phase 7) because it is cheap once
    the viewer exists, but nothing client-facing sends without the owner grant.

---

## 15. Data model

One migration script, `db/apply-floor-designer.mjs`, mirrored into `db/schema.sql`.

```sql
-- A live, editable design. Project- or lead-scoped (like estimates).
CREATE TABLE IF NOT EXISTS plan_designs (
  id          bigserial PRIMARY KEY,
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  lead_slug   text,
  name        text NOT NULL DEFAULT 'Kitchen',
  is_template boolean NOT NULL DEFAULT false,      -- project_id/lead_slug null
  doc         jsonb NOT NULL DEFAULT '{}',         -- PlanDoc (below)
  rev         integer NOT NULL DEFAULT 0,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_designs_project ON plan_designs(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_designs_lead    ON plan_designs(lead_slug);

-- Immutable snapshots ("Save version").
CREATE TABLE IF NOT EXISTS plan_design_versions (
  id          bigserial PRIMARY KEY,
  design_id   bigint NOT NULL REFERENCES plan_designs(id) ON DELETE CASCADE,
  number      integer NOT NULL,
  label       text NOT NULL DEFAULT '',
  doc         jsonb NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (design_id, number)
);

-- Captures (3D PNGs) and rendered sheets are files rows; index them per design.
CREATE TABLE IF NOT EXISTS plan_design_files (
  id          bigserial PRIMARY KEY,
  design_id   bigint NOT NULL REFERENCES plan_designs(id) ON DELETE CASCADE,
  version_id  bigint REFERENCES plan_design_versions(id) ON DELETE SET NULL,
  file_id     text NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('capture','sheet_pdf','underlay','photo')),
  label       text NOT NULL DEFAULT '',
  camera      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Comments pinned to a point / item (owner + client via portal).
CREATE TABLE IF NOT EXISTS plan_design_comments (
  id          bigserial PRIMARY KEY,
  design_id   bigint NOT NULL REFERENCES plan_designs(id) ON DELETE CASCADE,
  version_id  bigint REFERENCES plan_design_versions(id) ON DELETE SET NULL,
  anchor      jsonb NOT NULL,                      -- { level, x, y, itemId? }
  author_role text NOT NULL CHECK (author_role IN ('owner','staff','client','agent')),
  author_name text NOT NULL DEFAULT '',
  body        text NOT NULL,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Link a published/printed version back to the design.
ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS design_id         bigint REFERENCES plan_designs(id) ON DELETE SET NULL;
ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS design_version_id bigint REFERENCES plan_design_versions(id) ON DELETE SET NULL;
ALTER TABLE project_floorplans ADD COLUMN IF NOT EXISTS preview_file_id   text REFERENCES files(id) ON DELETE SET NULL;

-- Catalog items become placeable.
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS width_in    numeric(7,2);
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS depth_in    numeric(7,2);
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS height_in   numeric(7,2);
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS place_kind  text NOT NULL DEFAULT ''
  CHECK (place_kind IN ('','base','wall','tall','vanity','island','counter','appliance',
                        'plumbing','electrical','lighting','hvac','furniture','flooring',
                        'tile','paint','trim','door','window','hardware'));
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS price_cents  integer;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS cost_item_id bigint REFERENCES cost_items(id) ON DELETE SET NULL;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS model_key    text NOT NULL DEFAULT '';   -- glTF in public/models
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS material     jsonb;                       -- { color, roughness, textureKey }

-- Measure → cost-book rule (optionally per material tag).
CREATE TABLE IF NOT EXISTS plan_cost_rules (
  id           bigserial PRIMARY KEY,
  measure      text NOT NULL,
  material_tag text NOT NULL DEFAULT '',
  cost_item_id bigint NOT NULL REFERENCES cost_items(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT true,
  UNIQUE (measure, material_tag)
);

-- Designer defaults live in app_settings keys: designer.wall_thick_in,
-- designer.ceiling_in, designer.counter_in, designer.backsplash_in,
-- designer.wallcab_gap_in, designer.toe_in, designer.overhang_in,
-- designer.seating_overhang_in, designer.door_style, designer.finish, designer.snap_in.
```

### `PlanDoc` (jsonb; `lib/plan-doc.ts` owns type, zod, migrations)

```ts
interface PlanDoc {
  v: 1;
  units: "in";
  settings: { snapIn: number; angleSnap: 15 | 45 | 90 | 0; defaults: DesignerDefaults };
  levels: Level[];                 // { id, name, elevationIn, ceilingIn }
  walls: Wall[];                   // { id, levelId, a, b, thickIn, heightIn, kind: "existing"|"remove"|"new", faces: { left: FinishRef|null, right: FinishRef|null } }
  openings: Opening[];             // { id, wallId, atIn, widthIn, heightIn, sillIn, kind: "door"|"window"|"opening", subtype, hand, swing, phase, tag }
  rooms: Room[];                   // derived+cached: { id, levelId, name, polygon, areaSf, perimLf, floor: FinishRef|null, ceiling: FinishRef|null, trim: TrimSet|null }
  items: PlacedItem[];             // { id, levelId, kind: PlaceKind, catalogId|null, libraryKey|null, label, tag, x, y, z, rotDeg, w, d, h, phase, wallId?, runId?, props: Record<string, unknown>, selectionOptionId? }
  runs: CabinetRun[];              // { id, levelId, wallId|null, tier: "base"|"wall"|"tall", startIn, endIn, itemIds, accessories: RunAccessory[] }
  counters: Counter[];             // { id, runId|null, polygon, thickIn, overhang: {front,left,right,back}, edge, material: FinishRef, seams: Seam[], backsplashIn, waterfall: string[] }
  finishes: FinishRegion[];        // { id, levelId, target: "floor"|"wall"|"ceiling", roomId?|wallId?, polygon?, material: FinishRef, pattern?: TilePattern, heightIn? }
  trims: TrimRun[];                // { id, wallId|roomId, profile, heightIn, lf }
  electrical: Device[];            // { id, levelId, type, x, y, heightAff, wallId?, circuit, switchLegTo?: string[] }
  stairs: Stair[];                 // { id, fromLevelId, toLevelId, shape, x, y, rotDeg, widthIn, riserCount, treadIn, opening: Pt[] }
  structure: Structural[];         // { id, kind: "column"|"beam"|"soffit", ... }
  dims: Dim[];                     // { id, levelId, kind, a, b, offsetIn, chain?: Pt[] }
  notes: Note[];                   // { id, levelId, x, y, text, leaderTo?: Pt, kind: "note"|"label"|"cloud"|"north" }
  photos: PhotoPin[];              // { id, levelId, x, y, fileId }
  cameras: Camera[];               // { id, name, levelId, pos, target, fov, mode: "orbit"|"walk"|"plan" }
  sections: SectionLine[];         // { id, levelId, a, b, depthIn, flip }
  underlay?: Underlay;             // { fileId, page?, x, y, scale, rotDeg, opacity, locked }
  ignoredChecks: string[];
  meta: { templateOf?: string; createdFrom?: { designId, versionId } };
}
```

Server writes validate with zod and clamp (≤ 500 walls, ≤ 2000 items, coords
within ±20,000 in, labels ≤ 200 chars, ≤ 50 cameras); prices never come from
the client.

---

## 16. Files touched

| Area | New / changed |
|---|---|
| DB | `db/apply-floor-designer.mjs`, `db/schema.sql` |
| Domain (pure) | `lib/plan-doc.ts`, `lib/plan-geometry.ts` (walls, rooms, snapping), `lib/plan-runs.ts` (cabinet/counter logic), `lib/plan-measures.ts`, `lib/plan-checks.ts`, `lib/plan-library.ts` (generic libraries), `lib/plan-print.ts`, `lib/plan-elevation.ts` |
| Reads / writes | `lib/plan-designs.ts`, `lib/actions/plan-designs.ts`, `lib/actions/plan-files.ts`, `lib/actions/plan-comments.ts`, `lib/actions/plan-estimate.ts`, `lib/actions/catalog.ts` (dims, kind, price, model) |
| Routes | `app/(os)/floor/page.tsx` (list), `app/(os)/floor/[id]/page.tsx`, `app/client-portal/plans/[versionId]/3d/page.tsx`, `app/api/portal/plan-doc/[versionId]/route.ts` |
| Designer UI | `components/floor/Designer.tsx`, `TopBar.tsx`, `ToolPalette.tsx`, `Canvas2D.tsx`, `Elevation.tsx`, `Scene3D.tsx` + `Scene3DLoader.tsx`, `Inspector/*.tsx` (Properties, Catalog, Materials, Layers, Rooms, Checks, Comments), `StatusBar.tsx`, `SheetBuilder.tsx`, `VersionList.tsx` |
| Entry points | `components/projects/FloorPlan.tsx`, lead Floor plan tab, `components/projects/ProjectEstimate.tsx` |
| Catalog + settings | catalog item form fields, placeable filter; Settings → Designer defaults; Cost book → Plan rules |
| Portal | `components/portal/ClientFloorplans.tsx` (3D link), `components/portal/PlanViewer3D.tsx`, comment form |
| Assets | `public/models/*.glb` (CC0), `public/textures/*` |
| MCP | `mcp/floor-tools.mjs`, one registration line in `mcp/sjcos-mcp.mjs`, `mcp/README.md` |
| Docs | `docs/routes.md`, README §4.4, `docs/plan-vs-build.md` 3a → BUILT |

---

## 17. Verification and deployment

- `tsc` + `next build --webpack` per phase (symlinked node_modules, off-sandbox;
  memory *worktree-build-check*).
- Unit tests for `plan-geometry`, `plan-runs`, `plan-measures`, `plan-checks`,
  `plan-doc` migrations — pure functions; the estimate numbers must be provably
  right.
- Live flows via the copy + `next dev` recipe (memory *verify-without-building*):
  draft → autosave → reload → place run → 3D → capture → sheets → version →
  publish → portal 3D + comment → approve → estimate with expected LF/SF.
  Headless Chromium needs `--use-angle=swiftshader` for WebGL — a test-runner
  detail, unrelated to the production server which serves static JS.
- Device pass on iPhone + iPad Safari: touch drafting, Pencil, 3D context loss.
- Migration is additive; run the `.mjs` script before deploy. New deps are
  client-only; server bundle unchanged. Build, then restart `sjcos.service`,
  never the reverse; confirm no other session is mid-deploy.
