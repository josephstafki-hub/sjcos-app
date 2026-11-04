"use client";

import { FinancialTable } from "./FinancialTable";
import { ActionMenu } from "./ActionMenu";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Sparkles, FileSpreadsheet, ListPlus, GitMerge, ChevronLeft } from "lucide-react";
import { Button, Card, Chip, TableWrapper, TableHead, TableBody, TableHeader, TableRow, TableCell, TablePrimaryCell, TableGroupRow, TableActions } from "@/components/ui";
import { fmtUsd, unitLabel } from "@/lib/cost-book-units";
import type { CostItem } from "@/lib/cost-book";
import type { FloorplanVersion } from "@/lib/floorplans";
import type { ApprovalGateBase } from "@/lib/approval-gate-types";
import type { EstimateDetail, EstimateLineView, EstimateStatus } from "@/lib/estimates";
import type { TemplateManifest } from "@/lib/doc-templates/registry";
import { ESTIMATE_KIND_HELP, WHERE, describeScopeChangePath, type EstimateKind, type ScopeChangeContext } from "@/lib/estimate-kinds";
import { createEstimate, deleteEstimate, deleteEstimateLine, suggestEstimate, sendEstimate, mergeEstimates } from "@/lib/actions/estimates";
import { runAction } from "@/lib/run-action";
import { EstimateLineModal } from "./EstimateLineModal";
import { BulkAddPanel } from "./BulkAddPanel";
import { ContractGenerator } from "./ContractGenerator";
import { DocTypePanel, type DocDraftItem } from "./DocTypePanel";
import { TabLink } from "./TabNav";

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

/** The estimate editor, mounted twice on the project page — once per kind:
 *  kind 'formal' under Documents › Formal Estimate (the job's formal estimate;
 *  the client's PDF of it sits under each estimate — `pdfs` — and is printed
 *  from its current lines) and kind 'precon_change' under Money › Pre-con
 *  changes (client additions or changes priced before the contract is signed —
 *  after the contract they are change orders). Each mount lists only its own
 *  kind. docs/estimates-and-change-orders.md */
export function ProjectEstimate({
  slug,
  kind,
  estimates,
  costItems,
  defaultMarkup,
  floorplans,
  approvalGate,
  phase,
  pdfs,
}: {
  slug: string;
  kind: EstimateKind;
  estimates: EstimateDetail[];
  costItems: CostItem[];
  defaultMarkup: number;
  floorplans: FloorplanVersion[];
  approvalGate: ApprovalGateBase;
  phase: ScopeChangeContext;
  /** Formal only: the job's Formal Estimate PDF copies, shown under the estimate each was made from. */
  pdfs?: { manifest: TemplateManifest; drafts: DocDraftItem[] };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const isFormal = kind === "formal";
  const mine = estimates.filter((e) => e.kind === kind);
  const banner = describeScopeChangePath(phase);
  // A pre-con change can only be created before the contract is signed.
  const canCreate = isFormal || phase.path === "precon_estimate";
  const noun = isFormal ? "formal estimate" : "pre-con change";
  // null = the list view (every estimate as a row); an id = that estimate's
  // generator is open. Mirrors DocTypePanel — you land on the list and click
  // Edit to open one, then close back to the list.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSel, setMergeSel] = useState<Set<number>>(new Set());
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [bulkAdd, setBulkAdd] = useState(false);
  const [lineModal, setLineModal] = useState<{ mode: "add" | "edit"; line?: EstimateLineView } | null>(null);
  const [suggestion, setSuggestion] = useState<{ lines: { label: string; value: string }[]; total: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const selected = editingId != null ? mine.find((e) => e.id === editingId) ?? null : null;

  const isLocked = (estimate: EstimateDetail) => !!estimate.lockState || estimate.status === "sent" || estimate.status === "approved";
  const locked = !!selected && isLocked(selected);

  // The client's PDF of one formal estimate — made from its lines, updated from them.
  const clientPdf = (estimateId: number) =>
    isFormal && pdfs ? (
      <DocTypePanel
        slug={slug}
        templateKey="estimate_doc"
        manifest={pdfs.manifest}
        drafts={pdfs.drafts.filter((d) => d.estimate_id === estimateId)}
        estimateId={estimateId}
      />
    ) : null;

  function create(form: HTMLFormElement) {
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await runAction(() => createEstimate(slug, fd), { fallback: `Couldn't create the ${noun}.` });
      if (res.ok && res.id) {
        setEditingId(res.id);
        setShowNew(false);
        form.reset();
        router.refresh();
      }
    });
  }

  function toggleMergePick(id: number) {
    setMergeError(null);
    setMergeSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runMerge(form: HTMLFormElement) {
    const title = String(new FormData(form).get("title") ?? "").trim();
    const ids = Array.from(mergeSel);
    if (ids.length < 2) {
      setMergeError("Pick at least two estimates to merge.");
      return;
    }
    setMergeError(null);
    setMerging(true);
    startTransition(async () => {
      const res = await runAction(() => mergeEstimates(slug, ids, title), { fallback: "Couldn't merge the estimates." });
      setMerging(false);
      if (res.ok && res.id) {
        setEditingId(res.id);
        setShowMerge(false);
        setMergeSel(new Set());
        form.reset();
        router.refresh();
      } else if (!res.ok) {
        setMergeError(res.error);
      }
    });
  }

  function removeEstimate(id: number) {
    if (!confirm(`Delete this ${noun} and all its lines?`)) return;
    startTransition(async () => {
      await runAction(() => deleteEstimate(slug, id), { fallback: `Couldn't delete the ${noun}.` });
      setEditingId(null);
      router.refresh();
    });
  }

  function removeLine(lineId: number) {
    startTransition(async () => {
      await runAction(() => deleteEstimateLine(lineId, slug), { fallback: "Couldn't delete the line." });
      router.refresh();
    });
  }

  function send() {
    if (!selected) return;
    setSendError(null);
    startTransition(async () => {
      const res = await runAction(() => sendEstimate(slug, selected.id), { fallback: `Couldn't send the ${noun}.` });
      if (res.ok) router.refresh();
      else setSendError(res.error);
    });
  }

  function runSuggest() {
    if (!selected) return;
    setSuggesting(true);
    startTransition(async () => {
      const res = await runAction(() => suggestEstimate(slug, ""), { fallback: "Couldn't suggest a scope." });
      if (res.ok) setSuggestion({ lines: res.lines, total: res.total });
      setSuggesting(false);
    });
  }

  const inputCls = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent";
  const linkCls = "font-semibold text-accent-2 underline-offset-2 hover:underline";

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
      {/* ── List view: every estimate of this kind as a row; Edit opens the generator ── */}
      {!selected && (
      <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-heading font-semibold text-ink">{isFormal ? "Formal estimate" : "Pre-con changes"}</h3>
          <div className="mt-0.5 text-label font-medium text-ink-3">
            {mine.length} {isFormal ? "estimate" : "change"}{mine.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isFormal && mine.length >= 2 && (
            <button
              onClick={() => {
                setShowMerge((v) => !v);
                setShowNew(false);
                setMergeError(null);
                setMergeSel(new Set());
              }}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-label font-semibold ${
                showMerge ? "border-accent bg-accent-soft text-accent-2" : "border-rule bg-card text-ink-2 hover:bg-paper-2"
              }`}
            >
              <GitMerge className="size-3" strokeWidth={1.75} /> Merge
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => { setShowNew((v) => !v); setShowMerge(false); }}
              className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover"
            >
              <Plus className="size-3" strokeWidth={2} /> New {noun}
            </button>
          )}
        </div>
      </div>

      {/* Where things go — the same sentence the agents are told. */}
      {isFormal ? (
        <Card className="border-rule bg-paper-2 p-3.5 text-label text-ink-2">
          {ESTIMATE_KIND_HELP.formal}{" "}
          Change the lines with Edit. The client&rsquo;s PDF sits under the estimate and is printed from its lines;
          after the lines change, click Update PDF. Client additions or changes before the contract is signed go
          under{" "}
          <TabLink tab="Money" section="Pre-con changes" className={linkCls}>
            {WHERE.preconChanges}
          </TabLink>
          .
        </Card>
      ) : (
        <Card className={`p-3.5 ${canCreate ? "border-accent/40 bg-accent-soft" : "border-rule bg-paper-2"}`}>
          <div className={`text-label font-medium ${canCreate ? "text-accent-2" : "text-ink-3"}`}>
            {banner.headline}
          </div>
          <div className="mt-1 text-label text-ink-2">
            {canCreate ? (
              banner.detail
            ) : (
              <>
                Client changes are change orders now (
                <TabLink tab="Money" section="Change orders" className={linkCls}>
                  {WHERE.changeOrders}
                </TabLink>
                ); nothing new is priced here.
              </>
            )}
          </div>
        </Card>
      )}

      {showMerge && (
        <Card className="p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-label font-medium text-ink-3">
            <GitMerge className="size-3" strokeWidth={1.75} /> Merge estimates
          </div>
          <div className="mb-3 text-label text-ink-3">
            Pick two or more estimates (e.g. a design-build and a plans-based bid). Their lines are combined into a
            new merged estimate, grouped by section. The originals are kept.
          </div>
          <form onSubmit={(e) => { e.preventDefault(); runMerge(e.currentTarget); }}>
            <div className="space-y-1.5">
              {mine.map((e) => (
                <label
                  key={e.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-1.5 ${
                    mergeSel.has(e.id) ? "border-accent bg-accent-soft" : "border-rule bg-card hover:bg-paper-2"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={mergeSel.has(e.id)}
                    onChange={() => toggleMergePick(e.id)}
                    className="accent-accent"
                  />
                  <span className="flex-1 text-body font-medium text-ink">{e.title}</span>
                  <Chip kind="ghost">{RAIL_LABEL[e.rail]}</Chip>
                  <span className="tabular-nums text-label text-ink-2">{fmtUsd(e.total)}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-label font-medium text-ink-3">Merged title</span>
                <input name="title" placeholder="Combined bid" className={inputCls} />
              </label>
              <button
                type="submit"
                disabled={merging || mergeSel.size < 2}
                className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent px-3 py-1.5 text-label font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
              >
                <GitMerge className="size-3" strokeWidth={1.75} /> {merging ? "Merging…" : `Merge ${mergeSel.size || ""} estimates`.trim()}
              </button>
            </div>
            {mergeError && <div className="mt-2 text-label text-flag">{mergeError}</div>}
          </form>
        </Card>
      )}

      {showNew && canCreate && (
        <Card className="p-3.5">
          <form
            onSubmit={(e) => { e.preventDefault(); create(e.currentTarget); }}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="kind" value={kind} />
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-label font-medium text-ink-3">Title</span>
              <input
                name="title"
                required
                placeholder={isFormal ? "Henderson kitchen — formal estimate" : "Add pantry cabinets"}
                className={inputCls}
              />
            </label>
            <label className="flex w-[170px] flex-col gap-1">
              <span className="text-label font-medium text-ink-3">Rail</span>
              <select name="rail" defaultValue="plans" className={inputCls}>
                <option value="plans">Plans-based</option>
                <option value="design_build">Design-build</option>
              </select>
            </label>
            <button type="submit" className="rounded-md border border-accent bg-accent px-3 py-1.5 text-label font-semibold text-white hover:bg-accent-2">
              Create
            </button>
          </form>
        </Card>
      )}

      {mine.length === 0 ? (
        <Card kind="dashed" className="p-10 text-center">
          <FileSpreadsheet className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
          <div className="mt-2 font-serif text-heading font-semibold text-ink-2">
            {isFormal ? "No formal estimate yet" : "No pre-con changes"}
          </div>
          <div className="mt-1 text-label text-ink-3">
            {isFormal
              ? "Create it, then add lines from your cost book. The client's PDF is generated from those lines."
              : canCreate
                ? "When the client asks for an addition or change before the contract is signed, price it here."
                : "Client changes are change orders now."}
          </div>
        </Card>
      ) : (
        <TableWrapper><FinancialTable>
          <TableHead><TableRow><TableHeader>Estimate</TableHeader><TableHeader numeric>Total</TableHeader><TableHeader><span className="sr-only">Actions</span></TableHeader></TableRow></TableHead>
          <TableBody>{mine.map(e => <Fragment key={e.id}><TableRow>
            <TablePrimaryCell meta={<>Created {e.createdAtLabel} · {e.lines.length} lines <Chip kind={STATUS_KIND[e.status]}>{e.status[0].toUpperCase() + e.status.slice(1)}</Chip></>}>{e.title}</TablePrimaryCell>
            <TableCell numeric className="whitespace-nowrap">{fmtUsd(e.total)}</TableCell>
            <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => {setEditingId(e.id);setSuggestion(null);}}>{isLocked(e) ? "View" : "Edit"}</Button>
              {!isLocked(e) && <ActionMenu label={`More actions for ${e.title}`}><Button variant="ghost" className="text-flag" onClick={() => removeEstimate(e.id)}>Delete</Button></ActionMenu>}
            </div></TableCell>
          </TableRow>{isFormal && pdfs && <TableRow><TableCell colSpan={3}>{clientPdf(e.id)}</TableCell></TableRow>}</Fragment>)}</TableBody>
          <tfoot><TableRow><TableCell className="font-semibold">Total</TableCell><TableCell numeric className="font-semibold">{fmtUsd(mine.reduce((sum,e) => sum+e.total,0))}</TableCell><TableCell /></TableRow></tfoot>
        </FinancialTable></TableWrapper>
      )}
      </div>
      )}

      {/* ── Generator view: the open estimate, with a way back to the list ── */}
      {selected && (
        <>
          <button
            type="button"
            onClick={() => setEditingId(null)}
            className="inline-flex items-center gap-1 text-label font-semibold text-ink-3 hover:text-ink"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2} /> {isFormal ? "All formal estimates" : "All pre-con changes"}
          </button>

          {/* Header + totals */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-serif text-heading font-semibold text-ink">{selected.title}</h3>
                  <Chip kind="ghost">{RAIL_LABEL[selected.rail]}</Chip>
                  <Chip kind={STATUS_KIND[selected.status]}>{selected.status[0].toUpperCase() + selected.status.slice(1)}</Chip>
                </div>
                <div className="mt-0.5 text-meta text-ink-3">Created {selected.createdAtLabel}</div>
              </div>
              <div className="text-right">
                <div className="tabular-nums text-title font-semibold text-accent-2">{fmtUsd(selected.total)}</div>
                <div className="text-meta text-ink-3">
                  cost {fmtUsd(selected.subtotal)} + markup {fmtUsd(selected.markupTotal)}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!locked && <>
              <button
                onClick={() => setLineModal({ mode: "add" })}
                className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-label font-semibold text-paper hover:bg-ink-hover"
              >
                <Plus className="size-3" strokeWidth={2} /> Add line
              </button>
              <button
                onClick={() => setBulkAdd((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-label font-semibold ${
                  bulkAdd ? "border-accent bg-accent-soft text-accent-2" : "border-rule bg-card text-ink-2 hover:bg-paper-2"
                }`}
              >
                <ListPlus className="size-3" strokeWidth={1.75} /> Bulk add
              </button>
              <button
                onClick={runSuggest}
                disabled={suggesting}
                className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-label font-semibold text-white hover:bg-ai-2 disabled:opacity-60"
              >
                <Sparkles className="size-3" strokeWidth={1.5} /> {suggesting ? "Thinking…" : "Suggest scope"}
              </button>
              </>}
              {!locked && (selected.status === "draft" || selected.status === "declined") && (
                <button
                  onClick={send}
                  className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent px-2.5 py-1 text-label font-semibold text-white hover:bg-accent-2"
                >
                  Send for approval
                </button>
              )}
              {(selected.lockState === "sent" || selected.status === "sent") && (
                <span className="text-meta font-medium text-accent-2">Awaiting client signature · lines are locked.</span>
              )}
              {(selected.lockState === "signed" || selected.status === "approved") && (
                <span className="text-meta font-medium text-money">Signed · lines are locked.</span>
              )}
              <div className="flex-1" />
              {!locked && <ActionMenu label="More estimate actions"><Button variant="ghost" className="text-flag" onClick={() => removeEstimate(selected.id)}>Delete {noun}</Button></ActionMenu>}
            </div>
            {sendError && <div className="mt-2 text-label text-flag">{sendError}</div>}

            {suggestion && (
              <div className="mt-3 rounded-md border border-ai/40 bg-ai-soft p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-label font-medium text-ai-2">
                  <Sparkles className="size-3" strokeWidth={1.5} /> Rough scope (advisory · add real lines from your cost book)
                </div>
                <div className="space-y-0.5">
                  {suggestion.lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between text-label">
                      <span className="text-ink-2">{l.label}</span>
                      <span className="tabular-nums text-ink-3">{l.value}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center justify-between border-t border-ai/30 pt-1 text-label font-semibold">
                    <span className="text-ink">Ballpark</span>
                    <span className="tabular-nums text-ink">{suggestion.total}</span>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {isFormal && pdfs && <Card className="p-3.5">{clientPdf(selected.id)}</Card>}

          {bulkAdd && !locked && (
            <BulkAddPanel
              estimateId={selected.id}
              slug={slug}
              costItems={costItems}
              floorplans={floorplans}
              onDone={() => setBulkAdd(false)}
            />
          )}

          {/* Lines by section */}
          {selected.lines.length === 0 ? (
            <Card kind="dashed" className="p-8 text-center text-label text-ink-3">
              No lines yet — add one from your cost book or free-form.
            </Card>
          ) : (
            <TableWrapper><FinancialTable>
              <TableHead><TableRow><TableHeader>Description</TableHeader><TableHeader numeric className="@max-3xl/page:hidden">Qty</TableHeader><TableHeader numeric className="@max-3xl/page:hidden">Unit cost</TableHeader><TableHeader numeric className="@max-4xl/page:hidden">Markup</TableHeader><TableHeader numeric>Amount</TableHeader><TableHeader><span className="sr-only">Actions</span></TableHeader></TableRow></TableHead>
              <TableBody>{sections.map(sec => <Fragment key={sec.name}>
                <TableGroupRow colSpan={3} className="@3xl/page:hidden" count={sec.lines.length}>{sec.name}</TableGroupRow>
                <TableGroupRow colSpan={5} className="@max-3xl/page:hidden @4xl/page:hidden" count={sec.lines.length}>{sec.name}</TableGroupRow>
                <TableGroupRow colSpan={6} className="@max-4xl/page:hidden" count={sec.lines.length}>{sec.name}</TableGroupRow>
                {sec.lines.map(l => <TableRow key={l.id}>
                  <TablePrimaryCell meta={<span className="@3xl/page:hidden">{l.qty} {unitLabel(l.unit)} × {fmtUsd(l.unitCost)} · +{l.markup}%</span>}>{l.description}</TablePrimaryCell>
                  <TableCell numeric className="@max-3xl/page:hidden">{l.qty} {unitLabel(l.unit)}</TableCell><TableCell numeric className="@max-3xl/page:hidden">{fmtUsd(l.unitCost)}</TableCell><TableCell numeric className="@max-4xl/page:hidden">{l.markup}%</TableCell><TableCell numeric className="whitespace-nowrap">{fmtUsd(l.extended)}</TableCell>
                  <TableCell>{!locked && <TableActions><Button variant="ghost" size="sm" iconOnly icon={Pencil} aria-label={`Edit ${l.description}`} title="Edit" onClick={() => setLineModal({mode:"edit",line:l})} /><ActionMenu label={`More actions for ${l.description}`}><Button variant="ghost" className="text-flag" onClick={() => removeLine(l.id)}>Delete line</Button></ActionMenu></TableActions>}</TableCell>
                </TableRow>)}
                <TableRow><TableCell className="font-semibold">{sec.name} subtotal</TableCell><TableCell colSpan={2} className="@max-3xl/page:hidden" /><TableCell className="@max-4xl/page:hidden" /><TableCell numeric className="font-semibold">{fmtUsd(sec.lines.reduce((sum,l) => sum+l.extended,0))}</TableCell><TableCell /></TableRow>
              </Fragment>)}</TableBody>
              <tfoot><TableRow className="border-t border-rule font-semibold"><TableCell>Total</TableCell><TableCell colSpan={2} className="@max-3xl/page:hidden" /><TableCell className="@max-4xl/page:hidden" /><TableCell numeric>{fmtUsd(selected.total)}</TableCell><TableCell /></TableRow></tfoot>
            </FinancialTable></TableWrapper>
          )}

          {/* Live house-style Formal Estimate PDF — the same document the
              estimate_doc generator produces. Keyed on the line signature so it
              reloads after every save (router.refresh() feeds fresh props). */}
          {selected.lines.length > 0 && (
            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-label font-medium text-ink-3">
                  Preview · what the client will see
                </span>
                <span className="text-meta text-ink-3">
                  {isFormal
                    ? "Generated live from these lines. The client's copy is under Client PDF above."
                    : "The PDF the client gets for this change, generated live from these lines."}
                </span>
              </div>
              <iframe
                key={`${selected.total}|${selected.lines.map((l) => `${l.id}:${l.extended}`).join(",")}`}
                src={`/api/projects/${slug}/estimates/${selected.id}/preview`}
                title={`${selected.title} preview`}
                className="h-[560px] w-full rounded-md border border-rule bg-paper"
              />
            </div>
          )}

          {isFormal && selected.lines.length > 0 && (
            <ContractGenerator
              slug={slug}
              estimateId={selected.id}
              total={selected.total}
              schedule={selected.drawSchedule}
              gate={approvalGate}
              estimateApproved={selected.status === "approved"}
            />
          )}
        </>
      )}

      {lineModal && selected && !locked && (
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
