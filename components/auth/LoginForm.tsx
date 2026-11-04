"use client";

import { Button } from "@/components/ui";
import { useActionState } from "react";
import { login, type LoginState } from "@/lib/actions/auth";

const FIELD =
  "min-h-11 rounded-md border border-rule bg-paper px-3 py-2 text-subheading text-ink outline-none focus:border-accent";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <label className="flex flex-col gap-1">
        <span className="font-sans text-meta text-ink-3">Email</span>
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
        <span className="font-sans text-meta text-ink-3">Password</span>
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
        <div className="min-h-11 rounded-md border border-flag/40 bg-flag/10 px-3 py-2 text-label text-flag">
          {state.error}
        </div>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="mt-1 w-full"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
