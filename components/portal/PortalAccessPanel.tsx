"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Mail, RefreshCw, ShieldOff } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ClientInviteScope } from "@/lib/client-invites";
import {
  getPortalInviteLink,
  rotatePortalInviteLink,
  emailPortalInvite,
  revokePortalInvite,
} from "@/lib/actions/client-portal-admin";

/** Summary of the scope's invite, computed server-side by the page. */
export interface PortalInviteSummary {
  status: "none" | "active" | "dismissed" | "expired";
  toEmail: string | null;
  expiresLabel: string | null;
  used: boolean;
}

const STATUS_CHIP: Record<PortalInviteSummary["status"], { kind: "money" | "ghost" | "flag"; label: string }> = {
  none: { kind: "ghost", label: "No link issued" },
  active: { kind: "money", label: "Link active" },
  dismissed: { kind: "flag", label: "Revoked" },
  expired: { kind: "flag", label: "Expired" },
};

/** Owner panel for a client's dashboard access (project or lead scope): copy
 *  the live link, email it, rotate it (kills any previously shared copy), or
 *  revoke it outright. Until now invites only existed as a side effect of
 *  emailing a document — this makes access a first-class thing to manage. */
export function PortalAccessPanel({
  scope,
  invite,
}: {
  scope: ClientInviteScope;
  invite: PortalInviteSummary;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  async function copyLink(rotate: boolean) {
    const res = rotate ? await rotatePortalInviteLink(scope) : await getPortalInviteLink(scope);
    if (!res.ok) return setError(res.error);
    try {
      await navigator.clipboard.writeText(res.link);
      setNotice(rotate ? "New link copied — the old one is dead." : "Portal link copied.");
    } catch {
      // Clipboard can be unavailable (permissions); show the link instead.
      setNotice(`Link: ${res.link}`);
    }
  }

  const chip = STATUS_CHIP[invite.status];

  return (
    <Card className="max-w-[680px] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-[15px] font-semibold text-ink">Dashboard access</h3>
        <Chip kind={chip.kind} dot>
          {chip.label}
        </Chip>
        {invite.used && <Chip kind="ghost">visited</Chip>}
        <div className="flex-1" />
      </div>
      <p className="mt-1 text-[12px] leading-snug text-ink-3">
        The client reaches their dashboard through a signed link — no account needed
        {invite.toEmail ? ` (on file: ${invite.toEmail})` : ""}
        {invite.expiresLabel ? ` · current link good through ${invite.expiresLabel}` : ""}.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => copyLink(false))}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
        >
          <Copy className="size-3" strokeWidth={1.75} /> Copy link
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await emailPortalInvite(scope);
              if (!res.ok) setError(res.error);
              else setNotice(res.delivery.note);
            })
          }
          className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
        >
          <Mail className="size-3" strokeWidth={1.75} /> Email invite
        </button>
        <button
          type="button"
          disabled={pending}
          title="Issue a fresh link — anything previously shared stops working"
          onClick={() => run(() => copyLink(true))}
          className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
        >
          <RefreshCw className="size-3" strokeWidth={1.75} /> Rotate
        </button>
        {invite.status === "active" && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                await revokePortalInvite(scope);
                setNotice("Link revoked — the dashboard is closed until you issue a new one.");
              })
            }
            className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-3 hover:border-flag hover:text-flag disabled:opacity-50"
          >
            <ShieldOff className="size-3" strokeWidth={1.75} /> Revoke
          </button>
        )}
      </div>

      {error && <div className="mt-2 text-[12px] text-flag">{error}</div>}
      {notice && <div className="mt-2 break-all text-[12px] text-money">{notice}</div>}
    </Card>
  );
}
