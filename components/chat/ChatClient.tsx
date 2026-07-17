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
  addChannelTeamMember,
  removeChannelTeamMember,
  createTeamMember,
  addClientToRoom,
  removeClientFromRoom,
  openDirectMessage,
  releasePortalDelivery,
  skipPortalDelivery,
} from "@/lib/actions/chat";
import type {
  ChatChannel,
  ChatData,
  ChatMessage,
  ChannelMember,
  ChannelView,
  TeamMember,
  ClientMember,
  PortalOutboxItem,
} from "@/lib/chat";
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

// A person you can start a DM with (P1-D3): a sub, a team member, or a client.
type DmParty = "sub" | "team" | "client";
interface DmOption {
  partyType: DmParty;
  slug: string;
  name: string;
  initials: string;
  subtitle: string;
}

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
  // DM person-lookup (P1-D3): search across subs/team/clients before opening.
  const [pickingDm, setPickingDm] = useState(false);
  const [dmQuery, setDmQuery] = useState("");
  const [dmError, setDmError] = useState<string | null>(null);
  // Portal-delivery outbox (P1-D4): team-chat messages parked for the owner to
  // Release into (or Skip from) a real sub/client portal.
  const [outbox, setOutbox] = useState<PortalOutboxItem[]>(data.portalOutbox);
  const [outboxError, setOutboxError] = useState<string | null>(null);
  const [outboxPending, setOutboxPending] = useState<number | null>(null);
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

  // Internal-team roster — grows when the owner creates a teammate inline.
  const [teamRoster, setTeamRoster] = useState(data.teamRoster);

  const setTeamMembers = (key: string, teamMembers: TeamMember[]) =>
    setViews((v) => ({ ...v, [key]: { ...v[key], teamMembers } }));

  const addTeamMember = (m: TeamMember) => {
    if (!view) return;
    const key = selectedKey;
    setTeamMembers(key, [...view.teamMembers, m]);
    startTransition(async () => {
      await addChannelTeamMember(key, m.slug);
    });
  };

  const removeTeamMember = (slug: string) => {
    if (!view) return;
    const key = selectedKey;
    setTeamMembers(key, view.teamMembers.filter((m) => m.slug !== slug));
    startTransition(async () => {
      await removeChannelTeamMember(key, slug);
    });
  };

  // Create a new teammate and add them to the current channel (server-first —
  // the canonical slug comes back from the action). Returns an error string, or
  // null on success, so the popover can show it inline.
  const createTeammateHandler = (name: string, roleLabel: string): Promise<string | null> => {
    const key = selectedKey;
    return new Promise((resolve) => {
      startTransition(async () => {
        const r = await createTeamMember(name, roleLabel, key);
        if (!r.ok || !r.member) {
          resolve(r.error ?? "Could not add teammate.");
          return;
        }
        const m = r.member;
        setTeamRoster((list) => (list.some((t) => t.slug === m.slug) ? list : [...list, m]));
        setViews((v) => {
          const cur = v[key];
          if (!cur || cur.teamMembers.some((t) => t.slug === m.slug)) return v;
          return { ...v, [key]: { ...cur, teamMembers: [...cur.teamMembers, m] } };
        });
        resolve(null);
      });
    });
  };

  const setClientMembers = (key: string, clientMembers: ClientMember[]) =>
    setViews((v) => ({ ...v, [key]: { ...v[key], clientMembers } }));

  // Add a client to the current room (server-first — the row id comes back from
  // the action). Manual only: there's no client roster to pick from. Returns an
  // error string, or null on success, so the popover can show it inline.
  const addClientHandler = (name: string, email: string): Promise<string | null> => {
    const key = selectedKey;
    return new Promise((resolve) => {
      startTransition(async () => {
        const r = await addClientToRoom(key, name, email);
        if (!r.ok || !r.client) {
          resolve(r.error ?? "Could not add client.");
          return;
        }
        const c = r.client;
        setViews((v) => {
          const cur = v[key];
          if (!cur) return v;
          const rest = cur.clientMembers.filter((x) => x.id !== c.id && x.name !== c.name);
          return { ...v, [key]: { ...cur, clientMembers: [...rest, c] } };
        });
        resolve(null);
      });
    });
  };

  const removeClient = (id: number) => {
    if (!view) return;
    const key = selectedKey;
    setClientMembers(key, view.clientMembers.filter((c) => c.id !== id));
    startTransition(async () => {
      await removeClientFromRoom(key, id);
    });
  };

  // Subs not yet in the current channel — the add-picker options.
  const available = view
    ? data.roster.filter((r) => !view.members.some((m) => m.slug === r.slug))
    : [];
  // Team members not yet in the current channel — the add-teammate options.
  const availableTeam = view
    ? teamRoster.filter((r) => !view.teamMembers.some((m) => m.slug === r.slug))
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
      const sent = await sendChatMessage(key, text);
      if (sent.queued?.length) setOutbox((list) => [...sent.queued!, ...list]);
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
        if (r.queued?.length) setOutbox((list) => [...r.queued!, ...list]);
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

  // Portal outbox — server-first (never optimistic): a failed release must not
  // show "delivered" when nothing reached the portal. Release is the gated
  // outbound; Skip just drops the queued row.
  const releaseDeliveryHandler = (id: number) => {
    setOutboxError(null);
    setOutboxPending(id);
    startTransition(async () => {
      const r = await releasePortalDelivery(id);
      setOutboxPending(null);
      if (r.ok) setOutbox((list) => list.filter((d) => d.id !== id));
      else setOutboxError(r.error ?? "Could not release.");
    });
  };

  const skipDeliveryHandler = (id: number) => {
    setOutboxError(null);
    setOutboxPending(id);
    startTransition(async () => {
      const r = await skipPortalDelivery(id);
      setOutboxPending(null);
      if (r.ok) setOutbox((list) => list.filter((d) => d.id !== id));
      else setOutboxError(r.error ?? "Could not skip.");
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
          teamMembers: [],
          clientMembers: [],
          aiMembers: [],
          canManageMembers: true,
          canManageAi: true,
          canManageClients: false,
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

  // ─── DM person-lookup (P1-D3) ──────────────────────────────────────────────
  // Kept local (not imported from lib/chat) so the client bundle doesn't drag in
  // lib/db; mirrors the server key convention exactly.
  const dmKeyFor = (partyType: DmParty, slug: string) =>
    partyType === "sub"
      ? `dm:${slug}`
      : partyType === "team"
        ? `dm:team:${slug}`
        : `dm:client:${slug}`;

  // Everyone you can DM: subs, live team roster (so a just-created teammate shows
  // up), and derived clients — flattened into one searchable option list.
  const dmOptions: DmOption[] = [
    ...data.roster.map((r) => ({
      partyType: "sub" as const,
      slug: r.slug,
      name: r.name,
      initials: r.initials,
      subtitle: r.trade || "Sub",
    })),
    ...teamRoster.map((t) => ({
      partyType: "team" as const,
      slug: t.slug,
      name: t.name,
      initials: t.initials,
      subtitle: t.roleLabel || "Team",
    })),
    ...data.clientRoster.map((c) => ({
      partyType: "client" as const,
      slug: c.slug,
      name: c.name,
      initials: c.initials,
      subtitle: c.subtitle,
    })),
  ];
  const dmNeedle = dmQuery.trim().toLowerCase();
  const dmMatches = (
    dmNeedle
      ? dmOptions.filter((o) => `${o.name} ${o.subtitle}`.toLowerCase().includes(dmNeedle))
      : dmOptions
  ).slice(0, 10);

  const closeDmPicker = () => {
    setPickingDm(false);
    setDmQuery("");
    setDmError(null);
  };

  const openDmHandler = (o: DmOption) => {
    const key = dmKeyFor(o.partyType, o.slug);
    // Already in the rail (a top-6 sub or a previously-opened DM) → just select.
    if (directs.some((d) => d.key === key)) {
      selectChannel(key);
      closeDmPicker();
      return;
    }
    startTransition(async () => {
      const r = await openDirectMessage(o.partyType, o.slug, o.name, o.subtitle);
      if (!r.ok || !r.dm) {
        setDmError(r.error ?? "Could not open direct message.");
        return;
      }
      const dm = r.dm;
      const firstName = dm.fullName.split(/\s+/)[0];
      setDirects((list) =>
        list.some((d) => d.key === dm.key)
          ? list
          : [
              ...list,
              { key: dm.key, initials: dm.initials, name: `${firstName} · ${dm.subtitle}`, online: false },
            ],
      );
      setViews((v) => ({
        ...v,
        [dm.key]: v[dm.key] ?? {
          key: dm.key,
          name: dm.fullName,
          description: `Direct message · ${dm.subtitle}`,
          participants: ["JS", dm.initials],
          members: [],
          teamMembers: [],
          clientMembers: [],
          aiMembers: [...AGENT_ORDER],
          canManageMembers: false,
          canManageAi: false,
          canManageClients: false,
          daySeparator: `Today · ${new Date().toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}`,
          messages: [],
        },
      }));
      closeDmPicker();
      selectChannel(dm.key);
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
        <RailLabel>Rooms</RailLabel>
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
          {pickingDm ? (
            <div className="px-1 pt-1">
              <input
                autoFocus
                value={dmQuery}
                onChange={(e) => {
                  setDmQuery(e.target.value);
                  setDmError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeDmPicker();
                }}
                placeholder="Search subs, team, clients…"
                className="w-full rounded-md border border-rule bg-card px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
              />
              {dmError && <div className="px-1 pt-1 text-[10px] text-flag">{dmError}</div>}
              <div className="mt-1 max-h-56 overflow-y-auto">
                {dmMatches.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-ink-3">No one matches.</div>
                ) : (
                  dmMatches.map((o) => (
                    <button
                      key={`${o.partyType}:${o.slug}`}
                      onClick={() => openDmHandler(o)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ink-2 transition-colors hover:bg-paper-3"
                    >
                      <Avatar initials={o.initials} size="sm" kind="gray" />
                      <span className="flex-1 truncate text-[12px]">
                        {o.name}
                        <span className="text-ink-3"> · {o.subtitle}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setPickingDm(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink-2"
            >
              <Plus className="size-3.5 flex-none" strokeWidth={2} />
              New message
            </button>
          )}
        </div>

        {/* ─── Portal outbox ── team-chat comms parked for portal delivery. ──
            Release pushes the message into a real sub/client portal (the gated
            outbound); Skip drops it. Nothing is delivered without a click. */}
        {outbox.length > 0 && (
          <>
            <div className="my-2 h-px bg-rule" />
            <RailLabel>{`Portal outbox (${outbox.length})`}</RailLabel>
            {outboxError && <div className="px-1 pb-1 text-[10px] text-flag">{outboxError}</div>}
            <div className="flex flex-col gap-1">
              {outbox.map((d) => (
                <div key={d.id} className="rounded-md border border-rule bg-card px-2 py-1.5">
                  <div className="truncate text-[11.5px] text-ink-2">{d.preview}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-3">
                    <Send className="size-2.5 flex-none" strokeWidth={1.75} />
                    <span className="truncate">{d.recipientLabel}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      onClick={() => releaseDeliveryHandler(d.id)}
                      disabled={outboxPending === d.id}
                      className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] font-medium text-accent-2 transition-colors hover:bg-accent-soft disabled:opacity-50"
                    >
                      Release
                    </button>
                    <button
                      onClick={() => skipDeliveryHandler(d.id)}
                      disabled={outboxPending === d.id}
                      className="rounded px-1.5 py-0.5 text-[10px] text-ink-3 transition-colors hover:bg-paper-3 hover:text-ink-2 disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

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
                  teamMembers={view.teamMembers}
                  availableTeam={availableTeam}
                  clientMembers={view.clientMembers}
                  canManageClients={view.canManageClients}
                  aiMembers={view.aiMembers}
                  canManageAi={view.canManageAi}
                  onAdd={addMember}
                  onRemove={removeMember}
                  onAddTeam={addTeamMember}
                  onRemoveTeam={removeTeamMember}
                  onCreateTeam={createTeammateHandler}
                  onAddClient={addClientHandler}
                  onRemoveClient={removeClient}
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
  teamMembers,
  availableTeam,
  clientMembers,
  canManageClients,
  aiMembers,
  canManageAi,
  onAdd,
  onRemove,
  onAddTeam,
  onRemoveTeam,
  onCreateTeam,
  onAddClient,
  onRemoveClient,
  onAddAgent,
  onRemoveAgent,
  onClose,
}: {
  members: ChannelMember[];
  available: ChannelMember[];
  teamMembers: TeamMember[];
  availableTeam: TeamMember[];
  clientMembers: ClientMember[];
  canManageClients: boolean;
  aiMembers: DevAgent[];
  canManageAi: boolean;
  onAdd: (m: ChannelMember) => void;
  onRemove: (slug: string) => void;
  onAddTeam: (m: TeamMember) => void;
  onRemoveTeam: (slug: string) => void;
  onCreateTeam: (name: string, roleLabel: string) => Promise<string | null>;
  onAddClient: (name: string, email: string) => Promise<string | null>;
  onRemoveClient: (id: number) => void;
  onAddAgent: (agent: DevAgent) => void;
  onRemoveAgent: (agent: DevAgent) => void;
  onClose: () => void;
}) {
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamRole, setTeamRole] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [addingClient, setAddingClient] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const submitNewTeammate = async () => {
    const name = teamName.trim();
    if (!name) return;
    setTeamError(null);
    const err = await onCreateTeam(name, teamRole.trim());
    if (err) {
      setTeamError(err);
      return;
    }
    setTeamName("");
    setTeamRole("");
    setAddingTeam(false);
  };

  const submitNewClient = async () => {
    const name = clientName.trim();
    if (!name) return;
    setClientError(null);
    const err = await onAddClient(name, clientEmail.trim());
    if (err) {
      setClientError(err);
      return;
    }
    setClientName("");
    setClientEmail("");
    setAddingClient(false);
  };

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

        {/* ─── Team ── SJC's own staff, added independently of subs (P1-D1). ── */}
        <div className="my-1.5 h-px bg-rule" />
        <div className="px-1 pb-1 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
          Team
        </div>
        <div className="flex flex-col gap-0.5">
          {teamMembers.map((m) => (
            <div key={m.slug} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-paper-3">
              <Avatar initials={m.initials} size="sm" kind="gray" />
              <span className="flex-1 truncate text-[12px] text-ink-2">
                {m.name.split(/\s+/)[0]}
                {m.roleLabel ? ` · ${m.roleLabel}` : ""}
              </span>
              <button
                onClick={() => onRemoveTeam(m.slug)}
                aria-label={`Remove ${m.name}`}
                className="flex-none rounded p-0.5 text-ink-3 hover:bg-flag-soft hover:text-flag"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
          {teamMembers.length === 0 && !addingTeam && (
            <p className="px-1.5 py-1 text-[11px] text-ink-3">No team members in this channel.</p>
          )}
        </div>

        {availableTeam.length > 0 && (
          <div className="mt-0.5 flex max-h-32 flex-col gap-0.5 overflow-y-auto">
            {availableTeam.map((m) => (
              <button
                key={m.slug}
                onClick={() => onAddTeam(m)}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-paper-3"
              >
                <Avatar initials={m.initials} size="sm" kind="gray" />
                <span className="flex-1 truncate text-[12px] text-ink-2">
                  {m.name.split(/\s+/)[0]}
                  {m.roleLabel ? ` · ${m.roleLabel}` : ""}
                </span>
                <Plus className="size-3.5 flex-none text-accent" strokeWidth={2} />
              </button>
            ))}
          </div>
        )}

        {addingTeam ? (
          <div className="mt-1 flex flex-col gap-1">
            <input
              autoFocus
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewTeammate();
                if (e.key === "Escape") setAddingTeam(false);
              }}
              placeholder="Name"
              className="rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
            />
            <input
              value={teamRole}
              onChange={(e) => setTeamRole(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewTeammate();
                if (e.key === "Escape") setAddingTeam(false);
              }}
              placeholder="Role (optional)"
              className="rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
            />
            {teamError && <p className="px-0.5 text-[11px] text-flag">{teamError}</p>}
            <div className="flex gap-1">
              <button
                onClick={submitNewTeammate}
                className="flex-1 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-paper hover:bg-accent-2"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAddingTeam(false);
                  setTeamName("");
                  setTeamRole("");
                  setTeamError(null);
                }}
                className="rounded-md border border-rule px-2 py-1 text-[12px] text-ink-2 hover:bg-paper-3"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              setAddingTeam(true);
              setTeamError(null);
            }}
            className="mt-0.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-accent hover:bg-paper-3"
          >
            <Plus className="size-3.5 flex-none" strokeWidth={2} />
            New teammate
          </button>
        )}

        {/* ─── Clients ── entity rooms only; added manually (P1-D2). No portal ──
             ── delivery here (that's gated, P1-D4) — this is membership only. ── */}
        {canManageClients && (
          <>
            <div className="my-1.5 h-px bg-rule" />
            <div className="px-1 pb-1 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
              Clients
            </div>
            <div className="flex flex-col gap-0.5">
              {clientMembers.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-paper-3">
                  <Avatar initials={c.initials} size="sm" kind="gray" />
                  <span className="flex-1 truncate text-[12px] text-ink-2">
                    {c.name}
                    {c.email ? <span className="text-ink-3"> · {c.email}</span> : null}
                  </span>
                  <button
                    onClick={() => onRemoveClient(c.id)}
                    aria-label={`Remove ${c.name}`}
                    className="flex-none rounded p-0.5 text-ink-3 hover:bg-flag-soft hover:text-flag"
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </div>
              ))}
              {clientMembers.length === 0 && !addingClient && (
                <p className="px-1.5 py-1 text-[11px] text-ink-3">No clients in this room.</p>
              )}
            </div>

            {addingClient ? (
              <div className="mt-1 flex flex-col gap-1">
                <input
                  autoFocus
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewClient();
                    if (e.key === "Escape") setAddingClient(false);
                  }}
                  placeholder="Name"
                  className="rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
                />
                <input
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewClient();
                    if (e.key === "Escape") setAddingClient(false);
                  }}
                  placeholder="Email (optional)"
                  className="rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
                />
                {clientError && <p className="px-0.5 text-[11px] text-flag">{clientError}</p>}
                <div className="flex gap-1">
                  <button
                    onClick={submitNewClient}
                    className="flex-1 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-paper hover:bg-accent-2"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setAddingClient(false);
                      setClientName("");
                      setClientEmail("");
                      setClientError(null);
                    }}
                    className="rounded-md border border-rule px-2 py-1 text-[12px] text-ink-2 hover:bg-paper-3"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAddingClient(true);
                  setClientError(null);
                }}
                className="mt-0.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-accent hover:bg-paper-3"
              >
                <Plus className="size-3.5 flex-none" strokeWidth={2} />
                Add client
              </button>
            )}
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
