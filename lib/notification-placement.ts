// Where the corner approvals go (components/shell/NotificationCenter.tsx).
//
// Normally they stack bottom-right above the page (z-60). Some screens own
// their bottom edge — Inbox's reply footer, the discovery checklist's Finish
// bar and sheets, Settings › Calls' Save footer — and a card there would cover
// the very action Joe is in the middle of. On those screens the cards go
// *compact*: a "Decisions N" badge that opens them only when tapped, at z-35,
// below sheets and dialogs. The badge sits in the page's own
// #approval-badge-slot when it has one, else in the top bar beside the bell
// (#approval-badge-topbar, on every page). It never floats over the page.
//
// A screen asks for compact mode by its path (COMPACT_PATHS) or by claiming it
// while a surface is mounted (claimCompactApprovals): the checklist, the live
// call bar while it shows a call, the lead page's Start a discovery call. A
// claim marked `modal` (an open checklist sheet or confirm) also keeps the
// cards closed: no approval card may sit above an open sheet.

export const APPROVAL_SLOT_ID = "approval-badge-slot";
/** The badge's fallback home, beside the bell in the top bar (Topbar.tsx). */
export const APPROVAL_TOPBAR_SLOT_ID = "approval-badge-topbar";
/** Fired when an ApprovalBadgeSlot mounts or unmounts, so the badge moves. */
export const APPROVAL_SLOT_EVENT = "sjc:approval-badge-slot";
/** Fired whenever the set of compact claims changes. */
export const COMPACT_APPROVALS_EVENT = "sjc:compact-approvals";

const COMPACT_PATHS = /^\/(?:inbox|calls|settings\/calls)(?:\/|$)/;

export function compactPath(pathname: string | null): boolean {
  return COMPACT_PATHS.test(pathname ?? "");
}

export interface CompactClaims {
  /** Some mounted surface asked for compact approvals. */
  surface: boolean;
  /** A sheet or dialog is open: the cards stay closed. */
  modal: boolean;
}

export const NO_CLAIMS: CompactClaims = { surface: false, modal: false };

// Kept at module level, not only in the event, so a surface that mounts before
// NotificationCenter starts listening (same commit, or during a route change)
// is still counted.
const claims = new Map<string, { modal: boolean }>();

/** Pure: the claim map after one claim or release. */
export function applyClaim(
  current: ReadonlyMap<string, { modal: boolean }>,
  source: string,
  active: boolean,
  modal = false,
): Map<string, { modal: boolean }> {
  const next = new Map(current);
  if (active) next.set(source, { modal });
  else next.delete(source);
  return next;
}

export function summarizeClaims(current: ReadonlyMap<string, { modal: boolean }>): CompactClaims {
  if (!current.size) return NO_CLAIMS;
  let modal = false;
  for (const c of current.values()) if (c.modal) modal = true;
  return { surface: true, modal };
}

export function currentClaims(): CompactClaims {
  return summarizeClaims(claims);
}

/** Ask for (active) or release compact approvals on behalf of `source`. */
export function claimCompactApprovals(source: string, active: boolean, modal = false) {
  const before = claims.get(source);
  if (active ? before && before.modal === modal : !before) return;
  const next = applyClaim(claims, source, active, modal);
  claims.clear();
  for (const [k, v] of next) claims.set(k, v);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(COMPACT_APPROVALS_EVENT));
}

export function approvalPlacement(
  pathname: string | null,
  surface: CompactClaims | boolean,
  opened: boolean,
  hasSlot = false,
) {
  const c = typeof surface === "boolean" ? { surface, modal: false } : surface;
  const compact = compactPath(pathname) || c.surface || c.modal;
  return {
    compact,
    /** The cards themselves: on tap in compact mode, never over an open sheet. */
    expanded: compact ? opened && !c.modal : true,
    /** The "Decisions N" badge: in the page's slot; with no slot, beside the
     *  bell in the top bar. Never a floating corner over the page. */
    badge: !compact ? "none" : hasSlot ? "slot" : "topbar",
    corner: compact ? "top" : "bottom",
    layer: compact ? 35 : 60,
  } as const;
}

/** Close the opened cards (Joe went back to typing) without changing claims. */
export function collapseApprovals() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(COMPACT_APPROVALS_EVENT));
}
