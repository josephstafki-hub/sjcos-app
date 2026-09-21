"use client";

// Drawing-set builder: pick sheets / paper / captures / version → publish a
// project_floorplans row, then optionally stage it for signature. Sending
// stays behind the owner grant — the action stages a draft and reports.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DesignerContext } from "../view-state";
import { DEFAULT_SHEETS, PAPER_LABELS, SHEET_KEYS, SHEET_LABELS, type PaperSize, type SheetKey } from "@/lib/plan-print-types";
import { publishPlanVersion, sendDesignForSignature } from "@/lib/actions/plan-publish";
import { runAction } from "@/lib/run-action";
import { BTN_PRIMARY, INPUT_CLS, LABEL_CLS, Toggle } from "./fields";

export function SheetBuilder({ ctx }: { ctx: DesignerContext }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ro = ctx.readOnly;
  const latest = ctx.versions[0] ?? null;
  const [sheets, setSheets] = useState<Set<SheetKey>>(() => new Set(DEFAULT_SHEETS));
  const [paper, setPaper] = useState<PaperSize>("tabloid");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  const [versionId, setVersionId] = useState<string>(latest ? String(latest.id) : "");
  const [captureIds, setCaptureIds] = useState<Set<string>>(() => new Set(ctx.files.filter((f) => f.kind === "capture").map((f) => f.fileId)));
  const [notes, setNotes] = useState("");
  const [published, setPublished] = useState<{ floorplanId: number; versionId: number } | null>(null);
  const [signer, setSigner] = useState({ signerName: "", signerEmail: "", title: `${ctx.design.name} — plan approval` });
  const [signNote, setSignNote] = useState<string | null>(null);

  const captures = ctx.files.filter((f) => f.kind === "capture");
  const toggleSheet = (k: SheetKey, on: boolean) =>
    setSheets((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  const toggleCapture = (id: string, on: boolean) =>
    setCaptureIds((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const publish = () =>
    start(async () => {
      await ctx.d.saveNow();
      const r = await runAction(() =>
        publishPlanVersion(ctx.design.id, {
          versionId: versionId ? Number(versionId) : null,
          sheets: SHEET_KEYS.filter((k) => sheets.has(k)),
          paper,
          orientation,
          captureFileIds: captures.filter((c) => captureIds.has(c.fileId)).map((c) => c.fileId),
          notes: notes.trim(),
        }),
      );
      if (r.ok && "floorplanId" in r) {
        setPublished({ floorplanId: r.floorplanId, versionId: r.versionId });
        router.refresh();
      }
    });

  const send = () =>
    start(async () => {
      if (!published) return;
      const r = await runAction(() => sendDesignForSignature(ctx.design.id, published.floorplanId, signer));
      if (r.ok) setSignNote(("error" in r && r.error) || "Staged for signature. Sending needs Joe&apos;s owner grant — approve it on /engine/permissions.");
    });

  const pubVersion = published ? ctx.versions.find((v) => v.id === published.versionId) ?? null : null;
  const planLink = ctx.design.projectSlug ? `/projects/${ctx.design.projectSlug}?tab=Floor` : ctx.design.leadSlug ? `/leads/${ctx.design.leadSlug}` : null;

  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <div>
        <div className={`mb-1 ${LABEL_CLS}`}>Sheets</div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {SHEET_KEYS.map((k) => (
            <Toggle key={k} label={SHEET_LABELS[k]} on={sheets.has(k)} disabled={ro} onChange={(on) => toggleSheet(k, on)} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className={`mb-0.5 ${LABEL_CLS}`}>Paper</div>
          <select className={INPUT_CLS} value={paper} disabled={ro} onChange={(e) => setPaper(e.target.value as PaperSize)}>
            {(Object.keys(PAPER_LABELS) as PaperSize[]).map((p) => (
              <option key={p} value={p}>
                {PAPER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className={`mb-0.5 ${LABEL_CLS}`}>Orientation</div>
          <select className={INPUT_CLS} value={orientation} disabled={ro} onChange={(e) => setOrientation(e.target.value as "portrait" | "landscape")}>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </label>
      </div>
      {captures.length > 0 && (
        <div>
          <div className={`mb-1 ${LABEL_CLS}`}>Include captures</div>
          <div className="flex flex-col gap-0.5">
            {captures.map((c) => (
              <Toggle key={c.id} label={c.label} on={captureIds.has(c.fileId)} disabled={ro} onChange={(on) => toggleCapture(c.fileId, on)} />
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <div className={`mb-0.5 ${LABEL_CLS}`}>Version</div>
        {ctx.versions.length === 0 ? (
          <div className="text-flag">Cut a new version first (above).</div>
        ) : (
          <select className={INPUT_CLS} value={versionId} disabled={ro} onChange={(e) => setVersionId(e.target.value)}>
            {ctx.versions.map((v) => (
              <option key={v.id} value={String(v.id)}>
                v{v.number} · {v.label}
                {v.published ? " (published)" : ""}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="block">
        <div className={`mb-0.5 ${LABEL_CLS}`}>Notes for the client</div>
        <textarea className={`${INPUT_CLS} min-h-[48px] resize-y`} value={notes} disabled={ro} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button type="button" className={BTN_PRIMARY} disabled={ro || pending || ctx.versions.length === 0 || sheets.size === 0} onClick={publish}>
        {pending ? "Rendering…" : "Publish plan version"}
      </button>

      {published && (
        <div className="rounded-md border border-money bg-money-soft px-2.5 py-2 text-money">
          Plan {pubVersion ? `v${pubVersion.number}` : `#${published.floorplanId}`} created on the Floor tab.{" "}
          {planLink && (
            <a className="underline" href={planLink}>
              Open it
            </a>
          )}
        </div>
      )}

      {published && ctx.design.projectSlug && (
        <div className="mt-1 rounded-md border border-rule px-2.5 py-2">
          <div className={`${LABEL_CLS} mb-1`}>Send for signature</div>
          <div className="flex flex-col gap-1.5">
            <input className={INPUT_CLS} placeholder="Signer name" value={signer.signerName} onChange={(e) => setSigner({ ...signer, signerName: e.target.value })} />
            <input className={INPUT_CLS} placeholder="Signer email" type="email" value={signer.signerEmail} onChange={(e) => setSigner({ ...signer, signerEmail: e.target.value })} />
            <input className={INPUT_CLS} placeholder="Document title" value={signer.title} onChange={(e) => setSigner({ ...signer, title: e.target.value })} />
            <p className="text-[11px] leading-snug text-ink-3">
              This stages a signature draft. Actually sending it to the client needs Joe&apos;s owner grant (the Ask window or /engine/permissions).
            </p>
            <button type="button" className={BTN_PRIMARY} disabled={pending || !signer.signerName.trim() || !signer.signerEmail.trim()} onClick={send}>
              Stage for signature
            </button>
            {signNote && <div className="text-[11.5px] text-money">{signNote}</div>}
          </div>
        </div>
      )}
      {published && !ctx.design.projectSlug && <div className="text-[11px] text-ink-3">Signature requests are available on project-scoped designs.</div>}
    </div>
  );
}
