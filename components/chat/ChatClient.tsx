"use client";

import { useState, useTransition } from "react";
import { Sparkles, Send } from "lucide-react";
import { Card, Chip, Avatar } from "@/components/ui";
import {
  sendChatMessage,
  askClaudeInChannel,
  markChannelRead,
} from "@/lib/actions/chat";
import type { ChatChannel, ChatData, ChatMessage } from "@/lib/chat";

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
  const [views, setViews] = useState(data.views);
  const [channels, setChannels] = useState(data.channels);
  const [rooms, setRooms] = useState(data.rooms);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [, startTransition] = useTransition();

  const view = views[selectedKey];

  const selectChannel = (key: string) => {
    setSelectedKey(key);
    // Optimistically clear the unread badge + persist the read marker.
    const clear = (list: ChatChannel[]) =>
      list.map((c) => (c.key === key ? { ...c, unread: undefined } : c));
    setChannels(clear);
    setRooms(clear);
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
    const mentionsClaude = /@claude/i.test(text);
    startTransition(async () => {
      await sendChatMessage(key, text);
      if (mentionsClaude) {
        setTyping(true);
        const r = await askClaudeInChannel(key);
        if (r.ok && r.reply) {
          append(key, {
            initials: "CL",
            name: "Claude",
            time: clockNow(),
            text: r.reply,
            kind: "ai",
            system: true,
          });
        }
        setTyping(false);
      }
    });
  };

  return (
    <div className="flex h-full">
      {/* ─── Channel rail ─────────────────────────────────────────── */}
      <aside className="flex w-[220px] flex-none flex-col overflow-y-auto border-r border-rule bg-paper-2 p-3">
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
        <div className="flex flex-col gap-1">
          {data.directs.map((d) => (
            <div key={d.initials} className="flex items-center gap-2 px-2 py-0.5">
              <span className="relative flex-none">
                <Avatar initials={d.initials} size="sm" kind="gray" />
                {d.online && (
                  <span className="absolute -bottom-px -right-px size-1.5 rounded-full border border-paper bg-money" />
                )}
              </span>
              <span className="truncate text-[12px] text-ink-2">{d.name}</span>
            </div>
          ))}
        </div>

        <div className="my-2 h-px bg-rule" />
        <Card kind="ai" className="flex items-center gap-1.5 p-2">
          <Sparkles className="size-3 flex-none text-ai-2" strokeWidth={1.5} />
          <span className="text-[11px] text-ai-2">@claude is in this channel</span>
        </Card>
      </aside>

      {/* ─── Messages ─────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex-none border-b border-rule px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[20px] font-medium leading-tight text-accent-2">
                {view.name}
              </h1>
              <div className="mt-0.5 text-[11px] text-ink-3">{view.description}</div>
            </div>
            <div className="flex -space-x-1">
              {view.participants.map((p, i) => (
                <Avatar
                  key={i}
                  initials={p}
                  size="sm"
                  kind={p === "JS" ? "accent" : p === "CL" ? "ai" : "gray"}
                  className="ring-1 ring-paper"
                />
              ))}
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
                No messages yet. Say something — mention <b>@claude</b> to loop Claude in.
              </div>
            )}
            {view.messages.map((m, i) => (
              <MessageRow key={i} message={m} />
            ))}
            {typing && (
              <div className="flex items-center gap-2 pl-1 text-[12px] text-ai-2">
                <Sparkles className="size-3 animate-pulse" strokeWidth={1.5} />
                Claude is typing…
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
              placeholder={`Message ${view.name}…  (@claude to ask, Enter to send)`}
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
