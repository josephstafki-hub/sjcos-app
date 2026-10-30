"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button, type ButtonProps } from "./Button";

type SubmitButtonProps = Extract<ButtonProps, { href?: never }> & { pendingLabel?: string };

/** A submit button that disables itself while its parent <form> is submitting,
 *  so repeated clicks can't fire the Server Action twice (no duplicate rows).
 *  Must be rendered inside the <form> it submits. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "",
  disabled,
  icon,
  variant,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  // Legacy callers supplied their entire visual treatment via className.
  // Preserve their primary / quiet hierarchy until they adopt variant explicitly.
  const legacyVariant = !className || /\bbg-ink\b/.test(className) ? "primary"
    : /\bbg-ai\b/.test(className) ? "ai"
    : /\btext-flag\b/.test(className) ? "danger"
    : /\bborder-rule\b/.test(className) ? "secondary" : "ghost";
  return (
    <Button
      {...props}
      variant={variant ?? legacyVariant}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      icon={pending ? LoaderCircle : icon}
      className={`${pending ? "[&>svg]:animate-spin" : ""} ${className}`}
    >
      {pending ? pendingLabel ?? "Working…" : children}
    </Button>
  );
}
