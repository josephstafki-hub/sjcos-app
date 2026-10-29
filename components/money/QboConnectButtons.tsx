"use client";

import { useState, useTransition } from "react";
import { runAction } from "@/lib/run-action";

type Res = { ok: boolean; error?: string; detail?: unknown };

/** "Connect to QuickBooks" + "Disconnect" for Settings › Accounting.
 *  Connect is a plain link: the browser must leave for Intuit's consent
 *  screen, so there is nothing for a server action to do. */
export function QboConnectButtons({ connected, configured, disconnect }: { connected: boolean; configured: boolean; disconnect: () => Promise<Res> }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {configured ? (
        <a href="/api/qbo/oauth/start" className="rounded-md border border-money bg-money px-3 py-1.5 text-[12px] font-semibold text-paper">
          {connected ? "Reconnect QuickBooks" : "Connect to QuickBooks"}
        </a>
      ) : (
        <span className="text-[12px] text-ink-3">Add INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET and QBO_ENV to .env.local and restart to enable Connect.</span>
      )}
      {connected && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Disconnect QuickBooks? SJC OS will stop reading and writing your books until you connect again. Nothing in QuickBooks is changed or deleted.")) return;
            start(async () => {
              const r = await runAction(disconnect, { fallback: "Disconnect failed." });
              if (r.ok) setNote("Disconnected.");
            });
          }}
          className="rounded-md border border-rule px-3 py-1.5 text-[12px] text-ink-2 disabled:opacity-50"
        >
          {pending ? "Working…" : "Disconnect"}
        </button>
      )}
      {note && <span className="text-[11.5px] text-ink-3">{note}</span>}
    </div>
  );
}
