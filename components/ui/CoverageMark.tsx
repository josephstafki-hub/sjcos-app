import { COVERAGE_MARKS } from "@/lib/checklist-coverage/contract";

// Shared mark for checklist coverage and sub "Ready to start" (plan §6.0).
// Exactly two word sets; the symbol never appears without its word, and the
// accessible name is the word. Colour only supports the word — never the only
// signal. The discovery checklist, in-home consult and sub agreements all use
// this one component; none of them invents a third set.

export type CoverageWord = keyof typeof COVERAGE_MARKS.coverage;
export type ReadyWord = keyof typeof COVERAGE_MARKS.ready;

const COVERAGE_TONE: Record<CoverageWord, string> = {
  open: "text-ink-2",
  partial: "text-ink",
  covered: "text-accent-2",
  not_applicable: "text-ink-3",
  suggestion: "text-ai-2",
  conflict: "text-flag",
  return_visit: "text-info",
};
const READY_TONE: Record<ReadyWord, string> = { done: "text-accent-2", not_yet: "text-ink-2", problem: "text-flag" };

export type CoverageMarkProps = (
  | { variant: "coverage"; state: CoverageWord }
  | { variant: "ready"; state: ReadyWord }
) & {
  /** "row" = 15 px state word (checklist rows); "sm" = compact lists. */
  size?: "row" | "sm";
  className?: string;
};

export function CoverageMark({ variant, state, size = "row", className = "" }: CoverageMarkProps) {
  const [symbol, word] = variant === "coverage" ? COVERAGE_MARKS.coverage[state as CoverageWord] : COVERAGE_MARKS.ready[state as ReadyWord];
  const tone = variant === "coverage" ? COVERAGE_TONE[state as CoverageWord] : READY_TONE[state as ReadyWord];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-sans font-semibold ${size === "row" ? "text-[15px] leading-5" : "text-label"} ${tone} ${className}`}>
      <span aria-hidden className="inline-block w-[1.1em] text-center font-mono">{symbol}</span>
      <span>{word}</span>
    </span>
  );
}

/** The plain word for a mark, for aria-labels and live announcements. */
export function coverageWord(state: CoverageWord): string {
  return COVERAGE_MARKS.coverage[state][1];
}
