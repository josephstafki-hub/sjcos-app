"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Check, Send } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { sendReferralThankYou } from "@/lib/actions/leads";

/** Referral card on lead detail — shows who referred the lead and lets the owner
 *  (re)send a thank-you. Auto-thanks fire on creation for referral leads with an
 *  email; this covers leads added without one, or a re-send. */
export function ThankReferrerButton({
  slug,
  referrerName,
  referrerEmail,
  thanked,
}: {
  slug: string;
  referrerName: string | null;
  referrerEmail: string | null;
  thanked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(thanked);
  const [error, setError] = useState("");

  if (!referrerName && !referrerEmail) return null;

  function thank() {
    setError("");
    startTransition(async () => {
      const r = await sendReferralThankYou(slug);
      if (r.ok) {
        setSent(true);
        router.refresh();
      } else {
        setError(r.error ?? "Couldn't send.");
      }
    });
  }

  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5">
        <Gift className="size-3.5 text-accent" strokeWidth={1.75} />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Referral</span>
      </div>
      <div className="mt-2 text-[13px] text-ink">{referrerName || "Referrer"}</div>
      {referrerEmail && <div className="text-[11px] text-ink-3">{referrerEmail}</div>}
      <div className="mt-2.5">
        {sent ? (
          <Chip kind="money" dot>
            <Check className="mr-0.5 inline size-2.5" strokeWidth={2} /> thanked
          </Chip>
        ) : referrerEmail ? (
          <button
            type="button"
            onClick={thank}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            <Send className="size-3" strokeWidth={1.75} />
            {pending ? "Sending…" : "Thank referrer"}
          </button>
        ) : (
          <span className="text-[11px] text-ink-3">Add a referrer email to send thanks.</span>
        )}
      </div>
      {error && <div className="mt-1 text-[11px] text-flag">{error}</div>}
    </Card>
  );
}
