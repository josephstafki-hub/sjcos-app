"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, ExternalLink, RotateCcw } from "lucide-react";
import { Chip } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import type { MarketingDraft, PostStage } from "@/lib/marketing";
import { POST_PLATFORMS, POST_PLATFORM_LABEL, postProblem, type PostPlatform } from "@/lib/marketing-types";
import { askToPost, markNotPosted, markPosted, retryPost, setPostTarget } from "@/lib/actions/marketing";
import { approveDecisionAction, rejectDecisionAction } from "@/lib/decisions/actions";
import { runAction } from "@/lib/run-action";

const STAGE_CHIP: Record<PostStage, { label: string; kind: "ghost" | "info" | "accent" | "flag" | "money" | "ai" }> = {
  draft: { label: "draft", kind: "ghost" },
  awaiting_approval: { label: "waiting for your OK", kind: "accent" },
  queued: { label: "queued", kind: "info" },
  posting: { label: "posting…", kind: "ai" },
  check: { label: "check it", kind: "flag" },
  posted: { label: "posted", kind: "money" },
  failed: { label: "not posted", kind: "flag" },
};

export function StageChip({ stage }: { stage: PostStage }) {
  const c = STAGE_CHIP[stage];
  return (
    <Chip kind={c.kind} dot>
      {c.label}
    </Chip>
  );
}

/** Can Joe still change where it goes / which photos? */
export const editableStage = (s: PostStage) => s === "draft" || s === "failed" || s === "awaiting_approval";

/** The posting agent's half of a social draft card: where it goes, ask for
 *  approval (approve right here), and what happened. Photos are picked on the
 *  photo tiles above ("In post"). */
export function PostingPanel({ draft, isOwner, dirty }: { draft: MarketingDraft; isOwner: boolean; dirty: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState("");
  const editable = editableStage(draft.stage);
  const problem = draft.platform ? postProblem(draft.platform, draft.body, draft.media.length) : "Pick where it goes.";

  function act<R extends { ok: boolean; error?: string; message?: string; reply?: string }>(fn: () => Promise<R>, fallback: string) {
    startTransition(async () => {
      const r = await runAction(fn, { fallback });
      if (r && "ok" in r && r.ok) {
        const msg = (r as { message?: string; reply?: string }).message ?? (r as { reply?: string }).reply;
        if (msg) toast({ kind: "success", message: msg });
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 rounded-md border border-rule bg-paper-2/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-3.5 flex-none text-ai" strokeWidth={1.75} />
        <span className="text-[11px] font-semibold text-ink-2">Post it for me</span>
        <select
          value={draft.platform ?? ""}
          disabled={pending || !editable}
          onChange={(e) => act(() => setPostTarget(draft.id, e.target.value, draft.media), "Couldn't change where it goes.")}
          className="rounded-md border border-rule bg-card px-2 py-1 text-[12px] text-ink-2 outline-none focus:border-accent disabled:opacity-60"
        >
          <option value="">Where to?</option>
          {POST_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {POST_PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-ink-3">{draft.media.length ? `${draft.media.length} photo${draft.media.length === 1 ? "" : "s"}` : "no photos"}</span>
        <div className="flex-1" />
        <StageChip stage={draft.stage} />
      </div>

      {draft.stageNote && <div className={`mt-1.5 text-[11px] ${draft.stage === "failed" || draft.stage === "check" ? "text-flag" : "text-ink-3"}`}>{draft.stageNote}</div>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(draft.stage === "draft" || draft.stage === "failed") && !draft.retryable && (
          <>
            <button
              type="button"
              disabled={pending || dirty || !!problem}
              onClick={() => act(() => askToPost(draft.id), "Couldn't make the approval card.")}
              className="rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
            >
              Ask to post
            </button>
            <span className="text-[11px] text-ink-3">{dirty ? "Save your edits first." : (problem ?? "Nothing goes up until you approve it.")}</span>
          </>
        )}

        {draft.stage === "awaiting_approval" && draft.pendingDecision && (
          isOwner ? (
            <>
              <button
                type="button"
                disabled={pending || dirty}
                onClick={() => act(() => approveDecisionAction(draft.pendingDecision!.id, draft.pendingDecision!.contentHash), "Couldn't approve it.")}
                className="rounded-md border border-money bg-money px-2 py-1 text-[11px] font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                Approve &amp; post to {draft.platform ? POST_PLATFORM_LABEL[draft.platform] : "it"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => rejectDecisionAction(draft.pendingDecision!.id, null, draft.pendingDecision!.contentHash), "Couldn't decline it.")}
                className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
              >
                Not now
              </button>
              <span className="text-[11px] text-ink-3">Exactly this text and these photos.</span>
            </>
          ) : (
            <span className="text-[11px] text-ink-3">Waiting for Joe to approve it.</span>
          )
        )}

        {draft.stage === "failed" && draft.retryable && isOwner && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => retryPost(draft.id), "Couldn't try again.")}
              className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
            >
              <RotateCcw className="size-3" strokeWidth={1.75} /> Try again
            </button>
            <span className="text-[11px] text-ink-3">The same approved post. Sign in again first if it says so.</span>
          </>
        )}

        {draft.stage === "check" && isOwner && (
          <>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Link to the post (if it's up)"
              className="min-w-[200px] flex-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => markPosted(draft.id, link), "Couldn't mark it posted.")}
              className="rounded-md border border-money bg-money px-2 py-1 text-[11px] font-semibold text-paper disabled:opacity-50"
            >
              It&apos;s up
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => markNotPosted(draft.id), "Couldn't mark it.")}
              className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
            >
              It isn&apos;t up
            </button>
          </>
        )}

        {draft.stage === "posted" && draft.postedUrl && (
          <a href={draft.postedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-2 hover:underline">
            <ExternalLink className="size-3" strokeWidth={1.75} /> See the post
          </a>
        )}
      </div>

      {isOwner && draft.shots.length > 0 && (draft.stage === "check" || draft.stage === "failed" || draft.stage === "posted") && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.shots.slice(-4).map((s) => (
            <a key={s.name} href={`/api/marketing/runs/${s.intentId}/${s.name}`} target="_blank" rel="noreferrer" title={s.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/marketing/runs/${s.intentId}/${s.name}`} alt={s.name} className="h-14 w-20 rounded border border-rule object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** "In post" toggle on a shareable photo tile. */
export function InPostToggle({ draft, photoId, disabled }: { draft: MarketingDraft; photoId: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const on = draft.media.includes(photoId);
  const n = draft.media.indexOf(photoId) + 1;
  return (
    <label className="flex items-center gap-1 text-[10px] text-ink-3">
      <input
        type="checkbox"
        checked={on}
        disabled={disabled || pending || !editableStage(draft.stage)}
        onChange={(e) =>
          startTransition(async () => {
            const media = e.target.checked ? [...draft.media, photoId] : draft.media.filter((m) => m !== photoId);
            const r = await runAction(() => setPostTarget(draft.id, (draft.platform ?? "") as PostPlatform | "", media), { fallback: "Couldn't change the photos." });
            if (r && "ok" in r && r.ok && "message" in r && r.message) toast({ kind: "info", message: String(r.message) });
            router.refresh();
          })
        }
      />
      {on ? `In post (${n})` : "In post"}
    </label>
  );
}
