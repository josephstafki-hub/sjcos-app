"use client";

import { useState, useTransition } from "react";
import { FileText, Download, FileStack } from "lucide-react";
import { Card } from "@/components/ui";
import { generatePermitPacket } from "@/lib/actions/permit";
import type { PermitFile } from "@/lib/permits";

/** Permits tab: generate a building-permit application packet PDF and list the
 *  ones already on file. Owner-only. The scope narrative is Qwen-drafted, so the
 *  Generate button runs ~10–20s on local CPU inference — shows pending. */
export function PermitPacket({ slug, permits }: { slug: string; permits: PermitFile[] }) {
  const [rows, setRows] = useState(permits);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setError(null);
    start(async () => {
      const res = await generatePermitPacket(slug);
      if (res.ok) {
        // The server revalidates; reflect the new packet immediately.
        setRows((prev) => [
          {
            id: res.id ?? `pending-${Date.now()}`,
            name: "Permit Packet.pdf",
            subtitle: "Just generated",
            createdLabel: "just now",
          },
          ...prev,
        ]);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="max-w-[680px]">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <FileStack className="mt-0.5 size-5 flex-none text-ink-3" strokeWidth={1.5} />
          <div className="flex-1">
            <h3 className="font-serif text-[16px] font-semibold text-ink">Building permit packet</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
              Generates a cover packet — project, owner, contractor license, valuation, and an
              AI-drafted scope of work — to attach to your jurisdiction&apos;s permit application.
              Valuation comes from the signed contract value (or the largest estimate).
            </p>
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            <FileText className="size-3.5" strokeWidth={1.5} />
            {pending ? "Generating…" : "Generate permit packet"}
          </button>
          {error && <p className="mt-2 text-[12px] text-flag">{error}</p>}
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="mt-4 overflow-hidden p-0">
          <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            On file · {rows.length}
          </div>
          {rows.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}
            >
              <FileText className="size-4 flex-none text-ink-3" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{p.name}</div>
                <div className="font-mono text-[10px] text-ink-3">
                  {p.subtitle ?? "Permit packet"} · {p.createdLabel}
                </div>
              </div>
              {!p.id.startsWith("pending-") && (
                <a
                  href={`/api/files/${p.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2"
                >
                  <Download className="size-3" strokeWidth={1.5} /> PDF
                </a>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
