"use client";

import { useState, useTransition } from "react";
import { Check, Mail } from "lucide-react";
import { sendWeeklyStatusEmail } from "@/lib/actions/projects";

/** Real "Send to client" control for the drafted weekly-status email. Emails
 *  the AI draft to the project's client via Gmail (replaces the old fake
 *  "Review" AckButton). Shows a sending → sent / error state. */
export function WeeklyStatusSend({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  function send() {
    setError("");
    startTransition(async () => {
      const r = await sendWeeklyStatusEmail(slug);
      if (r.ok) setDone(true);
      else setError(r.error ?? "Could not send.");
    });
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-money/40 bg-money/10 px-2.5 py-1 text-[12px] font-semibold text-money">
        <Check className="size-3" strokeWidth={2} />
        Sent
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={send}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-ai-2 disabled:opacity-60"
      >
        <Mail className="size-3" strokeWidth={1.75} />
        {pending ? "Sending…" : "Send to client"}
      </button>
      {error && <span className="max-w-[160px] text-right text-[10px] text-flag">{error}</span>}
    </div>
  );
}
