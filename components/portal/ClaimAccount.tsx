"use client";

// "Create an account" for a client who arrived on a link.
//
// Joe's framing, which the copy below has to actually convey: right now anyone
// with your link can open this page; making an account locks it to you and lets
// you sign in from anywhere. Both halves matter — the second is the benefit,
// the first is why they'd bother.

import { useActionState, useState } from "react";
import { Lock, Check } from "lucide-react";
import { Card, Eyebrow } from "@/components/ui";
import { claimPortalAccount, type ClaimState } from "@/lib/actions/portal-account";

export function ClaimAccount({ defaultEmail }: { defaultEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ClaimState, FormData>(
    claimPortalAccount,
    {},
  );

  if (state.ok) {
    return (
      <Card className="p-4">
        <div className="flex items-start gap-2">
          <Check className="mt-0.5 size-4 flex-none text-money" strokeWidth={2} />
          <div>
            <div className="font-serif text-[14px] font-semibold text-ink">Your portal is locked to you</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
              From now on, sign in at any time with your email and password — on your phone, your
              laptop, anywhere. The old link from your email no longer opens this page.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const inputCls =
    "w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

  return (
    <Card className="p-4">
      <Eyebrow>Your access</Eyebrow>
      <div className="mt-1.5 flex items-start gap-2">
        <Lock className="mt-0.5 size-4 flex-none text-ink-3" strokeWidth={1.75} />
        <div className="min-w-0">
          <div className="font-serif text-[14px] font-semibold text-ink">
            You&rsquo;re signed in through your emailed link
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
            You don&rsquo;t need an account to use this portal — the link we sent you is enough, and
            it keeps working for 30 days. Because it&rsquo;s just a link, though,{" "}
            <strong className="font-semibold text-ink">
              anyone you forward that email to can open this page too
            </strong>
            . Creating a password locks the portal to you, retires the link, and lets you sign in
            from any device.
          </p>
        </div>
      </div>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          <Lock className="size-3.5" strokeWidth={1.75} /> Create an account
        </button>
      ) : (
        <form action={action} className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Email</span>
            <input
              name="email"
              type="email"
              required
              defaultValue={defaultEmail}
              placeholder="you@example.com"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
              Password
            </span>
            <input name="password" type="password" required minLength={8} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
              Confirm password
            </span>
            <input name="confirm" type="password" required minLength={8} className={inputCls} />
          </label>
          {state.error && <div className="text-[12px] text-flag">{state.error}</div>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
            >
              {pending ? "Setting it up…" : "Create account"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[12px] text-ink-3 hover:text-ink"
            >
              Not now
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
