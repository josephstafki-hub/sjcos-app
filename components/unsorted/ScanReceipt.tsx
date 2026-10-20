"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, Send, X } from "lucide-react";
import { Card } from "@/components/ui";

export interface ScanJob {
  slug: string;
  name: string;
  client_name: string;
}

interface Pic {
  key: string;
  file: File;
  url: string;
}

/** Shrink a phone photo before it goes up: the right way round, ≤2000px,
 *  JPEG. Keeps a 6 MB camera shot to a few hundred KB on a job-site signal.
 *  Anything the browser can't draw goes up as it is. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

/** /scan — photograph a receipt (or several) and send it in. Claude reads it
 *  and files it to the job, or leaves it on Unsorted when it can't tell. */
export function ScanReceipt({ jobs, canSort }: { jobs: ScanJob[]; canSort: boolean }) {
  const [pics, setPics] = useState<Pic[]>([]);
  const [job, setJob] = useState("");
  const [note, setNote] = useState("");
  const [oneReceipt, setOneReceipt] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ count: number; again: number } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const picsRef = useRef(pics);

  // Let go of the preview URLs when the page goes away.
  useEffect(() => {
    picsRef.current = pics;
  }, [pics]);
  useEffect(() => () => picsRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function add(list: FileList | null) {
    if (!list?.length) return;
    const next = Array.from(list).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, url: URL.createObjectURL(file) }));
    setPics((p) => [...p, ...next].slice(0, 12));
    setError("");
    setSent(null);
  }

  function remove(key: string) {
    setPics((p) => {
      const gone = p.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return p.filter((x) => x.key !== key);
    });
  }

  async function send() {
    if (!pics.length || sending) return;
    setSending(true);
    setError("");
    try {
      const form = new FormData();
      for (const p of pics) {
        const blob = await shrink(p.file);
        const name = blob === p.file ? p.file.name : `${p.file.name.replace(/\.[^.]+$/, "") || "receipt"}.jpg`;
        form.append("photo", blob, name);
      }
      if (job) form.append("project_slug", job);
      if (note.trim()) form.append("note", note.trim());
      if (oneReceipt && pics.length > 1) form.append("one_receipt", "1");
      const res = await fetch("/api/receipts/scan", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; receipts?: { existed: boolean }[]; skipped?: string[] };
      if (!res.ok || !body.ok) {
        setError(body.error || "Couldn't send that. Try again.");
        return;
      }
      const receipts = body.receipts ?? [];
      pics.forEach((p) => URL.revokeObjectURL(p.url));
      setPics([]);
      setNote("");
      setOneReceipt(false);
      setSent({ count: receipts.filter((r) => !r.existed).length, again: receipts.filter((r) => r.existed).length });
      if (body.skipped?.length) setError(`Couldn't open ${body.skipped.join(", ")}.`);
    } catch {
      setError("Couldn't reach the server. Check your signal and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3 px-4 py-5">
      <div>
        <h1 className="font-serif text-[28px] font-medium leading-none tracking-tight text-accent-2">Scan a receipt</h1>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          Snap it and send it. Claude reads the store, items and total and files it to the job — or puts it in Unsorted if it
          can&apos;t tell which job.
        </p>
      </div>

      {sent && (
        <Card className="flex items-start gap-2.5 border-money bg-money-soft p-3.5 text-[13px] text-ink">
          <CheckCircle2 className="mt-0.5 size-4 flex-none text-money" />
          <div className="min-w-0 flex-1">
            {sent.count > 0 && (
              <p>
                Sent {sent.count === 1 ? "1 receipt" : `${sent.count} receipts`}. Claude is reading {sent.count === 1 ? "it" : "them"} now.
              </p>
            )}
            {sent.again > 0 && <p className={sent.count ? "mt-1 text-ink-3" : ""}>{sent.again === 1 ? "That photo was" : `${sent.again} photos were`} already sent before.</p>}
            {canSort && (
              <Link href="/unsorted" className="mt-1 inline-block font-semibold text-accent-2 hover:underline">
                Open Unsorted →
              </Link>
            )}
          </div>
        </Card>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={libraryRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-accent bg-accent-soft px-3 py-7 text-accent-2 active:scale-[0.99]"
        >
          <Camera className="size-8" strokeWidth={1.5} />
          <span className="text-[15px] font-semibold">{pics.length ? "Take another" : "Take a photo"}</span>
        </button>
        <button
          type="button"
          onClick={() => libraryRef.current?.click()}
          className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-rule bg-card px-3 py-7 text-ink-2 active:scale-[0.99]"
        >
          <ImagePlus className="size-6" strokeWidth={1.5} />
          <span className="text-[12.5px] font-semibold">From photos</span>
        </button>
      </div>

      {pics.length > 0 && (
        <Card className="flex flex-col gap-3 p-3.5">
          <div className="grid grid-cols-3 gap-2">
            {pics.map((p) => (
              <div key={p.key} className="relative aspect-[3/4] overflow-hidden rounded-lg border border-rule bg-paper-2">
                {p.file.type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.file.name} className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center p-2 text-center text-[11px] text-ink-3">{p.file.name}</div>
                )}
                <button
                  type="button"
                  onClick={() => remove(p.key)}
                  aria-label="Remove photo"
                  className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>

          {pics.length > 1 && (
            <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={oneReceipt} onChange={(e) => setOneReceipt(e.target.checked)} className="mt-0.5" />
              <span>
                These photos are one long receipt
                <span className="block text-[11px] text-ink-3">Otherwise each photo is its own receipt.</span>
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1 text-[12px] text-ink-3">
            Which job? (optional)
            <select value={job} onChange={(e) => setJob(e.target.value)} className="rounded-lg border border-rule bg-paper px-2.5 py-2 text-[14px] text-ink">
              <option value="">Not sure — let Claude figure it out</option>
              {jobs.map((j) => (
                <option key={j.slug} value={j.slug}>
                  {j.name}
                  {j.client_name && j.client_name !== j.name ? ` · ${j.client_name}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-ink-3">
            Anything to add? (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. trim for the Libby basement"
              className="rounded-lg border border-rule bg-paper px-2.5 py-2 text-[14px] text-ink placeholder:text-ink-4"
            />
          </label>

          {error && <p className="text-[12.5px] text-flag">{error}</p>}

          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {sending ? "Sending…" : `Send ${pics.length === 1 || oneReceipt ? "receipt" : `${pics.length} receipts`}`}
          </button>
        </Card>
      )}
      {!pics.length && error && <p className="text-[12.5px] text-flag">{error}</p>}
    </div>
  );
}
