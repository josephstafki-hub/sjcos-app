"use client";

import { useEffect, useState } from "react";
import { AiStreamSkeleton } from "@/components/ui";
import { draftWeeklyStatus } from "@/lib/actions/projects";

/** The AI-drafted weekly-status line, loaded after the page paints. Lives on
 *  the client so a router.refresh() elsewhere on the page (saving an estimate
 *  line, ticking a punch item) never waits on the slow CPU Qwen draft — see
 *  draftWeeklyStatus for the full story. Keeps whatever it already has across
 *  refreshes; only re-asks when the project changes. */
export function WeeklyStatusDraft({ slug }: { slug: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    draftWeeklyStatus(slug)
      .then((t) => alive && setText(t))
      .catch(() => alive && setText(""));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (text === null) return <AiStreamSkeleton />;
  return <>{text || "Draft unavailable right now."}</>;
}
