"use client";

import Link from "next/link";
import { FileText, Image as ImageIcon, LayoutGrid, PenLine, ListChecks } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { PublishedRoster as Roster } from "@/lib/portal-roster";

/** What the client can currently see on their dashboard, grouped by kind, each
 *  row jumping to where it's managed. Lead scopes only have files + docs. */
export function PublishedRoster({
  roster,
  base,
}: {
  roster: Roster;
  /** Owner page for the scope, e.g. "/projects/birchwood-kitchen" — rows link
   *  to `${base}?tab=…&focus=…`. */
  base: string;
}) {
  const link = (tab: string, focus?: string) =>
    `${base}?tab=${encodeURIComponent(tab)}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`;

  return (
    <Card className="max-w-[680px] overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        On the client&rsquo;s dashboard · {roster.total} item{roster.total === 1 ? "" : "s"}
      </div>
      {roster.total === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-ink-3">
          Nothing published yet. Use the eye icons on Files and Documents (and Publish on plans,
          boards, and selections) to put things in front of the client.
        </div>
      ) : (
        <div className="divide-y divide-rule-soft">
          {roster.plans.length > 0 && (
            <Group title="Floor plans" icon={PenLine}>
              {roster.plans.map((p) => (
                <Row
                  key={p.id}
                  href={link("Floor", `floorplan-${p.id}`)}
                  label={`Version ${p.version}`}
                  meta={`published ${p.publishedLabel}`}
                  status={
                    p.approvedLabel ? (
                      <Chip kind="money" dot>approved · {p.approvedName || "client"}</Chip>
                    ) : (
                      <Chip kind="ghost" dot>awaiting approval</Chip>
                    )
                  }
                />
              ))}
            </Group>
          )}
          {roster.boards.length > 0 && (
            <Group title="Mood boards" icon={LayoutGrid}>
              {roster.boards.map((b) => (
                <Row
                  key={b.room}
                  href={link("Mood", `mood-${b.room}`)}
                  label={b.title || b.room}
                  meta={`${b.room} · published ${b.publishedLabel}`}
                  status={
                    b.approvedLabel ? (
                      <Chip kind="money" dot>approved · {b.approvedName || "client"}</Chip>
                    ) : (
                      <Chip kind="ghost" dot>awaiting approval</Chip>
                    )
                  }
                />
              ))}
            </Group>
          )}
          {roster.selections.length > 0 && (
            <Group title="Selections" icon={ListChecks}>
              {roster.selections.map((s) => (
                <Row
                  key={s.id}
                  href={link("Selections", `selection-${s.id}`)}
                  label={s.area}
                  meta={`pushed ${s.pushedLabel}${s.decidedLabel ? ` · decided ${s.decidedLabel}` : ""}`}
                  status={
                    s.status === "approved" ? (
                      <Chip kind="money" dot>chose {s.choice || "an option"}</Chip>
                    ) : s.status === "declined" ? (
                      <Chip kind="flag" dot>declined</Chip>
                    ) : (
                      <Chip kind="accent" dot>pending</Chip>
                    )
                  }
                />
              ))}
            </Group>
          )}
          {roster.docs.length > 0 && (
            <Group title="Documents" icon={FileText}>
              {roster.docs.map((d) => (
                <Row
                  key={d.id}
                  href={link("Documents", `draft-${d.id}`)}
                  label={d.title}
                  meta={`published ${d.when}`}
                />
              ))}
            </Group>
          )}
          {roster.files.length > 0 && (
            <Group title="Files" icon={ImageIcon}>
              {roster.files.map((f) => (
                <Row
                  key={f.id}
                  href={link("Files", `file-${f.id}`)}
                  label={f.name}
                  meta={`${f.sizeLabel} · published ${f.when}`}
                />
              ))}
            </Group>
          )}
        </div>
      )}
    </Card>
  );
}

function Group({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        <Icon className="size-3" strokeWidth={1.5} />
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({
  href,
  label,
  meta,
  status,
}: {
  href: string;
  label: string;
  meta: string;
  status?: React.ReactNode;
}) {
  return (
    <Link href={href} className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-1 hover:bg-paper-2">
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{label}</span>
      {status}
      <span className="flex-none font-mono text-[10px] text-ink-4">{meta}</span>
    </Link>
  );
}
