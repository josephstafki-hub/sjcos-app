# Autonomous Sweep — Progress Log

Newest entries at top. Each iteration appends one block.
Joe: this is your audit trail — every decision, park, and completion is recorded here.

---

## 2026-07-15 · P1-A1 — Bottom-of-page chrome loses green / account info invisible · **[x] DONE**

**What was actually wrong (it was not what it looked like).** There is no scroll listener,
no transparent-at-top pattern, no z-index fight anywhere in the app — the green never
"turned off". This was a plain layout/overflow bug:

- `Shell.tsx:55` framed every internal page as `flex h-screen bg-paper` with **no
  `overflow-hidden`**.
- `Sidebar.tsx:169` was `flex w-[232px] flex-none flex-col gap-1 bg-sidebar …` with **no
  `overflow-y-auto`**, but its content (logo + 3 section labels + 21 nav links + 2 dividers
  + Ask link + account row) is ~1000px tall — taller than essentially any laptop viewport.

So the bottom sidebar rows overflowed the `<nav>`'s box. CSS backgrounds only paint an
element's own box, so those rows rendered with **no green** on the cream `--paper` body.
The overflow also pushed the document's scroll height past `h-screen`, which is what made
the body scrollable in the first place: scrolling down slid the green box up and exposed
the overflowed rows. The account name/role are cream (`text-paper`) — **cream text on the
cream body = invisible**. That's the exact reported symptom, and it hit every one of the
26 pages that render `<Shell>`.

**Fix (3 files, all in `components/shell/`):**
1. `Shell.tsx` — frame is now `flex h-dvh overflow-hidden bg-paper`. `overflow-hidden`
   means nothing can extend the document height again, so the body can never scroll and the
   chrome can never slide out of view. `h-dvh` (Tailwind v4.3 built-in) also fixes the
   mobile case where `100vh` exceeds the visible viewport under the dynamic URL bar.
2. `Sidebar.tsx` — the link list now scrolls **inside** the green panel
   (`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto`, thin cream scrollbar). The logo,
   Ask link, and account row sit outside it as `flex-none` pinned chrome, so account info is
   visible at every viewport height. Deleted the old `<div className="flex-1" />` spacer —
   the flex-1 scroll area does that job, so when content fits the footer still bottoms out
   exactly as before. Added `flex-none` to nav rows/labels/dividers so they can't squash
   inside the new scroll container (the bare `h-px` dividers would otherwise collapse to 0).
3. `MobileNav.tsx:56` — drawer drops `overflow-y-auto` and gains `flex` so the now
   internally-scrolling Sidebar fills it. Side benefit: the close button no longer scrolls
   away with the drawer content.

**Fable's plan:** located the root cause precisely (sidebar taller than viewport + no
clipping on either the frame or the nav; confirmed zero scroll listeners exist), confirmed
the chrome is one shared component so a Shell+Sidebar fix covers every page, and specified
the three edits above.

**Fable's review verdict: PASSED, no blocking issues.** Verified no page relies on body
scroll (zero `window.scroll*`/`document.scroll*`/`position: sticky` in `app/` or
`components/`; the only `scrollTo` calls — `AssistantChat.tsx:85`, `TodayFeed.tsx:89` — are
ref-scoped to their own containers, and body scroll only ever happened *because of this
bug*). Confirmed the drawer's close button still positions correctly, `h-dvh` is safe, and
the account row stays visible even at a 400px-tall viewport (fixed chrome ≈145px). It
flagged ≤4px of cosmetic spacing drift from dropping `gap-1` off the nav — **fixed**, since
this item is itself a visual fix and shouldn't introduce new drift: spacer `pt-0.5`→`pt-1.5`
and account row `mt-1.5`→`mt-2.5` restore the original 24px logo→"Work" and 10px
Ask→account gaps exactly.

**Decisions Joe should know:**
- Added `pb-[max(0.125rem,env(safe-area-inset-bottom))]` to the account row so it clears the
  home indicator on notched phones. Low risk, no change on desktop.
- `h-screen`→`h-dvh` only on the Shell frame. Left login / client-portal / sub-portal on
  `h-screen` — they don't use Shell, already clip correctly, and aren't part of this item.
- Tailwind emits `100dvh` with no `vh` fallback, so Chrome <108 / Safari <15.4 would degrade.
  Judged negligible for an internal app.

**Files changed:** `components/shell/Shell.tsx`, `components/shell/Sidebar.tsx`,
`components/shell/MobileNav.tsx`

**Verify:** `npx tsc --noEmit` clean (exit 0) · `npm run lint` 0 errors (11 warnings, all
pre-existing in files this diff doesn't touch). No build run, service/:3017 untouched.

**Still worth a human look:** the reasoning here is static (code-read + tsc + lint) since I
can't serve the branch without touching the running site. Next time this branch is served,
shrink the window below ~1000px tall and scroll — the rail should stay green top-to-bottom
with the account row pinned, and the page itself should no longer scroll the body.

---
