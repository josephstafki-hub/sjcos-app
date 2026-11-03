"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import type { MarketingDraft } from "@/lib/marketing";
import { addPostPhotos, setPhotoShareable } from "@/lib/actions/marketing";
import { runAction } from "@/lib/run-action";

const FIRST_SHOWN = 12;

/** A draft's job photos to post with it by hand: the ones the client OK'd
 *  sharing come first, each with Download; Joe ticks OK to share on the rest
 *  (owner only), and anyone can add their own. */
export function PostPhotos({ draft, isOwner }: { draft: MarketingDraft; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = showAll ? draft.photos : draft.photos.slice(0, FIRST_SHOWN);
  const shareable = draft.photos.filter((p) => p.shareable).length;

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
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          <span className="flex-1">
            Photos to post with it: download the ones the client OK&apos;d sharing{isOwner ? "; tick OK to share on any others they agreed to" : ""}.
            {draft.photos.length > 0 && <> {shareable ? `${shareable} OK to share.` : "None OK'd yet."}</>}
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
        {!isOwner && <div className="mb-1 text-[10px] text-ink-3">Photos you add go on the job; Joe ticks OK to share before they can be downloaded.</div>}
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
