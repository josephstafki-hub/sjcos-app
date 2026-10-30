"use client";
import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { ScheduleBlockModal } from "./ScheduleBlockModal";
import type { ScheduleDay, ScheduleProject } from "@/lib/schedule";
import {
  deleteScheduleBlock,
  restoreScheduleBlock,
  type RemovedBlock,
} from "@/lib/actions/schedule";
import { groupScheduleSpans } from "@/lib/schedule-time";
import { runAction } from "@/lib/run-action";
const TINTS = [
  "border-accent bg-accent-soft/50",
  "border-info bg-info-soft/50",
  "border-warn bg-warn-soft/40",
  "border-ok bg-ok-soft/50",
];
function tint(key: string) {
  return TINTS[
    Array.from(key).reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length
  ];
}
function readableLabel(label: string) {
  return label.split("/").map((part, index) => (
    <Fragment key={index}>
      {index > 0 && (
        <>
          /<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));
}
export function ScheduleBoard({
  days,
  projects,
}: {
  days: ScheduleDay[];
  projects: ScheduleProject[];
}) {
  const [removed, setRemoved] = useState<RemovedBlock[]>([]);
  const [pending, start] = useTransition();
  const spans = groupScheduleSpans(
    days.map((day) => ({
      ...day,
      blocks: day.blocks.filter((b) => !removed.some((r) => r.id === b.id)),
    })),
  );
  return (
    <>
      {!!removed.length && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-rule-soft bg-card px-4 py-3 text-body"
        >
          <span className="flex-1">
            {removed.length} block{removed.length === 1 ? "" : "s"} removed.
            Undo is available until you leave this page.
          </span>
          {removed.map((b) => (
            <Button
              key={b.id}
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await runAction(() => restoreScheduleBlock(b));
                  if (r.ok)
                    setRemoved((list) => list.filter((x) => x.id !== b.id));
                })
              }
            >
              Undo {b.label}
            </Button>
          ))}
        </div>
      )}
      {spans.length > 0 && (
        <div
          aria-label="Multi-day work"
          className="mb-3 grid grid-cols-1 gap-2 @2xl/page:grid-cols-5"
        >
          {spans.map((span, index) => (
            <div
              key={span.key}
              className="min-w-0 @2xl/page:[grid-column:var(--span-column)] @2xl/page:[grid-row:var(--span-row)]"
              style={
                {
                  "--span-column": `${span.start + 1} / ${span.end + 2}`,
                  "--span-row": index + 1,
                } as React.CSSProperties
              }
            >
              <div
                className={`rounded-md border-l-4 px-3 py-2 ${tint(span.projectSlug ?? span.label)}`}
              >
                <p className="text-label font-semibold">{span.label}</p>
                <p className="mt-1 text-meta text-ink-2">
                  {days[span.start].dow[0] +
                    days[span.start].dow.slice(1).toLowerCase()}{" "}
                  {days[span.start].date}–
                  {days[span.end].dow[0] +
                    days[span.end].dow.slice(1).toLowerCase()}{" "}
                  {days[span.end].date}
                  {span.projectSlug && (
                    <>
                      {" "}
                      ·{" "}
                      <Link
                        className="hover:underline"
                        href={`/projects/${span.projectSlug}`}
                      >
                        {span.projectName}
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-rule-soft bg-card @2xl/page:grid-cols-5">
        {days.map((day) => (
          <section
            key={day.iso}
            aria-label={`${day.dow} ${day.iso}`}
            className="group/day min-w-0 border-b border-rule-soft last:border-0 @2xl/page:border-b-0 @2xl/page:border-r"
          >
            <div
              className={`flex min-h-14 items-center justify-between gap-1 border-b border-rule-soft px-3 py-3 ${day.today ? "bg-selected" : "bg-paper-2/40"}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-label font-semibold">
                <span>
                  {day.dow.charAt(0) + day.dow.slice(1).toLowerCase()}
                </span>
                <span
                  className={
                    day.today
                      ? "flex size-7 items-center justify-center rounded-full bg-accent text-paper"
                      : "text-ink-3"
                  }
                >
                  {day.date}
                </span>
                {day.today && (
                  <span className="text-meta text-accent">Today</span>
                )}
              </div>
              <ScheduleBlockModal
                initialDate={day.iso}
                projects={projects}
                triggerAriaLabel={`Add a block on ${day.dow}`}
                triggerClassName="rounded-md p-1.5 text-ink-3 max-sm:min-h-11 max-sm:min-w-11 opacity-100 hover:bg-hover focus:opacity-100 @2xl/page:opacity-0 @2xl/page:group-hover/day:opacity-100 [@media(hover:none)]:opacity-100"
                triggerContent={<Plus className="size-4" />}
              />
            </div>
            <div className="space-y-2 p-2 @2xl/page:min-h-72">
              {day.blocks
                .filter((b) => !removed.some((r) => r.id === b.id))
                .map((b, n) => (
                  <article
                    key={b.id ?? `${b.label}-${n}`}
                    className={`min-w-0 rounded-md border-l-4 px-2 py-2 ${tint(b.projectSlug ?? b.label)}`}
                  >
                    <div className="mb-1 text-meta text-ink-3">
                      {b.time}
                      {b.auto ? " · From record" : ""}
                    </div>
                    {b.id ? (
                      <ScheduleBlockModal
                        initialDate={day.iso}
                        projects={projects}
                        block={b}
                        triggerClassName="block w-full break-words text-left text-label font-semibold text-ink hover:underline"
                        triggerContent={readableLabel(b.label)}
                      />
                    ) : (
                      <p className="break-words text-label font-semibold text-ink">
                        {readableLabel(b.label)}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-start gap-1">
                      <div className="min-w-0 flex-1 break-words text-meta text-ink-2">
                        {b.projectSlug ? (
                          <Link
                            className="hover:underline"
                            href={`/projects/${b.projectSlug}`}
                          >
                            {b.projectName}
                          </Link>
                        ) : b.href ? (
                          <Link href={b.href} className="hover:underline">
                            {b.hrefLabel}
                          </Link>
                        ) : (
                          "Standalone"
                        )}
                      </div>
                      {b.id && (
                        <details className="relative shrink-0">
                          <summary
                            aria-label={`More actions for ${b.label}`}
                            className="cursor-pointer list-none rounded p-1 hover:bg-hover max-sm:min-h-11 max-sm:min-w-11"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </summary>
                          <div className="absolute right-0 z-10 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-flag"
                              disabled={pending}
                              onClick={() =>
                                start(async () => {
                                  const r = await runAction(() =>
                                    deleteScheduleBlock(b.id!),
                                  );
                                  if (r.ok && r.removed)
                                    setRemoved((list) => [...list, r.removed!]);
                                })
                              }
                            >
                              Remove block
                            </Button>
                          </div>
                        </details>
                      )}
                    </div>
                  </article>
                ))}
              {!day.blocks.length && (
                <p className="px-1 py-3 text-meta text-ink-3">
                  No blocks planned
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
