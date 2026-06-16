"use client";

import { useState, useTransition } from "react";
import { Avatar, Card, Chip, Eyebrow, Field } from "@/components/ui";
import type { SettingsData } from "@/lib/settings";
import { setAiToggle, setNotifyToggle } from "@/lib/actions/settings";

function Toggle({
  settingKey,
  label,
  on: initial,
  action,
}: {
  settingKey: string;
  label: string;
  on: boolean;
  action: (key: string, on: boolean) => Promise<void>;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  function flip() {
    const next = !on;
    setOn(next); // optimistic
    startTransition(async () => {
      await action(settingKey, next);
    });
  }

  return (
    <button
      onClick={flip}
      disabled={pending}
      className="flex w-full items-center gap-3 border-t border-rule-soft py-1.5 text-left first:border-t-0 disabled:opacity-60"
    >
      <span className="flex-1 text-[13px] text-ink">{label}</span>
      <span
        className={[
          "relative h-5 w-9 flex-none rounded-full border transition-colors",
          on ? "border-ai bg-ai" : "border-rule bg-paper-3",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 size-3.5 rounded-full bg-paper transition-all",
            on ? "left-[18px]" : "left-0.5",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

export function SettingsClient({ data }: { data: SettingsData }) {
  const [active, setActive] = useState("profile");

  return (
    <div className="flex h-full">
      {/* Category rail */}
      <aside className="w-[220px] flex-none border-r border-rule bg-paper-2 p-3.5">
        <Eyebrow muted>Settings</Eyebrow>
        <div className="mt-2 flex flex-col gap-0.5">
          {data.categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={[
                "rounded px-2.5 py-1.5 text-left text-[13px] transition-colors",
                c.id === active
                  ? "bg-accent-soft font-medium text-accent-2"
                  : "text-ink-2 hover:bg-paper-3",
              ].join(" ")}
            >
              {c.title}
            </button>
          ))}
        </div>
      </aside>

      {/* Content */}
      <section className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {active === "profile" && (
          <>
            <Eyebrow>Profile</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">
              {data.profile.name}
            </h1>
            <div className="mt-1.5 text-[11px] text-ink-3">{data.profile.meta}</div>

            <div className="my-5 border-t border-rule" />
            <div className="grid max-w-[720px] grid-cols-1 gap-5 sm:grid-cols-2">
              {data.profile.fields.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
          </>
        )}

        {active === "integrations" && (
          <>
            <Eyebrow>Integrations</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">
              Integrations
            </h1>
            <div className="mt-1.5 text-[11px] text-ink-3">
              {data.integrations.filter((it) => it.connected).length} of {data.integrations.length} connected
            </div>
            <div className="mt-5 grid max-w-[760px] grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {data.integrations.map((it) => (
                <Card key={it.name} className="p-3">
                  <div className="font-serif text-[13px] font-semibold text-ink">{it.name}</div>
                  <div className="mt-0.5 text-[11px] text-ink-3">{it.sub}</div>
                  <div className="mt-2">
                    <Chip kind={it.connected ? "money" : "ghost"} dot>
                      {it.connected ? "connected" : "not connected"}
                    </Chip>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {active === "ai" && (
          <>
            <Eyebrow>Claude &amp; AI</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">
              Claude &amp; AI defaults
            </h1>
            <div className="mt-1.5 text-[11px] text-ink-3">
              Control what Claude does automatically. Changes save instantly.
            </div>
            <div className="mt-5 max-w-[600px]">
              {data.aiToggles.map((t) => (
                <Toggle key={t.key} settingKey={t.key} label={t.label} on={t.on} action={setAiToggle} />
              ))}
            </div>
          </>
        )}

        {active === "workspace" && (
          <>
            <Eyebrow>Workspace</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">
              {data.profile.meta.split(" · ")[1] ?? "Workspace"}
            </h1>
            <div className="mt-1.5 text-[11px] text-ink-3">Business identity used across estimates, the site, and client docs.</div>
            <div className="my-5 border-t border-rule" />
            <div className="grid max-w-[720px] grid-cols-1 gap-5 sm:grid-cols-2">
              {data.workspace.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
          </>
        )}

        {active === "team" && (
          <>
            <Eyebrow>Team &amp; roles</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">Team &amp; roles</h1>
            <div className="mt-1.5 text-[11px] text-ink-3">{data.team.length} members · portal guests don&apos;t count toward seats</div>
            <Card className="mt-5 max-w-[600px] overflow-hidden p-0">
              {data.team.map((m, i) => (
                <div key={m.name} className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}>
                  <Avatar initials={m.initials} size="sm" kind={m.chip === "accent" ? "accent" : m.chip === "ai" ? "ai" : "gray"} />
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-[13.5px] font-semibold text-ink">{m.name}</div>
                    <div className="text-[11px] text-ink-3">{m.role}</div>
                  </div>
                  <Chip kind={m.chip}>{m.chip === "accent" ? "owner" : m.chip === "ai" ? "system" : "guest"}</Chip>
                </div>
              ))}
            </Card>
          </>
        )}

        {active === "billing" && (
          <>
            <Eyebrow>Subscription</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">{data.subscription.plan}</h1>
            <div className="mt-1.5 text-[11px] text-ink-3">{data.subscription.price} · {data.subscription.renews}</div>
            <div className="my-5 border-t border-rule" />
            <div className="grid max-w-[720px] grid-cols-1 gap-5 sm:grid-cols-2">
              {data.subscription.fields.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
          </>
        )}

        {active === "data" && (
          <>
            <Eyebrow>Data &amp; backups</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">Data &amp; backups</h1>
            <div className="mt-1.5 text-[11px] text-ink-3">Where your business data lives and how it&apos;s protected.</div>
            <Card className="mt-5 max-w-[600px] overflow-hidden p-0">
              {data.data.map((d, i) => (
                <div key={d.label} className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}>
                  <span className="flex-1 text-[13px] text-ink">{d.label}</span>
                  <Chip kind={d.ok ? "money" : "ghost"} dot>{d.value}</Chip>
                </div>
              ))}
            </Card>
          </>
        )}

        {active === "notifications" && (
          <>
            <Eyebrow>Notifications</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">Notifications</h1>
            <div className="mt-1.5 text-[11px] text-ink-3">Choose what reaches you. Changes save instantly.</div>
            <div className="mt-5 max-w-[600px]">
              {data.notifyToggles.map((t) => (
                <Toggle key={t.key} settingKey={t.key} label={t.label} on={t.on} action={setNotifyToggle} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
