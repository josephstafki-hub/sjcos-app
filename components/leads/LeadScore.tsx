"use client";

import { useState, useTransition } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { rescoreLead } from "@/lib/actions/leads";
import { AI_NAME } from "@/lib/ai-name";

type Verdict = "go" | "hold" | "pass";
type Score = { verdict: Verdict; confidence: number; rationale: string };

const VERDICT: Record<Verdict, { label: string; kind: "money" | "info" | "flag" }> = {
  go: { label: "GO", kind: "money" },
  hold: { label: "HOLD", kind: "info" },
  pass: { label: "PASS", kind: "flag" },
};

/** The persisted AI lead score, with a real re-score button. Scoring happens at
 *  ingest; the owner can re-run it here after new info comes in. Optimistic:
 *  the button shows pending while the model runs (~10–20s on local Qwen). */
export function LeadScore({ slug, initial }: { slug: string; initial: Score | null }) {
  const [score, setScore] = useState<Score | null>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function rescore() {
    setError(null);
    start(async () => {
      const res = await rescoreLead(slug);
      if (res.ok && res.verdict) {
        setScore((prev) => ({
          verdict: res.verdict!,
          confidence: prev?.confidence ?? 0,
          rationale: res.rationale ?? "",
        }));
      } else {
        setError(res.error ?? "Could not score this lead.");
      }
    });
  }

  const v = score ? VERDICT[score.verdict] : null;
  const pct = score ? Math.round(score.confidence * 100) : 0;

  return (
    <Card className="border-ai-soft bg-ai-soft/40 p-3.5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-ai-2" strokeWidth={1.5} />
        <h3 className="flex-1 font-serif text-[15px] font-semibold text-ai-2">
          {score ? `${AI_NAME} scored this lead` : `${AI_NAME} lead score`}
        </h3>
        {v && <Chip kind={v.kind}>{v.label}</Chip>}
        {score && pct > 0 && <Chip kind="ghost">{pct}% confident</Chip>}
        <button
          type="button"
          onClick={rescore}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-3 hover:bg-paper-2 hover:text-ink-2 disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${pending ? "animate-spin" : ""}`} strokeWidth={1.5} />
          {pending ? "Scoring…" : score ? "Re-score" : "Score lead"}
        </button>
      </div>

      {score ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{score.rationale}</p>
      ) : (
        <p className="mt-2 text-[12.5px] text-ink-3">
          Not scored yet — leads score automatically on arrival. Re-run it here if the model was down.
        </p>
      )}
      {error && <p className="mt-1.5 text-[12px] text-flag">{error}</p>}
    </Card>
  );
}
