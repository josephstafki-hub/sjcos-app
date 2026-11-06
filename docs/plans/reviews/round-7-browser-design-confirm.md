SCORES: design=9 completeness=9

# Round 7 — Browser plan, design & UX confirm

Reviewed: `docs/plans/agent-browser-plan.md` at 4685d88d (`git show 4685d88d` plus the
"Round-6 fixes (coordinator)" appendix). Plan only. No source, builds or browsers.

## Round-6 items: verified / not fixed

| # | Item | Status |
|---|---|---|
| 1 | Native app on iPad hand-off copy | **Verified in §6.4, §6.5 and the fixture table. Not carried to §10.2 or §12 Phase 2.** The §6.4 frame now has separate "Phone web" and "Native app (iPhone OR iPad)" blocks. The native sentence is "Finish this in Safari on an iPad or computer. It stays in Browser › Asked to finish." with [Open in Safari] [Don't finish] [Close], as asked. The §6.5 "Joe hand-off phone/native" row matches. The new fixture row "Native app on iPad (supportsTablet) hand-off" asserts the exact sentence. Two cross-references still point builders at the wrong block (Required 2). |
| 2 | "Joe is watching." in the 800×360 staff meta row | **Verified for order and never-hide. The fallback added a new contradiction.** §6.3 now states the order (state · Joe is watching. · 2 windows), drops "· 2 windows" first (it stays in ⋯), then uses the short state, then wraps. It also says "Joe is watching." is never truncated or hidden. A matching 800×360 fixture row was added. But the wrap step promises "stage recomputed, still ≥200", which the plan's own numbers rule out (Required 1). |

Other checks:
- No other place still gives native-iPad Joe the "Finish this on your iPad" hand-off copy.
- The other "Open SJC OS on your iPad or computer" lines (§6.2 helper, phone lapse copy, unsupported portal, public Paused) are phone-web templates. The native shell never renders the Browser pane: it gets only Open in Safari landings (§10.2, line ~1773). So they are correct.
- I found no other 800×360 status-row order that leaves out "Joe is watching.". The "· 2 windows" mentions in the §6.5 popup row and the own-task fixture are consistent with the new order.
- The presentation-only claim holds. No authority, device rule or guard text changed.

## Required to reach 10

1. **§6.3 meta overflow and the 800×360 staff fixture row: the "still ≥200" promise can't be kept.**
   - §6.3 (line ~1623) works the stage out as **360−48−20−8−80 = 204 px**. Wrapping the meta to a second line costs about 20 px, which leaves **~184 px**. So "wrap the meta to two lines (stage recomputed, still ≥200)" can't be true at the worst-case safe area. The plan refuses this kind of claim for the keyboard ("no false ≥200 claim", line ~1631).
   - What goes wrong: a builder writing the fixture with large text gets an assertion that can't pass. They will "fix" it by truncating, which is the outcome this item exists to prevent.
   - Fix: in both places, replace "stage recomputed, still ≥200" with: "the stage gives up the extra line (this happens only with enlarged text; the ≥200 floor is asserted at default text size)."
   - In the same sentence, define the short state as its first sentence, e.g. "Private — you took over.". Today "the short private state" is not defined anywhere.

2. **§10.2 "Native hand-off landing" and §12 Phase 2: point at the native variant, not the "phone" copy.**
   - §10.2 still says the landing "shows §6.4's invitation/phone copy". Phase 2 (line ~3795) still says the "native app show[s] the phone invitation". Since §6.4 now has a block labelled "Phone web" with "Finish this on your iPad", a builder following §10.2 renders exactly the round-6 bug on Joe's iPad.
   - Fix: change both to "§6.4's **Native app** variant ('Finish this in Safari on an iPad or computer…')".
   - Add to Phase 2 the assertion from round 6: the native render contains no "on your iPad" string.

## Optional

- §6.5 "Staff, owner viewer present" row: add "in short landscape, appended to the meta row (§6.3)", so the state table cross-links to the landscape rule.
- Carried over and still open from round 6: staff copy "an iPad" rather than "your iPad"; where [Mark finished] [Didn't finish] sit in the landscape right column; the Canvas <640 width rule and the Browser <600 shorter-side rule are separate on purpose, which should be noted in H3; the 360 portrait staff status row should wrap (`min-h-11`) rather than truncate "Joe is watching.".
