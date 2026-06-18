"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** A submit button that disables itself while its parent <form> is submitting,
 *  so repeated clicks can't fire the Server Action twice (no duplicate rows).
 *  Must be rendered inside the <form> it submits. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "",
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel ?? "Working…" : children}
    </button>
  );
}
