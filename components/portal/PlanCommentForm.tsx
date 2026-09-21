"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, X } from "lucide-react";
import { addClientPlanComment, type CommentAnchor } from "@/lib/actions/plan-comments";
import { runAction } from "@/lib/run-action";

/** Comment composer for the portal 3D plan viewer. The anchor (level + plan
 *  inches, optional element id) comes from what the client tapped in 3D; the
 *  note itself goes straight to Joe (notification + client activity), the
 *  same shape as mood-board feedback. */
export function PlanCommentForm({
  floorplanId,
  anchor,
  anchorLabel,
  defaultName,
  onClose,
}: {
  floorplanId: number;
  anchor: CommentAnchor;
  /** Human description of the pin, e.g. "Kitchen" or "B36 base cabinet". */
  anchorLabel: string;
  defaultName: string;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    setSent(false);
    if (!body.trim()) return setError("Write a note first.");
    const fd = new FormData();
    fd.set("body", body.trim());
    fd.set("name", name.trim());
    startTransition(async () => {
      const res = await runAction(() => addClientPlanComment(floorplanId, anchor, fd));
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      setBody("");
      setSent(true);
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-accent bg-accent-soft/40 p-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="size-3.5 text-accent-2" strokeWidth={1.75} />
        <span className="text-[12px] font-semibold text-accent-2">Comment on {anchorLabel}</span>
        <div className="flex-1" />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-9 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <label className="mt-2 block">
        <span className="mb-1 block text-[11px] font-semibold text-ink-2">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="w-full max-w-xs rounded-md border border-rule bg-card px-2.5 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
        />
      </label>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="What should change here? Anything you notice is useful…"
        className="mt-2 w-full rounded-md border border-rule bg-card px-2.5 py-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />

      {error && <div className="mt-1 text-[11px] text-flag">{error}</div>}
      {sent && !error && <div className="mt-1 text-[11px] font-semibold text-money">Sent to Joe.</div>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={pending}
          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-accent bg-accent-soft px-3 text-[12px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-60"
        >
          <MessageSquare className="size-3" strokeWidth={1.75} />
          {pending ? "Sending…" : "Send to Joe"}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 items-center rounded-md border border-rule bg-card px-3 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
          >
            {sent ? "Done" : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
