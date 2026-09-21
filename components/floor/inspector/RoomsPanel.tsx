"use client";

// Rooms tab: live room schedule for the current level, the measure list
// behind "Estimate from plan", and the generate-estimate dialog.

import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { DesignerContext } from "../view-state";
import { pointInPolygon, type PlanDoc } from "@/lib/plan-doc";
import { computeMeasures, summarizeMeasures } from "@/lib/plan-measures";
import { generateEstimateFromDesign, type GenerateResult } from "@/lib/actions/plan-estimate";
import { runAction } from "@/lib/run-action";
import { BTN_GHOST, BTN_PRIMARY, Empty, INPUT_CLS, LABEL_CLS, SectionHeader } from "./fields";

const CAB = new Set(["base", "wall", "tall", "vanity", "island"]);

function roomRows(doc: PlanDoc, levelId: string) {
  const rooms = doc.rooms.filter((r) => r.levelId === levelId);
  const items = doc.items.filter((i) => i.levelId === levelId);
  return rooms.map((r) => {
    const inside = items.filter((i) => pointInPolygon({ x: i.x, y: i.y }, r.polygon));
    return {
      room: r,
      cabinets: inside.filter((i) => CAB.has(i.kind)).length,
      appliances: inside.filter((i) => i.kind === "appliance").length,
      fixtures: inside.filter((i) => i.kind === "plumbing").length,
    };
  });
}

export function RoomsPanel({ ctx }: { ctx: DesignerContext }) {
  const { doc, levelId } = ctx.d;
  const ro = ctx.readOnly;
  const rows = useMemo(() => roomRows(doc, levelId), [doc, levelId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [showMeasures, setShowMeasures] = useState(false);
  const [dialog, setDialog] = useState(false);
  const measures = useMemo(() => (showMeasures || dialog ? summarizeMeasures(computeMeasures(doc)) : []), [doc, showMeasures, dialog]);

  const totals = rows.reduce(
    (t, r) => ({ sf: t.sf + r.room.areaSf, lf: t.lf + r.room.perimLf, cab: t.cab + r.cabinets, app: t.app + r.appliances, fix: t.fix + r.fixtures }),
    { sf: 0, lf: 0, cab: 0, app: 0, fix: 0 },
  );
  const selected = ctx.d.selected[0];

  return (
    <div>
      <SectionHeader>Rooms on this level</SectionHeader>
      {rows.length === 0 ? (
        <Empty>No closed rooms yet — draw walls that meet at the corners.</Empty>
      ) : (
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className={`${LABEL_CLS} text-left`}>
              <th className="pb-1 font-medium">Room</th>
              <th className="pb-1 text-right font-medium">sf</th>
              <th className="pb-1 text-right font-medium">lf</th>
              <th className="pb-1 text-right font-medium" title="Cabinets / appliances / fixtures">
                C·A·F
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ room, cabinets, appliances, fixtures }) => (
              <tr
                key={room.id}
                className={`cursor-pointer border-t border-rule-soft align-top hover:bg-paper-2 ${selected === room.id ? "bg-paper-2" : ""}`}
                onClick={() => {
                  ctx.d.select([room.id]);
                  ctx.focus2d({ id: room.id, levelId });
                }}
              >
                <td className="py-1 pr-1">
                  {editing === room.id ? (
                    <input
                      autoFocus
                      className={`${INPUT_CLS} px-1.5 py-0.5 text-[12px]`}
                      defaultValue={room.name}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== room.name) ctx.d.apply({ op: "setRoom", id: room.id, patch: { name, pinned: true } });
                        setEditing(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <div
                      className="font-medium text-ink"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (!ro) setEditing(room.id);
                      }}
                    >
                      {room.name || "Room"}
                    </div>
                  )}
                  <div className="truncate text-[10.5px] text-ink-3">
                    {room.ceilingIn ? `${room.ceilingIn}" clg` : "level clg"}
                    {room.floor ? ` · ${room.floor.label}` : ""}
                  </div>
                </td>
                <td className="py-1 text-right font-mono text-ink">{Math.round(room.areaSf)}</td>
                <td className="py-1 text-right font-mono text-ink-2">{room.perimLf.toFixed(0)}</td>
                <td className="py-1 text-right font-mono text-ink-2">
                  {cabinets}·{appliances}·{fixtures}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-rule text-ink">
              <td className="pt-1 font-medium">{rows.length} rooms</td>
              <td className="pt-1 text-right font-mono">{Math.round(totals.sf)}</td>
              <td className="pt-1 text-right font-mono">{totals.lf.toFixed(0)}</td>
              <td className="pt-1 text-right font-mono">
                {totals.cab}·{totals.app}·{totals.fix}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
      {!ro && rows.length > 0 && <div className="mt-1 text-[10.5px] text-ink-4">Double-click a name to rename.</div>}

      <button type="button" className="mt-4 flex w-full items-center gap-1 text-left" onClick={() => setShowMeasures((s) => !s)}>
        {showMeasures ? <ChevronDown className="size-3.5 text-ink-3" strokeWidth={1.75} /> : <ChevronRight className="size-3.5 text-ink-3" strokeWidth={1.75} />}
        <span className={LABEL_CLS}>Measures (whole design)</span>
      </button>
      {showMeasures && (
        <div className="mt-1.5">
          {measures.length === 0 ? (
            <div className="text-[12px] text-ink-3">Nothing measurable yet.</div>
          ) : (
            <table className="w-full text-[11.5px]">
              <tbody>
                {measures.map((m) => (
                  <tr key={m.key} className="border-t border-rule-soft">
                    <td className="py-0.5 pr-2 text-ink-2">{m.label}</td>
                    <td className="py-0.5 text-right font-mono text-ink">
                      {Number.isInteger(m.qty) ? m.qty : m.qty.toFixed(1)} {m.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="mt-3">
        <button type="button" className={BTN_PRIMARY} disabled={ro} onClick={() => setDialog(true)}>
          Generate estimate
        </button>
      </div>
      {dialog && <EstimateDialog ctx={ctx} onClose={() => setDialog(false)} />}
    </div>
  );
}

function EstimateDialog({ ctx, onClose }: { ctx: DesignerContext; onClose: () => void }) {
  const [targetId, setTargetId] = useState<string>(ctx.estimateTargets[0] ? String(ctx.estimateTargets[0].id) : "new");
  const [title, setTitle] = useState(`${ctx.design.name} — from plan`);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<GenerateResult | null>(null);

  const go = () =>
    start(async () => {
      const target = targetId === "new" ? { newTitle: title.trim() || ctx.design.name } : { estimateId: Number(targetId) };
      const r = await runAction(() => generateEstimateFromDesign(ctx.design.id, target));
      if (r.ok && "result" in r) setResult(r.result);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">Generate estimate from plan</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4 text-[13px]">
          {!result ? (
            <>
              <label className="block">
                <div className={`mb-0.5 ${LABEL_CLS}`}>Target</div>
                <select className={INPUT_CLS} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="new">New estimate…</option>
                  {ctx.estimateTargets.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.title} · {t.status} · ${Math.round(t.total).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              {targetId === "new" && (
                <label className="block">
                  <div className={`mb-0.5 ${LABEL_CLS}`}>Title</div>
                  <input className={INPUT_CLS} value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
              )}
              <p className="text-[12px] leading-relaxed text-ink-3">
                Plan-generated lines land in “Demo / New / Products — from plan” sections. Previous plan lines are replaced; hand-added lines are left alone.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" className={BTN_GHOST} onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={go}>
                  {pending ? "Generating…" : "Generate"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-md border border-money bg-money-soft px-3 py-2 text-money">
                {result.linesAdded} line{result.linesAdded === 1 ? "" : "s"} written to{" "}
                <a className="underline" href={`/estimates/${result.estimateId}`}>
                  estimate #{result.estimateId}
                </a>
                .
              </div>
              {(result.delta.added.length > 0 || result.delta.removed.length > 0) && (
                <div>
                  <div className={LABEL_CLS}>Changes</div>
                  <ul className="mt-1 text-[12px]">
                    {result.delta.added.map((s) => (
                      <li key={`+${s}`} className="text-money">
                        + {s}
                      </li>
                    ))}
                    {result.delta.removed.map((s) => (
                      <li key={`-${s}`} className="text-flag">
                        − {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.unmapped.length > 0 && (
                <div>
                  <div className={LABEL_CLS}>
                    Unmapped measures ({result.unmapped.length}) —{" "}
                    <a className="text-accent-2 underline" href="/cost-book">
                      set plan rules
                    </a>
                  </div>
                  <ul className="mt-1 text-[12px] text-ink-2">
                    {result.unmapped.map((u) => (
                      <li key={`${u.key}:${u.materialTag}`}>
                        {u.label}
                        {u.materialTag ? ` (${u.materialTag})` : ""} — {u.qty} {u.unit}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.unpriced.length > 0 && (
                <div>
                  <div className={LABEL_CLS}>Unpriced products ({result.unpriced.length})</div>
                  <ul className="mt-1 text-[12px] text-ink-2">
                    {result.unpriced.map((u) => (
                      <li key={`${u.tag}:${u.label}`}>
                        {u.tag ? `${u.tag} · ` : ""}
                        {u.label} × {u.qty}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end">
                <button type="button" className={BTN_PRIMARY} onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
