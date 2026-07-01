"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Plus, X } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { IncidentReport } from "@/lib/safety";
import { SEVERITIES } from "@/lib/incident-types";
import { createIncidentReport } from "@/lib/actions/safety";

const SEV_CHIP: Record<string, "flag" | "accent" | "ghost"> = {
  serious: "flag",
  recordable: "accent",
  minor: "ghost",
  near_miss: "ghost",
};

/** Incident reports section for the Safety tab — log an incident (AI drafts the
 *  narrative → PDF) and see past reports. */
export function Incidents({ slug, incidents }: { slug: string; incidents: IncidentReport[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const inputCls =
    "w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

  return (
    <div className="mt-2 border-t border-rule pt-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-flag" strokeWidth={1.75} />
        <h3 className="flex-1 font-serif text-[14px] font-semibold text-ink">Incident reports</h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          {open ? <X className="size-3" strokeWidth={2} /> : <Plus className="size-3" strokeWidth={2} />}
          {open ? "Cancel" : "Report an incident"}
        </button>
      </div>

      {open && (
        <Card className="mt-3 p-4">
          <form
            ref={formRef}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(async () => {
                setError("");
                const r = await createIncidentReport(slug, fd);
                if (r.ok) {
                  formRef.current?.reset();
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(r.error ?? "Couldn't create the report.");
                }
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Date of incident</span>
                <input name="occurredAt" type="date" className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Severity</span>
                <select name="severity" defaultValue="minor" className={inputCls}>
                  {SEVERITIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-2">Reported by</span>
              <input name="reporter" placeholder="Your name" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-2">What happened</span>
              <textarea name="notes" required rows={4} placeholder="Notes — AI drafts a factual narrative from these." className={`${inputCls} resize-y`} />
            </label>
            {error && <div className="text-[12px] text-flag">{error}</div>}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
            >
              {pending ? "Generating…" : "Generate report"}
            </button>
          </form>
        </Card>
      )}

      {incidents.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {incidents.map((i) => (
            <Card key={i.id} className="p-3.5">
              <div className="flex items-center gap-2">
                <Chip kind={SEV_CHIP[i.severity] ?? "ghost"} dot>
                  {i.severityLabel}
                </Chip>
                <span className="flex-1 text-[11px] text-ink-3">
                  {i.occurredLabel || "date n/a"}{i.reporter ? ` · ${i.reporter}` : ""}
                </span>
                {i.fileId && (
                  <a
                    href={`/api/files/${i.fileId}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-accent-2 hover:underline"
                  >
                    <FileText className="size-3" strokeWidth={1.75} /> PDF
                  </a>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-snug text-ink-2">{i.narrative}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
