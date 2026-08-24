"use client";

import { useState, useTransition } from "react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { ACTION_LABEL, GATED_ACTIONS, type OwnerGrant } from "@/lib/owner-grant-types";
import { approveGrant, createGrantAction, denyGrant, revokeGrant } from "@/lib/actions/owner-grants";

const inputCls =
  "w-full rounded-md border border-rule bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";
const btnCls =
  "rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const primaryCls =
  "rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50";

function isLive(g: OwnerGrant) {
  return g.status === "approved" && g.uses < g.max_uses && new Date(g.expires_at).getTime() > Date.now();
}

function statusChip(g: OwnerGrant) {
  if (g.status === "requested") return <Chip kind="flag">Waiting on you</Chip>;
  if (g.status === "denied") return <Chip kind="ghost">Denied</Chip>;
  if (g.status === "revoked") return <Chip kind="ghost">Revoked</Chip>;
  if (g.uses >= g.max_uses) return <Chip kind="default">Spent</Chip>;
  if (new Date(g.expires_at).getTime() <= Date.now()) return <Chip kind="ghost">Expired</Chip>;
  return <Chip kind="money">Live · {g.max_uses - g.uses} use{g.max_uses - g.uses === 1 ? "" : "s"} left</Chip>;
}

function describe(g: OwnerGrant) {
  const what = g.actions.includes("*")
    ? "Any send"
    : g.actions.map((a) => ACTION_LABEL[a as keyof typeof ACTION_LABEL] ?? a).join(", ");
  const target = g.target_id ? ` · ${g.target_kind ?? "target"} ${g.target_id}` : "";
  const to = typeof g.scope?.to === "string" ? ` · to ${g.scope.to}` : "";
  return `${what}${target}${to}`;
}

function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function PermissionsClient({ grants }: { grants: OwnerGrant[] }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, okMsg?: string) =>
    start(async () => {
      const r = await fn();
      setNotice(r.ok ? okMsg ?? "" : r.error ?? "Something went wrong.");
    });

  const copy = (id: string) => {
    void navigator.clipboard?.writeText(id);
    setCopied(id);
    window.setTimeout(() => setCopied((c) => (c === id ? "" : c)), 1500);
  };

  const waiting = grants.filter((g) => g.status === "requested");
  const live = grants.filter(isLive);
  const history = grants.filter((g) => g.status !== "requested" && !isLive(g));

  return (
    <div className="flex flex-col gap-6">
      {notice && <div className="text-[12px] font-medium text-ai-2">{notice}</div>}

      {/* Requests */}
      <section>
        <Eyebrow>Requests</Eyebrow>
        <div className="mt-2 flex flex-col gap-2">
          {waiting.map((g) => (
            <RequestCard key={g.id} g={g} pending={pending} run={run} />
          ))}
          {waiting.length === 0 && (
            <Card kind="dashed" className="p-6 text-center">
              <div className="text-[13px] text-ink-3">No agent is waiting on a permission right now.</div>
            </Card>
          )}
        </div>
      </section>

      {/* Mint by hand */}
      <section>
        <Eyebrow>Grant a permission</Eyebrow>
        <Card className="mt-2 p-3">
          <form
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              run(
                async () => {
                  const r = await createGrantAction(fd);
                  if (r.ok) form.reset();
                  return r;
                },
                "Granted — copy the id to the agent (it's in the Live list).",
              );
            }}
          >
            <label className="text-[12px] text-ink-3">
              Action
              <select name="action" className={inputCls} defaultValue="send_email">
                {GATED_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABEL[a]}
                  </option>
                ))}
                <option value="*">Any send (use sparingly)</option>
              </select>
            </label>
            <label className="text-[12px] text-ink-3">
              Target id (optional — bid package / PO / invoice / draft / issue id)
              <input name="target_id" className={inputCls} placeholder="e.g. 12" />
            </label>
            <label className="text-[12px] text-ink-3">
              Only to this address (send_email)
              <input name="to" type="email" className={inputCls} placeholder="someone@example.com" />
            </label>
            <label className="text-[12px] text-ink-3">
              Note for the audit
              <input name="reason" className={inputCls} placeholder="Why this is okay to send" />
            </label>
            <label className="text-[12px] text-ink-3">
              Uses
              <input name="max_uses" type="number" min={1} max={100} defaultValue={1} className={inputCls} />
            </label>
            <label className="text-[12px] text-ink-3">
              Expires in (hours)
              <input name="hours" type="number" min={0.25} max={168} step={0.25} defaultValue={24} className={inputCls} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={primaryCls} disabled={pending}>
                Grant
              </button>
            </div>
          </form>
        </Card>
      </section>

      {/* Live */}
      <section>
        <Eyebrow>Live grants</Eyebrow>
        <div className="mt-2 flex flex-col gap-2">
          {live.map((g) => (
            <Card key={g.id} className="p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Chip kind="ai">{g.requested_by}</Chip>
                    {statusChip(g)}
                    <div className="flex-1" />
                    <span className="font-mono text-[10px] text-ink-3">until {fmt(g.expires_at)}</span>
                  </div>
                  <div className="mt-1 font-serif text-[14px] font-semibold text-ink">{describe(g)}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">{g.reason}</div>
                  <button
                    type="button"
                    onClick={() => copy(g.id)}
                    className="mt-1 font-mono text-[10px] text-ink-3 hover:text-ink"
                    title="Copy grant id"
                  >
                    {g.id} {copied === g.id ? "· copied" : "· copy"}
                  </button>
                  <Audit g={g} />
                </div>
                <button className={btnCls} disabled={pending} onClick={() => run(() => revokeGrant(g.id), "Revoked.")}>
                  Revoke
                </button>
              </div>
            </Card>
          ))}
          {live.length === 0 && (
            <Card kind="dashed" className="p-6 text-center">
              <div className="text-[13px] text-ink-3">Nothing is granted right now.</div>
            </Card>
          )}
        </div>
      </section>

      {/* History */}
      {history.length > 0 && (
        <section>
          <Eyebrow>History</Eyebrow>
          <div className="mt-2 flex flex-col gap-2">
            {history.map((g) => (
              <Card key={g.id} className="p-3 opacity-70">
                <div className="flex items-center gap-1.5">
                  <Chip kind="ghost">{g.requested_by}</Chip>
                  {statusChip(g)}
                  <div className="flex-1" />
                  <span className="font-mono text-[10px] text-ink-3">{fmt(g.decided_at ?? g.created_at)}</span>
                </div>
                <div className="mt-1 text-[13px] font-medium text-ink">{describe(g)}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">{g.reason}</div>
                <Audit g={g} />
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RequestCard({
  g,
  pending,
  run,
}: {
  g: OwnerGrant;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, okMsg?: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Card className="border-flag p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Chip kind="ai">{g.requested_by}</Chip>
            {statusChip(g)}
            <div className="flex-1" />
            <span className="font-mono text-[10px] text-ink-3">{fmt(g.created_at)}</span>
          </div>
          <div className="mt-1 font-serif text-[14px] font-semibold text-ink">{describe(g)}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">{g.reason}</div>
          <input
            className={`${inputCls} mt-1.5`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why? (optional — if you deny, agents learn from this)"
            maxLength={300}
          />
        </div>
        <div className="flex flex-none gap-1.5">
          <button className={btnCls} disabled={pending} onClick={() => run(() => denyGrant(g.id, note), "Denied.")}>
            Deny
          </button>
          <button
            className={primaryCls}
            disabled={pending}
            onClick={() => run(() => approveGrant(g.id), "Approved — the agent can send now.")}
          >
            Approve
          </button>
        </div>
      </div>
    </Card>
  );
}

function Audit({ g }: { g: OwnerGrant }) {
  if (!g.audit?.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 border-l border-rule pl-2">
      {g.audit.map((a, i) => (
        <li key={i} className="font-mono text-[10px] text-ink-3">
          {fmt(a.at)} · {a.action} {a.target} · {a.result}
        </li>
      ))}
    </ul>
  );
}
