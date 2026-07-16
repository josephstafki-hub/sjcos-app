"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Check, Send, Pencil, Trash2, FolderPlus } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type { Selection, SelectionStatus, SelectionsView, SelectionGroup } from "@/lib/selections";
import {
  addSelection,
  updateSelection,
  pushSelectionToClient,
  removeSelection,
  addSection,
  updateSection,
  removeSection,
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
  draft: "draft",
  pending: "awaiting client",
  approved: "approved",
  declined: "declined",
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type Result = { ok: boolean; error?: string };

/** Project Selections tab — finishes/products grouped into budgeted rooms.
 *  Owner manages sections (room + budget), adds/edits selections with a price,
 *  pushes drafts to the client portal, and watches budgets roll up. */
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
  // Modal state: add a selection (optionally prefilled section), edit one, or
  // add/edit a section.
  const [addSel, setAddSel] = useState<{ sectionId: number | null } | null>(null);
  const [editSel, setEditSel] = useState<Selection | null>(null);
  const [sectionModal, setSectionModal] = useState<{ id: number | null; name: string; budget: number } | null>(null);

  // Sections offered in the picker (real sections only, not the Ungrouped bucket).
  const sectionOptions = view.groups
    .filter((g) => g.id !== null)
    .map((g) => ({ id: g.id as number, name: g.name }));

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center">
        <div className="flex-1">
          <h3 className="font-serif text-[16px] font-semibold text-ink">Selections</h3>
          {view.totalBudget > 0 && (
            <p className="mt-0.5 text-[12px] text-ink-3">
              {fmt(view.totalSpent)} approved of {fmt(view.totalBudget)} budget ·{" "}
              <span className={view.totalBudget - view.totalSpent < 0 ? "text-flag" : "text-money"}>
                {fmt(view.totalBudget - view.totalSpent)} remaining
              </span>
              {view.totalProposed > 0 && (
                <span className="text-ink-3"> · {fmt(view.totalProposed)} pending</span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => setSectionModal({ id: null, name: "", budget: 0 })}
          className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
        >
          <FolderPlus className="size-3" strokeWidth={1.5} />
          Add section
        </button>
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}

      {empty ? (
        <Card kind="dashed" className="p-8 text-center">
          <div className="text-[13px] text-ink-3">
            No sections yet. Add a room (with a budget) to start grouping finishes.
          </div>
        </Card>
      ) : (
        view.groups.map((g) => (
          <SectionBlock
            key={g.id ?? "ungrouped"}
            group={g}
            pending={pending}
            onAddSelection={() => setAddSel({ sectionId: g.id })}
            onEditSection={() => g.id !== null && setSectionModal({ id: g.id, name: g.name, budget: g.budget })}
            onRemoveSection={() => g.id !== null && run(() => removeSection(g.id as number))}
            onPush={(id) => run(() => pushSelectionToClient(id))}
            onRemove={(id) => run(() => removeSelection(id))}
            onEdit={(s) => setEditSel(s)}
          />
        ))
      )}

      {addSel && (
        <SelectionModal
          title="Add selection"
          pending={pending}
          catalog={catalog}
          sections={sectionOptions}
          defaultSectionId={addSel.sectionId}
          onClose={() => setAddSel(null)}
          onSubmit={(fd) =>
            run(() => addSelection(slug, fd), () => setAddSel(null), "Could not add the selection.")
          }
        />
      )}

      {editSel && (
        <SelectionModal
          title="Edit selection"
          pending={pending}
          catalog={catalog}
          sections={sectionOptions}
          defaultSectionId={editSel.sectionId}
          selection={editSel}
          onClose={() => setEditSel(null)}
          onSubmit={(fd) =>
            run(() => updateSelection(editSel.id, fd), () => setEditSel(null), "Could not save the selection.")
          }
        />
      )}

      {sectionModal && (
        <SectionModal
          pending={pending}
          initial={sectionModal}
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
    </div>
  );
}

function SectionBlock({
  group: g,
  pending,
  onAddSelection,
  onEditSection,
  onRemoveSection,
  onPush,
  onRemove,
  onEdit,
}: {
  group: SelectionGroup;
  pending: boolean;
  onAddSelection: () => void;
  onEditSection: () => void;
  onRemoveSection: () => void;
  onPush: (id: number) => void;
  onRemove: (id: number) => void;
  onEdit: (s: Selection) => void;
}) {
  const over = g.remaining < 0;
  const pct = g.budget > 0 ? Math.min(100, Math.round((g.spent / g.budget) * 100)) : 0;
  const isUngrouped = g.id === null;

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-serif text-[14px] font-semibold text-ink">{g.name}</h4>
            {!isUngrouped && (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                budget {fmt(g.budget)}
              </span>
            )}
          </div>
          {!isUngrouped && (
            <>
              <div className="mt-1.5 h-1.5 w-full max-w-[260px] overflow-hidden rounded-full bg-paper-3">
                <div
                  className={`h-full rounded-full ${over ? "bg-flag" : "bg-money"}`}
                  style={{ width: `${over ? 100 : pct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink-3">
                {fmt(g.spent)} approved ·{" "}
                <span className={over ? "text-flag" : "text-money"}>
                  {over ? `${fmt(-g.remaining)} over` : `${fmt(g.remaining)} left`}
                </span>
                {g.proposed > 0 && <span> · {fmt(g.proposed)} pending</span>}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isUngrouped && (
            <>
              <button
                onClick={onEditSection}
                title="Edit section"
                className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
              >
                <Pencil className="size-3" strokeWidth={1.5} />
              </button>
              <button
                disabled={pending}
                onClick={onRemoveSection}
                title="Remove section (keeps its selections)"
                className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
              >
                <Trash2 className="size-3" strokeWidth={1.5} />
              </button>
            </>
          )}
          <button
            onClick={onAddSelection}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e]"
          >
            <Plus className="size-3" strokeWidth={1.5} />
            Add
          </button>
        </div>
      </div>

      {g.selections.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {g.selections.map((s) => (
            <SelectionCard key={s.id} s={s} pending={pending} onPush={onPush} onRemove={onRemove} onEdit={onEdit} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SelectionCard({
  s,
  pending,
  onPush,
  onRemove,
  onEdit,
}: {
  s: Selection;
  pending: boolean;
  onPush: (id: number) => void;
  onRemove: (id: number) => void;
  onEdit: (s: Selection) => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      {s.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={s.imageUrl}
          alt={s.choice}
          className="aspect-[4/3] w-full border-b border-rule object-cover"
        />
      ) : (
        <div className="aspect-[4/3] border-b border-rule bg-paper-3" />
      )}
      <div className="flex flex-col gap-1.5 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{s.area}</span>
          {s.price > 0 && <span className="text-[12px] font-semibold text-ink-2">{fmt(s.price)}</span>}
        </div>
        <span className="text-[13px] leading-snug text-ink">{s.choice}</span>
        <div className="mt-0.5 flex items-center gap-2">
          <Chip kind={STATUS_CHIP[s.status]} dot>
            {STATUS_LABEL[s.status]}
          </Chip>
          <div className="ml-auto flex items-center gap-1.5">
            {s.status === "draft" && (
              <button
                disabled={pending}
                onClick={() => onPush(s.id)}
                title="Push to client portal"
                className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50"
              >
                <Send className="size-3" strokeWidth={1.75} />
                Push
              </button>
            )}
            <button
              onClick={() => onEdit(s)}
              title="Edit"
              className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              <Pencil className="size-3" strokeWidth={1.75} />
            </button>
            <button
              disabled={pending}
              onClick={() => onRemove(s.id)}
              title="Remove"
              className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
            >
              <X className="size-3" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

const FIELD = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";

function SelectionModal({
  title,
  pending,
  catalog,
  sections,
  defaultSectionId,
  selection,
  onClose,
  onSubmit,
}: {
  title: string;
  pending: boolean;
  catalog: CatalogOption[];
  sections: { id: number; name: string }[];
  defaultSectionId: number | null;
  selection?: Selection;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <ModalShell title={title} onClose={onClose}>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Section</span>
          <select name="sectionId" defaultValue={defaultSectionId ?? ""} className={FIELD}>
            <option value="">Ungrouped</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Area</span>
            <input name="area" required autoFocus defaultValue={selection?.area} placeholder="Counters" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Price ($)</span>
            <input name="price" inputMode="numeric" defaultValue={selection?.price ? String(selection.price) : ""} placeholder="0" className={FIELD} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Choice</span>
          <input name="choice" required defaultValue={selection?.choice} placeholder="Calacatta marble · slab" className={FIELD} />
        </label>
        {!selection && (
          <>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Catalog item (optional — uses its image)</span>
              <select name="catalogId" defaultValue="" className={FIELD}>
                <option value="">None</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Or upload an image (optional)</span>
              <input
                name="image"
                type="file"
                accept="image/*"
                className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
              />
            </label>
          </>
        )}

        <ModalActions pending={pending} onClose={onClose} submitLabel={selection ? "Save" : "Add"} />
      </form>
    </ModalShell>
  );
}

function SectionModal({
  pending,
  initial,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  initial: { id: number | null; name: string; budget: number };
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <ModalShell title={initial.id === null ? "Add section" : "Edit section"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Section name</span>
          <input name="name" required autoFocus defaultValue={initial.name} placeholder="Kitchen" className={FIELD} />
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

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
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
