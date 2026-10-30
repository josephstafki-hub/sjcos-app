"use client";

import { useRef, useState, useTransition } from "react";
import { Clock, MoreHorizontal } from "lucide-react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Segmented,
  Table,
  TableWrapper,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui";
import { useDialogDismiss } from "@/lib/use-dialog-dismiss";
import { runAction } from "@/lib/run-action";
import {
  startTimerAction,
  stopTimerAction,
  correctIntervalAction,
  confirmClockInAction,
  clockOutAction,
} from "@/lib/owner-time/actions";
import { toBusinessInput, fromBusinessInput } from "@/lib/business-time";
import {
  SOURCE_LABELS,
  CATEGORY_LABELS,
  flagLabel,
} from "@/lib/owner-time/labels";
import type { ReviewList, TimeInterval } from "@/lib/owner-time/intervals";

type Category = TimeInterval["category"];
const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
const input =
  "h-9 min-w-0 max-w-full rounded-md border border-rule bg-card px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-focus max-sm:h-11";
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const when = (iso: string | null) =>
  iso ? fmt.format(new Date(iso)) : "Running";
const dur = (i: TimeInterval) =>
  `${(((i.end_at ? Date.parse(i.end_at) : Date.now()) - Date.parse(i.start_at)) / 3600_000).toFixed(2)} h`;

export function TimeReview({
  review,
  projects,
  rates,
}: {
  review: ReviewList & { running: TimeInterval | null };
  projects: { id: string; name: string; slug: string }[];
  rates: { category: string; rate_cents: number; effective_from: string }[];
  from: string;
  to: string;
}) {
  const trigger = useRef<HTMLElement | null>(null);
  const [pending, start] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState<Category>("site");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("recorded");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState({
    startAt: "",
    endAt: "",
    projectId: "",
    category: "site" as Category,
    note: "",
  });
  useDialogDismiss(Boolean(editing), () => setEditing(null), trigger);
  const name = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ??
    (id ? "Other job" : "Overhead · no job");
  const flagsFor = (id: string) =>
    review.flags.filter((f) => f.intervalId === id);
  const act = (fn: () => Promise<{ ok: boolean; error?: string } | void>) =>
    start(async () => {
      await runAction(fn);
    });
  const shown = review.intervals.filter((i) =>
    filter === "discarded"
      ? i.state === "discarded"
      : filter === "review"
        ? i.state !== "discarded" && flagsFor(i.id).length > 0
        : i.state !== "discarded",
  );
  const adjust = (i: TimeInterval) => {
    trigger.current = document.activeElement as HTMLElement;
    setError("");
    setEditing(i.id);
    setEdit({
      startAt: toBusinessInput(i.start_at),
      endAt: i.end_at ? toBusinessInput(i.end_at) : "",
      projectId: i.project_id ?? "",
      category: i.category,
      note: "",
    });
  };
  const current = review.intervals.find((i) => i.id === editing);

  return (
    <div className="mt-6 space-y-6">
      <Card className="p-4">
        <h2 className="text-subheading font-semibold">Manual timer</h2>
        {review.running ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Chip kind="ok" dot>
              Running
            </Chip>
            <span className="min-w-0 flex-1 text-body">
              {name(review.running.project_id)} · since{" "}
              {when(review.running.start_at)}
            </span>
            <Button
              disabled={pending}
              onClick={() => act(() => stopTimerAction())}
            >
              Stop timer
            </Button>
          </div>
        ) : (
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 @xl/page:grid-cols-2 @2xl/page:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto]">
            <label className="min-w-0 text-label text-ink-2">
              Job
              <select
                aria-label="Timer job"
                className={`${input} mt-1.5 w-full`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Overhead · no job</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-label text-ink-2">
              Category
              <select
                className={`${input} mt-1.5 w-full`}
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-label text-ink-2">
              What are you working on?
              <input
                className={`${input} mt-1.5 w-full`}
                placeholder="Optional note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="flex items-end justify-end">
              <Button
                disabled={pending}
                icon={Clock}
                onClick={() =>
                  act(() => startTimerAction(projectId || null, category, note))
                }
              >
                Start timer
              </Button>
            </div>
          </div>
        )}
      </Card>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-heading">Recorded time</h2>
          <Segmented
            aria-label="Time filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "recorded", label: "Recorded" },
              {
                value: "review",
                label: "Needs review",
                count: review.flags.filter(
                  (f) =>
                    review.intervals.find((i) => i.id === f.intervalId)
                      ?.state !== "discarded",
                ).length,
              },
              { value: "discarded", label: "Discarded" },
            ]}
          />
        </div>
        {!shown.length ? (
          <Card>
            <EmptyState
              icon={Clock}
              title={
                filter === "discarded"
                  ? "No discarded entries"
                  : "No time in this view"
              }
              description="Recorded work appears here. Start a timer above or choose another date range or filter."
            />
          </Card>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <tr>
                  <TableHeader>Job & time · Central</TableHeader>
                  <TableHeader numeric>Hours</TableHeader>
                  <TableHeader className="@max-3xl/page:hidden">
                    Review
                  </TableHeader>
                  <TableHeader>
                    <span className="sr-only">Actions</span>
                  </TableHeader>
                </tr>
              </TableHead>
              <TableBody>
                {shown.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="min-w-0">
                      <div className="break-words text-subheading font-semibold">
                        {name(i.project_id)}
                      </div>
                      <div className="mt-1 text-meta text-ink-3">
                        {when(i.start_at)} → {when(i.end_at)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-meta text-ink-3">
                          {CATEGORY_LABELS[i.category]} ·{" "}
                          {SOURCE_LABELS[i.source]}
                        </span>
                        <Chip kind={i.state === "confirmed" ? "ok" : "neutral"}>
                          {i.state === "inferred"
                            ? "Unconfirmed"
                            : i.state === "review"
                              ? "Needs review"
                              : i.state === "confirmed"
                                ? "Confirmed"
                                : "Discarded"}
                        </Chip>
                      </div>
                      <div className="mt-1 @3xl/page:hidden">
                        {flagsFor(i.id)
                          .slice(0, 2)
                          .map((f) => (
                            <p key={f.flag} className="text-meta text-warn">
                              {flagLabel(f, review.intervals, projects)}
                            </p>
                          ))}
                      </div>
                    </TableCell>
                    <TableCell numeric className="whitespace-nowrap">
                      {dur(i)}
                    </TableCell>
                    <TableCell className="max-w-60 @max-3xl/page:hidden">
                      {flagsFor(i.id).map((f, n) => (
                        <p
                          key={`${f.flag}-${n}`}
                          className="text-meta text-warn"
                        >
                          {flagLabel(f, review.intervals, projects)}
                        </p>
                      ))}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => adjust(i)}
                        >
                          {i.state === "discarded" ? "Restore" : "Adjust"}
                        </Button>
                        {(i.state === "inferred" || i.state === "review") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              act(() =>
                                correctIntervalAction(i.id, {
                                  state: "confirmed",
                                  note: "Kept in review",
                                }),
                              )
                            }
                          >
                            Keep
                          </Button>
                        )}
                        {i.state === "inferred" &&
                          i.source === "geofence_prompt" &&
                          !i.end_at && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={
                                pending ||
                                (i.choices.length > 1 && !i.project_id)
                              }
                              onClick={() =>
                                act(() =>
                                  confirmClockInAction(i.id, i.project_id),
                                )
                              }
                            >
                              Clock in
                            </Button>
                          )}
                        {i.state === "confirmed" &&
                          !i.end_at &&
                          i.source !== "designer_activity" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                act(() =>
                                  clockOutAction(
                                    i.id,
                                    Boolean(i.suggested_end_at),
                                  ),
                                )
                              }
                            >
                              Clock out
                            </Button>
                          )}
                        {i.state !== "discarded" && (
                          <details className="relative">
                            <summary
                              aria-label="More time actions"
                              className="cursor-pointer list-none rounded-md p-2 hover:bg-hover"
                            >
                              <MoreHorizontal className="size-4" />
                            </summary>
                            <div className="absolute right-0 z-10 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-flag"
                                disabled={pending}
                                onClick={() =>
                                  act(() =>
                                    correctIntervalAction(i.id, {
                                      state: "discarded",
                                      note: "Discarded in review",
                                    }),
                                  )
                                }
                              >
                                Discard entry
                              </Button>
                            </div>
                          </details>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </section>
      <p className="text-meta text-ink-3">
        {rates.length
          ? rates
              .map(
                (r) =>
                  `${CATEGORY_LABELS[r.category as Category] ?? "Other"}: $${(r.rate_cents / 100).toFixed(2)}/h from ${r.effective_from.slice(0, 10)}`,
              )
              .join(" · ")
          : "No approved labor rate yet. Hours are recorded; job cost stays unconfigured. Ask to set your rate in the Ask window."}
      </p>
      {current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onClick={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(null);
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Adjust time"
            className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-rule-soft bg-card p-5 shadow-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              start(async () => {
                try {
                  const r = await runAction(() =>
                    correctIntervalAction(current.id, {
                      startAt: fromBusinessInput(
                        edit.startAt,
                        current.start_at,
                      ),
                      endAt: edit.endAt
                        ? fromBusinessInput(edit.endAt, current.end_at)
                        : null,
                      projectId: edit.projectId || null,
                      category: edit.category,
                      state: "confirmed",
                      note: edit.note,
                    }),
                  );
                  if (r.ok) setEditing(null);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Couldn't save this time.",
                  );
                }
              });
            }}
          >
            <h2 className="font-serif text-title">Adjust time</h2>
            <p className="text-meta text-ink-3">
              All dates and times are Central. Saving keeps the correction
              history.
            </p>
            <label className="block text-label">
              Start · Central
              <input
                autoFocus
                required
                type="datetime-local"
                className={`${input} mt-1.5 w-full`}
                value={edit.startAt}
                onChange={(e) => setEdit({ ...edit, startAt: e.target.value })}
              />
            </label>
            <label className="block text-label">
              End · Central
              <input
                type="datetime-local"
                className={`${input} mt-1.5 w-full`}
                value={edit.endAt}
                onChange={(e) => setEdit({ ...edit, endAt: e.target.value })}
              />
            </label>
            <label className="block text-label">
              Job
              <select
                className={`${input} mt-1.5 w-full`}
                value={edit.projectId}
                onChange={(e) =>
                  setEdit({ ...edit, projectId: e.target.value })
                }
              >
                <option value="">Overhead · no job</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-label">
              Category
              <select
                className={`${input} mt-1.5 w-full`}
                value={edit.category}
                onChange={(e) =>
                  setEdit({ ...edit, category: e.target.value as Category })
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-label">
              Reason
              <input
                className={`${input} mt-1.5 w-full`}
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
              />
            </label>
            {error && (
              <p role="alert" className="text-meta text-flag">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
