SCORES: design=9.5 completeness=9

# Build R5 — Design & field UX: final confirmation of the pill fix (d633ef00)

Evidence: `/tmp/sjcqa/shots/calls-final/` (all 8 shots) and the bounding boxes in `log.json`. Boxes are `[x1, x2, y1, y2]`.

## Verdict: fixed at 640 and 768; at 744 the pill only misses because the list is short

| Width | Finish vs pill | Evidence |
|---|---|---|
| 640 (200% zoom) | **Clear** | Finish 16–480, pill 483–624, on the same rows (y 360–410). Right padding = 160 px, so `pr-40` applied. Finish is still 464 px wide and reads fine. |
| 768 (iPad) | **Clear** | Finish 300–556 (`@3xl` auto width, `min-w-64`), pill 611–752. Looks right. |
| 744 (iPad mini) | **Clear in this shot, but the fix did not apply** | Finish spans 20–724, so the bar's right padding is 20 px (`px-5`), not 160. The pill (587–728, y 1063–1113) misses only because the 13 rows + Notes are short enough that the bar sits at y ≈ 966 above it instead of sticking to the bottom. |

**Why 744 breaks.** The page container is ≥ 42rem there, so `@2xl/page:px-5` turns on. Tailwind v4 emits the container-query variant after the `sm:max-lg:` media variant, so `px-5` overrides `pr-40`. At 640 the container is < 42rem and `pr-40` wins. At 768 the split view makes the checklist pane narrow, so `pr-40` wins again.

**When the overlap comes back on an iPad mini in portrait:** open Notes (the textarea adds about 150 px), or let the "N changes not sent" or error line show. Either one makes the pane scroll. The sticky bar then sits at the bottom of the viewport (about y 1063–1133), and the full-width Finish runs under the pill (x 587–728). That is the round-5 defect again, at the device it was named for.

**Summary "Ask in email"** (`pb-28`) is fixed at every width. At 640, 744 and 768, scrolled to the bottom, the last "Ask in email" (Paying for it), "All rows" and **Link to a lead** all sit above the pill with clear space under them. The padding doesn't look odd.

**Re-shot states**
- **desktop-settings-dirty:** "Work (edited)" in Label, 13/40, and Save is enabled. Cancel and Restore default wording sit in the footer. Correct.
- **staff-phone-submitted:** "Submitted for approval. Joe approves it in Today; approval sends it." The tab bar is clear and nothing is covered. Correct.

Nothing else new was introduced.

## Required fix (one)

In `components/calls/checklist/ChecklistPane.tsx`, on the sticky Finish bar, make the pill gutter win over the container-query padding. Change `sm:max-lg:pr-40` to `sm:max-lg:pr-40!`. An alternative is to drop it from this div and put `sm:max-lg:pr-40` on an inner wrapper around the bar's contents.

To verify: at 744×1133 with Notes open, measure the Finish box. Its right edge should be ≤ 584 and it should not intersect the pill.

`ChecklistSummary.tsx` uses `pb`, which `@2xl/page:px-5` doesn't touch, so it needs no change.
