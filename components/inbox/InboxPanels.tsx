"use client";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { X, Search, Copy, Check, Clock, Link as LinkIcon } from "lucide-react";
import { Button, Chip, Segmented, Avatar } from "@/components/ui";
import { createWorkItem } from "@/lib/actions/engine";
import { createLeadFromInbox } from "@/lib/actions/leads";
import { createSubFromInbox } from "@/lib/actions/subs";
import { createVendorFromInbox } from "@/lib/actions/vendors";
import {
  inboxContextAction,
  inboxPeopleAction,
  summarizeInboxAction,
} from "@/lib/actions/inbox-experience";
import {
  attentionTaskTitle,
  messageWorkItem,
  reminderDueAt,
  relatedConversations,
  SHORTCUTS,
  formatContactPhone, todoDateLabel,
} from "@/lib/inbox-experience";
import { searchInboxDirectoryAction } from "@/lib/actions/inbox-screening";
import type { InboxDirectoryEntry } from "@/lib/inbox-directory";
import { runAction } from "@/lib/run-action";
import type {
  InboxThread,
  ThreadReader,
  InboxData,
  InboxTodo,
} from "@/lib/inbox";
import type { InboxContext } from "@/lib/inbox-context";

export function InboxDialog({
  title,
  onClose,
  children,
  bottom = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  bottom?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    box?.querySelector<HTMLElement>("input,textarea,button")?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && box) {
        const els = Array.from(
          box.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input,textarea,select,[tabindex="0"]',
          ),
        );
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    box?.addEventListener("keydown", key);
    return () => {
      box?.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className={`absolute inset-0 z-[80] flex justify-center bg-ink/25 p-3 ${bottom ? "items-end" : "items-center"}`}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[90%] w-full max-w-lg overflow-y-auto border border-rule bg-card shadow-modal ${bottom ? "rounded-t-2xl" : "rounded-xl"}`}
      >
        <div className="flex min-h-13 items-center gap-2 border-b border-rule px-4">
          <h2 className="flex-1 text-subheading font-semibold">{title}</h2>
          <Button
            icon={X}
            iconOnly
            aria-label={`Close ${title}`}
            title="Close"
            onClick={onClose}
            className="size-11"
          />
        </div>
        <div className="space-y-4 p-4">{children}</div>
      </div>
    </div>
  );
}
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <InboxDialog title="Inbox shortcuts" onClose={onClose}>
      <p className="text-meta text-ink-3">
        Available outside text fields and menus.
      </p>
      <dl className="grid grid-cols-[64px_1fr] gap-2 text-body">
        {Object.entries(SHORTCUTS).map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="rounded border border-rule bg-paper-2 px-2 py-1 font-mono text-meta">
                {k}
              </kbd>
            </dt>
            <dd>
              {
                {
                  next: "Next conversation",
                  previous: "Previous conversation",
                  open: "Open conversation",
                  reply: "Write a reply",
                  approve: "Focus draft Send",
                  done: "Done",
                  remind: "Remind me",
                  link: "Link to job / lead",
                  search: "Search conversations",
                  help: "Show shortcuts",
                }[v]
              }
            </dd>
          </div>
        ))}
      </dl>
    </InboxDialog>
  );
}
export function LinkPicker({
  sender,
  options,
  value,
  onPick,
  onClose,
}: {
  sender?:string;
  options: InboxData["linkOptions"];
  value: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const directory=useDirectoryMatches(q,sender??"");
  const all = [
    ...(options?.projects ?? []).map((p) => ({
      ...p,
      value: `project:${p.slug}`,
      kind: "Job",
    })),
    ...(options?.leads ?? []).map((p) => ({
      ...p,
      value: `lead:${p.slug}`,
      kind: "Lead",
    })),
  ].filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <InboxDialog title="Link to existing" onClose={onClose}>
      <label className="flex items-center gap-2 rounded-md border border-rule p-2">
        <Search className="size-4 text-ink-3" />
        <input
          aria-label="Search directory"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people, jobs, subs and vendors…"
          className="min-h-8 min-w-0 flex-1 bg-transparent text-body outline-none"
        />
      </label>
      <div className="max-h-72 overflow-y-auto">
        {directory.loading&&<p role="status" className="p-3 text-meta text-ink-3">Searching directory…</p>}
        {directory.error&&<p role="alert" className="p-3 text-meta text-flag">{directory.error}</p>}
        {directory.entries.map(p=><button key={`${p.kind}:${p.slug}`} className="block min-h-11 w-full rounded-md px-2 py-2 text-left hover:bg-hover" onClick={()=>{onPick(`${p.kind}:${p.slug}`);onClose();}}><span className="block text-body">{p.name} · {p.role}{p.job?` · ${p.job}`:''}</span><span className="block truncate text-meta text-ink-3">{p.email}{p.match==='email'?' · Exact email':p.match==='domain'?' · Same domain':''}</span></button>)}
        {!sender&&!q&&all.map((p) => (
          <button
            key={p.value}
            onClick={() => {
              onPick(p.value);
              onClose();
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-body hover:bg-hover"
          >
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <Chip kind="ghost">{p.kind}</Chip>
            {value === p.value && <Check className="size-4 text-accent" />}
          </button>
        ))}
        {!directory.loading&&!directory.error&&!directory.entries.length&&Boolean(sender||q) && (
          <p className="p-3 text-meta text-ink-3">No matching directory records.</p>
        )}
      </div>
      {value && (
        <Button
          variant="ghost"
          onClick={() => {
            onPick("");
            onClose();
          }}
        >
          Remove link
        </Button>
      )}
    </InboxDialog>
  );
}
export function MessageTaskDialog({
  thread,
  reader,
  remind,
  options,
  onClose,
  onCreated,
}: {
  thread: InboxThread;
  reader: ThreadReader;
  remind: boolean;
  options: InboxData["linkOptions"];
  onClose: () => void;
  onCreated: (todo: InboxTodo) => void;
}) {
  const [title, setTitle] = useState(
    () => thread.automated && !remind ? attentionTaskTitle(thread) : remind ? messageWorkItem(thread, reader, {}).get("title") as string : `Follow up with ${thread.fromName}: ${messageWorkItem(thread, reader, {}).get("title")}`.slice(0,160),
  );
  const [due, setDue] = useState("");
  const [preset,setPreset]=useState<"tomorrow"|"monday"|"pick">("tomorrow");
  const [job, setJob] = useState(
    thread.projectSlug
      ? `project:${thread.projectSlug}`
      : thread.linkedType
        ? `${thread.linkedType}:${thread.linkedSlug}`
        : "",
  );
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    let active = true;
    inboxPeopleAction()
      .then((p) => {
        if (active) setPeople(p);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  function create(preset?: "tomorrow" | "monday" | "pick") {
    setError("");
    let dueAt = due;
    try {
      if (remind) dueAt = reminderDueAt(preset ?? "pick", new Date(), due);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    start(async () => {
      const r = await runAction(
        () => {
          const fd = messageWorkItem(thread, reader, {
            title: remind ? `Follow up: ${title}` : title,
            dueAt,
            job,
            assignees: assigned,
          });
          if (remind) fd.set("reminder", "true");
          return createWorkItem(fd);
        },
        { fallback: "Could not create the to-do." },
      );
      if (r.ok) {
        let actual: InboxTodo | undefined;
        try {
          const context = await inboxContextAction({
            threadId: thread.id,
            email: thread.fromEmail,
            contactKey: thread.contactKey,
            projectSlug: thread.projectSlug,
            leadSlug:
              thread.linkedType === "lead" ? thread.linkedSlug : undefined,
          });
          actual = context.todos.find((t) => t.id === r.id);
        } catch {
          /* The saved task still gets a link if the context read fails. */
        }
        if (r.id)
          onCreated(
            actual ?? {
              id: r.id,
              title: r.existing
                ? "Existing linked to-do"
                : remind
                  ? `Follow up: ${title}`
                  : title,
              due_at: r.existing ? null : dueAt || null,
              assignees: r.existing
                ? undefined
                : assigned.length
                  ? people
                      .filter((p) => assigned.includes(p.id))
                      .map((p) => p.name)
                      .join(", ")
                  : "Joe",
            },
          );
        onClose();
      } else setError(r.error ?? "Could not create the to-do.");
    });
  }
  return (
    <InboxDialog
      title={remind ? "Remind me" : "Make to-do"}
      onClose={onClose}
      bottom
    >
      {remind ? (
        <>
          <p className="text-body text-ink-2">
            Creates a to-do for {preset==='pick'?(due||'your chosen day'):preset==='tomorrow'?'tomorrow':'Monday'} 8am Central — this conversation stays in your inbox.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={Clock}
              onClick={() => setPreset("tomorrow")}
              aria-pressed={preset==="tomorrow"}
              disabled={pending}
            >
              Tomorrow · 8am
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPreset("monday")}
              aria-pressed={preset==="monday"}
              disabled={pending}
            >
              Monday · 8am
            </Button>
          </div>
        </>
      ) : (
        <label className="block text-meta text-ink-3">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-rule bg-paper px-3 text-body text-ink"
          />
        </label>
      )}
      <blockquote className="max-h-28 overflow-y-auto rounded border-l-2 border-rule bg-paper-2 p-3 text-meta text-ink-2">{[...reader.messages].reverse().find(m=>!m.outbound)?.body.join('\n').slice(0,600)??thread.preview}</blockquote>
      <label className="block text-meta text-ink-3">
        {remind ? "Or pick a day" : "Due day"}
        <input
          type="date"
          value={due}
          onChange={(e) => {setDue(e.target.value);setPreset("pick");}}
          className="mt-1 min-h-11 w-full rounded-md border border-rule bg-paper px-3 text-body text-ink"
        />
      </label>
      <label className="block text-meta text-ink-3">
        Job or lead
        <select
          value={job}
          onChange={(e) => setJob(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-md border border-rule bg-paper px-3 text-body text-ink"
        >
          <option value="">No job or lead</option>
          {options?.projects.map((p) => (
            <option key={p.slug} value={`project:${p.slug}`}>
              {p.name}
            </option>
          ))}
          {options?.leads.map((p) => (
            <option key={p.slug} value={`lead:${p.slug}`}>
              {p.name} · Lead
            </option>
          ))}
        </select>
      </label>
      {people.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-meta text-ink-3">
            Assignee ·{" "}
            {assigned.length
              ? people
                  .filter((p) => assigned.includes(p.id))
                  .map((p) => p.name)
                  .join(", ")
              : "Joe"}
          </summary>
          <fieldset>
            <legend className="mb-1 text-meta text-ink-3">
              Assignee · leave empty for Joe
            </legend>
            {people.map((p) => (
              <label
                key={p.id}
                className="flex min-h-11 items-center gap-2 text-body"
              >
                <input
                  type="checkbox"
                  checked={assigned.includes(p.id)}
                  onChange={(e) =>
                    setAssigned((a) =>
                      e.target.checked
                        ? [...a, p.id]
                        : a.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </fieldset>
        </details>
      )}
      {error && (
        <p role="alert" className="text-meta text-flag">
          {error}
        </p>
      )}
      <Button
        onClick={() => create(remind ? preset : undefined)}
        disabled={pending || (!remind && !title.trim()) || (remind && preset==="pick" && !due)}
      >
        {pending ? "Saving…" : remind ? "Set reminder" : "Create to-do"}
      </Button>
    </InboxDialog>
  );
}
export function ThreadSummary({ reader }: { reader: ThreadReader }) {
  const [summary, setSummary] = useState<{
    headline: string;
    bullets: string[];
    model: string;
    at: number;
  } | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (reader.messages.length < 2 && !reader.messages.some(m=>m.body.join("\n").length>600)) return null;
  return (
    <div className="mb-1 border-b border-rule-soft px-1 text-meta">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-meta text-ink-2">
          {summary?.headline ??
            `${reader.messages.length} ${reader.messages.length===1?"message":"messages"}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="max-sm:min-h-11"
          disabled={pending}
          onClick={() => {
            if (summary) {
              setExpanded((v) => !v);
              return;
            }
            start(async () => {
              const r = await runAction(
                () => summarizeInboxAction(reader.messages),
                { fallback: "Could not summarize." },
              );
              if (r.ok && r.summary) setSummary(r.summary);
              else setError(r.error ?? "Could not summarize.");
            });
          }}
        >
          {pending
            ? "Summarizing…"
            : summary
              ? expanded
                ? "Collapse"
                : "Expand"
              : "Summarize"}
        </Button>
      </div>
      {summary && expanded && (
        <>
          <ul className="my-2 list-disc space-y-1 pl-4 text-body text-ink-2">
            {summary.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <p className="text-meta text-ink-3">
            Summary by {summary.model} ·{" "}
            {new Date(summary.at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-meta text-flag">
          {error}
        </p>
      )}
    </div>
  );
}
export function ContextPanel({
  thread,
  threads,
  onClose,
  onLink,
  onSelect,
  initialData,
  loadError,
  onRetry,
  docked=false,
  compact=false,
  refreshing=false,
}: {
  thread: InboxThread;
  threads: InboxThread[];
  onClose: () => void;
  onLink: () => void;
  onSelect: (id: string) => void;
  initialTab?: "person" | "job";
  initialData?: InboxContext | null;
  loadError?:string;
  onRetry?:()=>void;
  docked?:boolean;
  compact?:boolean;
  refreshing?:boolean;
}) {
  const data = initialData;
  const [error,setError]=useState('');
  const [copied,setCopied]=useState('');
  const [adding,setAdding]=useState<'lead'|'sub'|'vendor'|null>(null);
  const related = relatedConversations(threads, {
    threadId: thread.id,
    email: data?.person?.email ?? thread.fromEmail,
    contactKey: thread.contactKey,
  });
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n / 100);
  return (
    <>
      <button
        aria-label="Close context panel"
        onClick={onClose}
        tabIndex={-1}
        className={`absolute inset-0 z-[65] bg-ink/20 ${docked?"hidden":""}`}
      />
      <aside
        role="complementary"
        aria-label="Person and job context"
        className={`${docked?(compact?"static w-[280px] shadow-none":"static w-[300px] shadow-none"):"absolute inset-x-0 bottom-0 max-h-[85%] w-full rounded-t-xl shadow-pop @4xl/page:inset-y-0 @4xl/page:left-auto @4xl/page:right-0 @4xl/page:max-h-none @4xl/page:w-[300px] @4xl/page:rounded-none"} z-[70] flex shrink-0 max-w-full flex-col border-l border-rule bg-paper-2`}
      >
        <div className="flex min-h-13 items-center gap-2 border-b border-rule px-3">
          <h2 className="text-subheading font-semibold">Person & job</h2>
          <div className="flex-1" />
          <Button
            icon={X}
            iconOnly
            aria-label="Close context"
            title="Close context"
            onClick={onClose}
            className="size-11"
          />
        </div>
        <div className="space-y-3 overflow-y-auto p-3">
          {(error||loadError) && (
            <div role="alert" className="text-meta text-flag">
              {error||loadError}
              {onRetry&&<Button variant="ghost" onClick={onRetry}>Try again</Button>}
            </div>
          )}
          {!data && !error && !loadError && (
            <p className="text-meta text-ink-3">Loading context…</p>
          )}
          {data&&refreshing&&<p role="status" className="text-meta text-ink-3">Updating context… Showing the last saved context.</p>}
          {data && (
            <>
              {
                <>

                  <h3 className="text-subheading font-semibold">
                    {data.person?.name ?? thread.fromName}
                  </h3>
                  {data.person ? (
                    <>
                      <Chip kind="accent">{data.person.role}</Chip>
                      <div className="flex flex-wrap gap-2">
                        {data.person.phone&&<><a className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-meta text-accent-2" href={`tel:${data.person.phone.replace(/[^+0-9]/g,'')}`}>Call</a><a className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-meta text-accent-2" href={`sms:${data.person.phone.replace(/[^+0-9]/g,'')}`}>Text</a></>}
                        {data.person.email&&<a className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-meta text-accent-2" href={`mailto:${data.person.email}`}>Email</a>}
                      </div>
                      {[data.person.email, data.person.phone]
                        .filter(Boolean)
                        .map((value) => {
                          const email = value!.includes("@");
                          const href = email
                            ? `mailto:${value}`
                            : `tel:${value!.replace(/[^+0-9]/g, "")}`;
                          return (
                            <div
                              key={value}
                              className="flex min-w-0 items-center gap-1"
                            >
                              <a
                                href={href}
                                title={value!}
                                className="block min-h-8 min-w-0 flex-1 truncate text-body text-accent-2 underline"
                              >
                                {email ? value : formatContactPhone(value!)}
                              </a>
                              {!email && (
                                <a
                                  href={`sms:${value!.replace(/[^+0-9]/g, "")}`}
                                  className="inline-flex min-h-11 items-center px-2 text-meta text-accent-2"
                                >
                                  Text
                                </a>
                              )}
                              <button
                                aria-label={`Copy ${value}`}
                                onClick={() =>
                                  navigator.clipboard
                                    .writeText(value!)
                                    .then(() => setCopied(value!))
                                    .catch(() =>
                                      setError(
                                        "Could not copy. Select the contact text to copy it.",
                                      ),
                                    )
                                }
                                className="grid size-11 shrink-0 place-items-center rounded hover:bg-hover"
                              >
                                {copied === value ? (
                                  <Check className="size-4" />
                                ) : (
                                  <Copy className="size-4" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                    </>
                  ) : (
                    <div>
                      <p className="mb-2 text-body text-ink-2">New contact?</p>
                      <div className="flex flex-wrap gap-2">
                        {(["lead", "sub", "vendor"] as const).map((k) => (
                          <Button
                            key={k}
                            variant="secondary"
                            size="sm"
                            className="min-h-11"
                            onClick={() => setAdding(k)}
                          >
                            Add as {k}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              }
              {
                <section>
                  <h3 className="mb-2 text-meta font-semibold text-ink-3">
                    {data.job?.kind === "lead" ? "Lead" : "Job"}
                  </h3>
                  {data.job ? (
                    <>
                      <a
                        href={`/${data.job.kind === "project" ? "projects" : "leads"}/${data.job.slug}`}
                        className="inline-flex min-h-11 items-center text-subheading font-semibold text-accent-2 underline"
                      >
                        {data.job.name}
                      </a>
                      <p className="text-body text-ink-2">
                        {data.job.stage}
                      </p>
                      {data.job.money && (
                        <dl className="mt-3 space-y-2 text-body">
                          {Object.entries({
                            Total: data.job.money.total,
                            Paid: data.job.money.paid,
                            Outstanding: data.job.money.outstanding,
                          }).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-2">
                              <dt className="text-ink-3">{k}</dt>
                              <dd className="tabular-nums">{money(v)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </>
                  ) : (
                    <p className="text-body text-ink-3">
                      No linked job or lead.
                    </p>
                  )}

                </section>
              }
              <section>
                <h3 className="mb-2 text-meta font-semibold text-ink-3">
                  Next on the schedule
                </h3>
                <p className="text-body text-ink-2">
                  {data.schedule
                    ? `${data.schedule.label} · ${data.schedule.day} · ${data.schedule.time}`
                    : "No upcoming schedule item."}
                </p>
              </section>
              <section>
                <h3 className="mb-2 text-meta font-semibold text-ink-3">
                  Open to-dos
                </h3>
                {data.todos.length ? (
                  data.todos.map((t) => (
                    <a
                      key={t.id}
                      href={`/engine?work=${t.id}`}
                      className="block min-h-11 border-b border-rule-soft py-2 text-body text-accent-2"
                    >
                      {t.title}
                      <span className="block text-meta text-ink-3">{t.assignees || "Joe"}</span>
                      {t.due_at && (
                        <span className="block text-meta text-ink-3">
                          {todoDateLabel(t)}
                        </span>
                      )}
                    </a>
                  ))
                ) : (
                  <p className="text-body text-ink-3">No open to-dos.</p>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-meta font-semibold text-ink-3">
                  Other conversations
                </h3>
                {related.length ? (
                  related.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onSelect(t.id)}
                      className="block min-h-11 w-full border-b border-rule-soft py-2 text-left"
                    >
                      <p className="truncate text-body text-ink-2">
                        {t.subject}
                      </p>
                      <span className="text-meta text-ink-3">
                        {t.channel.replaceAll("_", " ")} · {t.when}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="text-body text-ink-3">
                    No other conversations in the loaded inbox.
                  </p>
                )}
              </section>
              {data.job?.latestNote&&<details className="text-body text-ink-2"><summary className="min-h-11 cursor-pointer py-2 text-meta font-semibold">Latest note</summary><p className="whitespace-pre-line">{data.job.latestNote}</p></details>}
                  <Button
                    variant="ghost"
                    icon={LinkIcon}
                    onClick={onLink}
                    className="mt-2 min-h-11"
                  >
                    Link to job / lead
                  </Button>
            </>
          )}
        </div>
      </aside>
      {adding && <ContactCreateDialog thread={thread} kind={adding} onClose={() => setAdding(null)} onCreated={() => {setAdding(null); onLink();}} />}

    </>
  );
}

export function ContactCreateDialog({thread,kind,onClose,onCreated,onLink}:{thread:InboxThread;kind:'lead'|'sub'|'vendor';onClose:()=>void;onCreated:(slug:string)=>void;onLink?:()=>void}) {
  const [pending,start]=useTransition();
  const [error,setError]=useState('');
  const [created,setCreated]=useState(false);
  const directory=useDirectoryMatches('',thread.fromEmail??'');
  return <InboxDialog title={`Add as ${kind}`} onClose={onClose}><form className="space-y-3" action={form=>start(async()=>{
    setError('');
    if(directory.loading||directory.error){setError('Wait for the duplicate check before creating.');return;}
    try {
      const result=await (kind==='lead'?createLeadFromInbox:kind==='sub'?createSubFromInbox:createVendorFromInbox)(form);
      if(result.slug){setCreated(true);onCreated(result.slug);}else setError('Enter a name.');
    }catch{setError('Could not create the contact. Check the directory before trying again.');}
  })}>
    <DuplicateNotice directory={directory} onLink={onLink??onClose}/>
    <label className="block text-meta text-ink-3">Name<input name="name" required defaultValue={thread.fromName} className="mt-1 min-h-11 w-full rounded border border-rule bg-paper px-3 text-body" /></label>
    <label className="block text-meta text-ink-3">Email<input name="email" type="email" required readOnly defaultValue={thread.fromEmail} className="mt-1 min-h-11 w-full rounded border border-rule bg-paper px-3 text-body" /></label>
    {kind==='lead'?<><input type="hidden" name="source" value="Inbox"/><label className="block text-meta text-ink-3">Inquiry<textarea name="scope" defaultValue={`${thread.subject}\n${thread.preview}`} className="mt-1 min-h-24 w-full rounded border border-rule bg-paper p-3 text-body" /></label></>:<label className="block text-meta text-ink-3">Trade<input name="trade" className="mt-1 min-h-11 w-full rounded border border-rule bg-paper px-3 text-body" /></label>}
    {error&&<p role="alert" className="text-meta text-flag">{error}</p>}
    <Button type="submit" disabled={pending||created||directory.loading||Boolean(directory.error)}>{pending?'Creating…':`Create ${kind}`}</Button>
  </form></InboxDialog>;
}

function useDirectoryMatches(search:string,sender:string) {
  const [entries,setEntries]=useState<InboxDirectoryEntry[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let alive=true;setLoading(true);setEntries([]);setError('');
    const timer=setTimeout(()=>{searchInboxDirectoryAction(search,sender).then(rows=>{if(alive)setEntries(rows);}).catch(()=>{if(alive)setError('Could not check the directory. Try opening Link again.');}).finally(()=>{if(alive)setLoading(false);});},180);
    return ()=>{alive=false;clearTimeout(timer);};
  },[search,sender]);
  return {entries,loading,error};
}
function DuplicateNotice({directory,onLink}:{directory:ReturnType<typeof useDirectoryMatches>;onLink:()=>void}) {
  const possible=directory.entries.find(p=>p.match==='email')??directory.entries.find(p=>p.match==='domain');
  return <>{directory.loading&&<p role="status" className="text-meta text-ink-3">Checking directory…</p>}{directory.error&&<p role="alert" className="text-meta text-flag">{directory.error}</p>}{possible&&<p className="text-meta text-warn">Possible duplicate: {possible.name} ({possible.role}) · <button type="button" className="min-h-11 font-semibold text-accent-2 underline" onClick={onLink}>Link instead</button></p>}</>;
}
export function SenderScreening({thread,onLink,onAdd,onOther}:{thread:InboxThread;onLink:()=>void;onAdd:(kind:'lead'|'sub'|'vendor')=>void;onOther:()=>void}) {
  const directory=useDirectoryMatches('',thread.fromEmail??'');
  const exact=directory.entries.some(entry=>entry.match==='email');
  const pitch=thread.screeningFacts?.looksPitch;
  const recommended=exact?'link':pitch?'other':'lead';
  const reason=[thread.screeningFacts?.knownContact?'Screening requested by you':thread.screeningFacts?'No saved contact for this address':'Sender not yet screened',thread.screeningFacts?.hasUnsubscribe?'Has an unsubscribe link':'',pitch?'Looks like a pitch':''].filter(Boolean).join(' · ');
  return <div className="w-full min-w-0">
    <p className="mb-1 text-meta text-ink-3">{reason}</p>
    <DuplicateNotice directory={directory} onLink={onLink}/>
    <div className="flex flex-wrap items-center gap-1">
      <Button size="sm" variant={recommended==='link'?'primary':'secondary'} onClick={onLink}>Link{recommended==='link'?' · Recommended':''}</Button>
      {recommended==='lead'&&<Button size="sm" disabled={directory.loading||Boolean(directory.error)} onClick={()=>onAdd('lead')}>Add as lead · Recommended</Button>}
      <details className="relative"><summary className="flex min-h-11 cursor-pointer items-center rounded-md px-3 text-meta font-semibold text-ink-2">Add as ▾</summary><div className="absolute left-0 top-full z-[75] min-w-36 rounded-lg border border-rule bg-card p-1 shadow-pop">{(['lead','sub','vendor'] as const).map(kind=><Button key={kind} disabled={directory.loading||Boolean(directory.error)} variant="ghost" onClick={()=>onAdd(kind)} className="w-full justify-start">{kind[0].toUpperCase()+kind.slice(1)}</Button>)}</div></details>
      <Button size="sm" variant={recommended==='other'?'primary':'ghost'} onClick={onOther}>Always file to Other{recommended==='other'?' · Recommended':''}</Button>
    </div>
  </div>;
}
