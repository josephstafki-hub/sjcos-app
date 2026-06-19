"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X, Check } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { FloorplanVersion } from "@/lib/floorplans";
import {
  uploadFloorplan,
  updateFloorplanNotes,
  removeFloorplan,
} from "@/lib/actions/floorplans";

/** Project Floor tab — versioned floor-plan viewer. Owner uploads a plan image
 *  or PDF (each upload is a new version), switches between versions, edits each
 *  version's notes, and removes versions. Not a CAD editor. */
export function FloorPlan({ slug, versions }: { slug: string; versions: FloorplanVersion[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(versions[0]?.id ?? null);

  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;

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
        <h3 className="flex-1 font-serif text-[16px] font-semibold text-ink">Floor plan</h3>
        <button
          onClick={() => setModal(true)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          <Plus className="size-3" strokeWidth={1.5} />
          Upload version
        </button>
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}

      {!selected ? (
        <Card kind="dashed" className="p-8 text-center">
          <div className="text-[13px] text-ink-3">
            No floor plan yet. Upload a plan image or PDF — re-upload to add a new version.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_240px]">
          {/* Preview + notes for the selected version */}
          <div className="flex flex-col gap-3">
            <Card className="overflow-hidden p-0">
              {selected.isPdf ? (
                <iframe
                  src={selected.fileUrl}
                  title={`Floor plan v${selected.version}`}
                  className="h-[520px] w-full border-0"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.fileUrl} alt={`Floor plan v${selected.version}`} className="w-full object-contain" />
              )}
            </Card>
            <NotesEditor
              key={selected.id}
              initial={selected.notes}
              disabled={pending}
              onSave={(notes) => run(() => updateFloorplanNotes(selected.id, notes))}
            />
          </div>

          {/* Version list */}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Versions</span>
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedId(v.id)}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors ${
                  v.id === selected.id ? "border-accent bg-accent-soft" : "border-rule hover:bg-paper-2"
                }`}
              >
                <span className="font-mono font-semibold text-ink">v{v.version}</span>
                <span className="flex-1 truncate text-ink-3">{v.uploaded}</span>
                {v.isPdf && <Chip kind="ghost">PDF</Chip>}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    run(() => removeFloorplan(v.id));
                  }}
                  title="Remove version"
                  className="rounded p-0.5 text-ink-3 hover:text-flag"
                >
                  <X className="size-3" strokeWidth={1.75} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {modal && (
        <UploadModal
          pending={pending}
          onClose={() => setModal(false)}
          onUpload={(fd) =>
            startTransition(async () => {
              setError("");
              const res = await uploadFloorplan(slug, fd);
              if (res.ok) setModal(false);
              else setError(res.error ?? "Could not upload the plan.");
            })
          }
        />
      )}
    </div>
  );
}

function NotesEditor({
  initial,
  disabled,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  onSave: (notes: string) => void;
}) {
  const [notes, setNotes] = useState(initial);
  const dirty = notes !== initial;
  return (
    <Card className="p-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Notes for this version</span>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="Mark-ups, change requests, dimensions to confirm…"
        className="mt-1.5 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
      />
      <div className="mt-1.5 flex justify-end">
        <button
          disabled={disabled || !dirty}
          onClick={() => onSave(notes)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-40"
        >
          <Check className="size-3" strokeWidth={1.75} />
          Save notes
        </button>
      </div>
    </Card>
  );
}

function UploadModal({
  pending,
  onClose,
  onUpload,
}: {
  pending: boolean;
  onClose: () => void;
  onUpload: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">Upload floor plan</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            onUpload(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-3 p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Plan file (image or PDF)</span>
            <input
              name="file"
              type="file"
              accept="image/*,application/pdf"
              required
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Notes (optional)</span>
            <textarea
              name="notes"
              rows={3}
              placeholder="What changed in this version."
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
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
              className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
            >
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
