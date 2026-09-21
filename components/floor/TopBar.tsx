"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Undo2, Redo2, ChevronDown, Printer, Share2, Layers, AlertTriangle, MoreHorizontal, Check, Grid3x3, Magnet,
} from "lucide-react";
import { runAction } from "@/lib/run-action";
import { runChecks } from "@/lib/plan-checks";
import { renamePlanDesign, duplicatePlanDesign, deletePlanDesign, savePlanAsTemplate } from "@/lib/actions/plan-designs";
import type { DesignerContext, ViewMode } from "./view-state";
import { ALL_LAYERS } from "./view-state";

const MODES: { id: ViewMode; label: string; key: string }[] = [
  { id: "plan", label: "Plan", key: "1" },
  { id: "3d", label: "3D", key: "2" },
  { id: "elevation", label: "Elevation", key: "3" },
  { id: "split", label: "Split", key: "4" },
];

const SNAPS = [0.25, 0.5, 1, 2, 4, 12];
const ANGLES: (0 | 15 | 45 | 90)[] = [0, 15, 45, 90];

/** Top bar: view switcher, level, undo/redo with history, save state, snap,
 *  layers, checks badge, print/publish shortcuts, design menu. */
export function TopBar({
  ctx,
  onFit,
  onPrint,
}: {
  ctx: DesignerContext;
  onFit: () => void;
  onPrint: () => void;
}) {
  const router = useRouter();
  const { d, view, setView, design } = ctx;
  const [menu, setMenu] = useState<null | "history" | "snap" | "layers" | "design" | "level">(null);
  const warnings = runChecks(d.doc).filter((c) => c.severity === "warn").length;
  const levels = d.doc.levels;
  const level = levels.find((l) => l.id === d.levelId) ?? levels[0];

  const close = () => setMenu(null);
  const btn = "inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11.5px] font-medium text-ink-2 hover:bg-paper-2 disabled:opacity-40";

  return (
    <div className="relative flex flex-none flex-wrap items-center gap-1.5 border-b border-rule bg-paper px-3 py-1.5">
      {/* View switcher */}
      <div className="flex overflow-hidden rounded-md border border-rule">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setView({ mode: m.id })}
            title={`${m.label} (${m.key})`}
            className={[
              "px-2.5 py-1 text-[11.5px] font-semibold",
              view.mode === m.id ? "bg-ink text-paper" : "bg-card text-ink-2 hover:bg-paper-2",
            ].join(" ")}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Level */}
      <div className="relative">
        <button className={btn} onClick={() => setMenu(menu === "level" ? null : "level")}>
          {level?.name ?? "Level"}
          <ChevronDown className="size-3" />
        </button>
        {menu === "level" && (
          <Menu onClose={close}>
            {levels.map((l) => (
              <MenuItem key={l.id} active={l.id === d.levelId} onClick={() => { d.setLevelId(l.id); close(); }}>
                {l.name} <span className="ml-1 font-mono text-[9px] text-ink-4">{l.ceilingIn}&quot; clg</span>
              </MenuItem>
            ))}
            <div className="my-1 border-t border-rule" />
            <MenuItem
              onClick={() => {
                const name = window.prompt("Level name", `Level ${levels.length + 1}`);
                if (name) d.apply({ op: "addLevel", name, copyWallsFrom: d.levelId });
                close();
              }}
            >
              + Level (copies this level&apos;s walls)
            </MenuItem>
          </Menu>
        )}
      </div>

      {/* Undo / redo */}
      <div className="flex items-center gap-0.5">
        <button className={btn} onClick={d.undo} disabled={!d.canUndo} title="Undo (⌘Z)">
          <Undo2 className="size-3.5" />
        </button>
        <button className={btn} onClick={d.redo} disabled={!d.canRedo} title="Redo (⇧⌘Z)">
          <Redo2 className="size-3.5" />
        </button>
        <div className="relative">
          <button className={btn} onClick={() => setMenu(menu === "history" ? null : "history")} title="History">
            <ChevronDown className="size-3" />
          </button>
          {menu === "history" && (
            <Menu onClose={close} wide>
              {[...d.history].reverse().slice(0, 30).map((h) => (
                <MenuItem key={h.index} onClick={() => { d.jumpTo(h.index); close(); }} active={h.index === d.history.length - 1}>
                  <span className="font-mono text-[9px] text-ink-4">{h.index}</span> {h.label}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>
      </div>

      <SaveBadge ctx={ctx} />

      <div className="flex-1" />

      {/* Snap */}
      <div className="relative">
        <button className={btn} onClick={() => setMenu(menu === "snap" ? null : "snap")} title="Snap settings">
          <Magnet className="size-3.5" />
          {view.snapOn ? `${d.doc.settings.snapIn}"` : "off"}
        </button>
        {menu === "snap" && (
          <Menu onClose={close}>
            <MenuItem onClick={() => setView({ snapOn: !view.snapOn })} active={view.snapOn}>
              Snapping {view.snapOn ? "on" : "off"}
            </MenuItem>
            <div className="px-2 py-1 font-mono text-[9px] uppercase text-ink-4">Grid</div>
            {SNAPS.map((s) => (
              <MenuItem key={s} active={d.doc.settings.snapIn === s} onClick={() => d.apply({ op: "setSettings", patch: { snapIn: s } }, { transient: true })}>
                {s}&quot;
              </MenuItem>
            ))}
            <div className="px-2 py-1 font-mono text-[9px] uppercase text-ink-4">Angle</div>
            {ANGLES.map((a) => (
              <MenuItem key={a} active={d.doc.settings.angleSnap === a} onClick={() => d.apply({ op: "setSettings", patch: { angleSnap: a } }, { transient: true })}>
                {a === 0 ? "free" : `${a}°`}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>

      <button className={btn} onClick={() => setView({ showGrid: !view.showGrid })} title="Grid" aria-pressed={view.showGrid}>
        <Grid3x3 className={`size-3.5 ${view.showGrid ? "" : "opacity-40"}`} />
      </button>

      <button className={btn} onClick={onFit} title="Zoom to fit (F)">
        Fit
      </button>

      {/* Layers */}
      <div className="relative">
        <button className={btn} onClick={() => setMenu(menu === "layers" ? null : "layers")} title="Layers">
          <Layers className="size-3.5" />
          {view.layers.size < ALL_LAYERS.length ? `${view.layers.size}/${ALL_LAYERS.length}` : "Layers"}
        </button>
        {menu === "layers" && (
          <Menu onClose={close} wide>
            <div className="grid grid-cols-2 gap-x-2">
              {ALL_LAYERS.map((l) => (
                <label key={l} className="flex items-center gap-1.5 px-2 py-0.5 text-[11.5px] text-ink hover:bg-paper-2">
                  <input
                    type="checkbox"
                    checked={view.layers.has(l)}
                    onChange={(e) =>
                      setView((v) => {
                        const next = new Set(v.layers);
                        if (e.target.checked) next.add(l);
                        else next.delete(l);
                        return { layers: next };
                      })
                    }
                  />
                  {l}
                </label>
              ))}
            </div>
            <div className="my-1 border-t border-rule" />
            <div className="flex gap-1 px-2 py-1">
              {(["all", "existing", "demo", "new"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setView({ phase: p })}
                  className={[
                    "rounded-full border px-2 py-0.5 text-[10.5px] capitalize",
                    view.phase === p ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink-2",
                  ].join(" ")}
                >
                  {p}
                </button>
              ))}
            </div>
          </Menu>
        )}
      </div>

      {/* Checks */}
      <button
        className={`${btn} ${warnings ? "border-flag/40 text-flag" : ""}`}
        onClick={() => setView({ panel: "checks" })}
        title="Checks"
      >
        <AlertTriangle className="size-3.5" />
        {warnings}
      </button>

      <button className={btn} onClick={onPrint} title="Print / drawing set">
        <Printer className="size-3.5" />
        Print
      </button>
      <button className={`${btn} border-ink bg-ink text-paper hover:bg-[#232a1e]`} onClick={() => setView({ panel: "versions" })} title="Versions, publish, sign">
        <Share2 className="size-3.5" />
        Publish
      </button>

      {/* Design menu */}
      <div className="relative">
        <button className={btn} onClick={() => setMenu(menu === "design" ? null : "design")} title="Design menu">
          <MoreHorizontal className="size-3.5" />
        </button>
        {menu === "design" && (
          <Menu onClose={close} align="right">
            <MenuItem
              onClick={() => {
                const name = window.prompt("Design name", design.name);
                if (name && name !== design.name) void runAction(() => renamePlanDesign(design.id, name)).then(() => router.refresh());
                close();
              }}
            >
              Rename…
            </MenuItem>
            <MenuItem
              onClick={() => {
                void runAction(() => duplicatePlanDesign(design.id)).then((r) => {
                  if (r.ok && "id" in r) router.push(`/floor/${r.id}`);
                });
                close();
              }}
            >
              Duplicate
            </MenuItem>
            <MenuItem
              onClick={() => {
                const name = window.prompt("Template name", `${design.name} template`);
                if (name) void runAction(() => savePlanAsTemplate(design.id, name)).then(() => router.refresh());
                close();
              }}
            >
              Save as template…
            </MenuItem>
            <MenuItem onClick={() => { setView({ panel: "layers" }); close(); }}>Underlay & levels…</MenuItem>
            <div className="my-1 border-t border-rule" />
            {design.projectSlug && (
              <MenuItem asLink href={`/projects/${design.projectSlug}?tab=Floor`}>Open project</MenuItem>
            )}
            {design.leadSlug && <MenuItem asLink href={`/leads/${design.leadSlug}`}>Open lead</MenuItem>}
            <MenuItem asLink href="/floor">All designs</MenuItem>
            <div className="my-1 border-t border-rule" />
            {ctx.isOwner && (
              <MenuItem
                danger
                onClick={() => {
                  if (confirm(`Delete "${design.name}"? Published versions stay on the Floor tab.`)) {
                    void runAction(() => deletePlanDesign(design.id)).then(() =>
                      router.push(design.projectSlug ? `/projects/${design.projectSlug}?tab=Floor` : design.leadSlug ? `/leads/${design.leadSlug}` : "/floor"),
                    );
                  }
                  close();
                }}
              >
                Delete design
              </MenuItem>
            )}
          </Menu>
        )}
      </div>
    </div>
  );
}

function SaveBadge({ ctx }: { ctx: DesignerContext }) {
  const s = ctx.d.save;
  if (s.kind === "conflict") {
    return (
      <div className="flex items-center gap-1 rounded-md border border-flag/40 bg-flag-soft px-2 py-0.5 text-[11px] text-flag">
        Changed elsewhere (rev {s.rev})
        <button className="underline" onClick={ctx.d.reloadFromConflict}>Reload</button>
        <button className="underline" onClick={ctx.d.keepMineOverConflict}>Keep mine</button>
      </div>
    );
  }
  const text = s.kind === "saved" ? "Saved" : s.kind === "dirty" ? "Editing…" : s.kind === "saving" ? "Saving…" : s.kind === "offline" ? "Offline" : "Save failed";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${s.kind === "saved" ? "text-money" : s.kind === "error" ? "text-flag" : "text-ink-3"}`}>
      {s.kind === "saved" && <Check className="size-3" />}
      {text}
      {ctx.readOnly && <span className="ml-1 rounded bg-paper-3 px-1 font-mono text-[9px] text-ink-3">READ ONLY</span>}
    </span>
  );
}

function Menu({ children, onClose, wide, align }: { children: React.ReactNode; onClose: () => void; wide?: boolean; align?: "right" }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className={[
          "absolute top-full z-40 mt-1 flex flex-col rounded-md border border-rule bg-card p-1 shadow-xl",
          wide ? "min-w-[260px]" : "min-w-[170px]",
          align === "right" ? "right-0" : "left-0",
        ].join(" ")}
      >
        {children}
      </div>
    </>
  );
}

function MenuItem({
  children,
  onClick,
  active,
  danger,
  asLink,
  href,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  asLink?: boolean;
  href?: string;
}) {
  const cls = [
    "rounded px-2 py-1 text-left text-[11.5px]",
    active ? "bg-ink text-paper" : danger ? "text-flag hover:bg-flag-soft" : "text-ink hover:bg-paper-2",
  ].join(" ");
  if (asLink && href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
