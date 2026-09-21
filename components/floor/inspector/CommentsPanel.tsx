"use client";

// Comments tab: owner / staff / client / agent pins on the design. Resolve,
// locate, delete (owner), and add — either by clicking the plan (comment
// tool) or from the form here (pinned at the centre of the first room).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Crosshair, MessageSquarePlus, RotateCcw, Trash2 } from "lucide-react";
import { Chip, type ChipKind } from "@/components/ui";
import type { DesignerContext } from "../view-state";
import type { PlanDesignComment } from "@/lib/plan-designs";
import { addPlanComment, deletePlanComment, resolvePlanComment } from "@/lib/actions/plan-comments";
import { runAction } from "@/lib/run-action";
import { BTN_GHOST, BTN_PRIMARY, Empty, INPUT_CLS, SectionHeader } from "./fields";

const ROLE_CHIP: Record<PlanDesignComment["authorRole"], ChipKind> = { owner: "solid", staff: "accent", client: "info", agent: "ai" };

export function CommentsPanel({ ctx }: { ctx: DesignerContext }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const ro = ctx.readOnly;
  const open = ctx.comments.filter((c) => !c.resolvedAt);
  const done = ctx.comments.filter((c) => c.resolvedAt);

  const locate = (c: PlanDesignComment) => {
    if (c.anchor.levelId !== ctx.d.levelId) ctx.d.setLevelId(c.anchor.levelId);
    if (c.anchor.itemId) ctx.d.select([c.anchor.itemId]);
    ctx.focus2d({ x: c.anchor.x, y: c.anchor.y, levelId: c.anchor.levelId });
  };
  const setResolved = (c: PlanDesignComment, resolved: boolean) =>
    start(async () => {
      const r = await runAction(() => resolvePlanComment(c.id, resolved));
      if (r.ok) router.refresh();
    });
  const remove = (c: PlanDesignComment) =>
    start(async () => {
      if (!window.confirm("Delete this comment?")) return;
      const r = await runAction(() => deletePlanComment(c.id));
      if (r.ok) router.refresh();
    });
  const add = () => {
    const text = body.trim();
    if (!text) return;
    const room = ctx.d.doc.rooms.find((r) => r.levelId === ctx.d.levelId && r.polygon.length);
    const n = room?.polygon.length ?? 0;
    const at = room ? { x: room.polygon.reduce((s, p) => s + p.x, 0) / n, y: room.polygon.reduce((s, p) => s + p.y, 0) / n } : { x: 60, y: 60 };
    start(async () => {
      const r = await runAction(() => addPlanComment(ctx.design.id, { levelId: ctx.d.levelId, ...at }, text));
      if (r.ok) {
        setBody("");
        router.refresh();
      }
    });
  };

  const commentToolOn = ctx.d.tool === "comment";

  return (
    <div>
      {!ro && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            className={commentToolOn ? BTN_PRIMARY : BTN_GHOST}
            onClick={() => ctx.d.setTool(commentToolOn ? "select" : "comment")}
          >
            <MessageSquarePlus className="size-3" strokeWidth={1.75} /> {commentToolOn ? "Click the plan to pin a comment…" : "Add comment on the plan"}
          </button>
          <textarea className={`${INPUT_CLS} min-h-[56px] resize-y`} placeholder="Or type here — pins at the centre of the current room" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
          <div className="flex justify-end">
            <button type="button" className={BTN_PRIMARY} disabled={pending || !body.trim()} onClick={add}>
              Post
            </button>
          </div>
        </div>
      )}

      <SectionHeader>Open ({open.length})</SectionHeader>
      {open.length === 0 ? <Empty>No open comments.</Empty> : open.map((c) => <CommentRow key={c.id} c={c} ctx={ctx} onLocate={locate} onResolve={setResolved} onDelete={remove} />)}
      {done.length > 0 && (
        <>
          <SectionHeader>Resolved ({done.length})</SectionHeader>
          {done.map((c) => (
            <CommentRow key={c.id} c={c} ctx={ctx} onLocate={locate} onResolve={setResolved} onDelete={remove} />
          ))}
        </>
      )}
    </div>
  );
}

function CommentRow({
  c,
  ctx,
  onLocate,
  onResolve,
  onDelete,
}: {
  c: PlanDesignComment;
  ctx: DesignerContext;
  onLocate: (c: PlanDesignComment) => void;
  onResolve: (c: PlanDesignComment, resolved: boolean) => void;
  onDelete: (c: PlanDesignComment) => void;
}) {
  const resolved = !!c.resolvedAt;
  return (
    <div className={`mb-1.5 rounded-md border border-rule px-2.5 py-2 text-[12px] ${resolved ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-1.5">
        <Chip kind={ROLE_CHIP[c.authorRole]}>{c.authorRole}</Chip>
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{c.authorName}</span>
        <span className="font-mono text-[10px] text-ink-3">{c.createdLabel}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap leading-snug text-ink-2">{c.body}</div>
      <div className="mt-1.5 flex gap-0.5">
        <button type="button" title="Locate" onClick={() => onLocate(c)} className="rounded p-0.5 text-ink-3 hover:text-ink">
          <Crosshair className="size-3.5" strokeWidth={1.75} />
        </button>
        {!ctx.readOnly && (
          <button type="button" title={resolved ? "Reopen" : "Resolve"} onClick={() => onResolve(c, !resolved)} className="rounded p-0.5 text-ink-3 hover:text-ink">
            {resolved ? <RotateCcw className="size-3.5" strokeWidth={1.75} /> : <Check className="size-3.5" strokeWidth={1.75} />}
          </button>
        )}
        {ctx.isOwner && (
          <button type="button" title="Delete" onClick={() => onDelete(c)} className="ml-auto rounded p-0.5 text-ink-3 hover:text-flag">
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );
}
