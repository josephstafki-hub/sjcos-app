"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Card, Eyebrow } from "@/components/ui";
import type { MoodRoom } from "@/lib/mood";
import { addMoodImage, removeMoodImage } from "@/lib/actions/mood";

/** Project Mood tab — per-room reference-image grid. Owner adds an image (room +
 *  optional note) and removes any. Images are owner-only (served via /api/files). */
export function MoodBoard({ slug, rooms }: { slug: string; rooms: MoodRoom[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);

  function remove(id: number) {
    setError("");
    startTransition(async () => {
      const r = await removeMoodImage(id);
      if (!r.ok) setError(r.error ?? "Could not remove the image.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center">
        <h3 className="flex-1 font-serif text-[16px] font-semibold text-ink">Mood board</h3>
        <button
          onClick={() => setModal(true)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          <Plus className="size-3" strokeWidth={1.5} />
          Add image
        </button>
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}

      {rooms.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <div className="text-[13px] text-ink-3">
            No mood images yet. Add reference images per room for client review.
          </div>
        </Card>
      ) : (
        rooms.map((group) => (
          <div key={group.room} className="flex flex-col gap-2">
            <Eyebrow muted>{group.room}</Eyebrow>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {group.images.map((img) => (
                <Card key={img.id} className="group relative overflow-hidden p-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.imageUrl} alt={img.note || group.room} className="aspect-square w-full object-cover" />
                  <button
                    disabled={pending}
                    onClick={() => remove(img.id)}
                    title="Remove"
                    className="absolute right-1.5 top-1.5 rounded-md border border-rule bg-card/90 p-1 text-ink-3 opacity-0 transition-opacity hover:text-flag group-hover:opacity-100 disabled:opacity-50"
                  >
                    <X className="size-3" strokeWidth={1.75} />
                  </button>
                  {img.note && (
                    <div className="border-t border-rule px-2 py-1.5 text-[11px] leading-snug text-ink-2">
                      {img.note}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      {modal && (
        <AddMoodModal
          pending={pending}
          onClose={() => setModal(false)}
          onAdd={(fd) =>
            startTransition(async () => {
              setError("");
              const res = await addMoodImage(slug, fd);
              if (res.ok) setModal(false);
              else setError(res.error ?? "Could not add the image.");
            })
          }
        />
      )}
    </div>
  );
}

function AddMoodModal({
  pending,
  onClose,
  onAdd,
}: {
  pending: boolean;
  onClose: () => void;
  onAdd: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">Add mood image</h2>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Room</span>
            <input
              name="room"
              autoFocus
              placeholder="Kitchen"
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Image</span>
            <input
              name="image"
              type="file"
              accept="image/*"
              required
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Note (optional)</span>
            <input
              name="note"
              placeholder="Warm matte brass, honed stone"
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
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
