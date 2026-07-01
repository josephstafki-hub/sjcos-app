"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HardHat, Sparkles, Trash2, Check } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { SafetyOrientation } from "@/lib/safety";
import { generateSafetyOrientation, deleteSafetyOrientation } from "@/lib/actions/safety";

/** Project Safety tab — generate AI jobsite safety orientations per trade and
 *  see who's acknowledged them. (Incident reports render below in P4-5.) */
export function Safety({
  slug,
  orientations,
  incidents,
}: {
  slug: string;
  orientations: SafetyOrientation[];
  incidents?: React.ReactNode;
}) {
  const router = useRouter();
  const [trade, setTrade] = useState("General");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function generate() {
    setError("");
    startTransition(async () => {
      const res = await generateSafetyOrientation(slug, trade);
      if (!res.ok) setError(res.error ?? "Couldn't generate.");
      else router.refresh();
    });
  }

  function remove(id: number) {
    startTransition(async () => {
      await deleteSafetyOrientation(slug, id);
      router.refresh();
    });
  }

  const inputCls =
    "rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

  return (
    <div className="max-w-[760px] space-y-4">
      <Card className="p-3.5">
        <div className="flex items-center gap-2">
          <HardHat className="size-4 text-accent" strokeWidth={1.75} />
          <h3 className="font-serif text-[14px] font-semibold text-ink">Safety orientation</h3>
        </div>
        <p className="mt-1 text-[12px] text-ink-3">
          Generate a jobsite orientation for a trade; assigned subs acknowledge it on their portal.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="Trade (e.g. Tile, Electrical)"
            className={`${inputCls} w-[200px]`}
          />
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            <Sparkles className="size-3.5" strokeWidth={1.75} />
            {pending ? "Generating…" : "Generate orientation"}
          </button>
        </div>
        {error && <div className="mt-1.5 text-[12px] text-flag">{error}</div>}
      </Card>

      {orientations.length === 0 ? (
        <Card kind="dashed" className="p-6 text-center text-[12px] text-ink-3">
          No safety orientations yet.
        </Card>
      ) : (
        <div className="space-y-2.5">
          {orientations.map((o) => (
            <Card key={o.id} className="p-3.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-serif text-[14px] font-semibold text-ink">{o.trade} orientation</span>
                <Chip kind={o.ackCount > 0 ? "money" : "ghost"} dot>
                  {o.ackCount} acknowledged
                </Chip>
                <button
                  type="button"
                  onClick={() => remove(o.id)}
                  aria-label="Delete orientation"
                  className="rounded p-0.5 text-ink-4 hover:text-flag"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-snug text-ink-2">{o.body}</p>
              {o.ackNames.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-rule-soft pt-2 text-[11px] text-ink-3">
                  <Check className="size-3 text-money" strokeWidth={2} />
                  {o.ackNames.join(", ")}
                </div>
              )}
              <div className="mt-1 text-[10px] text-ink-3">Generated {o.createdLabel}</div>
            </Card>
          ))}
        </div>
      )}

      {incidents}
    </div>
  );
}
