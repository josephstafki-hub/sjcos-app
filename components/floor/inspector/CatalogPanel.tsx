"use client";

// Catalog tab: generic library, catalog placeables, and room templates.
// Clicking a row ARMS it (ctx.view.armed + the matching place tool); the
// canvas places it on click. With an item selected, the swap button replaces
// that item's product instead.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Search, X } from "lucide-react";
import type { DesignerContext } from "../view-state";
import type { ToolId } from "../useDesigner";
import { PLACE_KINDS, fmtIn, type PlaceKind, type Pt } from "@/lib/plan-doc";
import { LIBRARY, ROOM_TEMPLATES, cabinetTag, searchLibrary, type LibraryItem } from "@/lib/plan-library";
import type { PlanOp } from "@/lib/plan-ops";
import type { CatalogPlaceable } from "@/lib/plan-designs";
import { updateMaterialPlacement } from "@/lib/actions/catalog";
import { runAction } from "@/lib/run-action";
import { BTN_GHOST, BTN_PRIMARY, Empty, INPUT_CLS, SectionHeader } from "./fields";

type Source = "library" | "catalog" | "templates";
const KIND_CHIPS: PlaceKind[] = ["base", "wall", "tall", "vanity", "island", "appliance", "plumbing", "furniture", "structure", "generic"];
const CAB = new Set<PlaceKind>(["base", "wall", "tall", "vanity", "island"]);

const TOOL_FOR: Record<PlaceKind, ToolId> = {
  base: "base",
  wall: "wallcab",
  tall: "tall",
  vanity: "base",
  island: "island",
  appliance: "appliance",
  plumbing: "plumbing",
  hvac: "hvac",
  furniture: "furniture",
  structure: "column",
  generic: "filler",
  counter: "counter",
  electrical: "electrical",
  lighting: "electrical",
};

const asKind = (s: string): PlaceKind | null => ((PLACE_KINDS as readonly string[]).includes(s) ? (s as PlaceKind) : null);
const dims = (w: number, d: number, h: number) => `${fmtIn(w, { inchesOnly: true })}×${fmtIn(d, { inchesOnly: true })}×${fmtIn(h, { inchesOnly: true })}`;

function levelCentre(ctx: DesignerContext): Pt {
  const room = ctx.d.doc.rooms.find((r) => r.levelId === ctx.d.levelId && r.polygon.length);
  if (!room) return { x: 60, y: 60 };
  const n = room.polygon.length;
  return { x: room.polygon.reduce((s, p) => s + p.x, 0) / n, y: room.polygon.reduce((s, p) => s + p.y, 0) / n };
}

export function CatalogPanel({ ctx }: { ctx: DesignerContext }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [source, setSource] = useState<Source>("library");
  const [kind, setKind] = useState<PlaceKind | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const ro = ctx.readOnly;

  const selectedItem = useMemo(() => {
    const id = ctx.d.selected[0];
    return id ? ctx.d.doc.items.find((i) => i.id === id) ?? null : null;
  }, [ctx.d.doc.items, ctx.d.selected]);

  const libRows = useMemo(() => (source === "library" ? searchLibrary(q, kind ?? undefined).slice(0, 120) : []), [q, kind, source]);
  const catRows = useMemo(() => {
    if (source !== "catalog") return [];
    const t = q.trim().toLowerCase();
    return ctx.catalog.filter((c) => {
      if (kind && c.placeKind !== kind) return false;
      if (!t) return true;
      return `${c.name} ${c.sku} ${c.supplier} ${c.series} ${c.category}`.toLowerCase().includes(t);
    });
  }, [ctx.catalog, q, kind, source]);

  const armed = ctx.view.armed;
  const armedLib = armed?.libraryKey ? LIBRARY.find((l) => l.key === armed.libraryKey) ?? null : null;
  const armedCat = armed?.catalogId != null ? ctx.catalog.find((c) => c.id === armed.catalogId) ?? null : null;

  const remember = (key: string) => setRecent((r) => [key, ...r.filter((k) => k !== key)].slice(0, 8));

  const armLib = (l: LibraryItem) => {
    ctx.setView({ armed: { libraryKey: l.key } });
    ctx.d.setTool(TOOL_FOR[l.kind]);
    remember(`lib:${l.key}`);
  };
  const armCat = (c: CatalogPlaceable) => {
    const k = asKind(c.placeKind) ?? "generic";
    ctx.setView({ armed: { catalogId: c.id } });
    ctx.d.setTool(TOOL_FOR[k]);
    remember(`cat:${c.id}`);
  };
  const disarm = () => {
    ctx.setView({ armed: null });
    ctx.d.setTool("select");
  };

  const catalogSpec = (c: CatalogPlaceable) => {
    const k = asKind(c.placeKind) ?? "generic";
    return { id: c.id, name: c.name, kind: k, w: c.widthIn ?? 24, d: c.depthIn ?? 24, h: c.heightIn ?? 30, color: c.material?.color };
  };

  const placeAtCentre = () => {
    const at = levelCentre(ctx);
    if (armedLib) ctx.d.apply({ op: "placeItem", levelId: ctx.d.levelId, libraryKey: armedLib.key, at, snapToWall: false });
    else if (armedCat) ctx.d.apply({ op: "placeItem", levelId: ctx.d.levelId, catalog: catalogSpec(armedCat), at, snapToWall: false });
  };

  const swapLib = (l: LibraryItem) => {
    if (!selectedItem) return;
    ctx.d.apply(
      { op: "updateItem", id: selectedItem.id, patch: { libraryKey: l.key, catalogId: null, label: l.label, w: l.w, d: l.d, h: l.h, tag: l.tag, props: { ...selectedItem.props, ...l.props } } },
      { label: `Swap to ${l.label}` },
    );
  };
  const swapCat = (c: CatalogPlaceable) => {
    if (!selectedItem) return;
    const s = catalogSpec(c);
    const tag = CAB.has(s.kind) ? cabinetTag(s.kind, s.w, s.h, selectedItem.props) : selectedItem.tag;
    ctx.d.apply({ op: "updateItem", id: selectedItem.id, patch: { catalogId: c.id, libraryKey: null, label: c.name, w: s.w, d: s.d, h: s.h, tag } }, { label: `Swap to ${c.name}` });
  };

  const insertTemplate = (key: string) => {
    const t = ROOM_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    const walls = ctx.d.doc.walls.filter((w) => w.levelId === ctx.d.levelId);
    const maxX = walls.length ? Math.max(...walls.flatMap((w) => [w.a.x, w.b.x])) : null;
    const minY = walls.length ? Math.min(...walls.flatMap((w) => [w.a.y, w.b.y])) : 0;
    const origin: Pt = maxX == null ? { x: 0, y: 0 } : { x: maxX + 24, y: minY };
    const frag = t.build(ctx.d.levelId, origin, ctx.d.defaults);
    const ops: PlanOp[] = [{ op: "addWalls", walls: frag.walls }];
    for (const o of frag.openings) {
      ops.push({ op: "addOpening", wallId: o.wallId, atIn: o.atIn, kind: o.kind, subtype: o.subtype, widthIn: o.widthIn, heightIn: o.heightIn, sillIn: o.sillIn, hand: o.hand, swing: o.swing, phase: o.phase, tag: o.tag, id: o.id });
    }
    for (const i of frag.items) {
      if (!i.libraryKey) continue;
      ops.push({ op: "placeItem", levelId: ctx.d.levelId, libraryKey: i.libraryKey, at: { x: i.x, y: i.y }, rotDeg: i.rotDeg, snapToWall: false, snapToNeighbors: false, phase: i.phase, id: i.id, overrides: { props: i.props } });
    }
    for (const n of frag.notes ?? []) ops.push({ op: "addNote", levelId: ctx.d.levelId, at: { x: n.x, y: n.y }, text: n.text, kind: n.kind, id: n.id });
    if (ctx.d.apply(ops, { label: `Insert ${t.label}` })) ctx.focus2d({ x: origin.x + t.widthIn / 2, y: origin.y + t.depthIn / 2, levelId: ctx.d.levelId });
  };

  const recentRows = recent
    .map((k) => {
      if (k.startsWith("lib:")) {
        const l = LIBRARY.find((x) => x.key === k.slice(4));
        return l ? { key: k, label: l.label, sub: l.tag, onArm: () => armLib(l) } : null;
      }
      const c = ctx.catalog.find((x) => x.id === Number(k.slice(4)));
      return c ? { key: k, label: c.name, sub: c.sku, onArm: () => armCat(c) } : null;
    })
    .filter((r): r is NonNullable<typeof r> => !!r);

  return (
    <div className="flex flex-col gap-2">
      {(armedLib || armedCat) && (
        <div className="rounded-md border border-accent bg-accent-soft px-2.5 py-2 text-[12px]">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-2">Armed — click the plan to place</div>
          <div className="mt-0.5 font-medium text-ink">{armedLib?.label ?? armedCat?.name}</div>
          <div className="mt-1.5 flex gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={ro} onClick={placeAtCentre}>
              Place at centre
            </button>
            <button type="button" className={BTN_GHOST} onClick={disarm}>
              <X className="size-3" strokeWidth={1.75} /> Disarm
            </button>
          </div>
        </div>
      )}
      {selectedItem && (
        <div className="rounded-md border border-rule bg-paper-2 px-2.5 py-1.5 text-[11.5px] text-ink-2">
          <ArrowLeftRight className="mr-1 inline size-3" strokeWidth={1.75} />
          <b>{selectedItem.tag || selectedItem.label}</b> is selected — use the swap button on a row to replace its product.
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
        <input className={`${INPUT_CLS} pl-7`} placeholder="Search B36, range, toilet…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex overflow-hidden rounded-md border border-rule">
        {(["library", "catalog", "templates"] as Source[]).map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={`flex-1 py-1 text-[11.5px] capitalize ${i ? "border-l border-rule" : ""} ${source === s ? "bg-ink text-paper" : "bg-paper text-ink-2 hover:bg-paper-2"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {source !== "templates" && (
        <div className="flex flex-wrap gap-1">
          {KIND_CHIPS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(kind === k ? null : k)}
              className={`rounded-full border px-2 py-px font-mono text-[9.5px] uppercase tracking-[0.08em] ${kind === k ? "border-ink bg-ink text-paper" : "border-rule text-ink-3 hover:border-ink-4"}`}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {source === "library" && recentRows.length > 0 && !q && (
        <>
          <SectionHeader>Recent</SectionHeader>
          <div className="flex flex-col gap-1">
            {recentRows.map((r) => (
              <button key={r.key} type="button" onClick={r.onArm} className="flex items-center gap-2 rounded-md border border-rule px-2 py-1 text-left text-[12px] hover:border-ink-4">
                <span className="flex-1 truncate text-ink">{r.label}</span>
                <span className="font-mono text-[11px] text-ink-3">{r.sub}</span>
              </button>
            ))}
          </div>
          <SectionHeader>Library</SectionHeader>
        </>
      )}

      {source === "library" && (
        <div className="flex flex-col gap-1">
          {libRows.length === 0 && <Empty>No library items match.</Empty>}
          {libRows.map((l) => (
            <CatalogRow
              key={l.key}
              tag={l.tag}
              label={l.label}
              size={dims(l.w, l.d, l.h)}
              price=""
              armed={armed?.libraryKey === l.key}
              onArm={() => armLib(l)}
              onSwap={selectedItem && !ro ? () => swapLib(l) : undefined}
            />
          ))}
        </div>
      )}

      {source === "catalog" && (
        <div className="flex flex-col gap-1">
          {catRows.length === 0 && <Empty>{ctx.catalog.length ? "No catalog items match." : "No placeable catalog items yet — give a material a size on /catalog."}</Empty>}
          {catRows.map((c) =>
            c.widthIn && c.depthIn && c.heightIn ? (
              <CatalogRow
                key={c.id}
                tag={c.sku || c.category}
                label={c.name}
                size={dims(c.widthIn, c.depthIn, c.heightIn)}
                price={c.price}
                armed={armed?.catalogId === c.id}
                onArm={() => armCat(c)}
                onSwap={selectedItem && !ro ? () => swapCat(c) : undefined}
              />
            ) : (
              <NoSizeRow key={c.id} item={c} onSaved={() => router.refresh()} />
            ),
          )}
        </div>
      )}

      {source === "templates" && (
        <div className="flex flex-col gap-1.5">
          {ROOM_TEMPLATES.map((t) => (
            <div key={t.key} className="rounded-md border border-rule px-2.5 py-2">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="text-[12.5px] font-medium text-ink">{t.label}</div>
                  <div className="font-mono text-[10.5px] text-ink-3">
                    {fmtIn(t.widthIn)} × {fmtIn(t.depthIn)} clear
                  </div>
                </div>
                <button type="button" className={BTN_GHOST} disabled={ro} onClick={() => insertTemplate(t.key)}>
                  Insert here
                </button>
              </div>
              <div className="mt-1 text-[11.5px] leading-snug text-ink-3">{t.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogRow({ tag, label, size, price, armed, onArm, onSwap }: { tag: string; label: string; size: string; price: string; armed: boolean; onArm: () => void; onSwap?: () => void }) {
  return (
    <div className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] ${armed ? "border-ink bg-paper-2" : "border-rule hover:border-ink-4"}`}>
      <button type="button" onClick={onArm} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="w-[52px] flex-none truncate font-mono text-[11px] text-ink">{tag}</span>
        <span className="min-w-0 flex-1 truncate text-ink-2">{label}</span>
        <span className="flex-none font-mono text-[10.5px] text-ink-3">{size}</span>
        {price && <span className="flex-none font-mono text-[10.5px] text-money">{price}</span>}
      </button>
      {onSwap && (
        <button type="button" title="Swap the selected item to this" onClick={onSwap} className="rounded p-0.5 text-ink-3 hover:text-ink">
          <ArrowLeftRight className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function NoSizeRow({ item, onSaved }: { item: CatalogPlaceable; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="rounded-md border border-dashed border-rule px-2 py-1 text-[12px] opacity-80">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ink-2">{item.name}</span>
        <span className="font-mono text-[10px] uppercase text-ink-4">no size</span>
        <button type="button" className="text-[11px] text-accent-2 hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : "Set size"}
        </button>
      </div>
      {open && (
        <form
          className="mt-1.5 grid grid-cols-4 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await runAction(() => updateMaterialPlacement(item.id, fd));
              if (r.ok) {
                setOpen(false);
                onSaved();
              }
            });
          }}
        >
          <input name="width_in" placeholder="W" required className={`${INPUT_CLS} px-1.5 py-1 font-mono text-[11px]`} defaultValue={item.widthIn ?? ""} />
          <input name="depth_in" placeholder="D" required className={`${INPUT_CLS} px-1.5 py-1 font-mono text-[11px]`} defaultValue={item.depthIn ?? ""} />
          <input name="height_in" placeholder="H" required className={`${INPUT_CLS} px-1.5 py-1 font-mono text-[11px]`} defaultValue={item.heightIn ?? ""} />
          <select name="place_kind" className={`${INPUT_CLS} px-1 py-1 text-[11px]`} defaultValue={item.placeKind || "generic"}>
            {PLACE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending} className={`${BTN_PRIMARY} col-span-4`}>
            {pending ? "Saving…" : "Save size"}
          </button>
        </form>
      )}
    </div>
  );
}
