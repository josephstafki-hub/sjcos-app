"use client";

import { useState } from "react";
import { useServerState } from "@/lib/use-server-state";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DollarSign,
  Mail,
  Star,
  MessageSquare,
  FolderKanban,
  Globe,
  ShieldCheck,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import type {
  NotifAccent,
  NotifFilter,
  NotifIcon,
  NotificationCard,
  NotificationsData,
} from "@/lib/notifications";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import { approveWaiting, declineWaiting } from "@/lib/actions/approvals";
import type { PendingApproval } from "@/lib/approvals";
import { toast } from "@/components/ui/Toast";
import { ApprovalCard } from "./ApprovalCard";

const ICON: Record<NotifIcon, LucideIcon> = {
  money: DollarSign,
  mail: Mail,
  star: Star,
  chat: MessageSquare,
  project: FolderKanban,
  site: Globe,
  shield: ShieldCheck,
};

const ICON_TINT: Record<NotifAccent, string> = {
  flag: "text-flag",
  accent: "text-accent",
  ai: "text-ai-2",
  money: "text-money",
  ghost: "text-ink-2",
};

const RESOLUTION_LABEL: Record<string, string> = {
  approved: "Approved",
  consumed: "Approved",
  rejected: "Declined",
  expired: "Expired",
  revoked: "Revoked",
  superseded: "Replaced",
  closed: "Closed",
  info: "Done",
};

export function NotificationsClient({ data, approvals = [] }: { data: NotificationsData; approvals?: PendingApproval[] }) {
  const [filter, setFilter] = useState<NotifFilter>("all");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());
  const pending = new Map(approvals.map((a) => [a.key, a]));

  const visible =
    filter === "all"
      ? data.notifications
      : filter === "unread"
        ? data.notifications.filter((n) => !n.read)
        : data.notifications.filter((n) => n.kind === filter);

  // Waiting asks with no card in the feed (e.g. staged before this build)
  // still get answered here, at the top.
  const inFeed = new Set(data.notifications.map((n) => n.ref).filter(Boolean));
  const orphans = approvals.filter((a) => !inFeed.has(a.key) && !answered.has(a.key));
  const shown = new Set<string>();

  const answer = async (a: PendingApproval, verb: "approve" | "decline") => {
    setBusy(a.key);
    try {
      const r = verb === "approve" ? await approveWaiting(a.key, a.contentHash) : await declineWaiting(a.key, a.contentHash);
      if (r.ok) {
        toast({ kind: r.kind, title: verb === "approve" ? "Approved" : "Declined", message: r.message, sticky: r.kind === "error" ? true : undefined });
        setAnswered((s) => new Set(s).add(a.key));
        router.refresh();
      } else {
        toast({ kind: "error", title: verb === "approve" ? "Approve failed" : "Decline failed", message: r.error });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full justify-center overflow-y-auto px-7 pb-16 pt-6">
      <div className="w-[720px] max-w-full">
        {/* Header */}
        <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="min-w-0 flex-1">
            <Eyebrow>
              {data.unread} unread · {approvals.length || data.decisionCount} waiting on you
            </Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Notifications
            </h1>
          </div>
          <form action={markAllNotificationsRead}>
            <button
              type="submit"
              disabled={data.unread === 0}
              className="rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Mark all read
            </button>
          </form>
        </div>

        {/* Filter chips */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {data.filters.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}>
              <Chip kind={filter === f.key ? "solid" : "ghost"}>{f.label}</Chip>
            </button>
          ))}
        </div>

        {/* Cards */}
        <div className="flex flex-col gap-2">
          {orphans.map((a) => (
            <ApprovalCard key={a.key} approval={a} busy={busy === a.key} disabled={busy !== null} onAnswer={(v) => void answer(a, v)} />
          ))}
          {visible.map((n) => {
            const a = n.ref ? pending.get(n.ref) : undefined;
            // One answerable card per ask; older duplicates (a stale nudge,
            // the pre-fix second announcement) stay plain rows.
            if (a && n.actionable && !answered.has(a.key) && !shown.has(a.key)) {
              shown.add(a.key);
              return <ApprovalCard key={n.id} approval={a} busy={busy === a.key} disabled={busy !== null} onAnswer={(v) => void answer(a, v)} />;
            }
            return <NotificationRow key={n.id} notification={n} />;
          })}
          {visible.length === 0 && (
            <Card kind="dashed" className="p-8 text-center">
              <div className="text-[13px] text-ink-3">Nothing here right now.</div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationRow({ notification: n }: { notification: NotificationCard }) {
  const Icon = ICON[n.icon];
  // Follows the server too: marked read from the bell, another tab or "mark all".
  const [read, setRead] = useServerState(n.read);
  // Mark read on click. Fire-and-forget: the action revalidates /notifications
  // so it stays read on return; we also dim it immediately for feedback.
  function onOpen() {
    if (!read) {
      setRead(true);
      void markNotificationRead(n.id);
    }
  }
  return (
    <Link href={n.href} className="block" onClick={onOpen}>
      <Card
        className={[
          "p-3 transition-colors hover:bg-paper-2",
          n.flagged && !read ? "border-flag" : "",
          read ? "opacity-55" : "",
        ].join(" ")}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 flex-none items-center justify-center rounded border border-rule bg-paper-2">
            <Icon className={`size-3.5 ${ICON_TINT[n.accent]}`} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Chip kind={n.accent}>{n.tag}</Chip>
              {n.resolution && <Chip kind="ghost">{RESOLUTION_LABEL[n.resolution] ?? n.resolution}</Chip>}
              <div className="flex-1" />
              <span className="font-mono text-[10px] text-ink-3" title={n.whenAbsolute}>
                {n.when}
              </span>
            </div>
            <div className="mt-1 font-serif text-[14px] font-semibold text-ink">{n.title}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">{n.subline}</div>
          </div>
          <ChevronRight className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
        </div>
      </Card>
    </Link>
  );
}
