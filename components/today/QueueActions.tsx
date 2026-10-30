"use client";

import { Button } from "@/components/ui";
import { useRouter } from "next/navigation";
import { Sparkles, Check, Clock, ArrowUpRight, ArrowUp, ArrowDown, UserRound } from "lucide-react";
import { useTodayQueue } from "./TodayQueueContext";
import { AssigneePicker } from "./AssigneePicker";
import type { TodayPriority } from "@/lib/today";

/** Friendly name for the "Open <page>" button, from the item's href. */
export function pageLabel(href?: string): string {
  if (!href) return "Open";
  if (href.startsWith("/leads/")) return "Open lead";
  if (href.startsWith("/projects/")) return "Open project";
  if (href.startsWith("/warranty")) return "Open warranty";
  if (href.startsWith("/compliance")) return "Open compliance";
  if (href.startsWith("/schedule")) return "Open schedule";
  return "Open";
}

/** The lane-specific buttons on a to-do — the same set on an Up next card
 *  (`place="card"`) and on a list row opened in place (`place="list"`). The
 *  only difference is the move: cards get "↓ Back to list", rows get
 *  "↑ Up next". Deterministic React, verified server-side on click (see
 *  lib/actions/today.ts) — never model output. */
export function QueueActions({
  p,
  place,
  onHandOff,
}: {
  p: Omit<TodayPriority, "rank">;
  place: "card" | "list";
  onHandOff: (p: TodayPriority, kind: "do" | "prep") => void;
}) {
  const {
    busyId,
    checkingId,
    complete,
    snooze,
    handleCardClick,
    canAssign,
    assignees,
    assign,
    canPromote,
    promote,
    sendBack,
  } = useTodayQueue();
  const router = useRouter();

  const busy = busyId === p.id || checkingId === p.id;

  // Which buttons show, by lane (§3.2). Signal cards (checkable: false) are
  // always deep and only get Open + Prep me.
  const showHermes = p.checkable && p.lane === "chat";
  const showDone = p.checkable && (p.lane === "chat" || p.lane === "quick");
  const showSnooze = p.checkable && (p.lane === "quick" || p.lane === "deep");
  const showPrep = p.lane === "deep";
  const showOpen = Boolean(p.href);
  // Handing work out is the owner's alone (Joe, 2026-09-27), and only a real
  // work item can be handed over — the lead/job/schedule signal cards aren't
  // rows anyone can own.
  const showAssign = canAssign && p.checkable;
  // Up next is the owner's. A to-do waiting on a sub isn't his move, so it
  // can't be moved up.
  const showUp = place === "list" && canPromote && p.checkable && !p.waitingOnSub;
  const showBack = place === "card" && canPromote && p.checkable;

  const handOff = (kind: "do" | "prep") => onHandOff({ ...p, rank: "" }, kind);

  const open = async () => {
    if (!p.href) return;
    // A card's stale-check swaps it out in place if it was already finished
    // elsewhere. A list row has no slot to swap, so it just opens.
    if (place === "card" && p.checkable) {
      const handled = await handleCardClick({ ...p, rank: "" });
      if (handled) return;
    }
    router.push(p.href);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showHermes && (
        <Button size="sm" onClick={() => handOff("do")} disabled={busy} variant="ai">
          <Sparkles className="size-3" strokeWidth={1.5} /> Have AI do it
        </Button>
      )}
      {showPrep && (
        <Button size="sm" onClick={() => handOff("prep")} disabled={busy} variant="ai">
          <Sparkles className="size-3" strokeWidth={1.5} /> Prep me a summary
        </Button>
      )}
      {showOpen && (
        <Button size="sm"
          onClick={open}
          disabled={busy}
          variant="secondary"
        >
          {pageLabel(p.href)} <ArrowUpRight className="size-3" strokeWidth={2} />
        </Button>
      )}
      {showDone && (
        <Button size="sm" onClick={() => complete(p.id)} disabled={busy} variant="secondary">
          <Check className="size-3" strokeWidth={2} /> Mark done
        </Button>
      )}
      {showUp && (
        <Button size="sm" onClick={() => promote(p.id)} disabled={busy} variant="secondary">
          <ArrowUp className="size-3" strokeWidth={2} /> Up next
        </Button>
      )}
      {showSnooze && (
        <Button size="sm" onClick={() => snooze(p.id)} disabled={busy} variant="ghost">
          <Clock className="size-3" strokeWidth={1.5} /> Snooze 3d
        </Button>
      )}
      {showBack && (
        <Button size="sm"
          onClick={() => sendBack(p.id)}
          disabled={busy}
          title="Move this back to the list. It won't come back up on its own."
          variant="ghost"
        >
          <ArrowDown className="size-3" strokeWidth={2} /> Back to list
        </Button>
      )}
      {showAssign && (
        <AssigneePicker
          roster={assignees}
          assigned={p.assignedTo ?? []}
          onChange={(ids) => assign(p.id, ids)}
          disabled={busy}
          triggerClassName="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-label text-ink-2 hover:bg-hover"
          trigger={
            <>
              <UserRound className="size-3" strokeWidth={1.5} />
              {p.assignedTo?.length ? "Reassign" : "Assign"}
            </>
          }
        />
      )}
    </div>
  );
}

/** "Assigned to …" line with initials badges. A handed-off to-do stays on
 *  Joe's Today (his rule, 2026-09-27), so this is what tells the two apart at
 *  a glance — in the accent colour, not a footnote. It names everyone but the
 *  viewer ("Assigned to you & Abigail Stafki"), so a shared to-do never reads
 *  as one person's. */
export function AssignmentLine({ assignment }: { assignment: NonNullable<TodayPriority["assignment"]> }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-meta font-semibold text-accent-2">{assignment.label}</span>
    </div>
  );
}
