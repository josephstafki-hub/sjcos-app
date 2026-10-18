"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Clock } from "lucide-react";
import type { TodayPriority, WaitingItem } from "@/lib/today";
import { useTodayQueue } from "./TodayQueueContext";
import { AssignmentLine, pageLabel, QueueActions } from "./QueueActions";
import { DueLabel } from "./PriorityCard";

type View = "job" | "due" | "quick";

const VIEWS: { key: View; label: string }[] = [
  { key: "job", label: "By job" },
  { key: "due", label: "By due date" },
  { key: "quick", label: "Quick ones" },
];

/** Rows shown per group before "+ N more" — fewer under a job heading, more
 *  in the flatter due-date / quick views. */
const capFor = (view: View) => (view === "job" ? 5 : 12);

interface Group {
  key: string;
  name?: string;
  href?: string;
  items: WaitingItem[];
  /** How many of this job's to-dos are up in Up next right now. */
  upNext?: number;
}

/** Everything on Today below Up next — the same queue, continued. Grouped by
 *  job by default (or by due date, or just the quick ones), each row with a
 *  checkbox, its due date, and on hover "↑ Up next" / snooze / open. Clicking
 *  a row opens it in place into the card's own buttons. To-dos waiting on a
 *  sub sit collapsed at the bottom — listed, but not on Joe right now. */
export function QueueList({ onHandOff }: { onHandOff: (p: TodayPriority, kind: "do" | "prep") => void }) {
  const { waiting, priorities } = useTodayQueue();
  const [view, setView] = useState<View>("job");
  const [openId, setOpenId] = useState<string | null>(null);
  const [shownGroups, setShownGroups] = useState<Set<string>>(new Set());
  const [showSubs, setShowSubs] = useState(false);

  const active = waiting.filter((w) => !w.waitingOnSub);
  const withSubs = waiting.filter((w) => w.waitingOnSub);
  const groups = groupItems(active, view, priorities);

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const showAll = (key: string) => setShownGroups((cur) => new Set(cur).add(key));

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 border-t border-dashed border-rule pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">The rest</span>
        <span className="text-[11px] text-ink-4">{active.length}</span>
        <div className="flex-1" />
        <div className="inline-flex overflow-hidden rounded-md border border-rule">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-pressed={view === v.key}
              className={`px-2 py-0.5 text-[11px] ${
                view === v.key ? "bg-ink text-paper" : "bg-paper-2 text-ink-3 hover:bg-paper"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {active.length === 0 && withSubs.length === 0 && (
        <div className="py-2 text-[12px] text-ink-3">Nothing else on the list.</div>
      )}
      {active.length > 0 && groups.length === 0 && (
        <div className="py-2 text-[12px] text-ink-3">No quick ones right now.</div>
      )}

      {groups.map((g) => {
        const cap = capFor(view);
        const all = shownGroups.has(g.key) || g.items.length <= cap + 1;
        const rows = all ? g.items : g.items.slice(0, cap);
        return (
          <div key={g.key} className="mb-2.5">
            {g.name && <GroupHeader group={g} />}
            {rows.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                showGroup={view !== "job"}
                open={openId === item.id}
                onToggle={() => toggle(item.id)}
                onHandOff={onHandOff}
              />
            ))}
            {!all && (
              <button
                type="button"
                onClick={() => showAll(g.key)}
                className="py-1 pl-[30px] text-[11.5px] text-ink-3 hover:text-ink-2 hover:underline"
              >
                + {g.items.length - cap} more
              </button>
            )}
          </div>
        );
      })}

      {withSubs.length > 0 && (
        <div className="mb-2.5 opacity-80">
          <button
            type="button"
            onClick={() => setShowSubs((s) => !s)}
            aria-expanded={showSubs}
            className="flex w-full items-center gap-1.5 border-b border-rule-soft px-0.5 py-1.5 text-left"
          >
            {showSubs ? (
              <ChevronDown className="size-3.5 text-ink-3" strokeWidth={2} />
            ) : (
              <ChevronRight className="size-3.5 text-ink-3" strokeWidth={2} />
            )}
            <span className="text-[12px] font-bold text-ink-3">Waiting on a sub · {withSubs.length}</span>
            <span className="text-[11px] text-ink-4">not on you right now</span>
          </button>
          {showSubs &&
            withSubs.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                showGroup
                open={openId === item.id}
                onToggle={() => toggle(item.id)}
                onHandOff={onHandOff}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function GroupHeader({ group }: { group: Group }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-rule-soft px-0.5 py-1">
      <span className="min-w-0 truncate font-serif text-[14px] font-semibold text-ink">{group.name}</span>
      <span className="flex-none text-[11px] text-ink-4">
        {group.items.length}
        {group.upNext ? ` · ${group.upNext} in Up next` : ""}
      </span>
      <div className="flex-1" />
      {group.href && (
        <Link
          href={group.href}
          className="inline-flex flex-none items-center gap-0.5 text-[11px] text-ink-3 hover:text-ink-2 hover:underline"
        >
          {pageLabel(group.href)} <ArrowUpRight className="size-3" strokeWidth={2} />
        </Link>
      )}
    </div>
  );
}

function QueueRow({
  item,
  showGroup,
  open,
  onToggle,
  onHandOff,
}: {
  item: WaitingItem;
  showGroup: boolean;
  open: boolean;
  onToggle: () => void;
  onHandOff: (p: TodayPriority, kind: "do" | "prep") => void;
}) {
  const { busyId, complete, snooze, canPromote, promote } = useTodayQueue();
  const busy = busyId === item.id;
  const canUp = canPromote && item.checkable && !item.waitingOnSub;

  return (
    <div className={busy ? "opacity-60" : ""}>
      <div
        className={`group flex items-center gap-2 rounded-md px-1 py-[5px] transition-colors hover:bg-paper-2 ${
          open ? "bg-paper-2" : ""
        }`}
      >
        <span
          className={`w-[3px] self-stretch flex-none rounded-full ${
            item.priority === "urgent" ? "bg-flag" : item.priority === "high" ? "bg-flag/45" : ""
          }`}
        />
        {item.checkable ? (
          <button
            type="button"
            onClick={() => complete(item.id)}
            disabled={busy}
            title="Mark done"
            aria-label={`Mark ${item.title} done`}
            className="group/box grid size-3.5 flex-none place-items-center rounded-[3px] border-[1.5px] border-ink-4 transition-colors hover:border-money hover:bg-money/10 disabled:opacity-50"
          >
            <Check className="size-2.5 text-money opacity-0 group-hover/box:opacity-100" strokeWidth={2.5} />
          </button>
        ) : (
          <span className="size-3.5 flex-none rounded-[3px] border-[1.5px] border-ink-4" />
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`min-w-0 flex-1 truncate text-left text-[12.5px] ${
            open ? "font-semibold text-ink" : "text-ink-2"
          }`}
        >
          {item.title}
          {showGroup && <span className="text-ink-4"> · {item.group.name}</span>}
        </button>
        {item.assignment && (
          <span
            title={item.assignment.label}
            className="flex-none rounded bg-accent-soft px-1 font-mono text-[9.5px] font-semibold text-accent-2"
          >
            {item.assignment.others.map((a) => a.initials).join(" ")}
          </span>
        )}
        {item.due && (
          <span className={canUp || item.checkable || item.href ? "group-hover:hidden" : ""}>
            <DueLabel due={item.due} overdue={item.overdue} />
          </span>
        )}
        {/* Quick moves on hover. On a phone there's no hover — tapping the row
            opens it, which has the same buttons. */}
        <span className="hidden flex-none gap-1 group-hover:flex">
          {canUp && (
            <MiniButton onClick={() => promote(item.id)} disabled={busy} title="Move to Up next">
              <ArrowUp className="size-3" strokeWidth={2} /> Up next
            </MiniButton>
          )}
          {item.checkable && (
            <MiniButton onClick={() => snooze(item.id)} disabled={busy} title="Snooze 3 days">
              <Clock className="size-3" strokeWidth={1.75} />
            </MiniButton>
          )}
          {item.href && (
            <Link
              href={item.href}
              title={pageLabel(item.href)}
              className="inline-flex items-center rounded-[5px] border border-rule bg-paper px-1.5 py-px text-ink-2 transition-colors hover:bg-paper-3"
            >
              <ArrowUpRight className="size-3" strokeWidth={2} />
            </Link>
          )}
        </span>
      </div>

      {open && (
        <div className="mb-1.5 ml-[26px] mt-0.5 rounded-[10px] border border-rule bg-paper px-3 py-2.5 shadow-card">
          <div className="text-[12px] text-ink-3">{item.sub}</div>
          {item.assignment && (
            <div className="mt-1.5">
              <AssignmentLine assignment={item.assignment} />
            </div>
          )}
          <div className="mt-2">
            <QueueActions p={item} place="list" onHandOff={onHandOff} />
          </div>
        </div>
      )}
    </div>
  );
}

function MiniButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-0.5 rounded-[5px] border border-rule bg-paper px-1.5 py-px text-[10.5px] font-semibold text-ink-2 transition-colors hover:bg-paper-3 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** The list's groups for one view. Rank order is kept within every group,
 *  and job groups appear in the order of their highest-ranked to-do. */
function groupItems(items: WaitingItem[], view: View, upNext: TodayPriority[]): Group[] {
  if (view === "quick") {
    const quick = items.filter((i) => i.lane === "quick" || i.lane === "chat");
    return quick.length ? [{ key: "quick", items: quick }] : [];
  }
  if (view === "due") {
    const overdue = items
      .filter((i) => i.overdue)
      .toSorted((a, b) => (a.dueDay ?? "").localeCompare(b.dueDay ?? ""));
    const today = items.filter((i) => i.due && !i.overdue);
    const none = items.filter((i) => !i.due);
    return [
      { key: "overdue", name: "Overdue", items: overdue },
      { key: "today", name: "Due today", items: today },
      { key: "none", name: "No due date", items: none },
    ].filter((g) => g.items.length);
  }
  const byKey = new Map<string, Group>();
  for (const i of items) {
    const g = byKey.get(i.group.key) ?? { key: i.group.key, name: i.group.name, href: i.group.href, items: [] };
    g.items.push(i);
    byKey.set(i.group.key, g);
  }
  // "Office & admin" reads best last, after the jobs.
  const groups = [...byKey.values()].toSorted((a, b) => Number(a.key === "office") - Number(b.key === "office"));
  for (const g of groups) g.upNext = upNext.filter((p) => p.group?.key === g.key).length;
  return groups;
}
