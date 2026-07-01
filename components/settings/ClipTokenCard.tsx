"use client";

import { useState, useTransition } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui";
import { regenerateClipToken } from "@/lib/actions/clip";

// Settings → Integrations card for the browser-extension catalog clipper.
// Reveals / rotates the clip token and shows the endpoint the extension posts
// to. The token authenticates the (cross-origin, sessionless) extension.

function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code
          className={`min-w-0 flex-1 truncate rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex-none rounded-md border border-rule px-2 py-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="size-3.5 text-money" strokeWidth={1.5} /> : <Copy className="size-3.5" strokeWidth={1.5} />}
        </button>
      </div>
    </div>
  );
}

export function ClipTokenCard({ token, endpoint }: { token: string | null; endpoint: string }) {
  const [current, setCurrent] = useState(token);
  const [pending, startTransition] = useTransition();

  function regenerate() {
    if (current && !confirm("Generate a new token? The old one stops working immediately.")) return;
    startTransition(async () => {
      const next = await regenerateClipToken();
      setCurrent(next);
    });
  }

  return (
    <Card className="mt-5 max-w-[760px] p-4">
      <div className="font-serif text-[14px] font-semibold text-ink">Browser extension · catalog clipper</div>
      <div className="mt-0.5 text-[11px] text-ink-3">
        Clip products from any supplier page straight into your catalog. Load the unpacked extension
        (see <code className="font-mono">browser-extension/</code>), then paste the endpoint and token below into its options.
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <CopyRow label="Endpoint" value={endpoint} />
        {current ? (
          <CopyRow label="Clip token" value={current} />
        ) : (
          <div className="rounded-md border border-dashed border-rule bg-paper px-2.5 py-2 text-[12px] text-ink-3">
            No token yet — generate one to connect the extension.
          </div>
        )}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-60"
        >
          <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} strokeWidth={1.5} />
          {current ? "Regenerate token" : "Generate token"}
        </button>
      </div>
    </Card>
  );
}
