type LogoProps = {
  /** On the green sidebar, render the lockup in cream. */
  onDark?: boolean;
  className?: string;
};

/** SJC OS monoline lockup — gabled-roof mark + wordmark. */
export function Logo({ onDark, className = "" }: LogoProps) {
  const frame = onDark ? "rgba(255,255,255,0.12)" : "var(--paper-3)";
  const outline = onDark ? "var(--paper)" : "var(--ink)";
  const peak = onDark ? "var(--sidebar-sage)" : "var(--accent)";
  const word = onDark ? "var(--paper)" : "var(--ink)";

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden>
        <path
          d="M4 18 L4 10 L12 4 L20 10 L20 18 Z"
          fill={frame}
          stroke={outline}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <path
          d="M8 18 L8 13 L12 10 L16 13 L16 18"
          fill="none"
          stroke={peak}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="font-mono text-[11px] font-semibold tracking-[0.18em]"
        style={{ color: word }}
      >
        SJC&nbsp;OS
      </span>
    </div>
  );
}
