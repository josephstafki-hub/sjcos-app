"use client";

import { useState, useTransition } from "react";
import { Avatar, Card, Chip, Eyebrow, Field } from "@/components/ui";
import { DesignerDefaultsCard } from "@/components/settings/DesignerDefaultsCard";
import type { SettingsData } from "@/lib/settings";
import {
  setAiToggle,
  setLeadFirstResponseModel,
  setNotifyToggle,
  updateProfile,
  updateCompanyDocs,
  updateBillingRates,
} from "@/lib/actions/settings";
import { setUserActive } from "@/lib/actions/users";
import { AddUserButton, StaffAccessButton } from "./TeamAccess";
import { runAction } from "@/lib/run-action";
import { ClipTokenCard } from "./ClipTokenCard";
import { IntakeTokenCard } from "./IntakeTokenCard";

/** Shared text input for the editable forms, themed to match the modals. */
function TextInput({
  name,
  label,
  defaultValue,
  type = "text",
  required,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
      />
    </label>
  );
}

/** Which agent writes the same-day first response to new inbound leads. Claude
 *  (single-turn, no tools, ~5s) or Hermes (the agent gateway). Never Qwen. */
function FirstResponseModelPicker({ initial }: { initial: "claude" | "hermes" }) {
  const [model, setModel] = useState(initial);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex w-full items-center gap-3 border-t border-rule-soft py-1.5">
      <span className="flex-1 text-[13px] text-ink">Who drafts the first response to new inbound leads</span>
      <select
        value={model}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value === "hermes" ? "hermes" : "claude";
          setModel(next);
          startTransition(async () => {
            await runAction(() => setLeadFirstResponseModel(next), { fallback: "Couldn't save the first-response model." });
          });
        }}
        className="rounded-md border border-rule bg-card px-2 py-1 text-[12px] text-ink disabled:opacity-60"
      >
        <option value="claude">Claude</option>
        <option value="hermes">Hermes</option>
      </select>
    </div>
  );
}

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
      await runAction(() => action(settingKey, next), { fallback: "Couldn't save that setting." });
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
    <div className="flex h-full flex-col lg:flex-row">
      {/* Category rail — horizontal scrolling tabs on mobile, vertical rail on desktop */}
      <aside className="flex-none border-b border-rule bg-paper-2 p-3.5 lg:w-[220px] lg:border-b-0 lg:border-r">
        <Eyebrow muted>Settings</Eyebrow>
        <div className="mt-2 flex gap-0.5 overflow-x-auto lg:flex-col">
          {data.categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={[
                "whitespace-nowrap rounded px-2.5 py-1.5 text-left text-[13px] transition-colors",
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
            <form action={updateProfile} className="max-w-[720px]">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <TextInput name="name" label="Display name" defaultValue={data.profile.name} required />
                <TextInput name="email" label="Email" type="email" defaultValue={data.profile.email} required />
                <TextInput name="company" label="Business name" defaultValue={data.profile.company} />
                <TextInput name="phone" label="Phone (SMS in)" defaultValue={data.profile.phone} />
              </div>
              <div className="mt-5">
                <button
                  type="submit"
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
                >
                  Save changes
                </button>
              </div>
            </form>

            <div className="my-5 border-t border-rule" />
            <div className="grid max-w-[720px] grid-cols-1 gap-5 sm:grid-cols-2">
              {data.profile.fields.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
          </>
        )}

        {active === "company" && (
          <>
            <Eyebrow>Company &amp; documents</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">
              Company &amp; documents
            </h1>
            <div className="mt-1.5 text-[11px] text-ink-3">
              Boilerplate baked into generated contracts &amp; scopes of work.
            </div>

            <div className="my-5 border-t border-rule" />
            <form action={updateCompanyDocs} className="max-w-[720px]">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <TextInput name="license" label="License #" defaultValue={data.companyDocs.license} placeholder="e.g. BC123456" />
                <TextInput name="address" label="Business address" defaultValue={data.companyDocs.address} placeholder="Street, City, MN ZIP" />
                <TextInput name="depositPct" label="Default deposit %" type="number" defaultValue={data.companyDocs.depositPct} />
              </div>
              <label className="mt-5 flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Standard contract terms</span>
                <textarea
                  name="terms"
                  rows={10}
                  defaultValue={data.companyDocs.terms}
                  className="resize-y rounded-md border border-rule bg-paper px-2.5 py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="autoSendMilestone"
                  defaultChecked={data.companyDocs.autoSendMilestone}
                  className="size-3.5 accent-accent"
                />
                <span className="text-[13px] text-ink-2">
                  Auto-send milestone invoices when a project reaches a billing stage
                </span>
              </label>

              <div className="my-4 border-t border-rule-soft" />
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <TextInput name="googleReviewUrl" label="Google review link" defaultValue={data.companyDocs.googleReviewUrl} placeholder="https://g.page/r/…/review" />
              </div>
              <label className="mt-5 flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Warranty terms (sent at completion)</span>
                <textarea
                  name="warrantyTerms"
                  rows={4}
                  defaultValue={data.companyDocs.warrantyTerms}
                  placeholder="e.g. One-year workmanship warranty from substantial completion…"
                  className="resize-y rounded-md border border-rule bg-paper px-2.5 py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="autoOutreach"
                  defaultChecked={data.companyDocs.autoOutreach}
                  className="size-3.5 accent-accent"
                />
                <span className="text-[13px] text-ink-2">
                  Auto-send warranty info + Google review request when a job completes
                </span>
              </label>
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="autoDraftSocial"
                  defaultChecked={data.companyDocs.autoDraftSocial}
                  className="size-3.5 accent-accent"
                />
                <span className="text-[13px] text-ink-2">
                  Auto-draft a social post when a job completes (review on Marketing)
                </span>
              </label>
              <div className="mt-5">
                <button
                  type="submit"
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
                >
                  Save changes
                </button>
              </div>
            </form>

            <div className="my-8 border-t border-rule" />
            <h2 className="font-serif text-[19px] font-semibold text-ink">Billing rates</h2>
            <div className="mt-1 text-[11px] text-ink-3">
              Hourly rates + third-party markup printed on the Pre-Construction Agreement. Free text
              (e.g. &ldquo;$52 / hr&rdquo;, &ldquo;Unbilled&rdquo;, &ldquo;20%&rdquo;).
            </div>
            <form action={updateBillingRates} className="mt-5 max-w-[720px]">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <TextInput name="markup" label="Third-party markup" defaultValue={data.billingRates.markup} placeholder="e.g. 20%" />
                {data.billingRates.rows.map((r) => (
                  <TextInput key={r.key} name={r.key} label={r.label} defaultValue={r.value} placeholder="e.g. $52 / hr" />
                ))}
              </div>
              <div className="mt-5">
                <button
                  type="submit"
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
                >
                  Save billing rates
                </button>
              </div>
            </form>
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

            <IntakeTokenCard token={data.intake.token} endpoint={data.intake.endpoint} />
            <ClipTokenCard token={data.clip.token} endpoint={data.clip.endpoint} />
          </>
        )}

        {active === "ai" && (
          <>
            <Eyebrow>AI</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">
              AI defaults
            </h1>
            <div className="mt-1.5 text-[11px] text-ink-3">
              Control what the AI does automatically. Changes save instantly.
            </div>
            <div className="mt-5 max-w-[600px]">
              {data.aiToggles.map((t) => (
                <Toggle key={t.key} settingKey={t.key} label={t.label} on={t.on} action={setAiToggle} />
              ))}
              <FirstResponseModelPicker initial={data.leadFirstResponseModel} />
            </div>
          </>
        )}

        {active === "team" && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <Eyebrow>Team &amp; roles</Eyebrow>
                <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">Team &amp; roles</h1>
                <div className="mt-1.5 text-[11px] text-ink-3">
                  {data.team.length} members · team members see only the areas you tick; the money areas are grantable one by one
                </div>
              </div>
              <AddUserButton />
            </div>
            <Card className="mt-5 max-w-[600px] overflow-hidden p-0">
              {data.team.map((m, i) => (
                <div
                  key={m.id ?? m.name}
                  className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-rule-soft" : ""} ${
                    m.active === false ? "opacity-55" : ""
                  }`}
                >
                  <Avatar initials={m.initials} size="sm" kind={m.chip === "accent" ? "accent" : m.chip === "ai" ? "ai" : "gray"} />
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-[13.5px] font-semibold text-ink">{m.name}</div>
                    <div className="text-[11px] text-ink-3">{m.role}</div>
                  </div>
                  {/* Team members get an Access editor; every real non-owner row gets enable/disable. */}
                  {m.id && m.roleKey === "staff" && (
                    <StaffAccessButton id={m.id} name={m.name} email={m.email ?? ""} permissions={m.permissions ?? []} />
                  )}
                  {m.id && !m.isOwner ? (
                    <form action={setUserActive.bind(null, m.id, m.active === false)}>
                      <button
                        type="submit"
                        className={[
                          "rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors",
                          m.active === false
                            ? "border-accent bg-accent-soft text-accent-2 hover:bg-accent-soft/70"
                            : "border-rule text-ink-3 hover:bg-paper-2",
                        ].join(" ")}
                      >
                        {m.active === false ? "Enable" : "Disable"}
                      </button>
                    </form>
                  ) : (
                    <Chip kind={m.chip}>{m.chip === "accent" ? "owner" : m.chip === "ai" ? "system" : "guest"}</Chip>
                  )}
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
        {active === "designer" && (
          <>
            <Eyebrow>Floor-plan designer</Eyebrow>
            <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">Designer defaults</h1>
            <div className="mt-1.5 text-[11px] text-ink-3">
              Starting values for every new design — wall thickness, heights, overhangs, door and window sizes. A design
              keeps its own copy, so changing these never moves an existing plan.
            </div>
            <div className="my-5 border-t border-rule" />
            <DesignerDefaultsCard defaults={data.designerDefaults} />
          </>
        )}
      </section>
    </div>
  );
}
