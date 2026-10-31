"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import type { MarketingDraft } from "@/lib/marketing";
import { POST_LIMITS } from "@/lib/marketing-types";
import { addPostPhotos, setPhotoShareable, setPostTarget } from "@/lib/actions/marketing";
import { runAction } from "@/lib/run-action";
import { editableStage, InPostToggle } from "./PostingPanel";

const FIRST_SHOWN = 12;

/** A draft's photos: what's in the post (order, take out), add your own, and
 *  the job's photos (OK to share, Download, In post). */
export function PostPhotos({ draft, isOwner }: { draft: MarketingDraft; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const social = draft.kind === "social";
  const editable = social && editableStage(draft.stage);
  const byId = new Map(draft.photos.map((p) => [p.id, p]));
  const limit = draft.platform ? POST_LIMITS[draft.platform].maxPhotos : null;
  const shown = showAll ? draft.photos : draft.photos.slice(0, FIRST_SHOWN);

  function setMedia(media: string[]) {
    startTransition(async () => {
      await runAction(() => setPostTarget(draft.id, draft.platform ?? "", media), { fallback: "Couldn't change the photos." });
      router.refresh();
    });
  }
  function move(i: number, by: -1 | 1) {
    const m = [...draft.media];
    const j = i + by;
    if (j < 0 || j >= m.length) return;
    [m[i], m[j]] = [m[j], m[i]];
    setMedia(m);
  }
  function upload(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    fd.set("draftId", String(draft.id));
    for (const f of Array.from(files)) fd.append("photos", f);
    startTransition(async () => {
      const r = await runAction(() => addPostPhotos(fd), { fallback: "Couldn't add the photos." });
      if (r && "ok" in r && r.ok && "message" in r && r.message) toast({ kind: "success", message: String(r.message) });
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    });
  }

  if (!draft.projectSlug) return null;

  return (
    <div className="mt-2 space-y-2">
      {social && draft.platform && (
        <div>
          <div className="mb-1 text-[11px] text-ink-3">
            In this post{limit ? ` (up to ${limit})` : ""}: {draft.media.length ? "first one shows first. Use the arrows to reorder." : "none yet. Tick “In post” below or add your own."}
          </div>
          {draft.media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {draft.media.map((id, i) => (
                <div key={id} className="relative rounded-md border-2 border-ai p-0.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${id}`} alt={byId.get(id)?.name ?? "photo"} className="size-20 rounded object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-ink px-1 font-mono text-[10px] font-semibold text-paper">{i + 1}</span>
                  {editable && (
                    <div className="mt-0.5 flex items-center justify-between">
                      <button type="button" aria-label="Move earlier" disabled={pending || i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-ink-2 hover:bg-paper-2 disabled:opacity-30">
                        <ChevronLeft className="size-3.5" strokeWidth={2} />
                      </button>
                      <button type="button" aria-label="Take out of the post" disabled={pending} onClick={() => setMedia(draft.media.filter((m) => m !== id))} className="rounded p-0.5 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-30">
                        <X className="size-3.5" strokeWidth={2} />
                      </button>
                      <button type="button" aria-label="Move later" disabled={pending || i === draft.media.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-ink-2 hover:bg-paper-2 disabled:opacity-30">
                        <ChevronRight className="size-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          <span className="flex-1">
            Job photos: tick the ones the client OK&apos;d sharing; download those to post with the text{social ? ", or tick “In post” for the posting agent" : ""}.
          </span>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <button
            type="button"
            disabled={pending}
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
          >
            <ImagePlus className="size-3.5" strokeWidth={1.75} /> {pending ? "Working…" : "Add your own photos"}
          </button>
        </div>
        {!isOwner && <div className="mb-1 text-[10px] text-ink-3">Photos you add go on the job; Joe ticks OK to share.</div>}
        {draft.photos.length === 0 ? (
          <div className="text-[11px] text-ink-3">No photos on this job yet.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {shown.map((p) => (
              <div key={p.id} className={`flex flex-col items-center gap-1 rounded-md border p-1 ${p.shareable ? "border-money" : "border-rule"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${p.id}`} alt={p.name} className="size-16 rounded object-cover" loading="lazy" />
                <label className="flex items-center gap-1 text-[10px] text-ink-3">
                  <input
                    type="checkbox"
                    checked={p.shareable}
                    disabled={pending || !isOwner}
                    onChange={(e) =>
                      startTransition(async () => {
                        await runAction(() => setPhotoShareable(draft.projectSlug!, p.id, e.target.checked), { fallback: "Couldn't change that photo." });
                        router.refresh();
                      })
                    }
                  />
                  OK to share
                </label>
                {p.shareable && (
                  <a href={`/api/files/${p.id}?download=1`} download={p.name} className="text-[10px] font-semibold text-accent-2 hover:underline">
                    Download
                  </a>
                )}
                {p.shareable && social && <InPostToggle draft={draft} photoId={p.id} disabled={pending} />}
              </div>
            ))}
          </div>
        )}
        {draft.photos.length > FIRST_SHOWN && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="mt-1 text-[11px] font-semibold text-accent-2 hover:underline">
            {showAll ? "Show fewer" : `Show all ${draft.photos.length} job photos`}
          </button>
        )}
      </div>
    </div>
  );
}
