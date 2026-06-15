import { Fragment } from "react";
import {
  FolderKanban,
  UserRound,
  DollarSign,
  FolderOpen,
  BookOpen,
  Plus,
  Check,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Avatar, Card, Chip, Eyebrow } from "@/components/ui";
import { getAssistantData } from "@/lib/assistant";

const CTX_ICON: Record<string, LucideIcon> = {
  project: FolderKanban,
  leads: UserRound,
  money: DollarSign,
  files: FolderOpen,
  book: BookOpen,
};

/** Render a string with **bold** markdown spans. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <b key={i} className="font-semibold">
            {p.slice(2, -2)}
          </b>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export default async function AiPage() {
  const data = await getAssistantData();
  const { thread } = data;

  return (
    <Shell breadcrumb="ASK CLAUDE" hideCmd>
      <div className="flex h-full">
        {/* ─── Context rail ─────────────────────────────────────────── */}
        <aside className="w-[260px] flex-none overflow-y-auto border-r border-rule bg-paper-2 p-3.5">
          <Eyebrow muted>Context loaded</Eyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            {data.context.map((c) => {
              const Icon = CTX_ICON[c.icon] ?? FolderKanban;
              if (c.primary) {
                return (
                  <Card key={c.label} kind="ai" className="flex items-center gap-1.5 p-2">
                    <Check className="size-3 flex-none text-ai-2" strokeWidth={2} />
                    <span className="text-[12px] font-medium text-ai-2">{c.label}</span>
                  </Card>
                );
              }
              return (
                <div key={c.label} className="flex items-center gap-2 px-1 py-0.5">
                  <span className="flex size-3.5 flex-none items-center justify-center rounded-[3px] border border-accent-2 bg-accent-2">
                    <Check className="size-2.5 text-paper" strokeWidth={2.5} />
                  </span>
                  <Icon className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                  <span className="truncate text-[12px] text-ink-2">{c.label}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-2 px-1 py-0.5">
              <span className="size-3.5 flex-none rounded-[3px] border border-ink-4" />
              <Plus className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
              <span className="text-[12px] text-ink-3">Add context…</span>
            </div>
          </div>

          <div className="my-3 border-t border-rule" />
          <Eyebrow muted>Skills</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-1">
            {data.skills.map((s) => (
              <span
                key={s}
                className="rounded bg-paper-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-2"
              >
                {s}
              </span>
            ))}
          </div>

          <div className="my-3 border-t border-rule" />
          <Eyebrow muted>Recent threads</Eyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            {data.recent.map((t) => (
              <div key={t} className="text-[11px] text-ink-2">
                · {t}
              </div>
            ))}
          </div>
        </aside>

        {/* ─── Conversation ─────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-rule-soft px-7 py-4">
            <Eyebrow>{thread.startedLabel}</Eyebrow>
            <h1 className="mt-0.5 font-serif text-[20px] font-semibold text-ink">{thread.title}</h1>
          </div>

          <div className="flex-1 overflow-y-auto px-7 py-5">
            <div className="flex max-w-[760px] flex-col gap-3.5">
              {/* user */}
              <div className="flex items-start gap-2.5">
                <Avatar initials="J" kind="accent" />
                <div className="flex-1 pt-0.5 text-[13.5px] text-ink">{thread.userMessage}</div>
              </div>

              {/* assistant */}
              <div className="flex items-start gap-2.5">
                <Avatar initials="C" kind="ai" />
                <div className="flex-1">
                  <Card kind="ai" className="p-3">
                    <div className="text-[13px] text-ai-2">{thread.assistant.intro}</div>
                    <div className="mt-2.5 flex flex-col gap-1.5">
                      {thread.assistant.points.map((p, i) => (
                        <div key={i} className="flex gap-1.5 text-[13px] text-ai-2">
                          <span className="font-mono text-ai-2/70">{i + 1}.</span>
                          <span>
                            <RichText text={p} />
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <button className="rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2">
                        {thread.assistant.actions[0]}
                      </button>
                      {thread.assistant.actions.slice(1).map((a) => (
                        <button
                          key={a}
                          className="rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </Card>
                  <div className="mt-1.5 text-[11px] text-ink-3">{thread.assistant.sources}</div>
                </div>
              </div>
            </div>
          </div>

          {/* composer */}
          <div className="border-t border-rule bg-paper-2 px-7 py-3.5">
            <Card className="flex items-center gap-2 p-3">
              <Sparkles className="size-3.5 flex-none text-ai" strokeWidth={1.5} />
              <span className="flex-1 text-[13px] italic text-ink-3">
                Ask anything · or run a skill (/sow, /co-draft, …)
              </span>
              <Chip kind="ghost">⌘↵ send</Chip>
              <Chip kind="ai">@henderson</Chip>
            </Card>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-3">Try:</span>
              {data.tryPrompts.map((t) => (
                <Chip key={t} kind="ghost">
                  {t}
                </Chip>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}
