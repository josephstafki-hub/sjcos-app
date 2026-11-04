"use client";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { loadTodayRecovery, restoreTodayItem } from "@/lib/actions/today";
import type { RecoverableWork } from "@/lib/today-recovery.mjs";
import { useTodayQueue } from "./TodayQueueContext";

export function TodayRecovery({ view }: { view: "done" | "snoozed" }) {
  const [items, setItems] = useState<RecoverableWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { refresh } = useTodayQueue();
  useEffect(() => {
    let active = true;
    loadTodayRecovery(view)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch(() => {
        if (active)
          setError("Couldn't load this list. Switch views to try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view]);
  async function restore(id: string) {
    setBusy(id);
    setError(null);
    try {
      await restoreTodayItem(id, view);
      setItems((rows) => rows.filter((r) => r.id !== id));
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't restore this to-do. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  const visible = items.filter((i) =>
    `${i.title} ${i.project_name ?? i.lead_name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div>
      <p className="mb-3 text-body text-ink-3">
        {view === "done"
          ? "Reopen completed or cancelled work. Future due dates stay scheduled."
          : "Scheduled work stays out of Today until its due day. Bring back today changes its due date to today."}
      </p>
      <input
        aria-label="Search recovered work"
        placeholder="Search to-dos…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3 h-9 max-sm:h-11 w-full rounded-md border border-rule bg-card px-3 text-body focus-visible:outline-2 focus-visible:outline-focus"
      />
      {error && (
        <p role="alert" className="mb-3 text-body text-flag">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="py-8 text-body text-ink-3">
          Loading to-dos…
        </p>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title={
            search
              ? "No matching to-dos"
              : view === "done"
                ? "No completed work"
                : "No snoozed work"
          }
          description={
            search
              ? "Try another name or job."
              : view === "done"
                ? "Work you mark done will appear here so you can reopen it."
                : "Snoozed and future-dated to-dos will appear here until their scheduled day."
          }
          compact
        />
      ) : (
        <div className="divide-y divide-rule-soft">
          {visible.map((i) => (
            <div
              key={i.id}
              className="flex flex-wrap items-center gap-3 px-2 py-3 hover:bg-hover"
            >
              <div className="min-w-0 flex-1">
                <p className="text-subheading font-semibold text-ink">
                  {i.title}
                </p>
                <p className="mt-1 text-meta text-ink-3">
                  {i.project_name ?? i.lead_name ?? "Office & admin"}
                  {i.due ? ` · Due ${i.due}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                className="max-sm:h-11"
                variant="secondary"
                icon={RotateCcw}
                disabled={busy !== null}
                onClick={() => void restore(i.id)}
              >
                {busy === i.id
                  ? "Restoring…"
                  : view === "done"
                    ? "Reopen"
                    : "Bring back today"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
