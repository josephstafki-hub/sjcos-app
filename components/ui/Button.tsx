import Link from "next/link";
import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ai";
export type ButtonSize = "sm" | "md" | "lg";

type SharedProps = {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  className?: string;
} & (
  | { iconOnly: true; "aria-label": string; title: string }
  | { iconOnly?: false }
);

export type ButtonProps = SharedProps & (
  | ({ href?: never } & ComponentPropsWithoutRef<"button">)
  | ({ href: ComponentProps<typeof Link>["href"]; disabled?: boolean } & Omit<ComponentProps<typeof Link>, "href">)
);

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-hover",
  secondary: "border border-rule bg-card text-ink hover:bg-paper-2",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink",
  danger: "border border-flag/30 bg-card text-flag hover:bg-flag-soft",
  ai: "bg-ai text-paper hover:bg-ai-2",
};
const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-label",
  md: "h-8 px-3 text-body max-sm:h-11",
  lg: "h-10 px-4 text-subheading max-sm:h-11",
};
const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "size-7 text-label",
  md: "size-8 text-body max-sm:size-11",
  lg: "size-10 text-subheading max-sm:size-11",
};

/** One primary per region. Icon-only actions require both an accessible name and a tooltip. */
export function Button({
  children, variant, size = "md", icon: Icon, iconOnly, className = "", ...props
}: ButtonProps) {
  const classes = [
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-sans font-semibold transition-colors",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
    VARIANTS[variant ?? (iconOnly ? "ghost" : "primary")],
    iconOnly ? `${ICON_SIZES[size]} p-0` : SIZES[size],
    className,
  ].join(" ");
  const content = <>{Icon && <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />}{!iconOnly && children}</>;

  if (props.href !== undefined) {
    const { disabled, ...linkProps } = props;
    // A disabled link must also be inert for keyboard users.
    if (disabled) return <span role="link" className={classes} aria-disabled="true" aria-label={props["aria-label"]} title={props.title}>{content}</span>;
    // Files, PDFs and downloads (/api/…) aren't pages: a plain <a>, so Next
    // doesn't prefetch a binary response that never settles.
    if (typeof linkProps.href === "string" && linkProps.href.startsWith("/api/")) {
      const { href, prefetch: _prefetch, replace: _replace, scroll: _scroll, shallow: _shallow, locale: _locale, legacyBehavior: _legacy, passHref: _passHref, onNavigate: _onNavigate, ...anchorProps } = linkProps;
      return <a href={href} {...anchorProps} className={classes}>{content}</a>;
    }
    return <Link {...linkProps} className={classes}>{content}</Link>;
  }
  return <button type="button" {...props} className={classes}>{content}</button>;
}
