"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, LogOut } from "lucide-react";
import { SubmitButton } from "@/components/ui";
import { DELEGABLE_ACTIONS, authorityActionDef } from "@/lib/authority/catalog";
import { PERMISSIONS } from "@/lib/permissions";
import { grantAuthorityAction, revokeAuthorityAction, revokeUserSessionsAction, type UserActionResult } from "@/lib/actions/users";
import { runAction } from "@/lib/run-action";

// Team member › "May approve" editor (A22). Two distinct sections on the
// page: AREAS (what they can open — lib/permissions.ts, edited from the Team
// screen's Access modal) and AUTHORITY (what they may approve — one grant per
// action type, optionally scoped to a project and capped at a dollar amount).
// New accounts hold none. Owner-only; the Server Actions enforce it and every
// change is an audited command (lib/authority).

const inputCls = "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const primaryBtn = "rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]";
const ghostBtn = "inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2";

export interface AuthorityRow {
  id: string;
  action_type: string;
  project_id: string | null;
  project_name: string | null;
  max_amount_cents: string | null;
  granted_at: string;
  revoked_at: string | null;
  note: string;
}

export interface ProjectOption {
  id: string;
  name: string;
}

function money(cents: string | null): string {
  if (cents == null) return "no limit";
  const n = Number(cents) / 100;
  return `up to $${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AreasSummary({ permissions }: { permissions: readonly string[] }) {
  const held = PERMISSIONS.filter((p) => permissions.includes(p.key));
  return (
    <div className="flex flex-wrap gap-1.5">
      {held.length === 0 && <span className="text-[12px] text-ink-3">No areas — this account can open nothing.</span>}
      {held.map((p) => (
        <span
          key={p.key}
          className={[
            "rounded-md border px-2 py-0.5 text-[11px] font-semibold",
            p.sensitive ? "border-flag/50 bg-flag/5 text-ink" : "border-rule-soft bg-paper-2 text-ink-2",
          ].join(" ")}
          title={p.description}
        >
          {p.label}
        </span>
      ))}
    </div>
  );
}

export function AuthorityEditor({
  userId,
  userName,
  live,
  revoked,
  projects,
}: {
  userId: string;
  userName: string;
  live: AuthorityRow[];
  revoked: AuthorityRow[];
  projects: ProjectOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [picked, setPicked] = useState<string>(DELEGABLE_ACTIONS[0].key);
  const pickedDef = authorityActionDef(picked);

  async function run(fn: () => Promise<UserActionResult>, fallback: string, okMsg: string) {
    setError(null);
    setNotice(null);
    const res = await runAction(fn, { fallback });
    if (res.ok) setNotice(okMsg);
    else setError(res.error ?? fallback);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">May approve</span>
          {revoked.length > 0 && (
            <button type="button" className="text-[11px] text-ink-3 hover:underline" onClick={() => setShowRevoked((v) => !v)}>
              {showRevoked ? "Hide" : "Show"} {revoked.length} revoked
            </button>
          )}
        </div>
        {live.length === 0 ? (
          <div className="rounded-md border border-dashed border-rule px-3 py-2.5 text-[12px] text-ink-3">
            {userName} holds no approval authority. They can see whatever areas are ticked above, but cannot release a
            proposal, purchase, payment or package — those go to you.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {live.map((g) => {
              const def = authorityActionDef(g.action_type);
              return (
                <li key={g.id} className="flex items-start gap-2 rounded-md border border-accent bg-accent-soft/40 px-2.5 py-2 text-[12px]">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-accent-2" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{def?.label ?? g.action_type}</span>
                    <span className="block text-[11px] text-ink-3">
                      {g.project_name ? `Project: ${g.project_name}` : "Any project"} · {def?.amountBound ? money(g.max_amount_cents) : "no amount"} · since {when(g.granted_at)}
                      {g.note ? ` · ${g.note}` : ""}
                    </span>
                  </span>
                  <form action={() => run(() => revokeAuthorityAction(userId, g.id), "Couldn't revoke.", "Revoked — their open sessions were signed out.")}>
                    <SubmitButton pendingLabel="Revoking…" className={ghostBtn}>
                      <ShieldOff className="size-3" strokeWidth={1.5} />
                      Revoke
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
        {showRevoked && revoked.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 opacity-70">
            {revoked.map((g) => (
              <li key={g.id} className="rounded-md border border-rule-soft px-2.5 py-1.5 text-[11px] text-ink-3 line-through">
                {authorityActionDef(g.action_type)?.label ?? g.action_type} · {g.project_name ?? "any project"} · {money(g.max_amount_cents)} · revoked {g.revoked_at ? when(g.revoked_at) : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        action={(fd) => run(() => grantAuthorityAction(userId, fd), "Couldn't grant that.", "Granted.")}
        className="flex flex-col gap-2.5 rounded-md border border-rule px-3 py-3"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Add approval authority</span>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-3">Approval type</span>
          <select name="action_type" value={picked} onChange={(e) => setPicked(e.target.value)} className={inputCls}>
            {DELEGABLE_ACTIONS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          {pickedDef && <span className="text-[11px] text-ink-3">{pickedDef.description}</span>}
        </label>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Project (optional)</span>
            <select name="project_id" defaultValue="" className={inputCls}>
              <option value="">Any project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Dollar limit (optional)</span>
            <input
              name="max_amount"
              inputMode="decimal"
              placeholder={pickedDef?.amountBound ? "e.g. 5000" : "n/a for this type"}
              disabled={!pickedDef?.amountBound}
              className={`${inputCls} disabled:opacity-50`}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-3">Note (optional)</span>
          <input name="note" placeholder="why / until when" className={inputCls} />
        </label>
        {error && <div className="text-[12px] text-flag">{error}</div>}
        {notice && <div className="text-[12px] text-accent-2">{notice}</div>}
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Granting…" className={primaryBtn}>
            Grant
          </SubmitButton>
        </div>
      </form>
      <form
        action={() => run(() => revokeUserSessionsAction(userId), "Couldn't sign them out.", "Signed out everywhere.")}
        className="flex items-center justify-between gap-3 rounded-md border border-rule px-3 py-2.5"
      >
        <span className="text-[11px] text-ink-3">Every session and mobile token {userName} holds right now stops working on its next request.</span>
        <SubmitButton pendingLabel="Signing out…" className={ghostBtn}>
          <LogOut className="size-3" strokeWidth={1.5} />
          Sign out everywhere
        </SubmitButton>
      </form>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Authority is checked again at the moment of approval and again at dispatch, on every path (app, agent, Telegram,
        push). A revoke bites without re-login. Only you can change this page — an agent cannot, even when asked on your
        behalf.
      </p>
    </div>
  );
}
