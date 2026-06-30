"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Sparkles, FileSpreadsheet, Ruler } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { fmtUsd, unitLabel } from "@/lib/cost-book-units";
import type { CostItem } from "@/lib/cost-book";
import type { FloorplanVersion } from "@/lib/floorplans";
import type { EstimateDetail, EstimateLineView, EstimateStatus } from "@/lib/estimates";
import { createEstimate, deleteEstimate, deleteEstimateLine, suggestEstimate, sendEstimate } from "@/lib/actions/estimates";
import { EstimateLineModal } from "./EstimateLineModal";
import { TakeoffPanel } from "./TakeoffPanel";
import { ContractGenerator } from "./ContractGenerator";

const RAIL_LABEL: Record<string, string> = {
  design_build: "Design-build",
  plans: "Plans-based",
  merged: "Merged",
};
const STATUS_KIND: Record<EstimateStatus, "ghost" | "accent" | "money" | "flag"> = {
  draft: "ghost",
  sent: "accent",
  approved: "money",
  declined: "flag",
};

export function ProjectEstimate({
  slug,
  estimates,
  costItems,
  defaultMarkup,
  floorplans,
}: {
  slug: string;
  estimates: EstimateDetail[];
  costItems: CostItem[];
  defaultMarkup: number;
  floorplans: FloorplanVersion[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<number | null>(estimates[0]?.id ?? null);
  const [showNew, setShowNew] = useState(estimates.length === 0);
  const [takeoff, setTakeoff] = useState(false);
  const [lineModal, setLineModal] = useState<{ mode: "add" | "edit"; line?: EstimateLineView } | null>(null);
  const [suggestion, setSuggestion] = useState<{ lines: { label: string; value: string }[]; total: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const selected = estimates.find((e) => e.id === selectedId) ?? estimates[0] ?? null;

  function create(form: HTMLFormElement) {
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await createEstimate(slug, fd);
      if (res.ok && res.id) {
        setSelectedId(res.id);
        setShowNew(false);
        form.reset();
        router.refresh();
      }
    });
  }

  function removeEstimate(id: number) {
    if (!confirm("Delete this estimate and all its lines?")) return;
    startTransition(async () => {
      await deleteEstimate(slug, id);
      setSelectedId(null);
      router.refresh();
    });
  }

  function removeLine(lineId: number) {
    startTransition(async () => {
      await deleteEstimateLine(lineId, slug);
      router.refresh();
    });
  }

  function send() {
    if (!selected) return;
    setSendError(null);
    startTransition(async () => {
      const res = await sendEstimate(slug, selected.id);
      if (res.ok) router.refresh();
      else setSendError(res.error);
    });
  }

  function runSuggest() {
    if (!selected) return;
    setSuggesting(true);
    startTransition(async () => {
      const res = await suggestEstimate(slug, "");
      if (res.ok) setSuggestion({ lines: res.lines, total: res.total });
      setSuggesting(false);
    });
  }

  const inputCls = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

  // Group the selected estimate's lines by section.
  const sections: { name: string; lines: EstimateLineView[] }[] = [];
  if (selected) {
    const map = new Map<string, EstimateLineView[]>();
    for (const l of selected.lines) {
      if (!map.has(l.section)) map.set(l.section, []);
      map.get(l.section)!.push(l);
    }
    for (const [name, lines] of map) sections.push({ name, lines });
  }

  return (
    <div className="max-w-[860px] space-y-4">
      {/* Estimate selector + new */}
      <div className="flex flex-wrap items-center gap-2">
        {estimates.map((e) => (
          <button
            key={e.id}
            onClick={() => { setSelectedId(e.id); setSuggestion(null); }}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] ${
              selected?.id === e.id ? "border-accent bg-accent-soft text-accent-2" : "border-rule bg-card text-ink-2 hover:bg-paper-2"
            }`}
          >
            <span className="font-semibold">{e.title}</span>
            <span className="font-mono text-[11px]">{fmtUsd(e.total)}</span>
            <Chip kind={STATUS_KIND[e.status]}>{e.status}</Chip>
          </button>
        ))}
        <button
          onClick={() => setShowNew((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          <Plus className="size-3" strokeWidth={2} /> New estimate
        </button>
      </div>

      {showNew && (
        <Card className="p-3.5">
          <form
            onSubmit={(e) => { e.preventDefault(); create(e.currentTarget); }}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Title</span>
              <input name="title" required placeholder="Henderson kitchen — base bid" className={inputCls} />
            </label>
            <label className="flex w-[170px] flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Rail</span>
              <select name="rail" defaultValue="plans" className={inputCls}>
                <option value="plans">Plans-based</option>
                <option value="design_build">Design-build</option>
              </select>
            </label>
            <button type="submit" className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2">
              Create
            </button>
          </form>
        </Card>
      )}

      {!selected ? (
        <Card kind="dashed" className="p-10 text-center">
          <FileSpreadsheet className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
          <div className="mt-2 font-serif text-[16px] font-semibold text-ink-2">No estimate yet</div>
          <div className="mt-1 text-[12px] text-ink-3">Create an estimate, then add lines from your cost book.</div>
        </Card>
      ) : (
        <>
          {/* Header + totals */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif text-[18px] font-semibold text-ink">{selected.title}</h3>
                  <Chip kind="ghost">{RAIL_LABEL[selected.rail]}</Chip>
                  <Chip kind={STATUS_KIND[selected.status]}>{selected.status}</Chip>
                </div>
                <div className="mt-0.5 text-[11px] text-ink-3">Created {selected.createdAtLabel}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[22px] font-semibold text-accent-2">{fmtUsd(selected.total)}</div>
                <div className="text-[11px] text-ink-3">
                  cost {fmtUsd(selected.subtotal)} + markup {fmtUsd(selected.markupTotal)}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setLineModal({ mode: "add" })}
                className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
              >
                <Plus className="size-3" strokeWidth={2} /> Add line
              </button>
              <button
                onClick={() => setTakeoff((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-semibold ${
                  takeoff ? "border-accent bg-accent-soft text-accent-2" : "border-rule bg-card text-ink-2 hover:bg-paper-2"
                }`}
              >
                <Ruler className="size-3" strokeWidth={1.75} /> Takeoff
              </button>
              <button
                onClick={runSuggest}
                disabled={suggesting}
                className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-ai-2 disabled:opacity-60"
              >
                <Sparkles className="size-3" strokeWidth={1.5} /> {suggesting ? "Thinking…" : "Suggest scope"}
              </button>
              {(selected.status === "draft" || selected.status === "declined") && (
                <button
                  onClick={send}
                  className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-accent-2"
                >
                  Send for approval
                </button>
              )}
              {selected.status === "sent" && (
                <span className="text-[11px] font-medium text-accent-2">Awaiting client signature…</span>
              )}
              {selected.status === "approved" && (
                <span className="text-[11px] font-medium text-money">✓ Approved by client</span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => removeEstimate(selected.id)}
                className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2"
              >
                Delete estimate
              </button>
            </div>
            {sendError && <div className="mt-2 text-[12px] text-flag">{sendError}</div>}

            {suggestion && (
              <div className="mt-3 rounded-md border border-ai/40 bg-ai-soft p-3">
                <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ai-2">
                  <Sparkles className="size-3" strokeWidth={1.5} /> Rough scope (advisory · add real lines from your cost book)
                </div>
                <div className="space-y-0.5">
                  {suggestion.lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between text-[12px]">
                      <span className="text-ink-2">{l.label}</span>
                      <span className="font-mono text-ink-3">{l.value}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center justify-between border-t border-ai/30 pt-1 text-[12px] font-semibold">
                    <span className="text-ink">Ballpark</span>
                    <span className="font-mono text-ink">{suggestion.total}</span>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {takeoff && (
            <TakeoffPanel
              estimateId={selected.id}
              slug={slug}
              costItems={costItems}
              floorplans={floorplans}
              onDone={() => setTakeoff(false)}
            />
          )}

          {/* Lines by section */}
          {selected.lines.length === 0 ? (
            <Card kind="dashed" className="p-8 text-center text-[12px] text-ink-3">
              No lines yet — add one from your cost book or free-form.
            </Card>
          ) : (
            sections.map((sec) => (
              <Card key={sec.name} className="overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-rule bg-paper-2 px-4 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{sec.name}</span>
                  <span className="font-mono text-[11px] text-ink-2">
                    {fmtUsd(sec.lines.reduce((s, l) => s + l.extended, 0))}
                  </span>
                </div>
                {sec.lines.map((l, k) => (
                  <div key={l.id} className={`group flex items-center gap-3 px-4 py-2.5 text-[13px] ${k ? "border-t border-rule-soft" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{l.description}</div>
                      <div className="font-mono text-[11px] text-ink-3">
                        {l.qty} {unitLabel(l.unit)} × {fmtUsd(l.unitCost)} · +{l.markup}%
                      </div>
                    </div>
                    <span className="font-mono text-[13px] text-ink">{fmtUsd(l.extended)}</span>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => setLineModal({ mode: "edit", line: l })} title="Edit" className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink">
                        <Pencil className="size-3.5" strokeWidth={1.75} />
                      </button>
                      <button onClick={() => removeLine(l.id)} title="Delete" className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-flag">
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
            ))
          )}

          {selected.lines.length > 0 && (
            <ContractGenerator
              slug={slug}
              estimateId={selected.id}
              total={selected.total}
              schedule={selected.drawSchedule}
            />
          )}
        </>
      )}

      {lineModal && selected && (
        <EstimateLineModal
          estimateId={selected.id}
          slug={slug}
          mode={lineModal.mode}
          line={lineModal.line}
          costItems={costItems}
          defaultMarkup={defaultMarkup}
          onClose={() => setLineModal(null)}
        />
      )}
    </div>
  );
}
