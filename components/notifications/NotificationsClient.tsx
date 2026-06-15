"use client";

import { useState } from "react";
import Link from "next/link";
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

export function NotificationsClient({ data }: { data: NotificationsData }) {
  const [filter, setFilter] = useState<NotifFilter>("all");

  const visible =
    filter === "all"
      ? data.notifications
      : data.notifications.filter((n) => n.kind === filter);

  return (
    <div className="flex h-full justify-center overflow-y-auto px-7 pb-16 pt-6">
      <div className="w-[720px] max-w-full">
        {/* Header */}
        <div className="mb-3.5 flex items-end gap-4">
          <div className="flex-1">
            <Eyebrow>
              {data.total} today · {data.decisionCount} need a decision
            </Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
              Notifications
            </h1>
          </div>
          <button className="rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2">
            Mark all read
          </button>
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
          {visible.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
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
  return (
    <Link href={n.href} className="block">
      <Card
        className={[
          "p-3 transition-colors hover:bg-paper-2",
          n.flagged ? "border-flag" : "",
        ].join(" ")}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 flex-none items-center justify-center rounded border border-rule bg-paper-2">
            <Icon className={`size-3.5 ${ICON_TINT[n.accent]}`} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Chip kind={n.accent}>{n.tag}</Chip>
              <div className="flex-1" />
              <span className="font-mono text-[10px] text-ink-3">{n.when}</span>
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
