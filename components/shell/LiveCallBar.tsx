"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import type { LiveCallBarData } from "@/lib/actions/discovery-checklist-ui";
import { formatUsPhone } from "@/lib/comms/phone";
import { claimCompactApprovals } from "@/lib/notification-placement";
import { useOpenChecklist } from "@/components/calls/open-call-store";
import { markSignedIn } from "@/components/calls/checklist/signed-in";
import { chicagoTime, elapsed } from "@/components/calls/checklist/time";
import { useClock, useSessionValue, writeSessionValue } from "@/components/calls/checklist/useClock";

// App-wide live-call bar (plan §4.1, §6.1): 48 px, under the top bar, on every
// page. Fed by the Shell render, which LiveUpdates refreshes when a call row
// changes — no poller of its own. ✕ hides one call for this browser tab only.

const HIDDEN_KEY = "sjcos:live-call-bar:hidden";
const LIVE_CALL_CLAIM = "live-call";

function parseHidden(raw: string | null): string[] {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

// A name may truncate; a phone number and the timer never do — they are the
// two things the bar exists to show (plan §6.1). `leadSlug` puts the lead's
// own call first on that lead's page.
type Entry = { key: string; href: string; text: ReactNode; truncate: boolean; timer: string | null; label: string; symbol: string; leadSlug: string | null };

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
    const href = `/calls?open=${c.id}&view=checklist`;
    if (c.status === "ringing") {
      const label = c.direction === "inbound" ? `Incoming — ${who ?? number}` : `Your cell rings first — ${who ?? number}`;
      entries.push({ key: c.id, href, text: label, truncate: true, timer: null, label, symbol: "☎", leadSlug: c.lead_slug });
      continue;
    }
    // On a phone the words around the number drop away: "(612) 555-0199 03:08",
    // "Alex Smith 06:07". "Call from" also drops in a narrow pane (dock open).
    entries.push(who
      ? { key: c.id, href, text: who, truncate: true, timer, label: `${who} — on the line ${timer}`, symbol: "☎", leadSlug: c.lead_slug }
      : { key: c.id, href, text: <><span className="@max-2xl/shell:hidden">Call from </span>{number}</>, truncate: false, timer, label: `Call from ${number} — on the line ${timer}`, symbol: "☎", leadSlug: c.lead_slug });
  }
  for (const m of data?.manual ?? []) {
    if ((pathname === "/calls" && open?.sessionId === m.id) || hidden.includes(m.id)) continue;
    // Several open checklists with no lead must tell apart: say when each started.
    const time = chicagoTime(m.started_at);
    const label = m.lead_name ? `Discovery checklist — ${m.lead_name}` : `Discovery checklist · started ${time}`;
    const text = m.lead_name ? label : <><span className="@max-md/shell:hidden">Discovery checklist · started </span><span className="hidden @max-md/shell:inline">Checklist · </span><span className="whitespace-nowrap">{time}</span></>;
    entries.push({ key: m.id, href: `/calls?checklist=${m.id}`, text, truncate: !!m.lead_name, timer: null, label, symbol: "☑", leadSlug: m.lead_slug });
  }
  // On a lead's page, that lead's own call leads the bar.
  const pageSlug = pathname?.match(/^\/leads\/([^/?#]+)/)?.[1] ?? null;
  if (pageSlug) entries.sort((a, b) => Number(b.leadSlug === pageSlug) - Number(a.leadSlug === pageSlug));
  const entry = entries[0] ?? null;
  // While the bar shows a call, approvals fold into their badge so a card
  // never covers the bar (or the page Joe is taking the call on). Released
  // when the bar empties or unmounts.
  const showing = !!entry;
  useEffect(() => {
    if (!showing) return;
    claimCompactApprovals(LIVE_CALL_CLAIM, true);
    return () => claimCompactApprovals(LIVE_CALL_CLAIM, false);
  }, [showing]);

  if (!entry) return null;

  function hide() {
    const next = [...hidden.filter((k) => k !== entry!.key), entry!.key].slice(-50);
    writeSessionValue(HIDDEN_KEY, JSON.stringify(next));
  }

  return (
    <div role="region" aria-label="Live call" className="flex h-12 flex-none items-center gap-2 border-b border-ai/30 bg-ai-soft pl-[max(1rem,env(safe-area-inset-left))] @max-sm/shell:pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] text-ai-2 @max-md/shell:gap-1.5">
      <span aria-hidden className="flex-none text-[18px] leading-none @max-sm/shell:hidden">{entry.symbol}</span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden text-[15px] font-semibold @max-sm/shell:text-[14px]" title={entry.label}>
        <span className={entry.truncate ? "min-w-0 truncate" : "flex-none whitespace-nowrap"}>{entry.text}</span>
        {entry.timer !== null && (
          <span className="flex-none whitespace-nowrap">
            <span className="@max-md/shell:hidden">— on the line </span><span className="font-mono tabular-nums">{entry.timer}</span>
          </span>
        )}
      </span>
      {/* The other live calls stay reachable on a phone too: "+2" goes to Calls. */}
      {entries.length > 1 && (
        <Link href="/calls" aria-label={`${entries.length - 1} more live — open Calls`}
          className="inline-flex min-h-12 flex-none items-center rounded-md px-2 text-[14px] font-semibold text-ai-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus">
          +{entries.length - 1}<span className="@max-md/shell:hidden">&nbsp;more</span>
        </Link>
      )}
      <Link href={entry.href} aria-label={`Open checklist — ${entry.label}`} className="inline-flex min-h-12 flex-none items-center rounded-md px-3 @max-md/shell:px-2 text-[15px] font-semibold text-ai-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus @min-sm/shell:min-h-10 @min-sm/shell:border @min-sm/shell:border-ai/40 @min-sm/shell:bg-card @min-sm/shell:no-underline">
        {/* "Open checklist" is ~120 px a phone can't spare: just "Open" there. */}
        <span className="@max-md/shell:hidden">Open checklist</span><span className="hidden @max-md/shell:inline">Open</span>
      </Link>
      <button type="button" onClick={hide} aria-label={`Hide for this call: ${entry.label}`} title="Hide in this tab"
        className="inline-flex size-12 flex-none items-center justify-center rounded-md text-ai-2 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus">
        <X aria-hidden className="size-5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
