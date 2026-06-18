"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus } from "lucide-react";
import { Card, Eyebrow, PhotoGrid } from "@/components/ui";
import { uploadLeadPhoto } from "@/lib/actions/files";

/** Lead photos: real uploaded images (click to open the lightbox) plus an
 *  owner "Add photos" control. `placeholderCount` keeps the showcase grid for
 *  curated leads that have no real uploads yet. */
export function LeadPhotos({
  slug,
  photos,
  placeholderCount,
}: {
  slug: string;
  photos: { id: string; name: string }[];
  placeholderCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const srcs = photos.map((p) => `/api/files/${p.id}`);
  const hasReal = photos.length > 0;
  const count = hasReal ? photos.length : placeholderCount;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    startUpload(async () => {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await uploadLeadPhoto(slug, fd);
        if (!res.ok) {
          setError(res.error);
          break;
        }
      }
    });
  }

  if (count <= 0 && !uploading) {
    // No photos yet — show just the add affordance.
    return (
      <Card className="p-3">
        <div className="flex items-center">
          <Eyebrow muted>Photos</Eyebrow>
          <div className="flex-1" />
          <AddButton inputRef={inputRef} uploading={uploading} />
        </div>
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
        <p className="mt-2 text-[12px] text-ink-3">No photos yet — add site or intake photos.</p>
        {error && <p className="mt-1 text-[11px] text-flag">{error}</p>}
      </Card>
    );
  }

  return (
    <Card className="p-3">
      <div className="flex items-center">
        <Eyebrow muted>Photos · {count}</Eyebrow>
        <div className="flex-1" />
        <AddButton inputRef={inputRef} uploading={uploading} />
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
      <PhotoGrid count={count} srcs={hasReal ? srcs : undefined} label="Site photo" />
      {error && <p className="mt-1 text-[11px] text-flag">{error}</p>}
    </Card>
  );
}

function AddButton({
  inputRef,
  uploading,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={uploading}
      className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-0.5 text-[11px] font-semibold text-ink transition-colors hover:bg-paper-2 disabled:opacity-60"
    >
      <ImagePlus className="size-3" strokeWidth={1.5} />
      {uploading ? "Uploading…" : "Add photos"}
    </button>
  );
}
