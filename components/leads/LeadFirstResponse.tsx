"use client";

import { useState, useTransition } from "react";
import { Send, X, RefreshCw, Sparkles, Mail } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import {
  dismissFirstResponseAction,
  draftFirstResponseAsAction,
  redraftFirstResponseAction,
  sendFirstResponseAction,
} from "@/lib/actions/lead-first-response";
import type { FirstResponseBranch, LeadFirstResponse as Row } from "@/lib/lead-first-response";
import { AI_NAME } from "@/lib/ai-name";

const BRANCH: Record<FirstResponseBranch, { label: string; kind: "money" | "info" | "accent" | "flag" }> = {
  rough_estimate: { label: "Rough estimate", kind: "money" },
  missing_info: { label: "Ask for details", kind: "info" },
  discovery_call: { label: "Discovery call", kind: "accent" },
  human_review: { label: "Needs a human", kind: "flag" },
};

const MAILABLE: Exclude<FirstResponseBranch, "human_review">[] = ["rough_estimate", "missing_info", "discovery_call"];

const BTN = "inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-3 hover:bg-paper-2 hover:text-ink-2 disabled:opacity-50";
const BTN_PRIMARY = "inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The same-day first response to an inbound lead: what the app decided, the
 *  draft it wrote, and the owner's controls (send with edits, dismiss, redo,
 *  or pick a different branch). Auto-sent rows show as a receipt. */
export function LeadFirstResponse({ slug, initial, hasEmail }: { slug: string; initial: Row | null; hasEmail: boolean }) {
  const [row, setRow] = useState<Row | null>(initial);
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function apply(res: { ok: true; response: Row | null } | { ok: false; error: string }) {
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRow(res.response);
    setSubject(res.response?.subject ?? "");
    setBody(res.response?.body ?? "");
  }
  const run = (fn: () => Promise<{ ok: true; response: Row | null } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => apply(await fn()));
  };

  const signals = row?.signals ?? {};
  const signalChips = row
    ? [
        ["photos", signals.hasPhotos],
        ["measurements", signals.hasMeasurements],
        ["description", signals.hasDescription],
      ].map(([label, ok]) => (
        <Chip key={String(label)} kind={ok ? "money" : "ghost"}>
          {ok ? "✓" : "–"} {label}
        </Chip>
      ))
    : null;

  const redoButton = (
    <button type="button" onClick={() => run(() => redraftFirstResponseAction(slug))} disabled={pending} className={BTN}>
      <RefreshCw className={`size-3 ${pending ? "animate-spin" : ""}`} strokeWidth={1.5} />
      {row ? "Redo" : "Draft first response"}
    </button>
  );

  const pickButtons = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-ink-3">Draft as:</span>
      {MAILABLE.filter((b) => b !== row?.branch).map((b) => (
        <button key={b} type="button" onClick={() => run(() => draftFirstResponseAsAction(slug, b))} disabled={pending} className={BTN}>
          {BRANCH[b].label}
        </button>
      ))}
    </div>
  );

  return (
    <Card className="border-ai-soft bg-ai-soft/40 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-ai-2" strokeWidth={1.5} />
        <h3 className="flex-1 font-serif text-[15px] font-semibold text-ai-2">First response</h3>
        {row && <Chip kind={BRANCH[row.branch].kind}>{BRANCH[row.branch].label}</Chip>}
        {row?.status === "sent" && <Chip kind="money">Sent {row.autoSent ? "· auto" : "· by Joe"}</Chip>}
        {row?.status === "pending" && <Chip kind="ai">Waiting for you</Chip>}
        {row?.status === "drafting" && <Chip kind="ghost">Drafting…</Chip>}
        {(row?.status === "dismissed" || row?.status === "skipped" || row?.status === "failed") && (
          <Chip kind="ghost">{row.status}</Chip>
        )}
        {row?.status !== "pending" && row?.status !== "sent" && row?.status !== "drafting" && redoButton}
      </div>

      {!row && (
        <p className="mt-2 text-[12px] text-ink-3">
          {hasEmail
            ? `${AI_NAME} drafts a same-day reply for inbound leads. Nothing here yet — draft one to see what it would send.`
            : "No email on this lead, so there is nothing to reply to."}
        </p>
      )}

      {row && (
        <p className="mt-2 text-[12px] text-ink-2">
          {row.reason}
          {row.status === "sent" && row.sentAt ? ` — sent ${when(row.sentAt)} to the lead's email.` : ""}
        </p>
      )}

      {row && <div className="mt-2 flex flex-wrap gap-1.5">{signalChips}</div>}

      {row?.status === "pending" && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink"
            aria-label="Subject"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(22, Math.max(8, body.split("\n").length + 1))}
            className="w-full rounded-md border border-rule bg-card px-2.5 py-1.5 font-mono text-[12px] leading-5 text-ink"
            aria-label="Email body"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => run(() => sendFirstResponseAction(slug, subject, body))}
              disabled={pending || !hasEmail || !body.trim()}
              className={BTN_PRIMARY}
            >
              <Send className="size-3" strokeWidth={1.5} />
              {pending ? "Working…" : "Send to lead"}
            </button>
            <button type="button" onClick={() => run(() => dismissFirstResponseAction(slug))} disabled={pending} className={BTN}>
              <X className="size-3" strokeWidth={1.5} />
              Dismiss
            </button>
            {redoButton}
            <span className="flex-1" />
            {pickButtons}
          </div>
        </div>
      )}

      {row?.status === "human_review" && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[12px] text-ink-3">
            Nothing was sent. Read the inbound, then pick a reply branch — the draft lands here for you to edit and send.
          </p>
          {pickButtons}
        </div>
      )}

      {row?.status === "sent" && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-ink-3">
            <Mail className="mr-1 inline size-3" strokeWidth={1.5} />
            {row.subject}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-rule bg-card p-2.5 font-sans text-[12px] leading-5 text-ink-2">
            {row.body}
          </pre>
        </details>
      )}

      {(row?.status === "dismissed" || row?.status === "skipped" || row?.status === "failed") && row.body && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-ink-3">Last draft — {row.subject}</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-rule bg-card p-2.5 font-sans text-[12px] leading-5 text-ink-2">
            {row.body}
          </pre>
          <div className="mt-2">{pickButtons}</div>
        </details>
      )}

      {error && <p className="mt-2 text-[12px] text-flag">{error}</p>}
    </Card>
  );
}
