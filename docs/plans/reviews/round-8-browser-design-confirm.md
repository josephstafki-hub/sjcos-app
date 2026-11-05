SCORES: design=10 completeness=10

# Round 8 — Browser plan, design & UX confirm

Reviewed: `docs/plans/agent-browser-plan.md` at d9cf28b9 (`git show d9cf28b9` and the end of
the "Round-6 fixes (coordinator)" appendix, rows R7-1 and R7-2), followed by a sweep of the
whole plan for stale hand-off copy and status-row order. I reviewed the plan only: no source
code, builds or browsers. Every edit in d9cf28b9 changes presentation only. No authority,
device rule, guard or admission text changed, so the engineering and security 10/10 still
stands.

## Round-7 items: verified / not fixed

| # | Item | Status |
|---|---|---|
| 1 | "Joe is watching." wrap arithmetic and the undefined short private state | **Verified.** §6.3 (line ~1526) now says: drop "· 2 windows" (it stays in ⋯) → use the short private state, which is its first sentence only, e.g. "Private — you took over." → only with enlarged/accessibility text, wrap the meta to two lines and let the stage give up that line (≈184 px). The ≥200 px floor is checked at default text size, which matches the §6.3 budget (360−48−20−8−80 = 204). The 800×360 staff fixture row (line ~3962) says the same thing and adds "at default text size the meta fits on one line and stage ≥200". That assertion can pass. The example short state is a real string in the plan (§1 table, line ~1006, §6.5 "Public-page private" row), so builders have something concrete to copy. "Joe is watching." is still never truncated or hidden. |
| 2 | §10.2 and §12 Phase 2 pointed native at the phone-web copy | **Verified.** §10.2 "Native hand-off landing" (line ~3427) now names §6.4's **Native app** variant, quotes "Finish this in Safari on an iPad or computer. …" with [Open in Safari] [Don't finish] [Close], and rules out the Phone-web "Finish this on your iPad" line. Phase 2 (line ~3794) maps 800×360 Safari to Phone web and native on iPhone or iPad to the Native app variant. It also adds the check that the native screen never contains "on your iPad". |

## Whole-plan sweep

- **"on your iPad" strings.** Every remaining instance is a phone-web template: §5 lapse copy (~988), the §6.2 helper (~1179), the landscape phone column (~1496), §6.4 sign-in (~1848), the Phone-web invitation block (~2034), Paused (~2163), the unsupported portal (~2230/~2402) and the §6.5 public-Done row (~2295). The native shell never renders the Browser pane. It only gets Open in Safari landings (§10.2). So none of these can reach native.
- **Native hand-off copy.** §6.4 frame, §6.5 "Joe hand-off phone/native" row, §10.2, §12 Phase 2 and the native-iPad fixture row (~3963) all show the same sentence and button set. I found no conflicting reference.
- **Status-row order.** §6.3 meta (state · Joe is watching. · 2 windows), the §6.5 popup row ("meta adds '· 2 windows'"), the §6.5 owner-viewer row, §6.4's "display alongside, rather than replace, 'Joe is in control.'" (~1949) and the two 800×360 fixture rows all agree. No place puts "· 2 windows" before "Joe is watching." or leaves it out.
- **Appendix.** The "Design 2" row (~4342) still says "wrap, stage ≥200". That row is a historical record and the R7-1 row right below it replaces it. Builders work from §6.3 and the fixture table, which are both correct.

## Required to reach 10

None.

## Optional

- §6.4 Asked-to-finish list (line ~2060): "on a phone it shows the phone copy above" could say "the **Phone-web** copy above". There are now two labelled blocks. Native never renders this list, so this cannot cause a real failure.
- Appendix "Design 2" row: add "(superseded by R7-1)" so nobody reads the old "stage ≥200" wording as current.
- Carried over from rounds 6–7 and still taste only:
  - Cross-link the §6.5 "Staff, owner viewer present" row to the §6.3 landscape rule.
  - Use "an iPad" in staff copy.
  - Say where [Mark finished] [Didn't finish] go in the landscape right column.
  - Note in H3 that the Canvas <640 and Browser <600 rules are separate on purpose.
  - Wrap the 360 portrait staff status row (`min-h-11`) rather than truncating it.
