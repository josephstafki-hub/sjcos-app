# Autonomous Sweep — Progress Log

Newest entries at top. Each iteration appends one block.
Joe: this is your audit trail — every decision, park, and completion is recorded here.

---

## 2026-07-15 · P1-A2 — Replace model-specific labels with generic wording · **[x] DONE**

**Root cause — this was one line, not a hundred.** `lib/ai-name.ts` derived the label from
the provider env: `AI_NAME = provider === "ollama" ? "Qwen" : provider === "anthropic" ?
"Claude" : "AI"`. Prod runs Ollama, so every one of the ~12 `AI_NAME` interpolation sites
rendered the model's name — `Ask {AI_NAME}` in the Sidebar and the ⌘K pill literally read
**"Ask Qwen"**, which is Joe's exact example. `AI_NAME` is now a plain constant `"AI"`.
Kept as a constant (not inlined) because 12 call sites use it and a future rename should
stay a one-line edit. It must never be dynamic again — the dynamism *was* the bug.

**Heads-up: I found uncommitted WIP and built on it rather than discarding it.** The tree
had unattributed changes to 9 files (incl. the `ai-name.ts` rewrite above). It postdates the
`a132a8b` checkpoint of Joe's pre-existing WIP and isn't from the P1-A1 commit, so it is
almost certainly an earlier iteration of this loop that was interrupted before it could
record anything (P1-A2 was still `[ ]`). It was correct and on-target, so I kept all of it
and finished the job. **If that was actually Joe's own hand-written WIP, it's preserved
intact — nothing was reverted.**

**The judgment call — where model names must STAY.** Joe's item says "everywhere a model
picker/multiple models are available", so the line I drew is **role vs. identity**:
- **Role label → genericize.** Describes what the assistant *does* when the model behind it
  is interchangeable: "Ask AI", "Draft with AI", "AI is watching this channel".
- **Identity label → keep.** The user explicitly picked, or is picking, that named agent —
  genericizing here would actively destroy information. Kept: `AGENT_META`/
  `CLAUDE_MODEL_OPTIONS` in `lib/dev-agents-meta.ts` (that *is* the picker); every
  "Ask Claude…"/"Claude is planning" string in `AssistantChat.tsx` (verified — all gated on
  `agent === "claude"`); `@claude/@qwen/@hermes` mention tokens + sender maps; "Have Hermes
  do it" (Hermes is the only agent with MCP tools); agent-specific errors on agent-specific
  code paths (`qwenChat`'s "Qwen returned an empty response", `runClaude`'s "Claude timed
  out"); the Settings integrations row showing the *actually-configured* model — that one is
  telling Joe what's really connected, which is legitimate and stays dynamic.
- Also untouched: env vars, DB keys (`agent:'claude'`, `claude_session_id`), code
  identifiers, and `docs/*.md`.

**Two real bugs fell out of the sweep (not just wording):**
1. `lib/intake.ts:196` hardcoded the string `"Qwen"` as the `lead_activity` actor written to
   the DB, while the *identical* call in `lib/actions/leads.ts` (3 sites) used `AI_NAME`.
   Website-form leads were attributed differently from in-app ones. Now uses `AI_NAME`.
2. `lib/actions/dev-agents.ts:22` returned "The Claude run failed." from `pollAgentRun` —
   which its own header comment says is agent-agnostic. A **Qwen or Hermes** failure reported
   the wrong model. Now "The agent run failed."

**Fable's plan:** inventoried every hit across ~50 files, drew the role-vs-identity line
above with a per-file verdict, validated the existing WIP as sound, and flagged the two bugs.
I followed it, having independently verified its load-bearing claims (the `AI_NAME` sites,
the `agent === "claude"` gating, and that `NEXT_PUBLIC_AI_PROVIDER` now has zero readers).

**Fable's review verdict: PROBLEMS FOUND → fixed → now passing.** It caught a **real
regression I introduced**: I changed the chat participants stack from `"CL"` to `"AI"` in
`lib/chat.ts`, but the avatar *color* lookup lives in a different file
(`ChatClient.tsx:235`, `p === "CL" ? "ai" : "gray"`) — so the AI avatar in every channel
header would have silently rendered as a gray "everyone else" chip instead of the sage AI
one. Fixed the lookup to key on `"AI"`, plus the matching `"CL"` fallback at `lib/chat.ts:144`.
I confirmed no other consumer keys on `"CL"` for color (message avatars hardcode
`kind="gray"`), so the `@claude` sender map keeping `"CL"` initials is unaffected.

**Files changed (16):** `lib/ai-name.ts`, `lib/chat.ts`, `lib/intake.ts`, `lib/leads.ts`,
`lib/projects.ts`, `lib/settings.ts`, `lib/ai.ts`, `lib/inbox.ts`,
`lib/actions/dev-agents.ts`, `components/chat/ChatClient.tsx`,
`components/subs/SubNotes.tsx`, `components/automate/AutomateClient.tsx`,
`components/inbox/InboxClient.tsx`, `components/projects/ContractGenerator.tsx`,
`components/projects/MoneyPanel.tsx`, `components/settings/SettingsClient.tsx`

**Verify:** `npx tsc --noEmit` clean (exit 0) · `npm run lint` 0 errors (same 11 pre-existing
warnings as the P1-A1 baseline, none in files this diff touches). Final sweep grep confirms
every surviving model-name string maps to a documented KEEP. No build run, service/:3017
untouched.

**Decisions Joe should know:**
- **Old `lead_activity` rows still say "Qwen"** in the actor column and will display that in
  the Lead Activity tab next to new "AI" rows. I did **not** rewrite history — nothing reads
  or filters on the value (verified; it's display-only), and silently mutating historical
  records felt like Joe's call, not mine. One-time cleanup if you want it:
  `UPDATE lead_activity SET actor='AI' WHERE actor='Qwen';`
- **`NEXT_PUBLIC_AI_PROVIDER` is now dead** — zero readers after `ai-name.ts` stopped
  branching on it. Left `.env.local` alone (live config; harmless unused var).
- `docs/punchlist.md:86` records the *old* decision that the Automate page stays "Claude".
  Joe's blanket rule supersedes it; that line is now stale. Left as-is (docs out of scope).
- Settings "Claude & AI" section is now just "AI"; the integrations row shows the raw model
  id (`qwen2.5:7b-instruct`) instead of "Qwen · <model>".

**Still worth a human look:** reasoning is static (code-read + tsc + lint) — I can't serve the
branch without touching the running site. When served, check the sidebar/⌘K pill read "Ask
AI" and the chat channel header's AI avatar is sage-green, not gray.

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
