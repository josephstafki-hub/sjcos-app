# Autonomous Sweep — Progress Log

Newest entries at top. Each iteration appends one block.
Joe: this is your audit trail — every decision, park, and completion is recorded here.

---

## 2026-07-15 · P1-B1 — AI chat box in Projects/Leads/Warranties must accept file uploads · **[x] DONE**

**The good news: all three pages are one component.** The "AI chat box" on Projects, Leads,
and Warranties is the *same* `<CommandBar embedded />` (`components/cmdk/CommandBar.tsx`),
mounted at `app/projects/[slug]/page.tsx:461`, `app/leads/[slug]/page.tsx:289`, and
`app/warranty/page.tsx:35`. So this was one fix, not three — and the global ⌘K modal is the
same component too, so it got uploads for free.

**Heads-up: I again found uncommitted WIP and built on it rather than discarding it.** The
tree had unattributed changes to `CommandBar.tsx` adding a paperclip, chips, and the
`sendMessageAction` 5th-arg wiring. Same pattern as the P1-A2 entry below — almost certainly
an earlier interrupted iteration of this loop (P1-B1 was still `[ ]`). It was on-target, so I
validated it, fixed its bugs, and finished the job. **Nothing was reverted.** The whole
server side (`uploadChatFilesAction`, `sendMessageAction(..., attachments)`, the 25MB cap,
`sanitizeAttachments` path-traversal guard) already existed and was committed back in
`e9a155c` — only the client was missing.

**The WIP was copy-pasted from `AssistantChat.tsx` (/ai), and it copied four real bugs with
it.** That duplication *was* the bug, so I extracted the shared logic into a new hook,
`components/ai/useChatAttachments.ts`, and pointed both files at it. Fixed in one place:
1. **No `catch` around the server action.** A throw was an unhandled rejection — spinner
   stops, no error, file silently gone.
2. **One FormData for the whole batch.** `next.config.ts` sets
   `serverActions.bodySizeLimit: "25mb"` and the server's per-file cap is *also* 25MB — so
   two 15MB job photos summed past the limit and Next threw away the whole batch opaquely.
   Now one request per file, so a good file can't be lost to a bad neighbour. Note the two
   limits being equal means a file *at* the cap always throws inside Next before the action's
   own tidy error can run — hence the client-side pre-check that never POSTs an oversized file.
3. **Send didn't check `uploading`.** Pick a big photo, hit ↵ before it lands → the turn went
   without the attachment, no warning.
4. **Staged files lost on a failed send.** `setAttachments([])` ran optimistically; if
   `sendMessageAction` returned `!ok` the uploads were orphaned and had to be re-picked.

**Also added (cheap, and how people actually attach things):** paste-to-attach (screenshot →
⌘V straight into the box) on both, and drag-and-drop with a highlight on the CommandBar.

**Fable's plan:** confirmed the one-component insight, found bugs 1–4 with file:line, and
made the scope calls I adopted (below). I verified its load-bearing claims independently —
the mount points, the `bodySizeLimit`/per-file-cap collision, and that `AssistantChat`'s
`uploadFiles` was byte-identical to the WIP's.

**Fable's review verdict: PROBLEMS FOUND → both fixed → re-verified green.** It caught two
real concurrency bugs I introduced, both narrow but genuine:
1. **The restore clobbered mid-flight files.** Paste/drop aren't gated on `pending`, so Joe
   can stage a file *while* a turn runs. My `setAttachments(files)` restore would replace it
   with the send-time snapshot — and for a failed *text-only* send, `files` is `[]`, so it
   would wipe the new chip entirely. Now prepends: `setAttachments((cur) => [...files, ...cur])`.
2. **A paste during an in-flight upload was consumed and silently discarded** — exactly the
   failure class this item set out to fix. The root cause was that `uploading` was a
   *boolean*, which can't represent two overlapping uploads: it either rejects the second or
   lets the first one finishing re-open sending while the second is still going. Replaced
   with an in-flight **counter** (`uploadCount > 0`), so concurrent pastes both attach and
   the send guard stays honest.

**Decisions Joe should know:**
- **Uploads do NOT auto-file into the project's Files tab — deliberate.** Attaching a
  screenshot to ask a question isn't filing a project document; auto-filing would fill Files
  with chat ephemera. It's also not definable across the three pages: Warranty is a list page
  with no per-entity files surface at all. If you want it, the right shape is an explicit
  "Save to project files" action on a chip — say the word.
- **No file-type restriction.** Claude reads anything off disk; Qwen/Hermes degrade to
  "(binary file — not shown)". Restricting types would only remove capability.
- **Worth knowing: Hermes can't see images.** On these pages the agents are Claude + Hermes.
  Claude gets absolute paths and reads files itself; Hermes has no filesystem access, so the
  server inlines file *text* — an image inlines as "(binary file — not shown)". Photos are
  the likeliest upload on a Project/Lead, so **attach photos to Claude, not Hermes.** This is
  pre-existing server behavior (identical on /ai), not something this diff changed — but it's
  the one place "uploads work" has an asterisk. Flagging rather than fixing: giving Hermes
  vision is a real piece of work, not a slice of this item.
- Removed chips / agent switches orphan files under `uploads/ai-chat/` (gitignored). Pre-existing
  pattern, no cleanup anywhere in the app; left alone.
- Fixed one server-side inconsistency while in there: an attachment-only send persisted its
  body with leading `\n\n` (`lib/actions/ai-chat.ts`), which didn't match what the composer
  optimistically showed. Cosmetic, visible when reopening the thread in /ai.
- **`AssistantChat.tsx` (/ai) was not in scope** — the item names only Projects/Leads/
  Warranties, and it already had uploads. I touched it anyway because it carried the same
  four bugs in copy-identical code; leaving it would have meant fixing the bug once and
  leaving it live next door. Drag-and-drop on /ai deferred (paste + paperclip are there).

**Files changed (4):** `components/ai/useChatAttachments.ts` (new),
`components/cmdk/CommandBar.tsx`, `components/ai/AssistantChat.tsx`, `lib/actions/ai-chat.ts`

**Verify:** `npx tsc --noEmit` clean (exit 0) · `npm run lint` 0 errors (same 11 pre-existing
warnings, none in files this diff touches). No build run, service/:3017 untouched.

**Still worth a human look:** reasoning is static (code-read + tsc + lint) — I can't serve the
branch without touching the running site. When served, on a project page: paperclip a .txt →
chip appears → ask Hermes about its contents (exercises the inlining path); then paste a
screenshot and send to Claude (exercises the path-handoff path); drag a file onto the bar to
see the highlight.

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
