"use client";

// Settings › Phone lines (owner only). The numbers the business owns on
// Telnyx: one main line (what texts and calls go out from by default), and
// any line handed to one team member. Actions: lib/actions/phone-lines.ts.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, CircleAlert, CircleHelp, Phone, Plus } from "lucide-react";
import { Button, Card, Chip } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import {
  addPhoneLine,
  checkPhoneLine,
  deletePhoneLine,
  makeMainLine,
  updatePhoneLine,
} from "@/lib/actions/phone-lines";
import type { PhoneLine } from "@/lib/phone-lines";
import type { NumberReadiness } from "@/lib/telnyx";

type Person = { id: string; name: string; role: string; hasCell: boolean };

const inputCls = "w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent";

function firstName(n: string | null) {
  return (n ?? "").split(/\s+/)[0] || "Someone";
}

function ReadinessList({ r }: { r: NumberReadiness }) {
  const row = (label: string, v: boolean | null) => (
    <li className="flex items-center gap-2 text-meta">
      {v === true ? (
        <Check aria-hidden className="size-3.5 text-ok" />
      ) : v === false ? (
        <CircleAlert aria-hidden className="size-3.5 text-flag" />
      ) : (
        <CircleHelp aria-hidden className="size-3.5 text-ink-4" />
      )}
      <span className="text-ink-2">{label}</span>
      <span className="text-ink-4">{v === true ? "yes" : v === false ? "no" : "couldn't check"}</span>
    </li>
  );
  return (
    <div className="mt-3 rounded-md border border-rule-soft bg-paper-2 p-3">
      <ul className="space-y-1">
        {row("On the Telnyx account", r.onAccount)}
        {row("Can send and get texts (messaging profile)", r.texting)}
        {row("Can make and take calls (Call Control app)", r.calling)}
        {row("Registered for business texting (10DLC)", r.campaign)}
      </ul>
      {r.problems.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-meta text-flag">
          {r.problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {r.problems.length === 0 && <p className="mt-2 text-meta text-ok">Ready to use.</p>}
    </div>
  );
}

function LineRow({ line, people }: { line: PhoneLine; people: Person[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [readiness, setReadiness] = useState<NumberReadiness | null>(null);
  const [label, setLabel] = useState(line.label);
  const [owner, setOwner] = useState(line.assignedUserId ?? "");
  const [sms, setSms] = useState(line.smsEnabled);
  const [voice, setVoice] = useState(line.voiceEnabled);
  const [greeting, setGreeting] = useState(line.voicemailGreeting ?? "");
  const [notes, setNotes] = useState(line.notes);
  const holder = people.find((p) => p.id === owner);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      await runAction(fn, { onSuccess: () => { done?.(); router.refresh(); } });
    });

  return (
    <div className={`px-4 py-3.5 ${line.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 inline-flex size-8 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-2">
          <Phone aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <div className="font-mono text-subheading font-semibold text-ink">{line.formatted}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-meta text-ink-3">
            <span>{line.label || "No name"}</span>
            {line.isCompanyDefault && <Chip kind="accent">Main line</Chip>}
            {line.assignedUserName && <Chip kind="info">{firstName(line.assignedUserName)}&rsquo;s line</Chip>}
            {!line.active && <Chip kind="ghost">Off</Chip>}
            {line.active && !line.smsEnabled && <Chip kind="warn">Texts off</Chip>}
            {line.active && !line.voiceEnabled && <Chip kind="warn">Calls off</Chip>}
          </div>
        </div>
        <div className="flex basis-full flex-wrap items-center gap-2 @3xl/page:basis-auto">
          {!line.isCompanyDefault && !line.assignedUserId && line.active && (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => makeMainLine(line.id))}>
              Make main line
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await runAction(() => checkPhoneLine(line.id), {
                  onSuccess: (r) => {
                    if (r && "readiness" in r) setReadiness(r.readiness);
                  },
                });
              })
            }
          >
            {pending && !editing ? "Checking…" : "Check with Telnyx"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
      </div>

      {readiness && <ReadinessList r={readiness} />}

      {editing && (
        <form
          className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-rule-soft bg-paper-2 p-3 @3xl/page:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () =>
                updatePhoneLine(line.id, {
                  label,
                  assignedUserId: line.isCompanyDefault ? undefined : owner || null,
                  smsEnabled: sms,
                  voiceEnabled: voice,
                  voicemailGreeting: greeting,
                  notes,
                }),
              () => setEditing(false),
            );
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-3">Name</span>
            <input className={inputCls} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Google Voice line" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-3">Whose line</span>
            <select
              className={inputCls}
              value={owner}
              disabled={line.isCompanyDefault}
              onChange={(e) => setOwner(e.target.value)}
              title={line.isCompanyDefault ? "The main line belongs to the company" : undefined}
            >
              <option value="">Company (everyone)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.role === "owner" ? " (you)" : ""}
                </option>
              ))}
            </select>
            {holder && !holder.hasCell && (
              <span className="text-meta text-warn">
                {firstName(holder.name)} has no cell saved for calls, so calls to this line will ring you until they add one.
              </span>
            )}
          </label>
          <label className="flex items-center gap-2 text-body text-ink-2">
            <input type="checkbox" className="size-3.5 accent-accent" checked={sms} onChange={(e) => setSms(e.target.checked)} />
            Texts on this line
          </label>
          <label className="flex items-center gap-2 text-body text-ink-2">
            <input type="checkbox" className="size-3.5 accent-accent" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
            Calls on this line
          </label>
          <label className="flex flex-col gap-1 @3xl/page:col-span-2">
            <span className="text-meta text-ink-3">Voicemail greeting (blank = the standard SJ Carpentry greeting)</span>
            <textarea className={`${inputCls} resize-y`} rows={2} maxLength={600} value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 @3xl/page:col-span-2">
            <span className="text-meta text-ink-3">Notes</span>
            <input className={inputCls} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ported from Google Voice on …" />
          </label>
          <div className="flex flex-wrap items-center gap-2 @3xl/page:col-span-2">
            <Button size="sm" variant="primary" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {!line.isCompanyDefault && (
              <Button size="sm" variant="secondary" type="button" disabled={pending} onClick={() => act(() => updatePhoneLine(line.id, { active: !line.active }))}>
                {line.active ? "Switch line off" : "Switch line on"}
              </Button>
            )}
            {!line.isCompanyDefault && (
              <Button
                size="sm"
                variant="danger"
                type="button"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Remove ${line.formatted} from the list?`)) act(() => deletePhoneLine(line.id));
                }}
              >
                Remove
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function AddLine({ people }: { people: Person[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [number, setNumber] = useState("");
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOpen(true)}>
        Add a number
      </Button>
    );
  }
  return (
    <form
      className="grid w-full grid-cols-1 gap-3 rounded-md border border-rule bg-card p-4 @3xl/page:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await runAction(() => addPhoneLine({ number, label, assignedUserId: owner || null }), {
            onSuccess: () => {
              setOpen(false);
              setNumber("");
              setLabel("");
              setOwner("");
              router.refresh();
            },
          });
        });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-meta text-ink-3">Number</span>
        <input className={inputCls} required value={number} onChange={(e) => setNumber(e.target.value)} placeholder="(612) 555-1234" inputMode="tel" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-meta text-ink-3">Name</span>
        <input className={inputCls} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Google Voice line" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-meta text-ink-3">Whose line</span>
        <select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Company (everyone)</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.role === "owner" ? " (you)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="text-meta text-ink-3 @3xl/page:col-span-3">
        The number has to be on your Telnyx account first. Adding it here doesn&rsquo;t change anything until you make it the main line or give it to someone.
      </p>
      <div className="flex gap-2 @3xl/page:col-span-3">
        <Button size="sm" variant="primary" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add number"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PhoneLinesSettings({ lines, people }: { lines: PhoneLine[]; people: Person[] }) {
  const main = lines.find((l) => l.isCompanyDefault);
  return (
    <div className="mt-5 space-y-5">
      <Card className="overflow-hidden p-0">
        {lines.length === 0 ? (
          <div className="px-4 py-6 text-body text-ink-3">No numbers yet. Add the Telnyx number the app uses.</div>
        ) : (
          lines.map((l, i) => (
            <div key={l.id} className={i ? "border-t border-rule-soft" : ""}>
              <LineRow line={l} people={people} />
            </div>
          ))
        )}
      </Card>
      <AddLine people={people} />

      <div className="rounded-md border border-rule-soft bg-paper-2 p-4 text-body text-ink-2">
        <div className="font-semibold text-ink">How it works</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-meta">
          <li>
            The <b>main line</b>{main ? ` (${main.formatted})` : ""} is the number new texts and calls go out from, for you, agents and anyone
            without a line of their own. Calls to it ring your cell.
          </li>
          <li>
            A line you give to a team member is theirs. Their texts and calls go out from it, calls to it ring their cell, and texts to it go to their bell.
            You can read every line, and they can read their own line plus the company lines.
          </li>
          <li>
            Clients, leads, subs and suppliers are shared by everyone. Every call and text, on any line, shows up on that record as a short summary.
          </li>
          <li>Replies stay on the line the conversation started on, so switching the main line never moves an old conversation.</li>
        </ul>
        <div className="mt-3 font-semibold text-ink">Moving your Google Voice number over</div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-meta">
          <li>In Google Voice, unlock the number for transfer and note the transfer PIN.</li>
          <li>In Telnyx, start a port-in order for it. Keep using Google Voice until Telnyx says the port is complete.</li>
          <li>In Telnyx, put the number on the SJC OS messaging profile, the SJC OS Call Control app, and the 10DLC texting campaign.</li>
          <li>Add it here, press <b>Check with Telnyx</b>, and when every line is a yes, press <b>Make main line</b>. You can switch back the same way.</li>
        </ol>
      </div>
    </div>
  );
}
