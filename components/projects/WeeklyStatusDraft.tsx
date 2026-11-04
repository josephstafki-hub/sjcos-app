"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { WeeklyStatusSend } from "./WeeklyStatusSend";
import { draftWeeklyStatus } from "@/lib/actions/projects";

/** Draft only on request; opening a record must not start CPU inference. */
export function WeeklyStatusDraft({ slug }: { slug: string }) {
  const [text, setText] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <p className="text-body text-ink-2">
        {text ??
          "Prepare a weekly update from the project’s latest notes, then review it before sending."}
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setText(
                (await draftWeeklyStatus(slug)) ||
                  "Draft unavailable right now.",
              );
            } catch {
              setText("Could not prepare the draft. Try again.");
            }
          })
        }
      >
        {pending ? "Preparing…" : text ? "Refresh draft" : "Prepare draft"}
      </Button>
      {text &&
        text !== "Draft unavailable right now." &&
        !text.startsWith("Could not prepare") && (
          <WeeklyStatusSend slug={slug} />
        )}
    </div>
  );
}
