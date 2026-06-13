export type AvatarKind = "default" | "accent" | "ai" | "gray";
export type AvatarSize = "sm" | "md" | "lg";

const KIND_CLASSES: Record<AvatarKind, string> = {
  default: "bg-paper-3 border-rule text-ink-2",
  accent: "bg-accent-soft border-accent text-accent-2",
  ai: "bg-ai-soft border-ai text-ai-2",
  gray: "bg-paper-3 border-ink-4 text-ink-2",
};

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "size-5 text-[9px]",
  md: "size-[26px] text-[10px]",
  lg: "size-9 text-[12px]",
};

type AvatarProps = {
  initials?: string;
  kind?: AvatarKind;
  size?: AvatarSize;
  className?: string;
};

/** Initials avatar — full circle, mono numerals. */
export function Avatar({
  initials = "JS",
  kind = "default",
  size = "md",
  className = "",
}: AvatarProps) {
  return (
    <span
      className={[
        "inline-flex flex-none items-center justify-center rounded-full border",
        "font-mono font-semibold",
        KIND_CLASSES[kind],
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
    >
      {initials}
    </span>
  );
}
