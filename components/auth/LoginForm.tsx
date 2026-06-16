"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/actions/auth";

const FIELD =
  "rounded-md border border-rule bg-paper px-3 py-2 text-[14px] text-ink outline-none focus:border-accent";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Email</span>
        <input
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="username"
          placeholder="you@sjcarpentryllc.com"
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className={FIELD}
        />
      </label>

      {state.error && (
        <div className="rounded-md border border-flag/40 bg-flag/10 px-3 py-2 text-[12px] text-flag">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md border border-accent bg-accent px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
