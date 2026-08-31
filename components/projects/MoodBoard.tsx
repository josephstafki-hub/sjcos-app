"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  LayoutGrid,
  Palette,
  Plus,
  Settings2,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { CATEGORIES } from "@/lib/catalog-categories";
import type { MoodBoardData, MoodItem } from "@/lib/mood";
import {
  addCatalogMoodItems,
  addMoodImage,
  addMoodSwatch,
  addMoodText,
  createMoodBoard,
  deleteMoodBoard,
  duplicateMoodItem,
  removeMoodImage,
  renameMoodBoard,
  reorderMoodItem,
  saveMoodLayout,
  setMoodBoardPublished,
  updateMoodBoard,
  updateMoodLabel,
  updateMoodNote,
  updateMoodSwatch,
} from "@/lib/actions/mood";
import { useRemoved } from "@/lib/use-removed";
import { MoodCanvas, type MoodPatch } from "./MoodCanvas";

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

interface RunOptions {
  onSuccess?: () => void;
  /** Roll back an optimistic change when the write fails. */
  onError?: () => void;
  fallback?: string;
  /** Skip the router refetch when the canvas already shows the change locally. */
  refresh?: boolean;
}

const FIELD = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3";
const TOOL =
  "inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50";

/** A starting palette for swatches and board backgrounds — warm neutrals and
 *  the greens/clays that show up most in this shop's finishes. */
const PRESETS = [
  "#f5f1e8", "#e8ddcb", "#d6c7ae", "#b9a687", "#8c7a5e",
  "#2e3a24", "#4a5c3a", "#7d8f6a", "#a8b89a", "#ffffff",
  "#3a3f44", "#6b7075", "#a9adb1", "#c9a227", "#9c5b3f",
];

/** Project Mood tab — a mood-board creator. One free-form canvas per room: pin
 *  items straight from the catalog (name/price/image snapshotted at pin time),
 *  upload a reference image, drop a text block or a colour swatch, then drag,
 *  resize, crop, rotate and restack them into a composition to show the client.
 *  Owner-only; images are served through the owner-only /api/files. */
export function MoodBoard({
  slug,
  boards,
  catalog,
}: {
  slug: string;
  boards: MoodBoardData[];
  catalog: MoodCatalogOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [picker, setPicker] = useState(false);
  const [upload, setUpload] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [swatchOpen, setSwatchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<MoodItem | null>(null);
  /** Optimistically removed rows (`item:<id>` and `board:<room>`). A row
   *  disappears the moment its delete is clicked and only comes back if the
   *  write fails — waiting for the round trip (and disabling the X while ANY
   *  save was in flight, which is what the old `disabled={pending}` did) made
   *  removal feel broken. Item ids are serial and never reused; a board key is
   *  the room NAME, so addRoom restores it in case a deleted room is recreated. */
  const { removed, hide, restore } = useRemoved();
  /** A room the owner just created, held locally only for the frame between the
   *  write landing and the new props arriving — createMoodBoard persists it, so
   *  unlike before it no longer vanishes on reload. */
  const [draftRoom, setDraftRoom] = useState<string | null>(null);
  const [newRoom, setNewRoom] = useState(false);
  // A deep link (?tab=Mood&focus=mood-<room>) opens on that room.
  const searchParams = useSearchParams();
  const linkedRoom = searchParams.get("focus")?.startsWith("mood-")
    ? searchParams.get("focus")!.slice("mood-".length)
    : null;
  const [activeRoom, setActiveRoom] = useState<string | null>(linkedRoom);

  const rooms = useMemo(() => {
    const names = boards.map((b) => b.room).filter((r) => !removed.has(`board:${r}`));
    return draftRoom && !names.includes(draftRoom) ? [...names, draftRoom] : names;
  }, [boards, draftRoom, removed]);

  const room = (activeRoom && rooms.includes(activeRoom) ? activeRoom : rooms[0]) ?? null;
  const board = boards.find((b) => b.room === room) ?? null;
  const items = (board?.items ?? []).filter((i) => !removed.has(`item:${i.id}`));

  // Single path for every mutation on this board. The actions revalidate on the
  // server, but the project page is dynamic (cookie auth), so nothing re-renders
  // until the client router refetches — without router.refresh() a pinned item
  // lands in the DB and never shows up. On failure the modal stays open with the
  // error so the owner's picks survive.
  function run(
    fn: () => Promise<Result>,
    { onSuccess, onError, fallback = "Something went wrong.", refresh = true }: RunOptions = {},
  ) {
    setError("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? fallback);
        onError?.();
        return;
      }
      onSuccess?.();
      if (refresh) router.refresh();
    });
  }

  /** Remove an item optimistically: hide it now, restore it if the write fails. */
  function removeItem(id: number) {
    hide(`item:${id}`);
    run(() => removeMoodImage(id), {
      fallback: "Could not remove that.",
      onError: () => restore(`item:${id}`),
    });
  }

  /** Delete a board optimistically: its room chip drops out now (the next room
   *  takes focus) and only comes back if the delete fails. */
  function deleteBoard(name: string) {
    hide(`board:${name}`);
    if (draftRoom === name) setDraftRoom(null);
    setActiveRoom(null);
    setSettingsOpen(false);
    setDeleteOpen(false);
    run(() => deleteMoodBoard(slug, name), {
      fallback: "Could not delete the board.",
      onError: () => restore(`board:${name}`),
    });
  }

  function addRoom(name: string) {
    const clean = name.trim();
    if (!clean) return;
    // A recreated room must not stay hidden by an earlier optimistic delete.
    restore(`board:${clean}`);
    if (!rooms.includes(clean)) setDraftRoom(clean);
    setActiveRoom(clean);
    setNewRoom(false);
    run(() => createMoodBoard(slug, clean), { fallback: "Could not create that board." });
  }

  // The catalog-sourced pins on the active board, for the spec list under the
  // canvas — scoped to this room so it reads as that room's product list.
  const products = items.filter((i) => i.kind === "pin" && i.label);

  /** Publish/unpublish the active board on the client dashboard. Publishing
   *  also emails the client — show what actually happened, not just "done". */
  function publishBoard(to: boolean) {
    if (!room) return;
    setError("");
    setNotice("");
    startTransition(async () => {
      const r = await setMoodBoardPublished(slug, room, to);
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else {
        setNotice(to ? (r.delivery?.note ?? "Published.") : "Removed from the client dashboard.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4" data-focus={room ? `mood-${room}` : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1">
          <h3 className="font-serif text-[16px] font-semibold text-ink">
            {board?.title || "Mood board"}
          </h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Drag to move, handles to resize (corners keep proportions, Shift frees them), the stem
            above to rotate, the crop tool to pan and zoom an image inside its frame. Arrow keys
            nudge the selected item; Delete removes it.
          </p>
        </div>
        <button
          onClick={() => publishBoard(!board?.published)}
          disabled={!room || pending}
          title={board?.published ? "Remove this board from the client dashboard" : "Publish this board to the client dashboard (emails the client)"}
          className={
            board?.published
              ? TOOL
              : "inline-flex items-center gap-1 rounded-md border border-accent bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
          }
        >
          {board?.published ? (
            <>
              <EyeOff className="size-3" strokeWidth={1.5} /> Unpublish
            </>
          ) : (
            <>
              <Eye className="size-3" strokeWidth={1.5} /> Publish
            </>
          )}
        </button>
        <button onClick={() => setSettingsOpen(true)} disabled={!room} className={TOOL} title="Board settings">
          <Settings2 className="size-3" strokeWidth={1.5} />
          Settings
        </button>
        <button
          onClick={() => setDeleteOpen(true)}
          disabled={!room}
          title="Delete this board"
          className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:border-flag hover:text-flag disabled:opacity-50"
        >
          <Trash2 className="size-3" strokeWidth={1.5} />
          Delete
        </button>
        <button onClick={() => setTextOpen(true)} disabled={!room} className={TOOL}>
          <Type className="size-3" strokeWidth={1.5} />
          Text
        </button>
        <button onClick={() => setSwatchOpen(true)} disabled={!room} className={TOOL}>
          <Palette className="size-3" strokeWidth={1.5} />
          Swatch
        </button>
        <button onClick={() => setUpload(true)} disabled={!room} className={TOOL}>
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
      {notice && <div className="text-[12px] text-money">{notice}</div>}

      {/* Dashboard state for the active board. */}
      {board && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip kind={board.published ? "money" : "ghost"} dot>
            {board.published ? "On client dashboard" : "Hidden from client"}
          </Chip>
          {board.approvedLabel && (
            <Chip kind="money" dot>
              approved by {board.approvedName || "client"} · {board.approvedLabel}
            </Chip>
          )}
        </div>
      )}

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
            bgColor={board?.bgColor ?? ""}
            // The canvas keeps the dragged position in its own overrides map, so a
            // refetch per drag would be wasted work — just persist it.
            onMove={(pos: MoodPatch) =>
              run(() => saveMoodLayout(slug, [pos], pos.id), {
                refresh: false,
                fallback: "Could not save the layout.",
              })
            }
            onRemove={removeItem}
            onEditNote={(item) => setEditing(item)}
            onLayer={(id, dir) => run(() => reorderMoodItem(id, dir), { fallback: "Could not restack that." })}
            onDuplicate={(id) => run(() => duplicateMoodItem(id), { fallback: "Could not duplicate that." })}
          />
          {items.length === 0 && (
            <p className="-mt-2 text-center text-[12px] text-ink-3">
              {room} is empty — add items from the catalog, upload a reference image, or drop in text
              and colour swatches.
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

          {board && board.feedback.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Client feedback on this board</span>
              <Card className="divide-y divide-rule p-0">
                {board.feedback.map((f) => (
                  <div key={f.id} className="px-3 py-2">
                    <p className="whitespace-pre-wrap text-[12.5px] leading-snug text-ink">{f.body}</p>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">
                      {f.name} · {f.when}
                    </div>
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
            run(() => addCatalogMoodItems(slug, room, ids), {
              onSuccess: () => setPicker(false),
              fallback: "Could not pin those items.",
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
            run(
              () => {
                fd.set("room", room);
                return addMoodImage(slug, fd);
              },
              { onSuccess: () => setUpload(false), fallback: "Could not add the image." },
            )
          }
        />
      )}

      {textOpen && room && (
        <TextModal
          pending={pending}
          room={room}
          onClose={() => setTextOpen(false)}
          onAdd={(text) =>
            run(() => addMoodText(slug, room, text), {
              onSuccess: () => setTextOpen(false),
              fallback: "Could not add that text.",
            })
          }
        />
      )}

      {swatchOpen && room && (
        <SwatchModal
          pending={pending}
          room={room}
          onClose={() => setSwatchOpen(false)}
          onAdd={(color, label) =>
            run(() => addMoodSwatch(slug, room, color, label), {
              onSuccess: () => setSwatchOpen(false),
              fallback: "Could not add that swatch.",
            })
          }
        />
      )}

      {settingsOpen && room && (
        <BoardSettingsModal
          pending={pending}
          room={room}
          title={board?.title ?? ""}
          bgColor={board?.bgColor ?? ""}
          onClose={() => setSettingsOpen(false)}
          onSave={({ title, bgColor, rename }) =>
            run(
              async () => {
                // Strictly sequential: the settings row is keyed by room name, so
                // a rename that landed first would leave this write pointing at a
                // room that no longer exists — and ensureBoard would helpfully
                // resurrect it as a phantom empty board.
                const saved = await updateMoodBoard(slug, room, { title, bgColor });
                if (!saved.ok) return saved;
                if (!rename || rename === room) return saved;
                return renameMoodBoard(slug, room, rename);
              },
              {
                onSuccess: () => {
                  if (rename && rename !== room) {
                    setDraftRoom(null);
                    setActiveRoom(rename);
                  }
                  setSettingsOpen(false);
                },
                fallback: "Could not save the board.",
              },
            )
          }
          onDelete={() => deleteBoard(room)}
        />
      )}

      {deleteOpen && room && (
        <ModalShell title={`Delete ${room}?`} onClose={() => setDeleteOpen(false)}>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-[13px] text-ink-2">
              This deletes the {room} board and all{" "}
              {items.length === 1 ? "1 item" : `${items.length} items`} on it. Uploaded images stay
              in Files; this can&apos;t be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteBoard(room)}
                className="inline-flex items-center gap-1 rounded-md border border-flag bg-flag px-3 py-1.5 text-[12px] font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                <Trash2 className="size-3" strokeWidth={1.75} />
                Delete board
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {editing && (
        <EditModal
          item={editing}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={async ({ label, note, swatch }) => {
            // Three independent columns behind one form — run them in sequence
            // and stop at the first failure so the error is the real one.
            run(
              async () => {
                if (label !== undefined) {
                  const r = await updateMoodLabel(editing.id, label);
                  if (!r.ok) return r;
                }
                if (swatch !== undefined) {
                  const r = await updateMoodSwatch(editing.id, swatch);
                  if (!r.ok) return r;
                }
                return updateMoodNote(editing.id, note);
              },
              { onSuccess: () => setEditing(null), fallback: "Could not save that." },
            );
          }}
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
              Add {picked.length > 0 ? picked.length : ""} to board
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

/** A standalone text block — a heading, a client note, an instruction. */
function TextModal({
  pending,
  room,
  onClose,
  onAdd,
}: {
  pending: boolean;
  room: string;
  onClose: () => void;
  onAdd: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <ModalShell title={`Add text to ${room}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(text);
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Text</span>
          <textarea
            autoFocus
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            placeholder="Warm minimal — oak, brass, lime plaster"
            className={`${FIELD} resize-none`}
          />
        </label>
        <ModalActions pending={pending} onClose={onClose} submitLabel="Add" disabled={!text.trim()} />
      </form>
    </ModalShell>
  );
}

/** A solid colour chip — paint, stain, grout. */
function SwatchModal({
  pending,
  room,
  onClose,
  onAdd,
}: {
  pending: boolean;
  room: string;
  onClose: () => void;
  onAdd: (color: string, label: string) => void;
}) {
  const [color, setColor] = useState("#e8ddcb");
  const [label, setLabel] = useState("");
  return (
    <ModalShell title={`Add swatch to ${room}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(color, label);
        }}
        className="flex flex-col gap-3 p-4"
      >
        <ColorField label="Colour" value={color} onChange={setColor} />
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={200}
            placeholder="SW 7036 Accessible Beige"
            className={FIELD}
          />
        </label>
        <ModalActions pending={pending} onClose={onClose} submitLabel="Add" />
      </form>
    </ModalShell>
  );
}

/** Per-board settings, plus rename and delete for the whole board. */
function BoardSettingsModal({
  pending,
  room,
  title,
  bgColor,
  onClose,
  onSave,
  onDelete,
}: {
  pending: boolean;
  room: string;
  title: string;
  bgColor: string;
  onClose: () => void;
  onSave: (settings: { title: string; bgColor: string; rename: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(room);
  const [heading, setHeading] = useState(title);
  const [bg, setBg] = useState(bgColor || "#f5f1e8");
  const [useBg, setUseBg] = useState(Boolean(bgColor));
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <ModalShell title={`${room} board`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ title: heading, bgColor: useBg ? bg : "", rename: name.trim() });
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Room name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className={FIELD}
          />
          <span className="text-[11px] text-ink-3">
            Renaming onto an existing board merges the two.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Display title (optional)</span>
          <input
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            maxLength={200}
            placeholder="Primary bath — warm minimal"
            className={FIELD}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useBg} onChange={(e) => setUseBg(e.target.checked)} />
            <span className={LABEL}>Background colour</span>
          </label>
          {useBg && <ColorField label="" value={bg} onChange={setBg} />}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          {confirmDelete ? (
            <button
              type="button"
              disabled={pending}
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-md border border-flag px-3 py-1.5 text-[12px] font-semibold text-flag hover:bg-flag/10 disabled:opacity-50"
            >
              <Trash2 className="size-3" strokeWidth={1.75} />
              Delete board and everything on it
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-3 hover:text-flag"
            >
              <Trash2 className="size-3" strokeWidth={1.75} />
              Delete board
            </button>
          )}
          <div className="flex items-center gap-2">
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
              Save
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

/** Edit an item: its caption, its note, and its colour when it's a swatch. */
function EditModal({
  item,
  pending,
  onClose,
  onSave,
}: {
  item: MoodItem;
  pending: boolean;
  onClose: () => void;
  onSave: (v: { label?: string; note: string; swatch?: string }) => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [note, setNote] = useState(item.note);
  const [swatch, setSwatch] = useState(item.swatch || "#e8ddcb");
  const isText = item.kind === "text";
  const isSwatch = item.kind === "swatch";

  return (
    <ModalShell title={item.label || (isText ? "Text" : "Item")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            label,
            note,
            swatch: isSwatch ? swatch : undefined,
          });
        }}
        className="flex flex-col gap-3 p-4"
      >
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{isText ? "Text" : "Caption"}</span>
          <textarea
            autoFocus
            rows={isText ? 3 : 2}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={200}
            placeholder={isText ? "Warm minimal — oak, brass, lime plaster" : "Name shown on the card"}
            className={`${FIELD} resize-none`}
          />
        </label>

        {isSwatch && <ColorField label="Colour" value={swatch} onChange={setSwatch} />}

        {!isText && (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Note</span>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Why this one — finish, feel, where it goes"
              className={`${FIELD} resize-none`}
            />
          </label>
        )}

        <ModalActions pending={pending} onClose={onClose} submitLabel="Save" />
      </form>
    </ModalShell>
  );
}

/** Native colour picker + hex field + the shop palette, kept in step. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className={LABEL}>{label}</span>}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 cursor-pointer rounded-md border border-rule bg-paper p-0.5"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          spellCheck={false}
          className={`${FIELD} w-[110px] font-mono uppercase`}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            style={{ background: c }}
            className={`size-5 rounded border ${
              c.toLowerCase() === value.toLowerCase() ? "border-accent ring-1 ring-accent" : "border-rule"
            }`}
          />
        ))}
      </div>
    </div>
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

function ModalActions({
  pending,
  onClose,
  submitLabel,
  disabled,
}: {
  pending: boolean;
  onClose: () => void;
  submitLabel: string;
  disabled?: boolean;
}) {
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
        disabled={pending || disabled}
        className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
      >
        <Check className="size-3" strokeWidth={1.75} />
        {submitLabel}
      </button>
    </div>
  );
}
