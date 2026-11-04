/** Inbox owns its reply footer. Decisions open only by an explicit badge click. */
export function approvalPlacement(
  pathname: string | null,
  inboxSurfaceOpen: boolean,
  opened: boolean,
) {
  const compact = /^\/inbox(?:\/|$)/.test(pathname ?? "") || inboxSurfaceOpen;
  return {
    compact,
    expanded: compact ? opened : true,
    corner: compact ? "top" : "bottom",
    layer: compact ? 35 : 60,
  } as const;
}
