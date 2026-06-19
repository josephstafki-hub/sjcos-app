"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X, Check, Send } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type { Selection, SelectionStatus } from "@/lib/selections";
import {
  addSelection,
  pushSelectionToClient,
  removeSelection,
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

/** Project Selections tab — image grid of finish/product picks. Owner adds a
 *  selection (link a catalog item or upload an image), pushes drafts to the
 *  client portal for approval, and removes any. */
export function SelectionsBoard({
  slug,
  selections,
  catalog,
}: {
  slug: string;
  selections: Selection[];
  catalog: CatalogOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center">
        <h3 className="flex-1 font-serif text-[16px] font-semibold text-ink">Selections</h3>
        <button
          onClick={() => setModal(true)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          <Plus className="size-3" strokeWidth={1.5} />
          Add selection
        </button>
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}

      {selections.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <div className="text-[13px] text-ink-3">
            No selections yet. Add finishes from the catalog or upload an image.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {selections.map((s) => (
            <Card key={s.id} className="overflow-hidden p-0">
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
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                  {s.area}
                </span>
                <span className="text-[13px] leading-snug text-ink">{s.choice}</span>
                <div className="mt-0.5 flex items-center gap-2">
                  <Chip kind={STATUS_CHIP[s.status]} dot>
                    {STATUS_LABEL[s.status]}
                  </Chip>
                  <div className="ml-auto flex items-center gap-1.5">
                    {s.status === "draft" && (
                      <button
                        disabled={pending}
                        onClick={() => run(() => pushSelectionToClient(s.id))}
                        title="Push to client portal"
                        className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50"
                      >
                        <Send className="size-3" strokeWidth={1.75} />
                        Push
                      </button>
                    )}
                    <button
                      disabled={pending}
                      onClick={() => run(() => removeSelection(s.id))}
                      title="Remove"
                      className="rounded-md border border-rule p-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
                    >
                      <X className="size-3" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <AddSelectionModal
          pending={pending}
          catalog={catalog}
          onClose={() => setModal(false)}
          onAdd={(fd) =>
            startTransition(async () => {
              setError("");
              const res = await addSelection(slug, fd);
              if (res.ok) setModal(false);
              else setError(res.error ?? "Could not add the selection.");
            })
          }
        />
      )}
    </div>
  );
}

function AddSelectionModal({
  pending,
  catalog,
  onClose,
  onAdd,
}: {
  pending: boolean;
  catalog: CatalogOption[];
  onClose: () => void;
  onAdd: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">Add selection</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            onAdd(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-3 p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Area</span>
            <input
              name="area"
              required
              autoFocus
              placeholder="Kitchen counters"
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Choice</span>
            <input
              name="choice"
              required
              placeholder="Calacatta marble · slab"
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Catalog item (optional — uses its image)</span>
            <select
              name="catalogId"
              defaultValue=""
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            >
              <option value="">None</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Or upload an image (optional)</span>
            <input
              name="image"
              type="file"
              accept="image/*"
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
            />
          </label>

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
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
