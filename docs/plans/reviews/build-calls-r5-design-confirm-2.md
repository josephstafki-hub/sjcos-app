SCORES: design=9.6 completeness=9.5

# Build R5 — Design & field UX: second confirmation of the Finish-bar pill fix (203bdcfc)

Evidence: `git show 203bdcfc` and `/tmp/sjcqa/shots/calls-final2/` (all three width shots opened, plus the boxes in `log.json`). Boxes are `[x1, x2, y1, y2]`.

## Verdict: fixed. No required fix remains.

The change is one token in `components/calls/checklist/ChecklistPane.tsx`: `sm:max-lg:pr-40` → `sm:max-lg:pr-40!`. That is the fix I asked for. The `!` beats `@2xl/page:px-5` in the cascade, and only between `sm` and `lg`. Phones (< sm, tab bar) and ≥ lg (pill gone or docked) are unchanged.

| Width | Finish x | Pill x | Result |
|---|---|---|---|
| 744×1133 (iPad mini, the failing case) | 20–584 | 587–728 | **Passes.** Right edge 584 is exactly the target (≤ 584), and it does not touch the pill. In the shot the button now stops well short of the right edge, with a 160 px right gutter, the same as at 640. Before the fix it ran to 724. |
| 640×430 (200% zoom) | 16–480 | 483–624 | Clear, same as before. Same rows (y 370–418 vs 360–410), side by side, no overlap. |
| 768×1024 (iPad split) | 300–556 | 611–752 | Clear, unchanged. `@3xl` auto width (`min-w-64`) still applies and looks right. |

**Do the x-ranges alone prove it? Yes.** The pill is `position: fixed` at a constant x. The Finish bar is sticky, so opening Notes or showing the "not sent" line only moves it on the y axis. Its horizontal box comes from the bar's padding, which no longer depends on scroll or content height. Two x-ranges that don't overlap can't intersect at any y. So the missing notes-open shot doesn't leave a gap. A harness re-shot is nice to have, not required.

**Nothing new broke at 640–1024.**
- 744: The 564 px Finish button is still a large, centred-left tap target. Labels, the status row and the "By hand" chip are unchanged.
- 640: Finish is 464 px wide and its label is not clipped.
- 768: The split view and list are unchanged.
- 1024 is `lg`. `max-lg` excludes it, so the `!` rule doesn't apply there, and the earlier behaviour there was already accepted.
- The `!` is scoped to one right-padding utility. It doesn't affect top/bottom or the safe-area padding (`sm:pb-[max(...)]`).

**Optional polish, not required.** At 640 and 744 there is only 3 px between Finish and the pill. Nothing overlaps, but they read as almost touching. `pr-44` (176 px) would give about 19 px of air. Leave it unless Joe notices it.
