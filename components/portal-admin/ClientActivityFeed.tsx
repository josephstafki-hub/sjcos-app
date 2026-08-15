import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  DoorOpen,
  FileSignature,
  ImagePlus,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  PenLine,
  ShieldAlert,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ClientActivityKind, ClientActivityRow } from "@/lib/client-activity";

// "What has the client done" — the ledger, newest first. Server-rendered and
// passed into the tab as a node; rows deep-link (…?tab=X&focus=Y) to the
// record they're about. Shared by the lead + project Client portal tabs.

const ICON: Record<ClientActivityKind, LucideIcon> = {
  visit: DoorOpen,
  upload: ImagePlus,
  message: MessageSquare,
  selection: CheckCircle2,
  mood_feedback: Sparkles,
  mood_approve: LayoutGrid,
  plan_approve: PenLine,
  sign: FileSignature,
  decline: XCircle,
  punch_confirm: CheckCircle2,
  warranty: ShieldAlert,
  claim: KeyRound,
};

const TINT: Record<ClientActivityKind, string> = {
  visit: "text-ink-3",
  upload: "text-accent-2",
  message: "text-accent-2",
  selection: "text-money",
  mood_feedback: "text-accent-2",
  mood_approve: "text-money",
  plan_approve: "text-money",
  sign: "text-money",
  decline: "text-flag",
  punch_confirm: "text-money",
  warranty: "text-flag",
  claim: "text-ink-2",
};

export function ClientActivityFeed({
  rows,
  emptyHint = "Nothing yet. Once the client opens their portal, uploads a photo, sends a message, or approves something, it shows up here.",
}: {
  rows: ClientActivityRow[];
  emptyHint?: string;
}) {
  const active = rows.filter((r) => r.kind !== "visit").length;
  const lastVisit = rows.find((r) => r.kind === "visit");
  return (
    <Card className="max-w-[680px] overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2.5">
        <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Client activity · {active} action{active === 1 ? "" : "s"}
        </span>
        {lastVisit && (
          <span className="font-mono text-[10px] text-ink-3" title={lastVisit.whenAbsolute}>
            last opened {lastVisit.when}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-ink-3">{emptyHint}</div>
      ) : (
        <ol>
          {rows.map((r, i) => {
            const Icon = ICON[r.kind] ?? Sparkles;
            const inner = (
              <>
                <span className="flex size-7 flex-none items-center justify-center rounded border border-rule bg-paper-2">
                  <Icon className={`size-3.5 ${TINT[r.kind] ?? "text-ink-3"}`} strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className={`text-[13px] ${r.kind === "visit" ? "text-ink-3" : "font-semibold text-ink"}`}>
                      {r.summary}
                    </span>
                    {r.actor && r.kind !== "visit" && (
                      <span className="text-[11px] text-ink-3">{r.actor}</span>
                    )}
                    {r.fromLead && (
                      <Chip kind="ghost">lead stage</Chip>
                    )}
                  </div>
                  {r.detail && (
                    <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{r.detail}</div>
                  )}
                </div>
                <span
                  className="flex-none font-mono text-[10px] text-ink-3"
                  title={r.whenAbsolute}
                >
                  {r.when}
                </span>
                {r.href && <ArrowUpRight className="size-3 flex-none text-ink-3" strokeWidth={1.5} />}
              </>
            );
            const cls = `flex items-start gap-2.5 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`;
            return (
              <li key={r.id} data-focus={`activity-${r.id}`}>
                {r.href ? (
                  <Link href={r.href} className={`${cls} transition-colors hover:bg-paper-2`}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
