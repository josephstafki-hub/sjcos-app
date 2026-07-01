// Client-safe marketing constants — NO db import (so the /marketing client can
// use them without dragging pg into the browser bundle).

export type DraftKind = "social" | "blog";

export const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  social: "Social post",
  blog: "Blog post",
};
