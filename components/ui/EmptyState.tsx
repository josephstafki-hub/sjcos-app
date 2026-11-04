import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "./Button";

export type EmptyStateProps = {
  icon?: LucideIcon;
  title: ReactNode;
  description: ReactNode;
  action?: ButtonProps;
  compact?: boolean;
  className?: string;
};

/** Say what will appear and how; setup blockers belong in an attention banner. */
export function EmptyState({ icon: Icon, title, description, action, compact, className = "" }: EmptyStateProps) {
  return (
    <div className={`mx-auto flex max-w-[360px] flex-col items-center px-4 text-center ${compact ? "py-8" : "py-12"} ${className}`}>
      {Icon && <Icon aria-hidden className="mb-3 size-8 text-ink-4" strokeWidth={1.25} />}
      <h2 className="text-subheading font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-body text-ink-3">{description}</p>
      {action && <div className="mt-4"><Button variant="secondary" size="sm" {...action} /></div>}
    </div>
  );
}
