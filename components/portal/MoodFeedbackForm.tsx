"use client";

import { useState, useTransition } from "react";
import { MessageSquare } from "lucide-react";
import { addMoodFeedback } from "@/lib/actions/mood";

/** Per-board feedback composer for the portal mood page. Posts a short note
 *  ("closer — warmer wood tones?") straight onto the board; Joe sees it on the
 *  project's Mood tab and gets a notification. Approval stays its own control
 *  (ApproveControl) — this is for everything short of "yes, this is it". */
export function MoodFeedbackForm({ room }: { room: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    if (!body.trim()) return setError("Write a note first.");
    const fd = new FormData();
    fd.set("body", body.trim());
    startTransition(async () => {
      const res = await addMoodFeedback(room, fd);
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else setBody("");
    });
  }

  return (
    <div className="mt-2">
      <div className="flex items-start gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Thoughts on this board? Tell Joe what's working and what isn't…"
          className="min-w-0 flex-1 rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending}
          className="inline-flex flex-none items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
        >
          <MessageSquare className="size-3" strokeWidth={1.75} />
          {pending ? "Sending…" : "Send feedback"}
        </button>
      </div>
      {error && <div className="mt-1 text-[11px] text-flag">{error}</div>}
    </div>
  );
}
