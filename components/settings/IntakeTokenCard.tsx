"use client";

import { useState, useTransition } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { runAction } from "@/lib/run-action";
import { Card } from "@/components/ui";
import { regenerateIntakeToken } from "@/lib/actions/lead-intake-token";

// Settings → Integrations card for website lead-form ingestion. Reveals /
// rotates the intake token and shows the endpoint the site's lead form POSTs
// new leads to. The token authenticates the (cross-origin, sessionless) form.

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
      <div className="text-meta text-ink-3">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code
          className={`min-w-0 flex-1 truncate rounded-md border border-rule bg-paper px-2.5 py-1.5 text-meta text-ink ${
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

export function IntakeTokenCard({ token, endpoint }: { token: string | null; endpoint: string }) {
  const [current, setCurrent] = useState(token);
  const [feedback,setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function regenerate() {
    if (current && !confirm("Generate a new token? The old one stops working immediately.")) return;
    startTransition(async () => {
      await runAction(async () => {const next = await regenerateIntakeToken();setCurrent(next);return {ok:true};}, {onSuccess:()=>setFeedback("Saved"),onError:setFeedback});
    });
  }

  return (
    <Card className="mt-5 max-w-[760px] p-4">
      <div className="font-serif text-subheading font-semibold text-ink">Website lead form → OS</div>
      <div className="mt-0.5 text-meta text-ink-3">
        Drop new leads straight from your website into the pipeline. Have your web developer POST the
        form as JSON to the endpoint below with an{" "}
        <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> header. Every lead is
        scored by AI on arrival. Any fields (project, budget, timeline, message, …) are captured.
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <CopyRow label="Endpoint (POST)" value={endpoint} />
        {current ? (
          <CopyRow label="Intake token" value={current} />
        ) : (
          <div className="rounded-md border border-dashed border-rule bg-paper px-2.5 py-2 text-meta text-ink-3">
            No token yet — generate one to connect the website form.
          </div>
        )}
      </div>

      <p role="status" className="mt-3 text-meta text-ink-2">{pending ? "Saving…" : feedback}</p>
      <div className="mt-4">
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-meta font-semibold text-paper transition-colors hover:bg-ink-hover disabled:opacity-60"
        >
          <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} strokeWidth={1.5} />
          {current ? "Regenerate token" : "Generate token"}
        </button>
      </div>
    </Card>
  );
}
