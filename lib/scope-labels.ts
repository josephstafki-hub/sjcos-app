/** Owner-facing description of a scope package's design route. */
export function scopeDesignLabel(
  decision:
    | {
        direction_sufficiency?: string | null;
        path?: string | null;
        status?: string | null;
      }
    | null
    | undefined,
): string {
  if (!decision) return "—";
  const directions: Record<string, string> = {
    undefined: "Direction needed",
    defined: "Direction defined",
    exact: "Exact specification",
  };
  const label = (value: string) =>
    value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
  const route = [
    decision.direction_sufficiency
      ? directions[decision.direction_sufficiency] ||
        label(decision.direction_sufficiency)
      : null,
    decision.path ? label(decision.path) : null,
  ]
    .filter(Boolean)
    .join(" → ");
  return (
    (route || "—") + (decision.status ? ` (${label(decision.status)})` : "")
  );
}
