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
} from "@/lib/actions/chat";
import type { ChatChannel, ChatData, ChatMessage, ChannelMember } from "@/lib/chat";
import type { DevAgent } from "@/lib/dev-agents-meta";

// The AI teammates you can @-mention in any channel.
const CHAT_AGENTS: Record<DevAgent, { name: string; initials: string }> = {
  claude: { name: "Claude", initials: "CL" },
  qwen: { name: "Qwen", initials: "QW" },
  hermes: { name: "Hermes", initials: "HM" },
};

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
  const [, startTransition] = useTransition();

  const view = views[selectedKey];

  // Optimistically replace a channel's member list, then persist.
  const setMembers = (key: string, members: ChannelMember[]) =>
    setViews((v) => ({ ...v, [key]: { ...v[key], members } }));

  const addMember = (m: ChannelMember) => {
    const key = selectedKey;
    setMembers(key, [...view.members, m]);
    startTransition(async () => {
      await addChannelMember(key, m.slug);
    });
  };

  const removeMember = (slug: string) => {
    const key = selectedKey;
    setMembers(key, view.members.filter((m) => m.slug !== slug));
    startTransition(async () => {
      await removeChannelMember(key, slug);
    });
  };

  // Subs not yet in the current channel — the add-picker options.
  const available = data.roster.filter(
    (r) => !view.members.some((m) => m.slug === r.slug),
  );

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

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const key = selectedKey;
    append(key, { initials: "JS", name: "Joe", time: clockNow(), text, kind: "owner" });
    setInput("");
    const m = text.match(/@(claude|hermes|qwen|ai)\b/i);
    const mentioned = m?.[1].toLowerCase();
    const agent: DevAgent | null = mentioned
      ? mentioned === "ai"
        ? "qwen"
        : (mentioned as DevAgent)
      : null;
    startTransition(async () => {
      await sendChatMessage(key, text);
      if (agent) {
        const id = CHAT_AGENTS[agent];
        setTyping(id.name);
        const r = await askAgentInChannel(key, agent);
        if (r.ok && r.reply) {
          append(key, {
            initials: id.initials,
            name: id.name,
            time: clockNow(),
            text: r.reply,
            kind: "ai",
            system: true,
          });
        }
        setTyping(null);
      }
    });
  };

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
            />
          ))}
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

        <div className="my-2 h-px bg-rule" />
        <Card kind="ai" className="flex items-center gap-1.5 p-2">
          <Sparkles className="size-3 flex-none text-ai-2" strokeWidth={1.5} />
          <span className="text-[11px] text-ai-2">@claude · @qwen · @hermes are in this channel</span>
        </Card>
      </aside>

      {/* ─── Messages ─────────────────────────────────────────────── */}
      <section
        className={[
          "min-w-0 flex-1 flex-col",
          mobileThread ? "flex" : "hidden lg:flex",
        ].join(" ")}
      >
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
                  onAdd={addMember}
                  onRemove={removeMember}
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
                No messages yet. Say something — mention <b>@claude</b>, <b>@qwen</b>, or <b>@hermes</b> to loop one in.
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
              placeholder={`Message ${view.name}…  (@claude · @qwen · @hermes, Enter to send)`}
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
      </section>
    </div>
  );
}

function ChannelItem({
  channel,
  active,
  onSelect,
}: {
  channel: ChatChannel;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={[
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
        active ? "bg-accent-soft font-semibold text-accent-2" : "text-ink-2 hover:bg-paper-3",
      ].join(" ")}
    >
      <span className="flex-1 truncate">{channel.name}</span>
      {channel.unread ? (
        <Chip kind="accent" className="px-1.5">
          {channel.unread}
        </Chip>
      ) : null}
    </button>
  );
}

function MembersPopover({
  members,
  available,
  onAdd,
  onRemove,
  onClose,
}: {
  members: ChannelMember[];
  available: ChannelMember[];
  onAdd: (m: ChannelMember) => void;
  onRemove: (slug: string) => void;
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
