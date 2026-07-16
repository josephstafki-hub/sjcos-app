"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ExternalLink, ImagePlus, LayoutGrid, Plus, X } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { CATEGORIES } from "@/lib/catalog-categories";
import type { MoodBoardData, MoodItem } from "@/lib/mood";
import {
  addCatalogMoodItems,
  addMoodImage,
  removeMoodImage,
  saveMoodLayout,
  updateMoodNote,
} from "@/lib/actions/mood";
import { MoodCanvas } from "./MoodCanvas";

/** Catalog item as the picker needs it. Declared here rather than reusing
 *  lib/catalog's Material so the client bundle never imports the db-coupled
 *  module (same boundary trick as SelectionsBoard's CatalogOption). */
export interface MoodCatalogOption {
  id: number;
  name: string;
  supplier: string;
  category: string;
  priceLabel: string;
  imageUrl: string | null;
}

type Result = { ok: boolean; error?: string };

const FIELD = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";

/** Project Mood tab — a mood-board creator. One free-form canvas per room: pin
 *  items straight from the catalog (name/price/image snapshotted at pin time) or
 *  upload a reference image, then drag/resize them into a composition to show
 *  the client. Owner-only; images are served through the owner-only /api/files. */
export function MoodBoard({
  slug,
  boards,
  catalog,
}: {
  slug: string;
  boards: MoodBoardData[];
  catalog: MoodCatalogOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const [upload, setUpload] = useState(false);
  const [noteFor, setNoteFor] = useState<MoodItem | null>(null);
  /** A room the owner just created, which has no rows yet — boards come from the
   *  DB, and a room only exists there once it holds a pin. Never cleared on a
   *  successful pin: the room arrives in `boards` on the next render and `rooms`
   *  dedupes it, so clearing eagerly would only drop the chip for the frame
   *  between the write landing and the new props arriving — long enough to yank
   *  the owner onto a different board mid-compose. */
  const [draftRoom, setDraftRoom] = useState<string | null>(null);
  const [newRoom, setNewRoom] = useState(false);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);

  const rooms = useMemo(() => {
    const names = boards.map((b) => b.room);
    return draftRoom && !names.includes(draftRoom) ? [...names, draftRoom] : names;
  }, [boards, draftRoom]);

  const room = (activeRoom && rooms.includes(activeRoom) ? activeRoom : rooms[0]) ?? null;
  const items = boards.find((b) => b.room === room)?.items ?? [];

  function run(fn: () => Promise<Result>) {
    setError("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  function addRoom(name: string) {
    const clean = name.trim();
    if (!clean) return;
    if (!rooms.includes(clean)) setDraftRoom(clean);
    setActiveRoom(clean);
    setNewRoom(false);
  }

  // The catalog-sourced pins on the active board, for the spec list under the
  // canvas — scoped to this room so it reads as that room's product list.
  const products = items.filter((i) => i.label);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1">
          <h3 className="font-serif text-[16px] font-semibold text-ink">Mood board</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Pin items from the catalog, then drag and resize to compose the room.
          </p>
        </div>
        <button
          onClick={() => setUpload(true)}
          disabled={!room}
          className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
        >
          <ImagePlus className="size-3" strokeWidth={1.5} />
          Upload image
        </button>
        <button
          onClick={() => setPicker(true)}
          disabled={!room}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
        >
          <LayoutGrid className="size-3" strokeWidth={1.5} />
          Add from catalog
        </button>
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}

      {/* Room chips — one board per room. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {rooms.map((r) => (
          <button key={r} onClick={() => setActiveRoom(r)}>
            <Chip kind={r === room ? "ai" : "ghost"}>{r}</Chip>
          </button>
        ))}
        {newRoom ? (
          <input
            autoFocus
            placeholder="Kitchen"
            onBlur={(e) => (e.currentTarget.value.trim() ? addRoom(e.currentTarget.value) : setNewRoom(false))}
            onKeyDown={(e) => {
              if (e.key === "Enter") addRoom(e.currentTarget.value);
              if (e.key === "Escape") setNewRoom(false);
            }}
            className="w-[120px] rounded-md border border-accent bg-paper px-2 py-0.5 text-[12px] text-ink outline-none"
          />
        ) : (
          <button
            onClick={() => setNewRoom(true)}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-rule px-2 py-0.5 text-[11px] font-semibold text-ink-3 hover:border-ink-3 hover:text-ink-2"
          >
            <Plus className="size-3" strokeWidth={1.5} />
            New board
          </button>
        )}
      </div>

      {room === null ? (
        <Card kind="dashed" className="p-8 text-center">
          <div className="text-[13px] text-ink-3">
            No mood board yet. Add a board for a room, then pin items from the catalog.
          </div>
        </Card>
      ) : (
        <>
          <MoodCanvas
            items={items}
            pending={pending}
            onMove={(pos) => run(() => saveMoodLayout(slug, [pos], pos.id))}
            onRemove={(id) => run(() => removeMoodImage(id))}
            onEditNote={(item) => setNoteFor(item)}
          />
          {items.length === 0 && (
            <p className="-mt-2 text-center text-[12px] text-ink-3">
              {room} is empty — add items from the catalog or upload a reference image.
            </p>
          )}

          {products.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Products on this board</span>
              <Card className="divide-y divide-rule p-0">
                {products.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1 text-[12px] text-ink">{p.label}</span>
                    {p.priceLabel && <span className="text-[12px] text-ink-2">{p.priceLabel}</span>}
                    {p.sourceUrl && (
                      <a
                        href={p.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open product page"
                        className="text-ink-3 hover:text-ink"
                      >
                        <ExternalLink className="size-3" strokeWidth={1.5} />
                      </a>
                    )}
                  </div>
                ))}
              </Card>
            </div>
          )}
        </>
      )}

      {picker && room && (
        <CatalogPicker
          catalog={catalog}
          pending={pending}
          room={room}
          onClose={() => setPicker(false)}
          onPin={(ids) =>
            startTransition(async () => {
              setError("");
              const res = await addCatalogMoodItems(slug, room, ids);
              if (res.ok) setPicker(false);
              else setError(res.error ?? "Could not pin those items.");
            })
          }
        />
      )}

      {upload && room && (
        <UploadModal
          pending={pending}
          room={room}
          onClose={() => setUpload(false)}
          onAdd={(fd) =>
            startTransition(async () => {
              setError("");
              fd.set("room", room);
              const res = await addMoodImage(slug, fd);
              if (res.ok) setUpload(false);
              else setError(res.error ?? "Could not add the image.");
            })
          }
        />
      )}

      {noteFor && (
        <NoteModal
          item={noteFor}
          pending={pending}
          onClose={() => setNoteFor(null)}
          onSave={(note) =>
            startTransition(async () => {
              setError("");
              const res = await updateMoodNote(noteFor.id, note);
              if (res.ok) setNoteFor(null);
              else setError(res.error ?? "Could not save the note.");
            })
          }
        />
      )}
    </div>
  );
}

/** Multi-select catalog picker: search + category filter over the material
 *  library, thumbnails, pin as many as you want in one go. */
function CatalogPicker({
  catalog,
  pending,
  room,
  onClose,
  onPin,
}: {
  catalog: MoodCatalogOption[];
  pending: boolean;
  room: string;
  onClose: () => void;
  onPin: (ids: number[]) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [picked, setPicked] = useState<number[]>([]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter(
      (m) =>
        (cat === "All" || m.category === cat) &&
        (!needle ||
          m.name.toLowerCase().includes(needle) ||
          m.supplier.toLowerCase().includes(needle)),
    );
  }, [catalog, q, cat]);

  function toggle(id: number) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  return (
    <ModalShell title={`Add to ${room}`} onClose={onClose} wide>
      {catalog.length === 0 ? (
        <div className="p-4">
          <Card kind="dashed" className="p-8 text-center">
            <div className="text-[13px] text-ink-3">
              The catalog is empty. Add materials on the{" "}
              <Link href="/catalog" className="text-accent-2 underline">
                Catalog
              </Link>{" "}
              page, then pin them here.
            </div>
          </Card>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 border-b border-rule p-3">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or supplier…"
              className={FIELD}
            />
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCat(c)}>
                  <Chip kind={c === cat ? "ai" : "ghost"}>{c}</Chip>
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[46vh] overflow-y-auto p-3">
            {shown.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-ink-3">
                No materials match that search.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
                {shown.map((m) => {
                  const on = picked.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggle(m.id)}
                      className={`relative overflow-hidden rounded-md border text-left ${
                        on ? "border-accent ring-1 ring-accent" : "border-rule hover:border-ink-3"
                      }`}
                    >
                      {m.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.imageUrl} alt={m.name} className="aspect-square w-full object-cover" />
                      ) : (
                        <div className="aspect-square w-full bg-paper-3" />
                      )}
                      {on && (
                        <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-paper">
                          <Check className="size-3" strokeWidth={2.5} />
                        </span>
                      )}
                      <div className="border-t border-rule px-1.5 py-1">
                        <div className="line-clamp-1 text-[11px] text-ink">{m.name}</div>
                        <div className="line-clamp-1 text-[10px] text-ink-3">
                          {m.priceLabel || m.supplier}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-rule p-3">
            <span className="flex-1 text-[12px] text-ink-3">
              {picked.length === 0 ? "Nothing picked yet" : `${picked.length} picked`}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
            >
              Cancel
            </button>
            <button
              disabled={pending || picked.length === 0}
              onClick={() => onPin(picked)}
              className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
            >
              <Check className="size-3" strokeWidth={1.75} />
              Pin {picked.length > 0 ? picked.length : ""}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function UploadModal({
  pending,
  room,
  onClose,
  onAdd,
}: {
  pending: boolean;
  room: string;
  onClose: () => void;
  onAdd: (formData: FormData) => void;
}) {
  return (
    <ModalShell title={`Upload to ${room}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(new FormData(e.currentTarget));
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Image</span>
          <input
            name="image"
            type="file"
            accept="image/*"
            required
            autoFocus
            className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Note (optional)</span>
          <input name="note" maxLength={500} placeholder="Warm matte brass, honed stone" className={FIELD} />
        </label>
        <ModalActions pending={pending} onClose={onClose} submitLabel="Add" />
      </form>
    </ModalShell>
  );
}

function NoteModal({
  item,
  pending,
  onClose,
  onSave,
}: {
  item: MoodItem;
  pending: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(item.note);
  return (
    <ModalShell title={item.label || "Note"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(note);
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Note</span>
          <textarea
            autoFocus
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Why this one — finish, feel, where it goes"
            className={`${FIELD} resize-none`}
          />
        </label>
        <ModalActions pending={pending} onClose={onClose} submitLabel="Save" />
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[10vh]" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-[720px]" : "max-w-[460px]"} rounded-lg border border-rule bg-card shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
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
