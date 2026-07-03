"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, FileSignature, Plus, Trash2, ChevronDown, Check, Circle } from "lucide-react";
import { Card } from "@/components/ui";
import { fmtUsd } from "@/lib/cost-book-units";
import type { ApprovalGateBase } from "@/lib/approval-gate-types";
import { type DrawLine, defaultDrawSchedule, sumPercent, DRAW_TRIGGER_STATUSES } from "@/lib/draw-schedule";
import { generateContract, generateSOW, updateDrawSchedule } from "@/lib/actions/documents";

/** Draw-schedule editor + contract/SOW generation for an estimate. The PDF is
 *  sent to the client to e-sign; an editable .docx is saved to the project Files
 *  tab. Lives in the Estimate tab under the selected estimate. */
export function ContractGenerator({
  slug,
  estimateId,
  total,
  schedule,
  gate,
  estimateApproved,
}: {
  slug: string;
  estimateId: number;
  total: number; // cents
  schedule: DrawLine[] | null;
  gate: ApprovalGateBase;
  estimateApproved: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DrawLine[]>(schedule ?? defaultDrawSchedule(10));
  const [pending, startTransition] = useTransition();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [override, setOverride] = useState(false);

  const gateItems = [
    { label: "Design sign-off", done: gate.design, detail: gate.designDetail },
    { label: "Selections approved", done: gate.selections, detail: gate.selectionsDetail },
    {
      label: "Estimate approved",
      done: estimateApproved,
      detail: estimateApproved ? "Client-approved" : "Send this estimate for approval and get it signed",
    },
  ];
  const gateReady = gateItems.every((g) => g.done);
  const contractBlocked = !gateReady && !override;

  const totalPct = sumPercent(lines);
  const pctOk = Math.abs(totalPct - 100) <= 0.5;

  function setLine(i: number, patch: Partial<DrawLine>) {
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
    setSavedMsg(null);
  }
  function addLine() {
    setLines((ls) => [...ls, { label: "New milestone", percent: 0 }]);
    setSavedMsg(null);
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, k) => k !== i));
    setSavedMsg(null);
  }

  function saveSchedule() {
    setError(null);
    setSavedMsg(null);
    startTransition(async () => {
      const res = await updateDrawSchedule(slug, estimateId, lines);
      if (res.ok) {
        setSavedMsg("Schedule saved.");
        router.refresh();
      } else setError(res.error);
    });
  }

  function generate(kind: "contract" | "sow") {
    setError(null);
    setGenMsg(null);
    startTransition(async () => {
      const res = kind === "contract" ? await generateContract(slug, estimateId, override) : await generateSOW(slug, estimateId);
      if (res.ok) {
        setGenMsg(
          kind === "contract"
            ? "Contract generated — PDF sent to the client to sign; editable .docx saved to Files."
            : "Scope of Work generated — PDF sent to the client to sign; editable .docx saved to Files.",
        );
        router.refresh();
      } else setError(res.error);
    });
  }

  const inputCls = "rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent";

  return (
    <Card className="overflow-hidden p-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2.5 text-left"
      >
        <FileSignature className="size-4 text-accent" strokeWidth={1.75} />
        <span className="flex-1 font-serif text-[14px] font-semibold text-ink">Contract &amp; documents</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Generate · e-sign</span>
        <ChevronDown className={`size-4 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="space-y-4 p-4">
          {/* Draw schedule editor */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Payment / draw schedule</span>
              <span className={`font-mono text-[11px] ${pctOk ? "text-money" : "text-flag"}`}>{totalPct}% of total</span>
            </div>
            <div className="space-y-1.5">
              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    value={l.label}
                    onChange={(e) => setLine(i, { label: e.target.value })}
                    className={`${inputCls} min-w-[140px] flex-1`}
                    placeholder="Milestone"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={l.percent}
                      onChange={(e) => setLine(i, { percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                      className={`${inputCls} w-16 text-right`}
                    />
                    <span className="text-[12px] text-ink-3">%</span>
                  </div>
                  <span className="w-[84px] text-right font-mono text-[12px] text-ink-2">
                    {fmtUsd(Math.round((total * l.percent) / 100))}
                  </span>
                  <select
                    value={l.triggerStatus ?? ""}
                    onChange={(e) => setLine(i, { triggerStatus: e.target.value })}
                    title="Auto-bill this draw when the project reaches this stage"
                    className={`${inputCls} w-[150px]`}
                  >
                    {DRAW_TRIGGER_STATUSES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {l.billed && <span className="font-mono text-[10px] text-money">billed</span>}
                  <button onClick={() => removeLine(i)} title="Remove" className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-flag">
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={addLine} className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2">
                <Plus className="size-3" strokeWidth={2} /> Add milestone
              </button>
              <button
                onClick={saveSchedule}
                disabled={pending}
                className="rounded-md border border-ink bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save schedule"}
              </button>
              {savedMsg && <span className="text-[11px] text-money">{savedMsg}</span>}
            </div>
          </div>

          {/* Pre-con approval gate */}
          <div className="border-t border-rule-soft pt-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Approval gate</span>
              <span className={`font-mono text-[10px] ${gateReady ? "text-money" : "text-ink-3"}`}>
                {gateReady ? "ready" : "sign-offs needed before contract"}
              </span>
            </div>
            <div className="space-y-1">
              {gateItems.map((g) => (
                <div key={g.label} className="flex items-start gap-2">
                  {g.done ? (
                    <Check className="mt-0.5 size-3.5 flex-none text-money" strokeWidth={2.25} />
                  ) : (
                    <Circle className="mt-0.5 size-3.5 flex-none text-ink-4" strokeWidth={1.75} />
                  )}
                  <div className="min-w-0">
                    <span className={`text-[12px] ${g.done ? "text-ink-2" : "text-ink"}`}>{g.label}</span>
                    <span className="ml-1.5 text-[11px] text-ink-3">— {g.detail}</span>
                  </div>
                </div>
              ))}
            </div>
            {!gateReady && (
              <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                Override the gate and generate the contract anyway
              </label>
            )}
          </div>

          {/* Generate */}
          <div className="border-t border-rule-soft pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => generate("contract")}
                disabled={pending || contractBlocked}
                title={contractBlocked ? "Complete the approval gate (or override it) first" : undefined}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
              >
                <FileSignature className="size-3.5" strokeWidth={1.75} /> Generate contract
              </button>
              <button
                onClick={() => generate("sow")}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-card px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-paper-2 disabled:opacity-60"
              >
                <FileText className="size-3.5" strokeWidth={1.75} /> Generate Scope of Work
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">
              The PDF is sent to the client to e-sign in their portal; an editable .docx is saved to the Files tab.
              The Scope of Work narrative is drafted by Qwen from your line items.
            </p>
            {genMsg && <div className="mt-1.5 text-[12px] text-money">{genMsg}</div>}
            {error && <div className="mt-1.5 text-[12px] text-flag">{error}</div>}
          </div>
        </div>
      )}
    </Card>
  );
}
