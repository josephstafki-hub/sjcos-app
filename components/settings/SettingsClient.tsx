"use client";

import { SettingsForm } from "./SettingsForm";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar, Button, Card, Chip, Eyebrow, Field, PageHeader } from "@/components/ui";
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
      <span className="text-meta text-ink-3">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
      />
    </label>
  );
}

/** Which agent writes the same-day first response to new inbound leads. Claude
 *  (single-turn, no tools, ~5s) or Hermes (the agent gateway). Never Qwen. */
function FirstResponseModelPicker({ initial }: { initial: "claude" | "hermes" }) {
  const [model, setModel] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  return (
    <div className="flex w-full items-center gap-3 border-t border-rule-soft py-1.5">
      <span className="flex-1 text-body text-ink">Who drafts the first response to new inbound leads</span>
      <span role="status" className="text-meta text-ink-2">{pending ? "Saving…" : feedback}</span>
      <select
        value={model}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value === "hermes" ? "hermes" : "claude";
          setModel(next);
          startTransition(async () => {
            await runAction(() => setLeadFirstResponseModel(next), { fallback: "Couldn't save the first-response model.", onSuccess: () => setFeedback("Saved"), onError: message => {setModel(model);setFeedback(message);} });
          });
        }}
        className="rounded-md border border-rule bg-card px-2 py-1 text-meta text-ink disabled:opacity-60"
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
  const [feedback, setFeedback] = useState("");

  function flip() {
    const next = !on;
    setOn(next); // optimistic
    startTransition(async () => {
      await runAction(() => action(settingKey, next), { fallback: "Couldn't save that setting.", onSuccess: () => setFeedback("Saved"), onError: message => {setOn(!next);setFeedback(message);} });
    });
  }

  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={flip}
      disabled={pending}
      className="flex w-full items-center gap-3 border-t border-rule-soft py-4 text-left first:border-t-0 disabled:opacity-60"
    >
      <span className="flex-1 text-body text-ink">{label}</span>
      <span role="status" className="text-meta text-ink-2">{pending ? "Saving…" : feedback}</span>
      <span
        className={[
          "relative h-5 w-9 flex-none rounded-full border transition-colors",
          on ? "border-accent bg-accent" : "border-rule bg-paper-3",
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

function UserActiveButton({id, active}: {id:string;active:boolean}) {
  const [pending,start] = useTransition();
  const [feedback,setFeedback] = useState("");
  return <div className="space-y-1">
    <Button variant="secondary" size="sm" disabled={pending} onClick={()=>start(async()=>{
      await runAction(()=>setUserActive(id,!active),{onSuccess:()=>setFeedback("Saved"),onError:setFeedback});
    })}>{pending ? "Saving…" : active ? "Disable" : "Enable"}</Button>
    <p role="status" className="text-meta text-ink-2">{feedback}</p>
  </div>;
}

const MORE_SETTINGS = [
  { title: "Pricing", href: "/settings/pricing" },
  { title: "Overhead", href: "/settings/overhead" },
  { title: "Payments · Square", href: "/settings/payments" },
  { title: "Accounting · QuickBooks", href: "/settings/accounting" },
];

export function SettingsClient({ data }: { data: SettingsData }) {
  const [active, setActive] = useState("profile");
  const router = useRouter();

  return (
    <div className="flex min-h-full flex-col @4xl/page:flex-row">
      {/* Category rail — horizontal scrolling tabs on mobile, vertical rail on desktop */}
      <aside className="flex-none border-b border-rule bg-paper-2 p-3.5 @4xl/page:w-52 @4xl/page:border-b-0 @4xl/page:border-r">
        <Eyebrow muted>Settings</Eyebrow>
        <label className="mt-2 flex items-center gap-2 text-label @4xl/page:hidden">Section
          <select aria-label="Settings section" value={active} onChange={(e) => e.target.value.startsWith("/") ? router.push(e.target.value) : setActive(e.target.value)} className="h-11 min-w-0 flex-1 rounded-md border border-rule bg-card px-2 text-body">
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            {MORE_SETTINGS.map((m) => <option key={m.href} value={m.href}>{m.title}</option>)}
          </select>
        </label>
        <div className="mt-2 hidden gap-0.5 @4xl/page:flex @4xl/page:flex-col">
          {data.categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={[
                "whitespace-normal break-words rounded px-2.5 py-1.5 text-left text-body transition-colors",
                c.id === active
                  ? "bg-accent-soft font-medium text-accent-2"
                  : "text-ink-2 hover:bg-paper-3",
              ].join(" ")}
            >
              {c.title}
            </button>
          ))}
        </div>
        {/* Owner pages with their own route. Settings is owner-only, so every
            link here opens for whoever can see this rail. */}
        <div className="mt-4 hidden @4xl/page:block">
          <Eyebrow muted>More settings</Eyebrow>
          <div className="mt-2 flex flex-col gap-0.5">
            {MORE_SETTINGS.map((m) => (
              <Link key={m.href} href={m.href} className="rounded px-2.5 py-1.5 text-body text-ink-2 hover:bg-paper-3">
                {m.title}
              </Link>
            ))}
          </div>
        </div>

      </aside>

      {/* Content */}
      <section className="min-w-0 flex-1 px-4 py-6 @4xl/page:px-6"><div className="max-w-2xl">
        {active === "profile" && (
          <>
            <PageHeader title={<> {data.profile.name} </>} />
            <div className="mt-1.5 text-meta text-ink-3">{data.profile.meta}</div>

            <div className="my-5 border-t border-rule" />
            <p className="mb-3 text-body text-ink-2">Profile changes do not autosave. Edit your details, then choose Save profile.</p>
            <SettingsForm action={updateProfile} className="max-w-2xl" saveLabel="Save profile">
              <div className="grid grid-cols-1 gap-5 @3xl/page:grid-cols-2">
                <TextInput name="name" label="Display name" defaultValue={data.profile.name} required />
                <TextInput name="email" label="Email" type="email" defaultValue={data.profile.email} required />
                <TextInput name="company" label="Business name" defaultValue={data.profile.company} />
                <TextInput name="phone" label="Phone (SMS in)" defaultValue={data.profile.phone} />
              </div>

            </SettingsForm>

            <div className="my-5 border-t border-rule" />
            <div className="grid max-w-2xl grid-cols-1 gap-5 @3xl/page:grid-cols-2">
              {data.profile.fields.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>
          </>
        )}

        {active === "company" && (
          <>
            <PageHeader title={<> Company &amp; documents </>} />
            <div className="mt-1.5 text-meta text-ink-3">
              Boilerplate baked into generated contracts &amp; scopes of work.
            </div>

            <div className="my-5 border-t border-rule" />
            <SettingsForm action={updateCompanyDocs} className="max-w-2xl">
              <div className="grid grid-cols-1 gap-5 @3xl/page:grid-cols-2">
                <TextInput name="license" label="License #" defaultValue={data.companyDocs.license} placeholder="e.g. BC123456" />
                <TextInput name="address" label="Business address" defaultValue={data.companyDocs.address} placeholder="Street, City, MN ZIP" />
                <TextInput name="depositPct" label="Default deposit %" type="number" defaultValue={data.companyDocs.depositPct} />
              </div>
              <label className="mt-5 flex flex-col gap-1">
                <span className="text-meta text-ink-3">Standard contract terms</span>
                <textarea
                  name="terms"
                  rows={10}
                  defaultValue={data.companyDocs.terms}
                  className="resize-y rounded-md border border-rule bg-paper px-2.5 py-2 text-meta leading-relaxed text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="autoSendMilestone"
                  defaultChecked={data.companyDocs.autoSendMilestone}
                  className="size-3.5 accent-accent"
                />
                <span className="text-body text-ink-2">
                  Auto-send milestone invoices when a project reaches a billing stage
                </span>
              </label>

              <div className="my-4 border-t border-rule-soft" />
              <div className="grid grid-cols-1 gap-5 @3xl/page:grid-cols-2">
                <TextInput name="googleReviewUrl" label="Google review link" defaultValue={data.companyDocs.googleReviewUrl} placeholder="https://g.page/r/…/review" />
              </div>
              <label className="mt-5 flex flex-col gap-1">
                <span className="text-meta text-ink-3">Warranty terms (sent at completion)</span>
                <textarea
                  name="warrantyTerms"
                  rows={4}
                  defaultValue={data.companyDocs.warrantyTerms}
                  placeholder="e.g. One-year workmanship warranty from substantial completion…"
                  className="resize-y rounded-md border border-rule bg-paper px-2.5 py-2 text-meta leading-relaxed text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="autoOutreach"
                  defaultChecked={data.companyDocs.autoOutreach}
                  className="size-3.5 accent-accent"
                />
                <span className="text-body text-ink-2">
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
                <span className="text-body text-ink-2">
                  Auto-draft a social post when a job completes (review on Marketing)
                </span>
              </label>

            </SettingsForm>

            <div className="my-8 border-t border-rule" />
            <h2 className="font-serif text-heading font-semibold text-ink">Billing rates</h2>
            <div className="mt-1 text-meta text-ink-3">
              Hourly rates + third-party markup printed on the Pre-Construction Agreement. Free text
              (e.g. &ldquo;$52 / hr&rdquo;, &ldquo;Unbilled&rdquo;, &ldquo;20%&rdquo;).
            </div>
            <SettingsForm action={updateBillingRates} className="mt-5 max-w-2xl">
              <div className="grid grid-cols-1 gap-5 @3xl/page:grid-cols-2">
                <TextInput name="markup" label="Third-party markup" defaultValue={data.billingRates.markup} placeholder="e.g. 20%" />
                <TextInput
                  name="preconFeePct"
                  label="Pre-con fee (% of rough estimate low end)"
                  defaultValue={data.billingRates.preconFeePct}
                  placeholder="e.g. 5% — blank to set each fee by hand"
                />
                {data.billingRates.rows.map((r) => (
                  <TextInput key={r.key} name={r.key} label={r.label} defaultValue={r.value} placeholder="e.g. $52 / hr" />
                ))}
              </div>

            </SettingsForm>
          </>
        )}

        {active === "integrations" && (
          <>
            <PageHeader title={<> Integrations </>} />
            <div className="mt-1.5 text-meta text-ink-3">
              {data.integrations.filter((it) => it.connected).length} of {data.integrations.length} connected
            </div>
            <div className="mt-5 divide-y divide-rule-soft">
              {data.integrations.map((it) => {
                const body = (
                  <div className={`py-4 ${it.href ? "transition-colors hover:bg-hover" : ""}`}>
                    <div className="font-serif text-body font-semibold text-ink">{it.name}</div>
                    <div className="mt-0.5 text-meta text-ink-3">{it.sub}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Chip kind={it.connected ? "money" : "ghost"} dot>
                        {it.connected ? "connected" : "not connected"}
                      </Chip>
                      {it.href && <span className="text-meta font-medium text-accent">Open →</span>}
                    </div>
                  </div>
                );
                return it.href ? (
                  <Link key={it.name} href={it.href} className="block">
                    {body}
                  </Link>
                ) : (
                  <div key={it.name}>{body}</div>
                );
              })}
            </div>

            <IntakeTokenCard token={data.intake.token} endpoint={data.intake.endpoint} />
            <ClipTokenCard token={data.clip.token} endpoint={data.clip.endpoint} />
          </>
        )}

        {active === "ai" && (
          <>
            <PageHeader title={<> AI defaults </>} />
            <div className="mt-1.5 text-meta text-ink-3">
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
                <PageHeader title={<> Team &amp; roles </>} />
                <div className="mt-1.5 text-meta text-ink-3">
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
                    <div className="font-serif text-subheading font-semibold text-ink">{m.name}</div>
                    <div className="text-meta text-ink-3">{m.role}</div>
                  </div>
                  {/* Team members get an Access editor; every real non-owner row gets enable/disable. */}
                  {m.id && m.roleKey === "staff" && (
                    <StaffAccessButton id={m.id} name={m.name} email={m.email ?? ""} permissions={m.permissions ?? []} />
                  )}
                  {m.id && !m.isOwner ? (
                    <UserActiveButton id={m.id} active={m.active !== false} />
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
            <PageHeader title={<> Notifications </>} />
            <div className="mt-1.5 text-meta text-ink-3">Choose what reaches you. Changes save instantly.</div>
            <div className="mt-5 max-w-[600px]">
              {data.notifyToggles.map((t) => (
                <Toggle key={t.key} settingKey={t.key} label={t.label} on={t.on} action={setNotifyToggle} />
              ))}
            </div>
          </>
        )}
        {active === "designer" && (
          <>
            <PageHeader title={<> Designer defaults </>} />
            <div className="mt-1.5 text-meta text-ink-3">
              Starting values for every new design — wall thickness, heights, overhangs, door and window sizes. A design
              keeps its own copy, so changing these never moves an existing plan.
            </div>
            <div className="my-5 border-t border-rule" />
            <DesignerDefaultsCard defaults={data.designerDefaults} />
          </>
        )}
      </div></section>
    </div>
  );
}
