"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import type { LiveCallBarData } from "@/lib/actions/discovery-checklist-ui";
import { formatUsPhone } from "@/lib/comms/phone";
import { useOpenChecklist } from "@/components/calls/open-call-store";
import { markSignedIn } from "@/components/calls/checklist/signed-in";
import { elapsed } from "@/components/calls/checklist/time";
import { useClock, useSessionValue, writeSessionValue } from "@/components/calls/checklist/useClock";

// App-wide live-call bar (plan §4.1, §6.1): 48 px, under the top bar, on every
// page. Fed by the Shell render, which LiveUpdates refreshes when a call row
// changes — no poller of its own. ✕ hides one call for this browser tab only.

const HIDDEN_KEY = "sjcos:live-call-bar:hidden";

function parseHidden(raw: string | null): string[] {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

type Entry = { key: string; href: string; action: string; text: ReactNode; label: string; symbol: string };

export function LiveCallBar({ data, userId }: { data: LiveCallBarData | null; userId: string | null }) {
  const pathname = usePathname();
  const open = useOpenChecklist();
  const hidden = parseHidden(useSessionValue(HIDDEN_KEY));

  useEffect(() => { if (userId) markSignedIn(userId); }, [userId]);

  const ticking = (data?.calls ?? []).some((c) => c.status !== "ringing");
  const now = useClock(ticking);
  const entries: Entry[] = [];
  for (const c of data?.calls ?? []) {
    const onScreen = pathname === "/calls" && (open?.callId === c.id || (!!c.session_id && open?.sessionId === c.session_id));
    if (onScreen || hidden.includes(c.id)) continue;
    const who = c.label?.trim() || null;
    const number = formatUsPhone(c.number);
    const timer = now ? elapsed(c.answered_at ?? c.started_at, now) : "";
    let text: ReactNode;
    let label: string;
    if (c.status === "ringing") {
      label = c.direction === "inbound" ? `Incoming — ${who ?? number}` : `Your cell rings first — ${who ?? number}`;
      text = label;
    } else if (who) {
      label = `${who} — on the line ${timer}`;
      text = <>{who} — <span className="@max-sm/shell:hidden">on the line </span><span className="font-mono tabular-nums">{timer}</span></>;
    } else {
      label = `Call from ${number} — on the line ${timer}`;
      text = <>Call from {number} — <span className="@max-sm/shell:hidden">on the line </span><span className="font-mono tabular-nums">{timer}</span></>;
    }
    entries.push({ key: c.id, href: `/calls?open=${c.id}&view=checklist`, action: "Open checklist", text, label, symbol: "☎" });
  }
  for (const m of data?.manual ?? []) {
    if ((pathname === "/calls" && open?.sessionId === m.id) || hidden.includes(m.id)) continue;
    const label = `Discovery checklist open${m.lead_name ? ` — ${m.lead_name}` : ""}`;
    entries.push({ key: m.id, href: `/calls?checklist=${m.id}`, action: "Open", text: label, label, symbol: "☑" });
  }
  const entry = entries[0] ?? null;

  if (!entry) return null;

  function hide() {
    const next = [...hidden.filter((k) => k !== entry!.key), entry!.key].slice(-50);
    writeSessionValue(HIDDEN_KEY, JSON.stringify(next));
  }

  return (
    <div role="region" aria-label="Live call" className="flex h-12 flex-none items-center gap-2 border-b border-ai/30 bg-ai-soft pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] text-ai-2">
      <span aria-hidden className="flex-none text-[18px] leading-none">{entry.symbol}</span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={entry.label}>{entry.text}</span>
      {entries.length > 1 && <span className="flex-none text-[14px] @max-md/shell:hidden">+{entries.length - 1} more</span>}
      <Link href={entry.href} className="inline-flex min-h-12 flex-none items-center rounded-md px-3 text-[15px] font-semibold text-ai-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus @min-sm/shell:min-h-10 @min-sm/shell:border @min-sm/shell:border-ai/40 @min-sm/shell:bg-card @min-sm/shell:no-underline">
        {entry.action}
      </Link>
      <button type="button" onClick={hide} aria-label={`Hide for this call: ${entry.label}`} title="Hide in this tab"
        className="inline-flex size-12 flex-none items-center justify-center rounded-md text-ai-2 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus">
        <X aria-hidden className="size-5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
