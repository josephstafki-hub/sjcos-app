"use client";

import { useState } from "react";
import { Card, Chip, Eyebrow, Field } from "@/components/ui";
import type { AiToggle, SettingsData } from "@/lib/settings";

function Toggle({ label, on: initial }: AiToggle) {
  const [on, setOn] = useState(initial);
  return (
    <button
      onClick={() => setOn((v) => !v)}
      className="flex w-full items-center gap-3 border-t border-rule-soft py-1.5 text-left first:border-t-0"
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
        {active === "profile" ? (
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

            <div className="my-6 border-t border-rule" />
            <h2 className="mb-2.5 font-serif text-[15px] font-semibold text-ink">Integrations</h2>
            <div className="grid max-w-[720px] grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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

            <div className="my-6 border-t border-rule" />
            <h2 className="mb-2 font-serif text-[15px] font-semibold text-ink">Claude · AI defaults</h2>
            <div className="max-w-[600px]">
              {data.aiToggles.map((t) => (
                <Toggle key={t.label} {...t} />
              ))}
            </div>
          </>
        ) : (
          <>
            <Eyebrow>{data.categories.find((c) => c.id === active)?.title}</Eyebrow>
            <Card kind="dashed" className="mt-3 p-8 text-center">
              <div className="font-serif text-[16px] font-semibold text-ink-2">
                {data.categories.find((c) => c.id === active)?.title}
              </div>
              <div className="mt-1 text-[12px] text-ink-3">This section arrives in a later phase.</div>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}
