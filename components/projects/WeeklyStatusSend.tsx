"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { Check, Mail } from "lucide-react";
import { sendWeeklyStatusEmail } from "@/lib/actions/projects";
import { runAction } from "@/lib/run-action";

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
      const r = await runAction(() => sendWeeklyStatusEmail(slug), { fallback: "Could not send." });
      if (r.ok) setDone(true);
      else setError(r.error ?? "Could not send.");
    });
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-money/40 bg-money/10 px-2.5 py-1 text-label font-semibold text-money">
        <Check className="size-3" strokeWidth={2} />
        Sent
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        icon={Mail}
        type="button"
        onClick={send}
        disabled={pending}

      >
        {pending ? "Sending…" : "Send to client"}
      </Button>
      {error && <span className="max-w-prose text-right text-meta text-flag">{error}</span>}
    </div>
  );
}
