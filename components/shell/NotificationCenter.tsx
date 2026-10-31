"use client";

// Corner approvals + live notification toasts (2026-10-17). Joe: "a
// notification pop-up in the lower corner that immediately asks for these
// types of approvals and i can click a button in it to send or decline."
//
// Mounted once in the (os) layout. Polls pollNotificationCenter every few
// seconds while the tab is visible:
//   • anything waiting on the owner (permission requests with the exact
//     message, decisions, staged drafts) appears bottom-right as a card with
//     Approve / Decline (the operator dock owns the left); site toasts stack
//     above it via --sjc-approvals-h;
//   • new feed cards (a lead moved, a payment landed, a send went out) flash
//     as a short toast;
//   • the bell's unread count is broadcast so it updates without a reload.
// Approve goes through the same server path as Telegram and /engine, so it
// sends exactly what they would.

import Link from "next/link";
import { createPortal } from "react-dom";
import { approvalPlacement } from "@/lib/notification-placement";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, ChevronDown, ChevronUp, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { approveWaiting, declineWaiting, pollNotificationCenter, type NotificationPoll } from "@/lib/actions/approvals";
import type { PendingApproval } from "@/lib/approvals";
import { ApprovalCard } from "@/components/notifications/ApprovalCard";

const POLL_MS = 8_000;
const MAX_CARDS = 3;
const DISMISSED_KEY = "sjc.approvals.dismissed";

export const UNREAD_EVENT = "sjc:unread";

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function NotificationCenter() {
  const router = useRouter();
  const pathname = usePathname();
  const [inboxSurface, setInboxSurface] = useState(false);
  const [opened, setOpened] = useState(false);
  const [badgeSlot, setBadgeSlot] = useState<HTMLElement | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const placement = approvalPlacement(pathname, inboxSurface, opened);
  useEffect(() => {
    setOpened(false);
    setBadgeSlot(document.getElementById("inbox-approval-badge"));
    const change = (event: Event) => {
      setInboxSurface(Boolean((event as CustomEvent).detail));
      setOpened(false);
    };
    window.addEventListener("sjc:inbox-surface", change);
    return () => window.removeEventListener("sjc:inbox-surface", change);
  }, [pathname]);
  const closeDecisions = () => { setOpened(false); badgeRef.current?.focus(); };
  useEffect(() => {
    if (!placement.compact || !opened) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpened(false); badgeRef.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [placement.compact, opened]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  // Nothing renders until the first poll returns approvals, so reading
  // sessionStorage here can't cause a hydration mismatch.
  const [dismissed, setDismissed] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : loadDismissed()));
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const since = useRef<string | null>(null);
  const inFlight = useRef(false);
  const failures = useRef(0);
  const box = useRef<HTMLDivElement | null>(null);

  // Publish the stack's height so the site toasts sit above it, not on it.
  useEffect(() => {
    const el = box.current;
    const root = document.documentElement;
    if (!el || placement.compact) {
      root.style.removeProperty("--sjc-approvals-h");
      return;
    }
    const set = () => root.style.setProperty("--sjc-approvals-h", `${el.offsetHeight + 8}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sjc-approvals-h");
    };
  });

  const apply = useCallback((p: NotificationPoll) => {
    setApprovals(p.approvals);
    window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: p.unread }));
    for (const n of p.fresh.slice().reverse()) {
      toast({ kind: n.flagged ? "error" : "info", title: n.tag || "Notification", message: n.subline ? `${n.title} — ${n.subline}` : n.title });
    }
  }, []);

  const tick = useCallback(async () => {
    if (document.hidden || inFlight.current) return;
    inFlight.current = true;
    try {
      const p = await pollNotificationCenter(since.current);
      failures.current = 0;
      if (!p) return;
      // First poll is the baseline: no toasts for what was already there.
      if (since.current == null) p.fresh = [];
      since.current = p.now;
      apply(p);
    } catch {
      failures.current += 1;
    } finally {
      inFlight.current = false;
    }
  }, [apply]);

  useEffect(() => {
    void tick();
    const id = setInterval(() => {
      // Back off while the server is unreachable (redeploy, network).
      if (failures.current > 2 && Math.random() > 1 / failures.current) return;
      void tick();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tick]);

  const dismiss = (key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      try {
        sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode: dismissal just won't survive a reload */
      }
      return next;
    });
  };

  const answer = async (a: PendingApproval, verb: "approve" | "decline") => {
    setBusy(a.key);
    try {
      const r = verb === "approve" ? await approveWaiting(a.key, a.contentHash) : await declineWaiting(a.key, a.contentHash);
      if (r.ok) {
        toast({ kind: r.kind, title: verb === "approve" ? "Approved" : "Declined", message: r.message, sticky: r.kind === "error" ? true : undefined });
        setApprovals((list) => list.filter((x) => x.key !== a.key));
        router.refresh();
      } else {
        toast({ kind: "error", title: verb === "approve" ? "Approve failed" : "Decline failed", message: r.error });
      }
    } catch (err) {
      toast({ kind: "error", title: "Something went wrong", message: (err as Error).message });
    } finally {
      setBusy(null);
      void tick();
    }
  };

  const visible = approvals.filter((a) => !dismissed.has(a.key));
  const hiddenCount = approvals.length - visible.length;
  if (!approvals.length) return null;

  if (placement.compact) {
    const badge = <button ref={badgeRef} type="button" onClick={() => setOpened(v => !v)}
      aria-label={`${approvals.length} waiting on you — ${opened ? "hide" : "show"} decisions`}
      aria-expanded={opened} aria-controls="inbox-decisions"
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-rule bg-paper text-meta text-ink-2 hover:bg-paper-2">
      <BellRing className="size-3.5 text-flag" />{approvals.length}
    </button>;
    return <>
      {badgeSlot ? createPortal(badge, badgeSlot) : <div className="fixed right-28 top-[env(safe-area-inset-top)] z-[35]">{badge}</div>}
      {placement.expanded && <div id="inbox-decisions" role="region" aria-label="Waiting on you"
        className="fixed right-3 top-[calc(3rem+env(safe-area-inset-top))] z-[35] max-h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] w-[min(380px,calc(100vw-24px))] space-y-2 overflow-y-auto rounded-xl border border-rule bg-paper p-3 shadow-pop">
        <div className="flex items-center justify-between text-body font-semibold">Waiting on you
          <button type="button" onClick={closeDecisions} aria-label="Close decisions" className="grid size-11 place-items-center rounded hover:bg-hover"><X className="size-4" /></button>
        </div>
        {approvals.slice(0,MAX_CARDS).map(a => <ApprovalCard key={a.key} approval={a} busy={busy === a.key} disabled={busy !== null} onAnswer={verb => void answer(a,verb)} floating />)}
        <Link href="/notifications" className="inline-flex min-h-11 items-center text-body text-accent-2 underline">All decisions</Link>
      </div>}
    </>;
  }

  return (
    <div ref={box}
      className="pointer-events-none fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-[max(16px,env(safe-area-inset-right))] z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col items-end gap-2 [&>*]:w-full">
      {visible.length > 0 && (
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-rule bg-paper px-2.5 py-1 shadow-sm">
          <BellRing className="size-3.5 text-flag" strokeWidth={1.75} />
          <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
            {visible.length} waiting on you
          </span>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-0.5 text-ink-3 hover:bg-paper-2 hover:text-ink"
            aria-label={collapsed ? "Show approvals" : "Hide approvals"}
          >
            {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      )}
      {!collapsed &&
        visible.slice(0, MAX_CARDS).map((a) => (
          <div key={a.key} className="pointer-events-auto relative">
            <button
              type="button"
              onClick={() => dismiss(a.key)}
              className="absolute right-1.5 top-1.5 z-10 rounded p-0.5 text-ink-3 hover:bg-paper-2 hover:text-ink"
              aria-label="Not now"
              title="Not now (it stays in the bell)"
            >
              <X className="size-3.5" />
            </button>
            <ApprovalCard approval={a} busy={busy === a.key} disabled={busy !== null} onAnswer={(verb) => void answer(a, verb)} floating />
          </div>
        ))}
      {!collapsed && visible.length > MAX_CARDS && (
        <Link href="/notifications" className="pointer-events-auto rounded-md border border-rule bg-paper px-2.5 py-1 text-center text-[12px] text-ink-2 shadow-sm hover:bg-paper-2">
          +{visible.length - MAX_CARDS} more waiting
        </Link>
      )}
      {visible.length === 0 && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setDismissed(new Set());
            try {
              sessionStorage.removeItem(DISMISSED_KEY);
            } catch {
              /* ignore */
            }
          }}
          className="pointer-events-auto flex !w-auto items-center gap-1.5 self-end rounded-full border border-flag/40 bg-flag-soft px-3 py-1 text-[12px] font-medium text-flag shadow-sm"
        >
          <BellRing className="size-3.5" strokeWidth={1.75} />
          {hiddenCount} waiting on you
        </button>
      )}
    </div>
  );
}
