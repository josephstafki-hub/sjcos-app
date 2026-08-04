"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { pollLiveChanges } from "@/lib/actions/live";

/** How often to ask "did anything change?" while the tab is visible. */
const POLL_MS = 2_500;
/** Floor between two router.refresh() calls, so a burst of agent writes (e.g.
 *  arrange_mood_board moving ten items) coalesces into one refetch. */
const MIN_REFRESH_GAP_MS = 3_000;
/** Cap for the error backoff — a down server gets pinged at most every 30s. */
const MAX_BACKOFF_MS = 30_000;

/**
 * Renders nothing; mounted once in Shell. Polls the app_change_log cursor (see
 * lib/db.ts bumpLiveChange — the app and the MCP server both write to it) and
 * router.refresh()es when it advances, so edits made by agents — or by Joe in
 * another tab — appear on whatever page is open without a reload. refresh()
 * re-renders the server components and merges the payload without touching
 * client state, per the house rule this is short-interval polling via a server
 * action, not SSE (docs/operator-console-plan.md).
 */
export function LiveUpdates() {
  const router = useRouter();
  const cursor = useRef<number | null>(null);
  const needsRefresh = useRef(false);
  const lastRefresh = useRef(0);
  const inFlight = useRef(false);
  const failures = useRef(0);
  const retryAt = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled || document.hidden || inFlight.current) return;
      if (Date.now() < retryAt.current) return;

      inFlight.current = true;
      try {
        const { cursor: next } = await pollLiveChanges(cursor.current);
        failures.current = 0;
        if (cancelled) return;
        // First poll just sets the baseline — the page rendered fresh data on load.
        if (cursor.current != null && next > cursor.current) needsRefresh.current = true;
        cursor.current = next;
      } catch {
        // Network blip or redeploy: back off, keep the flag so nothing is lost.
        failures.current += 1;
        retryAt.current = Date.now() + Math.min(MAX_BACKOFF_MS, failures.current * 5_000);
      } finally {
        inFlight.current = false;
      }

      if (needsRefresh.current && Date.now() - lastRefresh.current >= MIN_REFRESH_GAP_MS) {
        needsRefresh.current = false;
        lastRefresh.current = Date.now();
        router.refresh();
      }
    }

    const id = setInterval(tick, POLL_MS);
    // Catch up the moment the tab becomes visible again instead of waiting out
    // the interval — this is the "came back from the truck" path.
    function onVisible() {
      if (!document.hidden) void tick();
    }
    document.addEventListener("visibilitychange", onVisible);
    void tick();

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
