"use client";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button, AiBubble } from "@/components/ui";
import { summarizeSub } from "@/lib/actions/subs";
import { runAction } from "@/lib/run-action";
export function SubSummary({ slug }: { slug: string }) {
  const [summary, setSummary] = useState(""),
    [pending, start] = useTransition();
  return (
    <div>
      {summary && <AiBubble className="mb-2">{summary}</AiBubble>}
      <Button
        variant="ai"
        size="sm"
        icon={Sparkles}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runAction(() => summarizeSub(slug));
            if (r.ok) setSummary(r.summary);
          })
        }
      >
        {pending ? "Summarizing…" : "Summarize reliability"}
      </Button>
    </div>
  );
}
