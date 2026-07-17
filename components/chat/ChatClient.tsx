"use client";

import { useState, useTransition } from "react";
import { Sparkles, Send, UserPlus, X, Plus, ChevronLeft } from "lucide-react";
import { Card, Chip, Avatar } from "@/components/ui";
import {
  sendChatMessage,
  askAgentInChannel,
  markChannelRead,
  addChannelMember,
  removeChannelMember,
  createChannel,
  archiveChannel,
  addChannelAgent,
  removeChannelAgent,
} from "@/lib/actions/chat";
import type { ChatChannel, ChatData, ChatMessage, ChannelMember, ChannelView } from "@/lib/chat";
import { AGENT_ORDER, type DevAgent } from "@/lib/dev-agents-meta";

// The AI teammates you can @-mention in any channel.
const CHAT_AGENTS: Record<DevAgent, { name: string; initials: string }> = {
  claude: { name: "Claude", initials: "CL" },
  qwen: { name: "Qwen", initials: "QW" },
  hermes: { name: "Hermes", initials: "HM" },
};

// Preference order for a bare `@ai` mention: qwen first (the grounded business
// assistant), matching the prior hardcoded default before AI membership existed.
const AT_AI_ORDER: DevAgent[] = ["qwen", "claude", "hermes"];

/** Small-caps mono section label for the light-background rail. */
function RailLabel({ children }: { children: string }) {
  return (
    <div className="px-1 pb-1 pt-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
      {children}
    </div>
  );
}

/** "7:48am" — matches the server-side format in lib/chat. */
function clockNow(): string {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}

export function ChatClient({ data }: { data: ChatData }) {
  const [selectedKey, setSelectedKey] = useState(data.selectedKey);
  // Mobile master/detail: below lg, show the channel rail OR the messages.
  const [mobileThread, setMobileThread] = useState(false);
  const [views, setViews] = useState(data.views);
  const [channels, setChannels] = useState(data.channels);
  const [rooms, setRooms] = useState(data.rooms);
  const [directs, setDirects] = useState(data.directs);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // May be undefined after archiving the last channel — the render guards for it.
  const view = views[selectedKey] as ChannelView | undefined;

  // Optimistically replace a channel's member list, then persist.
  const setMembers = (key: string, members: ChannelMember[]) =>
    setViews((v) => ({ ...v, [key]: { ...v[key], members } }));

  const setAiMembers = (key: string, aiMembers: DevAgent[]) =>
    setViews((v) => ({ ...v, [key]: { ...v[key], aiMembers } }));

  const addMember = (m: ChannelMember) => {
    if (!view) return;
    const key = selectedKey;
    setMembers(key, [...view.members, m]);
    startTransition(async () => {
      await addChannelMember(key, m.slug);
    });
  };

  const removeMember = (slug: string) => {
    if (!view) return;
    const key = selectedKey;
    setMembers(key, view.members.filter((m) => m.slug !== slug));
    startTransition(async () => {
      await removeChannelMember(key, slug);
    });
  };

  const addAgent = (agent: DevAgent) => {
    if (!view) return;
    const key = selectedKey;
    setAiMembers(key, [...view.aiMembers, agent]);
    startTransition(async () => {
      await addChannelAgent(key, agent);
    });
  };

  const removeAgent = (agent: DevAgent) => {
    if (!view) return;
    const key = selectedKey;
    setAiMembers(key, view.aiMembers.filter((a) => a !== agent));
    startTransition(async () => {
      await removeChannelAgent(key, agent);
    });
  };

  // Subs not yet in the current channel — the add-picker options.
  const available = view
    ? data.roster.filter((r) => !view.members.some((m) => m.slug === r.slug))
    : [];

  const selectChannel = (key: string) => {
    setSelectedKey(key);
    setManaging(false);
    setMobileThread(true);
    // Optimistically clear the unread badge + persist the read marker.
    const clear = <T extends { key: string; unread?: number }>(list: T[]) =>
      list.map((c) => (c.key === key ? { ...c, unread: undefined } : c));
    setChannels(clear);
    setRooms(clear);
    setDirects(clear);
    markChannelRead(key).catch(() => {});
  };

  const append = (key: string, msg: ChatMessage) =>
    setViews((v) => ({
      ...v,
      [key]: { ...v[key], messages: [...v[key].messages, msg] },
    }));

  // Post a local AI-styled system notice (e.g. "X isn't in this channel").
  const notice = (key: string, name: string, initials: string, text: string) =>
    append(key, { initials, name, time: clockNow(), text, kind: "ai", system: true });

  const send = () => {
    const text = input.trim();
    if (!text || !view) return;
    const key = selectedKey;
    const members = view.aiMembers;
    append(key, { initials: "JS", name: "Joe", time: clockNow(), text, kind: "owner" });
    setInput("");
    const m = text.match(/@(claude|hermes|qwen|ai)\b/i);
    const mentioned = m?.[1].toLowerCase();
    // @ai → the first member model (in preference order); an explicit @model
    // stays that model so the server-side membership gate can answer honestly.
    const agent: DevAgent | null = mentioned
      ? mentioned === "ai"
        ? AT_AI_ORDER.find((a) => members.includes(a)) ?? members[0] ?? null
        : (mentioned as DevAgent)
      : null;
    startTransition(async () => {
      await sendChatMessage(key, text);
      if (agent) {
        const id = CHAT_AGENTS[agent];
        // Skip the round-trip when we already know the model isn't a member.
        if (!members.includes(agent)) {
          notice(
            key,
            id.name,
            id.initials,
            `${id.name} isn't in this channel — add them from the participants menu.`,
          );
          return;
        }
        setTyping(id.name);
        const r = await askAgentInChannel(key, agent);
        setTyping(null);
        if (r.ok && r.reply) {
          append(key, {
            initials: id.initials,
            name: id.name,
            time: clockNow(),
            text: r.reply,
            kind: "ai",
            system: true,
          });
        } else if (!r.ok && r.error) {
          notice(key, id.name, id.initials, r.error);
        }
      }
    });
  };

  const createChannelHandler = () => {
    const name = newName.trim();
    if (!name) return;
    setCreateError(null);
    startTransition(async () => {
      const r = await createChannel(name);
      if (!r.ok || !r.channel) {
        setCreateError(r.error ?? "Could not create channel.");
        return;
      }
      const ch = r.channel;
      // Add to the rail + seed an empty view (owner-only, no members yet).
      setChannels((list) =>
        list.some((c) => c.key === ch.key) ? list : [...list, { key: ch.key, name: ch.name }],
      );
      setViews((v) => ({
        ...v,
        [ch.key]: v[ch.key] ?? {
          key: ch.key,
          name: ch.name,
          description: ch.description || "Team channel",
          participants: ["JS"],
          members: [],
          aiMembers: [],
          canManageMembers: true,
          canManageAi: true,
          daySeparator: `Today · ${new Date().toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}`,
          messages: [],
        },
      }));
      setNewName("");
      setCreating(false);
      selectChannel(ch.key);
    });
  };

  const archiveChannelHandler = (key: string) => {
    if (!window.confirm("Remove this channel? Its history is kept and can be restored.")) return;
    // Pick a fallback selection before dropping it from the list.
    const remaining = channels.filter((c) => c.key !== key);
    if (selectedKey === key) {
      const next = remaining[0]?.key ?? rooms[0]?.key ?? directs[0]?.key ?? "";
      setSelectedKey(next);
    }
    setChannels(remaining);
    startTransition(async () => {
      await archiveChannel(key);
    });
  };

  // Dynamic AI-membership copy for the footer / placeholder / empty state.
  const aiMembers = view?.aiMembers ?? [];
  const aiMentions = aiMembers.map((a) => `@${a}`).join(" · ");
  const aiFooter =
    view && view.canManageAi && aiMembers.length === 0
      ? "No AI in this channel — add a model from the participants menu"
      : `${aiMentions} ${aiMembers.length === 1 ? "is" : "are"} in this channel`;
  const composerHint = aiMembers.length ? `${aiMentions}, Enter to send` : "Enter to send";

  return (
    <div className="flex h-full">
      {/* ─── Channel rail ─────────────────────────────────────────── */}
      <aside
        className={[
          "w-full flex-none flex-col overflow-y-auto border-r border-rule bg-paper-2 p-3 lg:w-[220px]",
          mobileThread ? "hidden lg:flex" : "flex",
        ].join(" ")}
      >
        <RailLabel>Channels</RailLabel>
        <div className="flex flex-col gap-0.5">
          {channels.map((c) => (
            <ChannelItem
              key={c.key}
              channel={c}
              active={c.key === selectedKey}
              onSelect={() => selectChannel(c.key)}
              onArchive={() => archiveChannelHandler(c.key)}
            />
          ))}
          {creating ? (
            <div className="px-1 pt-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createChannelHandler();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                    setCreateError(null);
                  }
                }}
                onBlur={() => {
                  if (!newName.trim()) {
                    setCreating(false);
                    setCreateError(null);
                  }
                }}
                placeholder="channel-name"
                className="w-full rounded-md border border-rule bg-card px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
              />
              {createError && (
                <div className="px-1 pt-1 text-[10px] text-flag">{createError}</div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink-2"
            >
              <Plus className="size-3.5 flex-none" strokeWidth={2} />
              New channel
            </button>
          )}
        </div>

        <div className="my-2 h-px bg-rule" />
        <RailLabel>Project rooms</RailLabel>
        <div className="flex flex-col gap-0.5">
          {rooms.map((c) => (
            <ChannelItem
              key={c.key}
              channel={c}
              active={c.key === selectedKey}
              onSelect={() => selectChannel(c.key)}
            />
          ))}
        </div>

        <div className="my-2 h-px bg-rule" />
        <RailLabel>Direct</RailLabel>
        <div className="flex flex-col gap-0.5">
          {directs.map((d) => (
            <button
              key={d.key}
              onClick={() => selectChannel(d.key)}
              className={[
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
                d.key === selectedKey
                  ? "bg-accent-soft text-accent-2"
                  : "text-ink-2 hover:bg-paper-3",
              ].join(" ")}
            >
              <span className="relative flex-none">
                <Avatar initials={d.initials} size="sm" kind="gray" />
                {d.online && (
                  <span className="absolute -bottom-px -right-px size-1.5 rounded-full border border-paper bg-money" />
                )}
              </span>
              <span className="flex-1 truncate text-[12px]">{d.name}</span>
              {d.unread ? (
                <Chip kind="accent" className="px-1.5">
                  {d.unread}
                </Chip>
              ) : null}
            </button>
          ))}
        </div>

        {view && (
          <>
            <div className="my-2 h-px bg-rule" />
            <Card kind="ai" className="flex items-center gap-1.5 p-2">
              <Sparkles className="size-3 flex-none text-ai-2" strokeWidth={1.5} />
              <span className="text-[11px] text-ai-2">{aiFooter}</span>
            </Card>
          </>
        )}
      </aside>

      {/* ─── Messages ─────────────────────────────────────────────── */}
      <section
        className={[
          "min-w-0 flex-1 flex-col",
          mobileThread ? "flex" : "hidden lg:flex",
        ].join(" ")}
      >
        {!view ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-ink-3">
            No channel selected. Create one from the rail to get started.
          </div>
        ) : (
        <>
        <div className="flex-none border-b border-rule px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileThread(false)}
              aria-label="Back to channels"
              className="-ml-1 rounded p-0.5 text-ink-3 hover:bg-paper-3 lg:hidden"
            >
              <ChevronLeft className="size-5" strokeWidth={1.5} />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[20px] font-medium leading-tight text-accent-2">
                {view.name}
              </h1>
              <div className="mt-0.5 text-[11px] text-ink-3">{view.description}</div>
            </div>
            <div className="relative flex items-center gap-1.5">
              <div className="flex -space-x-1">
                {view.participants.map((p, i) => (
                  <Avatar
                    key={i}
                    initials={p}
                    size="sm"
                    kind={p === "JS" ? "accent" : p === "AI" ? "ai" : "gray"}
                    className="ring-1 ring-paper"
                  />
                ))}
              </div>
              {view.canManageMembers && (
                <button
                  onClick={() => setManaging((m) => !m)}
                  aria-label="Manage participants"
                  className={[
                    "flex-none rounded-full border border-rule p-1 transition-colors",
                    managing ? "bg-accent-soft text-accent-2" : "text-ink-3 hover:bg-paper-3",
                  ].join(" ")}
                >
                  <UserPlus className="size-3.5" strokeWidth={1.75} />
                </button>
              )}
              {managing && view.canManageMembers && (
                <MembersPopover
                  members={view.members}
                  available={available}
                  aiMembers={view.aiMembers}
                  canManageAi={view.canManageAi}
                  onAdd={addMember}
                  onRemove={removeMember}
                  onAddAgent={addAgent}
                  onRemoveAgent={removeAgent}
                  onClose={() => setManaging(false)}
                />
              )}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5">
          <div className="flex flex-col gap-3">
            <div className="flex justify-center">
              <Chip kind="ghost">{view.daySeparator}</Chip>
            </div>
            {view.messages.length === 0 && (
              <div className="py-8 text-center text-[12px] text-ink-3">
                No messages yet. Say something
                {aiMembers.length ? (
                  <>
                    {" "}
                    — mention <b>{aiMentions}</b> to loop one in.
                  </>
                ) : (
                  "."
                )}
              </div>
            )}
            {view.messages.map((m, i) => (
              <MessageRow key={i} message={m} />
            ))}
            {typing && (
              <div className="flex items-center gap-2 pl-1 text-[12px] text-ai-2">
                <Sparkles className="size-3 animate-pulse" strokeWidth={1.5} />
                {typing} is typing…
              </div>
            )}
          </div>
        </div>

        <div className="flex-none border-t border-rule px-5 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={`Message ${view.name}…  (${composerHint})`}
              className="flex-1 resize-none rounded-md border border-rule bg-card px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send"
              className="flex-none rounded-md bg-accent px-3 py-2 text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
            >
              <Send className="size-4" strokeWidth={1.75} />
            </button>
          </form>
        </div>
        </>
        )}
      </section>
    </div>
  );
}

function ChannelItem({
  channel,
  active,
  onSelect,
  onArchive,
}: {
  channel: ChatChannel;
  active: boolean;
  onSelect: () => void;
  /** Bare channels only — omit for project rooms (not removable here). */
  onArchive?: () => void;
}) {
  return (
    <div
      className={[
        "group flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] transition-colors",
        active ? "bg-accent-soft font-semibold text-accent-2" : "text-ink-2 hover:bg-paper-3",
      ].join(" ")}
    >
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="flex-1 truncate">{channel.name}</span>
        {channel.unread ? (
          <Chip kind="accent" className="px-1.5">
            {channel.unread}
          </Chip>
        ) : null}
      </button>
      {onArchive && (
        <button
          onClick={onArchive}
          aria-label={`Remove ${channel.name}`}
          className="flex-none rounded p-0.5 text-ink-3 opacity-0 transition-opacity hover:bg-flag-soft hover:text-flag group-hover:opacity-100"
        >
          <X className="size-3 " strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function MembersPopover({
  members,
  available,
  aiMembers,
  canManageAi,
  onAdd,
  onRemove,
  onAddAgent,
  onRemoveAgent,
  onClose,
}: {
  members: ChannelMember[];
  available: ChannelMember[];
  aiMembers: DevAgent[];
  canManageAi: boolean;
  onAdd: (m: ChannelMember) => void;
  onRemove: (slug: string) => void;
  onAddAgent: (agent: DevAgent) => void;
  onRemoveAgent: (agent: DevAgent) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Click-away backdrop. */}
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-9 z-20 w-60 rounded-lg border border-rule bg-card p-2 shadow-lg">
        <div className="px-1 pb-1 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
          Participants
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
            <Avatar initials="JS" size="sm" kind="accent" />
            <span className="flex-1 truncate text-[12px] text-ink-2">Joe · you</span>
            <span className="text-[10px] text-ink-3">owner</span>
          </div>
          {members.map((m) => (
            <div key={m.slug} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-paper-3">
              <Avatar initials={m.initials} size="sm" kind="gray" />
              <span className="flex-1 truncate text-[12px] text-ink-2">
                {m.name.split(/\s+/)[0]} · {m.trade}
              </span>
              <button
                onClick={() => onRemove(m.slug)}
                aria-label={`Remove ${m.name}`}
                className="flex-none rounded p-0.5 text-ink-3 hover:bg-flag-soft hover:text-flag"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>

        {available.length > 0 && (
          <>
            <div className="my-1.5 h-px bg-rule" />
            <div className="px-1 pb-1 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
              Add a sub
            </div>
            <div className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
              {available.map((m) => (
                <button
                  key={m.slug}
                  onClick={() => onAdd(m)}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-paper-3"
                >
                  <Avatar initials={m.initials} size="sm" kind="gray" />
                  <span className="flex-1 truncate text-[12px] text-ink-2">
                    {m.name.split(/\s+/)[0]} · {m.trade}
                  </span>
                  <Plus className="size-3.5 flex-none text-accent" strokeWidth={2} />
                </button>
              ))}
            </div>
          </>
        )}

        {canManageAi && (
          <>
            <div className="my-1.5 h-px bg-rule" />
            <div className="px-1 pb-1 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
              AI models
            </div>
            <div className="flex flex-col gap-0.5">
              {AGENT_ORDER.map((agent) => {
                const inChannel = aiMembers.includes(agent);
                const meta = CHAT_AGENTS[agent];
                return (
                  <button
                    key={agent}
                    onClick={() => (inChannel ? onRemoveAgent(agent) : onAddAgent(agent))}
                    className="group/ai flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-paper-3"
                  >
                    <Avatar initials={meta.initials} size="sm" kind="ai" />
                    <span className="flex-1 truncate text-[12px] text-ink-2">
                      {meta.name}
                      <span className="text-ink-3"> · @{agent}</span>
                    </span>
                    {inChannel ? (
                      <X
                        className="size-3.5 flex-none text-ink-3 group-hover/ai:text-flag"
                        strokeWidth={2}
                      />
                    ) : (
                      <Plus className="size-3.5 flex-none text-accent" strokeWidth={2} />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar
        initials={message.initials}
        kind={message.kind === "ai" ? "ai" : message.kind === "owner" ? "accent" : "gray"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-serif text-[13px] font-semibold text-ink">{message.name}</span>
          {message.system && <Chip kind="ai">AI · system</Chip>}
          <span className="font-mono text-[9px] text-ink-3">{message.time}</span>
        </div>
        <p
          className={[
            "mt-0.5 text-[13px] leading-relaxed",
            message.kind === "ai" ? "text-ai-2" : "text-ink",
          ].join(" ")}
        >
          {message.text}
        </p>
      </div>
    </div>
  );
}
