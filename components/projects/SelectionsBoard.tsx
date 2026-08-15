"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, X, Check, Send, Pencil, Trash2, FolderPlus, Link2, Loader2,
  Undo2, ExternalLink, CircleDot, Wallet,
} from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type {
  Selection, SelectionOption, SelectionStatus, SelectionsView, SelectionGroup,
} from "@/lib/selections";
import {
  addSelection, updateSelection, unpushSelection, removeSelection,
  addSection, updateSection, removeSection, pushSectionToClient, pushBoardToClient,
  addOption, updateOption, removeOption, prefillOptionFromUrl, decideSelection,
  setSelectionsBudget,
} from "@/lib/actions/selections";

/** Lightweight catalog option for the add-picker (avoids importing the
 *  db-coupled lib/catalog value into the client bundle). */
export interface CatalogOption {
  id: number;
  name: string;
}

const STATUS_CHIP: Record<SelectionStatus, ChipKind> = {
  draft: "ghost",
  pending: "info",
  approved: "money",
  declined: "flag",
};

const STATUS_LABEL: Record<SelectionStatus, string> = {
  draft: "not sent",
  pending: "awaiting client",
  approved: "decided",
  declined: "wants other options",
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type Result = { ok: boolean; error?: string };

/** Flatten the section tree into picker entries, indenting sub-sections so the
 *  hierarchy is readable in a plain <select>. */
function pickerOptions(
  groups: SelectionGroup[],
  depth = 0,
): { id: number; label: string }[] {
  return groups.flatMap((g) =>
    g.id === null
      ? []
      : [
          { id: g.id, label: `${"  ".repeat(depth)}${depth ? "└ " : ""}${g.name}` },
          ...pickerOptions(g.children, depth + 1),
        ],
  );
}

/** Draft decisions that actually have options — what a room/board send pushes.
 *  Ones with no options are skipped server-side too, so the counts agree. */
function pushableCount(g: SelectionGroup): number {
  return (
    g.selections.filter((s) => s.status === "draft" && s.options.length > 0).length +
    g.children.reduce((n, c) => n + pushableCount(c), 0)
  );
}

/** Project Selections tab — the decisions a client has to make, grouped into
 *  budgeted rooms and sub-sections. Each decision carries an allowance and two
 *  or three options; the owner pushes rooms (or the whole board) to the portal
 *  and the client picks one option per decision. */
export function SelectionsBoard({
  slug,
  view,
  catalog,
}: {
  slug: string;
  view: SelectionsView;
  catalog: CatalogOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [addSel, setAddSel] = useState<{ sectionId: number | null } | null>(null);
  const [editSel, setEditSel] = useState<Selection | null>(null);
  const [sectionModal, setSectionModal] = useState<
    { id: number | null; name: string; budget: number; parentId: number | null } | null
  >(null);
  const [optionModal, setOptionModal] = useState<
    { selectionId: number; selectionName: string; option: SelectionOption | null } | null
  >(null);
  const [budgetModal, setBudgetModal] = useState(false);

  const sectionOptions = pickerOptions(view.groups);
  const totalPushable = view.groups.reduce((n, g) => n + pushableCount(g), 0);

  // Single path for every mutation on this board. The actions revalidate on the
  // server, but the project page is dynamic (cookie auth), so nothing re-renders
  // until the client router refetches — without router.refresh() a new section
  // lands in the DB and never shows up. On failure the modal stays open with the
  // error so the typed-in values survive.
  function run(fn: () => Promise<Result>, onSuccess?: () => void, fallback = "Something went wrong.") {
    setError("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? fallback);
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  const empty = view.groups.length === 0;
  const overBudget = view.totalBudget > 0 && view.totalBudget - view.totalSpent < 0;
  const budgetPct =
    view.totalBudget > 0 ? Math.min(100, Math.round((view.totalSpent / view.totalBudget) * 100)) : 0;
  const overAllocated = view.overallBudget > 0 && view.allocatedBudget > view.overallBudget;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h3 className="font-serif text-[16px] font-semibold text-ink">Selections</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {view.totalDecisions > 0
              ? `${view.totalOpen} of ${view.totalDecisions} decision${view.totalDecisions === 1 ? "" : "s"} still open`
              : "Lay out a room, then add every finish that needs a decision."}
          </p>
          {view.totalBudget > 0 && (
            <>
              <div className="mt-1.5 h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-paper-3">
                <div
                  className={`h-full rounded-full ${overBudget ? "bg-flag" : "bg-money"}`}
                  style={{ width: `${overBudget ? 100 : budgetPct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink-3">
                {fmt(view.totalSpent)} committed of {fmt(view.totalBudget)}{" "}
                <span className={overBudget ? "text-flag" : "text-money"}>
                  ({overBudget
                    ? `${fmt(view.totalSpent - view.totalBudget)} over`
                    : `${fmt(view.totalBudget - view.totalSpent)} left`})
                </span>
                {view.totalProposed > 0 && <span> · {fmt(view.totalProposed)} still to decide</span>}
                {view.overallBudget > 0 ? (
                  view.allocatedBudget > 0 && (
                    <span className={overAllocated ? "text-flag" : ""}>
                      {" · "}rooms allocate {fmt(view.allocatedBudget)}
                      {overAllocated && ` (${fmt(view.allocatedBudget - view.overallBudget)} over the overall)`}
                    </span>
                  )
                ) : (
                  <span> · sum of room budgets — set an overall to override</span>
                )}
              </p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setBudgetModal(true)}
            title="Set the overall selections budget the client's running total is measured against"
            className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
          >
            <Wallet className="size-3" strokeWidth={1.5} />
            {view.overallBudget > 0 ? `Budget ${fmt(view.overallBudget)}` : "Set budget"}
          </button>
          {totalPushable > 0 && (
            <button
              disabled={pending}
              onClick={() => run(() => pushBoardToClient(slug))}
              title="Send every unsent decision that has options to the client portal"
              className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50"
            >
              <Send className="size-3" strokeWidth={1.75} />
              Send board
            </button>
          )}
          <button
            onClick={() => setSectionModal({ id: null, name: "", budget: 0, parentId: null })}
            className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
          >
            <FolderPlus className="size-3" strokeWidth={1.5} />
            Add room
          </button>
        </div>
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}

      {empty ? (
        <Card kind="dashed" className="p-8 text-center">
          <div className="text-[13px] text-ink-3">
            No rooms yet. Add a room (with a budget) to start grouping decisions.
          </div>
        </Card>
      ) : (
        view.groups.map((g) => (
          <SectionBlock
            key={g.id ?? "ungrouped"}
            group={g}
            depth={0}
            pending={pending}
            onAddSelection={(sectionId) => setAddSel({ sectionId })}
            onAddSub={(parentId) => setSectionModal({ id: null, name: "", budget: 0, parentId })}
            onEditSection={(s) => setSectionModal(s)}
            onRemoveSection={(id) => run(() => removeSection(id))}
            onPushSection={(id) => run(() => pushSectionToClient(id))}
            onUnpush={(id) => run(() => unpushSelection(id))}
            onRemove={(id) => run(() => removeSelection(id))}
            onEdit={(s) => setEditSel(s)}
            onAddOption={(sel) =>
              setOptionModal({ selectionId: sel.id, selectionName: sel.area, option: null })
            }
            onEditOption={(sel, opt) =>
              setOptionModal({ selectionId: sel.id, selectionName: sel.area, option: opt })
            }
            onRemoveOption={(id) => run(() => removeOption(id))}
            onChoose={(selId, optId) => run(() => decideSelection(selId, true, optId))}
          />
        ))
      )}

      {addSel && (
        <SelectionModal
          title="Add a decision"
          pending={pending}
          sections={sectionOptions}
          defaultSectionId={addSel.sectionId}
          onClose={() => setAddSel(null)}
          onSubmit={(fd) =>
            run(() => addSelection(slug, fd), () => setAddSel(null), "Could not add the decision.")
          }
        />
      )}

      {editSel && (
        <SelectionModal
          title="Edit decision"
          pending={pending}
          sections={sectionOptions}
          defaultSectionId={editSel.sectionId}
          selection={editSel}
          onClose={() => setEditSel(null)}
          onSubmit={(fd) =>
            run(() => updateSelection(editSel.id, fd), () => setEditSel(null), "Could not save the decision.")
          }
        />
      )}

      {budgetModal && (
        <BudgetModal
          pending={pending}
          overallBudget={view.overallBudget}
          allocatedBudget={view.allocatedBudget}
          onClose={() => setBudgetModal(false)}
          onSubmit={(fd) =>
            run(() => setSelectionsBudget(slug, fd), () => setBudgetModal(false), "Could not save the budget.")
          }
        />
      )}

      {sectionModal && (
        <SectionModal
          pending={pending}
          initial={sectionModal}
          sections={sectionOptions.filter((s) => s.id !== sectionModal.id)}
          onClose={() => setSectionModal(null)}
          onSubmit={(fd) =>
            run(
              () => (sectionModal.id === null ? addSection(slug, fd) : updateSection(sectionModal.id, fd)),
              () => setSectionModal(null),
              "Could not save the section.",
            )
          }
        />
      )}

      {optionModal && (
        <OptionModal
          pending={pending}
          catalog={catalog}
          selectionName={optionModal.selectionName}
          option={optionModal.option}
          onClose={() => setOptionModal(null)}
          onSubmit={(fd) =>
            run(
              () =>
                optionModal.option
                  ? updateOption(optionModal.option.id, fd)
                  : addOption(optionModal.selectionId, fd),
              () => setOptionModal(null),
              "Could not save the option.",
            )
          }
        />
      )}
    </div>
  );
}

// ─── Section (room / sub-section) ────────────────────────────────────────────

interface SectionHandlers {
  onAddSelection: (sectionId: number | null) => void;
  onAddSub: (parentId: number) => void;
  onEditSection: (s: { id: number; name: string; budget: number; parentId: number | null }) => void;
  onRemoveSection: (id: number) => void;
  onPushSection: (sectionId: number) => void;
  onUnpush: (id: number) => void;
  onRemove: (id: number) => void;
  onEdit: (s: Selection) => void;
  onAddOption: (s: Selection) => void;
  onEditOption: (s: Selection, o: SelectionOption) => void;
  onRemoveOption: (id: number) => void;
  onChoose: (selectionId: number, optionId: number) => void;
}

function SectionBlock({
  group: g,
  depth,
  pending,
  ...h
}: { group: SelectionGroup; depth: number; pending: boolean } & SectionHandlers) {
  const over = g.remaining < 0;
  const pct = g.budget > 0 ? Math.min(100, Math.round((g.spent / g.budget) * 100)) : 0;
  const isUngrouped = g.id === null;
  const isSub = depth > 0;
  const pushable = pushableCount(g);

  const header = (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4
            className={
              isSub
                ? "font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2"
                : "font-serif text-[14px] font-semibold text-ink"
            }
          >
            {g.name}
          </h4>
          {g.budget > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
              budget {fmt(g.budget)}
            </span>
          )}
          {g.totalCount > 0 && (
            <span className="text-[11px] text-ink-3">
              {g.openCount > 0 ? `${g.openCount} open` : "all decided"} · {g.totalCount} total
            </span>
          )}
        </div>
        {g.budget > 0 && (
          <>
            <div className="mt-1.5 h-1.5 w-full max-w-[260px] overflow-hidden rounded-full bg-paper-3">
              <div
                className={`h-full rounded-full ${over ? "bg-flag" : "bg-money"}`}
                style={{ width: `${over ? 100 : pct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              {fmt(g.spent)} committed ·{" "}
              <span className={over ? "text-flag" : "text-money"}>
                {over ? `${fmt(-g.remaining)} over` : `${fmt(g.remaining)} left`}
              </span>
              {g.allowance > 0 && <span> · {fmt(g.allowance)} in allowances</span>}
            </p>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isUngrouped && !isSub && pushable > 0 && (
          <button
            disabled={pending}
            onClick={() => h.onPushSection(g.id as number)}
            title={`Send the ${pushable} unsent decision${pushable === 1 ? "" : "s"} in ${g.name} to the client portal`}
            className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50"
          >
            <Send className="size-3" strokeWidth={1.75} />
            Send {pushable}
          </button>
        )}
        {!isUngrouped && !isSub && (
          <button
            onClick={() => h.onAddSub(g.id as number)}
            title="Add a sub-section"
            className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <FolderPlus className="size-3" strokeWidth={1.5} />
          </button>
        )}
        {!isUngrouped && (
          <>
            <button
              onClick={() =>
                h.onEditSection({ id: g.id as number, name: g.name, budget: g.budget, parentId: null })
              }
              title="Edit section"
              className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              <Pencil className="size-3" strokeWidth={1.5} />
            </button>
            <button
              disabled={pending}
              onClick={() => h.onRemoveSection(g.id as number)}
              title="Remove section (its decisions move to Ungrouped)"
              className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
            >
              <Trash2 className="size-3" strokeWidth={1.5} />
            </button>
          </>
        )}
        <button
          onClick={() => h.onAddSelection(g.id)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          <Plus className="size-3" strokeWidth={1.5} />
          Decision
        </button>
      </div>
    </div>
  );

  const body = (
    <>
      {g.selections.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {g.selections.map((s) => (
            <SelectionRow key={s.id} s={s} pending={pending} {...h} />
          ))}
        </div>
      )}
      {g.children.length > 0 && (
        <div className="flex flex-col gap-2.5 border-l border-rule-soft pl-3">
          {g.children.map((c) => (
            <SectionBlock key={c.id} group={c} depth={depth + 1} pending={pending} {...h} />
          ))}
        </div>
      )}
      {g.selections.length === 0 && g.children.length === 0 && (
        <p className="text-[12px] text-ink-3">
          Nothing here yet — add the finishes in this room that need a decision.
        </p>
      )}
    </>
  );

  // Sub-sections render inline rather than as nested cards, so a room with three
  // sub-sections doesn't turn into three boxes inside a box.
  return isSub ? (
    <div className="flex flex-col gap-2.5">
      {header}
      {body}
    </div>
  ) : (
    <Card className="flex flex-col gap-3 p-3">
      {header}
      {body}
    </Card>
  );
}

// ─── One decision + its options ──────────────────────────────────────────────

function SelectionRow({
  s,
  pending,
  onUnpush,
  onRemove,
  onEdit,
  onAddOption,
  onEditOption,
  onRemoveOption,
  onChoose,
}: { s: Selection; pending: boolean } & SectionHandlers) {
  const chosen = s.options.find((o) => o.id === s.chosenOptionId) ?? null;
  const delta = chosen && s.allowance > 0 ? chosen.price - s.allowance : 0;

  // A decision reads as a subheading over its option boxes, not a box of its
  // own — the visual hierarchy is room card → sub-section → decision → options.
  return (
    <div
      data-focus={`selection-${s.id}`}
      className="border-t border-rule-soft pt-2.5 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13px] font-semibold text-ink">{s.area}</span>
        {s.allowance > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
            allowance {fmt(s.allowance)}
          </span>
        )}
        <Chip kind={STATUS_CHIP[s.status]} dot>
          {STATUS_LABEL[s.status]}
        </Chip>
        <div className="ml-auto flex items-center gap-1.5">
          {s.status !== "draft" && (
            <button
              disabled={pending}
              onClick={() => onUnpush(s.id)}
              title="Pull back to draft and rework the options"
              className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
            >
              <Undo2 className="size-3" strokeWidth={1.75} />
            </button>
          )}
          <button
            onClick={() => onEdit(s)}
            title="Edit decision"
            className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <Pencil className="size-3" strokeWidth={1.75} />
          </button>
          <button
            disabled={pending}
            onClick={() => onRemove(s.id)}
            title="Remove decision"
            className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {(s.choice || s.notes) && (
        <p className="mt-1 text-[12px] leading-snug text-ink-2">
          {s.choice}
          {s.choice && s.notes ? " · " : ""}
          <span className="text-ink-3">{s.notes}</span>
        </p>
      )}

      {chosen && (
        <p className="mt-1 text-[12px] text-money">
          Client chose {chosen.name}
          {chosen.price > 0 && ` · ${fmt(chosen.price)}`}
          {delta !== 0 && (
            <span className={delta > 0 ? "text-flag" : "text-money"}>
              {" "}
              ({delta > 0 ? `${fmt(delta)} over` : `${fmt(-delta)} under`} allowance)
            </span>
          )}
        </p>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        {s.options.map((o) => (
          <OptionCard
            key={o.id}
            o={o}
            allowance={s.allowance}
            isChosen={o.id === s.chosenOptionId}
            canChoose={s.status === "pending" || s.status === "approved"}
            pending={pending}
            onEdit={() => onEditOption(s, o)}
            onRemove={() => onRemoveOption(o.id)}
            onChoose={() => onChoose(s.id, o.id)}
          />
        ))}
        <button
          onClick={() => onAddOption(s)}
          className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-rule text-ink-3 hover:border-accent hover:bg-accent-soft/30 hover:text-accent-2"
        >
          <Plus className="size-4" strokeWidth={1.5} />
          <span className="text-[11px] font-semibold">Add option</span>
        </button>
      </div>
    </div>
  );
}

function OptionCard({
  o,
  allowance,
  isChosen,
  canChoose,
  pending,
  onEdit,
  onRemove,
  onChoose,
}: {
  o: SelectionOption;
  allowance: number;
  isChosen: boolean;
  canChoose: boolean;
  pending: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onChoose: () => void;
}) {
  const delta = allowance > 0 && o.price > 0 ? o.price - allowance : 0;
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-md border bg-card ${
        isChosen ? "border-money ring-1 ring-money/30" : "border-rule"
      }`}
    >
      {o.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.imageUrl} alt={o.name} className="aspect-[4/3] w-full border-b border-rule object-cover" />
      ) : (
        <div className="aspect-[4/3] border-b border-rule bg-paper-3" />
      )}
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {o.brand && (
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">{o.brand}</span>
        )}
        <span className="text-[12px] leading-snug text-ink">{o.name}</span>
        {o.price > 0 && (
          <span className="text-[12px] font-semibold text-ink-2">
            {fmt(o.price)}
            {delta !== 0 && (
              <span className={`ml-1 font-normal ${delta > 0 ? "text-flag" : "text-money"}`}>
                {delta > 0 ? `+${fmt(delta)}` : `−${fmt(-delta)}`}
              </span>
            )}
          </span>
        )}
        {o.note && <span className="text-[11px] leading-snug text-ink-3">{o.note}</span>}

        <div className="mt-auto flex items-center gap-1 pt-1.5">
          {isChosen ? (
            <Chip kind="money" dot>chosen</Chip>
          ) : (
            canChoose && (
              <button
                disabled={pending}
                onClick={onChoose}
                title="Record this as the client's pick"
                className="inline-flex items-center gap-1 rounded border border-rule px-1.5 py-0.5 text-[10px] font-semibold text-ink-3 hover:border-money hover:text-money disabled:opacity-50"
              >
                <CircleDot className="size-2.5" strokeWidth={2} />
                Pick
              </button>
            )
          )}
          <div className="ml-auto flex items-center gap-1">
            {o.productUrl && (
              <a
                href={o.productUrl}
                target="_blank"
                rel="noreferrer noopener"
                title={o.productUrl}
                className="rounded p-0.5 text-ink-3 hover:text-accent-2"
              >
                <ExternalLink className="size-3" strokeWidth={1.75} />
              </a>
            )}
            <button onClick={onEdit} title="Edit option" className="rounded p-0.5 text-ink-3 hover:text-ink">
              <Pencil className="size-3" strokeWidth={1.75} />
            </button>
            <button
              disabled={pending}
              onClick={onRemove}
              title="Remove option"
              className="rounded p-0.5 text-ink-3 hover:text-flag disabled:opacity-50"
            >
              <X className="size-3" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

const FIELD = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";

function SelectionModal({
  title,
  pending,
  sections,
  defaultSectionId,
  selection,
  onClose,
  onSubmit,
}: {
  title: string;
  pending: boolean;
  sections: { id: number; label: string }[];
  defaultSectionId: number | null;
  selection?: Selection;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Room / section</span>
          <select name="sectionId" defaultValue={defaultSectionId ?? ""} className={FIELD}>
            <option value="">Ungrouped</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>What has to be decided</span>
            <input name="area" required autoFocus defaultValue={selection?.area} placeholder="Kitchen faucet" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Allowance ($)</span>
            <input
              name="allowance"
              inputMode="numeric"
              defaultValue={selection?.allowance ? String(selection.allowance) : ""}
              placeholder="0"
              className={FIELD}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Spec note (optional)</span>
          <input name="choice" defaultValue={selection?.choice} placeholder="Single-handle, pull-down, matte black" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Internal notes (optional)</span>
          <textarea name="notes" rows={2} defaultValue={selection?.notes} placeholder="Order by Sept 1 — 6 week lead time" className={FIELD} />
        </label>
        <ModalActions pending={pending} onClose={onClose} submitLabel={selection ? "Save" : "Add"} />
      </form>
    </ModalShell>
  );
}

/** Set the project-wide selections budget. Blank / 0 clears it, and the board
 *  goes back to measuring against whatever the rooms add up to. */
function BudgetModal({
  pending,
  overallBudget,
  allocatedBudget,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  overallBudget: number;
  allocatedBudget: number;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <ModalShell title="Overall selections budget" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Budget ($)</span>
          <input
            name="budget"
            inputMode="numeric"
            autoFocus
            defaultValue={overallBudget ? String(overallBudget) : ""}
            placeholder={allocatedBudget ? String(allocatedBudget) : "0"}
            className={FIELD}
          />
        </label>
        <p className="text-[11px] leading-snug text-ink-3">
          Shown to the client as the figure their running total is measured against, on top of
          the per-room budgets.
          {allocatedBudget > 0 && <> Rooms currently add up to {fmt(allocatedBudget)}.</>}{" "}
          Leave blank to use the room total.
        </p>
        <ModalActions pending={pending} onClose={onClose} submitLabel="Save" />
      </form>
    </ModalShell>
  );
}

function SectionModal({
  pending,
  initial,
  sections,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  initial: { id: number | null; name: string; budget: number; parentId: number | null };
  sections: { id: number; label: string }[];
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <ModalShell
      title={initial.id === null ? (initial.parentId ? "Add sub-section" : "Add room") : "Edit section"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name</span>
          <input name="name" required autoFocus defaultValue={initial.name} placeholder="Kitchen" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Nest under (optional)</span>
          <select name="parentId" defaultValue={initial.parentId ?? ""} className={FIELD}>
            <option value="">Top level — its own room</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Budget ($)</span>
          <input name="budget" inputMode="numeric" defaultValue={initial.budget ? String(initial.budget) : ""} placeholder="0" className={FIELD} />
        </label>
        <ModalActions pending={pending} onClose={onClose} submitLabel={initial.id === null ? "Add" : "Save"} />
      </form>
    </ModalShell>
  );
}

/** Add/edit one option. Pasting a product link and hitting Fetch fills the
 *  fields in; when the vendor site refuses (most of them do eventually) the
 *  error says so and every field stays typed-in-able. */
function OptionModal({
  pending,
  catalog,
  selectionName,
  option,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  catalog: CatalogOption[];
  selectionName: string;
  option: SelectionOption | null;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [url, setUrl] = useState(option?.productUrl ?? "");
  const [fetching, setFetching] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"ok" | "warn">("ok");
  // Set once a URL fetch pulls an image down; submitted so the action attaches
  // it without the owner having to re-upload.
  const [fetchedImageId, setFetchedImageId] = useState("");
  const [preview, setPreview] = useState<string | null>(option?.imageUrl ?? null);

  async function fetchFromUrl(target = url) {
    setNotice("");
    setFetching(true);
    try {
      const r = await prefillOptionFromUrl(target);
      const form = formRef.current;
      if (!r.ok) {
        setNoticeKind("warn");
        setNotice(r.error);
        return;
      }
      if (form) {
        // Only overwrite fields the fetch actually resolved, so a partial read
        // doesn't wipe something already typed.
        const set = (name: string, value: string) => {
          const el = form.elements.namedItem(name) as HTMLInputElement | null;
          if (el && value) el.value = value;
        };
        set("name", r.name);
        set("brand", r.brand);
        set("sku", r.sku);
        if (r.price > 0) set("price", String(r.price));
      }
      if (r.imageFileId) {
        setFetchedImageId(r.imageFileId);
        setPreview(`/api/files/${r.imageFileId}`);
      }
      setNoticeKind(r.imageFailed ? "warn" : "ok");
      setNotice(
        r.imageFailed
          ? "Pulled the details, but not the photo — upload one below."
          : "Pulled from the product page. Check it over before saving.",
      );
    } finally {
      setFetching(false);
    }
  }

  return (
    <ModalShell title={option ? "Edit option" : `Add option · ${selectionName}`} onClose={onClose}>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3 p-4"
      >
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Product link — paste and fetch</span>
          <div className="flex gap-2">
            <input
              name="productUrl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={(e) => {
                // Pasting a link is the ask itself — fetch right away instead of
                // making Joe click the button too. Manual edits still need it.
                const pasted = e.clipboardData.getData("text").trim();
                if (fetching || !/^https?:\/\//i.test(pasted)) return;
                e.preventDefault();
                setUrl(pasted);
                void fetchFromUrl(pasted);
              }}
              placeholder="https://www.ferguson.com/product/..."
              className={`${FIELD} min-w-0 flex-1`}
            />
            <button
              type="button"
              disabled={fetching || !url.trim()}
              onClick={() => fetchFromUrl()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
            >
              {fetching ? (
                <Loader2 className="size-3 animate-spin" strokeWidth={1.75} />
              ) : (
                <Link2 className="size-3" strokeWidth={1.75} />
              )}
              Fetch
            </button>
          </div>
          {notice && (
            <span className={`text-[11px] ${noticeKind === "warn" ? "text-flag" : "text-money"}`}>
              {notice}
            </span>
          )}
        </div>

        <div className="grid grid-cols-[1fr_110px] gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Option name</span>
            <input name="name" required defaultValue={option?.name} placeholder="Trinsic pull-down, matte black" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Price ($)</span>
            <input name="price" inputMode="numeric" defaultValue={option?.price ? String(option.price) : ""} placeholder="0" className={FIELD} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Brand / vendor</span>
            <input name="brand" defaultValue={option?.brand} placeholder="Delta" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Model / SKU</span>
            <input name="sku" defaultValue={option?.sku} placeholder="9159-BL-DST" className={FIELD} />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Note for the client (optional)</span>
          <input name="note" defaultValue={option?.note} placeholder="Lifetime finish warranty · 2 week lead" className={FIELD} />
        </label>

        {!option && catalog.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Catalog item (optional — uses its image)</span>
            <select name="catalogId" defaultValue="" className={FIELD}>
              <option value="">None</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={LABEL}>{preview ? "Replace the photo" : "Upload a photo"}</span>
            <input
              name="image"
              type="file"
              accept="image/*"
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
            />
          </label>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-14 shrink-0 rounded border border-rule object-cover" />
          )}
        </div>
        <input type="hidden" name="imageFileId" value={fetchedImageId} />

        <ModalActions pending={pending} onClose={onClose} submitLabel={option ? "Save" : "Add option"} />
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-[520px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ pending, onClose, submitLabel }: { pending: boolean; onClose: () => void; submitLabel: string }) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
      >
        <Check className="size-3" strokeWidth={1.75} />
        {submitLabel}
      </button>
    </div>
  );
}
