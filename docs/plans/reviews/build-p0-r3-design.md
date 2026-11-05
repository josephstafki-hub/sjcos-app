SCORES: design=8 completeness=7

# Build round 3 — Phase 0 — Design & UX judge

Branch `t3/in-app-browser-agent-tools` at `08f8561a` (UI fixes `bd4435b3`, server fixes `08f8561a`). Base for "today" = `e082956a`.

Evidence:
- `/home/joe/qa-sjcos/abc/shots/p0-r3-normal/` and `p0-r3-paused/`, each with its `p0r3-log.json`.
- Round 1/2 sets for comparison.
- Source at HEAD: `components/panel/ThreadList.tsx`, `PanelChat.tsx`, `askStatusCopy.ts`, `lib/thread-access.ts`, `proxy.ts`, `app/api/transcribe|tts/route.ts`, `lib/use-voice-available.ts`, `lib/use-tts-available.ts`.
- The Phase 0 handoff, context decisions 10–11, and the "Joe's words" memory.

## Round-2 REQUIRED items

| # | Item | Status |
|---|---|---|
| 1 | Empty copy while loading and in empty folders | **Fixed.** Every `…-history-immediate` shot reads "Loading chats…" with no groups: phone360/390, land800 and ipad820, as both people. The loaded shots show the real lists: Joe's Unfiled 2 + Settled (111) + job folders; Abigail's seed + Settled (2). `ThreadList.tsx:622–625` matches the spec. "Empty — start a chat here." is back at `:773`, inside the expanded-group branch (`:737`). It was not captured; see coordinator finding 3. |
| 2 | Unavailable chat wiped the whole list | **Fixed.** In the deep-link shots (1280 and phone360, both people) the viewer's own list stays. The log has `leakedTheirs:false` everywhere. |
| 3 | "Try again" on the unavailable notice; `c=` kept | **Fixed.** The composer line reads "This chat isn't available to this account." with no button. `addrHasC:false` everywhere. The reloaded shots show no notice (`noticeAfterReload:false`). The title is "New chat". |
| 4 | Composer buttons grew | **Fixed.** In the /today 420 dock at 1280 (fine pointer), Attach, Voice and Send are back to 28 px and match Sparkle and Mic, as on base. At 800×360 (touch) they are 44 px, as agreed, so about 12 px of transcript shows against 26 on base. The 800×360 squeeze is the pre-existing optional below. |
| 5 | Deploy note in builder words | **Fixed.** Item 3 is the agreed wording, with "0" from the Nov 4 dump and a recount required at deploy. The `?c=` recapture line is present. |

Round-2 optional items still open: the ⌘K "thread ·" dangling dot (still visible in both ⌘K shots), the panel Sign in link's `returnTo`, and the 800×360 settings rows. The archived-row trash item is now folded into REQUIRED 2.

## Coordinator findings — verdicts

1. **Expired session shows the paused sentence. Real bug, REQUIRED 1.**
   - The server mapping is correct: `lib/thread-access.ts:84` maps `ASK_SIGN_IN_REQUIRED` and redirect messages to `SIGN_IN_AGAIN`.
   - But a signed-out server-action POST never reaches it. `proxy.ts:167–179` sends every non-API path without a session to `/login` with a 307. The action client receives login HTML and throws a generic error, and `askCall` (`askStatusCopy.ts:29`) turns any unknown throw into `ASK_PAUSED`.
   - Result: Joe, signed out mid-chat, is told "Chats are paused while SJC OS checks its records. Try again in a few minutes.", and Try again can never fix it. He has no route to the Sign in link.
   - Seen in `owner-desk1280-session-expired.png`, in both the list and the composer.
2. **Delete is greyed and the sentence is invisible. Real bug, REQUIRED 2.**
   - `MenuItem` (`ThreadList.tsx:1018–1043`) puts `description` only in `title`, which is a hover tooltip and never appears on touch.
   - My round-2 table called it a description; it is not shown on screen.
   - The archived-row trash button (`:805`) has the same problem.
3. **Empty folder. Capture problem, not a bug.**
   - The shot clicked the folder **name**, which scopes the rail to the folder (chip "Tierney ×"). The folder stays collapsed, the same as on base.
   - The text renders only when the folder is expanded (`:737` → `:773`). Recapture by clicking the chevron (`aria-label="Expand"`) on an empty folder.
4. **Paused voice probes log 503 console errors on every page. Real issue, REQUIRED 3.**
   - `GET /api/transcribe` and `GET /api/tts` are availability probes, but they run through `askBoundary` and answer 503 when paused.
   - The browser logs that as a failed resource on every page with a mic or speaker, including /today. That breaks the zero-console-error bar the QA log relies on.
   - The probes already read `!r.ok` as `{available:false}`, so a 200 changes nothing on screen.
5. **Phone paused: a plain "Close Threads" text link. Real bug, REQUIRED 4.**
   - The failure branch (`ThreadList.tsx:529–535`) drops the whole header row ("Threads", New, ×). It adds an unstyled `Close Threads` text button in body ink, with "Threads" in title case, below Try again.
   - On phone the list covers the whole panel, so this text link is the only way out.
   - On desktop the rail also loses its "Threads" header (`*-desk1280-paused-composer.png`), so the column reads as a stray note.
6. **Pane-host registration shots deferred to Canvas Phase 1. Accepted, with conditions.**
   - Phase 0 registers nothing, so the strip, tabs, 839/840/1000 split, popout pane and Back to app cannot appear in this release.
   - The normal set confirms the chrome is unchanged where nothing is registered.
   - Conditions: Canvas Phase 1 build round 1 must carry the full capture list from the round-2 review as a **blocking** item. The Phase 0 handoff must not describe the host layout as visually verified. Add one line to the handoff saying so.

## Other observations from the captures

- **The unavailable state disables Attach** (`PanelChat.tsx:872`: `disabled={!!chat.failureCode || …}`). After a stale link the person is on a fresh New chat and may send, but cannot attach a photo, and nothing says why (`*-deeplink-other.png`, the faded paperclip). REQUIRED 5.
- **Paused, as seen on screen, is otherwise right:**
  - The sentence and Try again show in the list and the composer.
  - The typed draft stays ("QA draft that must stay"). Send and Attach are disabled.
  - ⌘K "Spaeth" still returns the project, lead, client and invoices.
  - No titles leak.
  - The /today dock still shows the queue narration above the paused line. That text is built locally from the queue (`lib/operator-narration.ts`), not a stored chat, so it is acceptable.
- **The phone "paused composer" shots show the thread list, not the composer.** History was still open from the previous step, so the phone draft and disabled Send were never seen on screen. `draftKept:true` comes from the DOM only.
- **The paused mic disappears app-wide.** The probe hides dictation in Team Chat and Inbox too, and caches `false` until reload. This is an engineering question (optional below).

## REQUIRED fixes

1. **Expired session must say "Sign in again to continue."**, with the Sign in link, in both the list and the composer.
   - `components/panel/askStatusCopy.ts:28`, `askCall` catch: before falling back to paused, ask the API, which the proxy never redirects. Use exactly:
     ```ts
     catch (error) {
       const known = askFailure(error);
       if (known) throw known;
       const signedOut = await fetch('/api/ai/status', { cache: 'no-store' }).then(r => r.status === 401, () => false);
       throw { ok: false, code: signedOut ? 'SIGN_IN_AGAIN' : 'ASK_PAUSED' } satisfies AskFailure;
     }
     ```
   - Only the 401 branch is used. That route answers 401 `SIGN_IN_AGAIN` for any signed-out request.
   - Do **not** let action POSTs bypass `proxy.ts`, because other app actions rely on it.
   - Recapture `owner-desk1280-session-expired` and a phone360 version.
2. **Show the not-ready sentence on screen, not only as a tooltip.**
   - `ThreadList.tsx:1042`, `MenuItem`: replace the single label span with
     `<span className="min-w-0"><span className="block truncate">{label}</span>{description && <span className="block text-meta text-ink-4 whitespace-normal">{description}</span>}</span>`.
     Keep `title` as well. The Delete row then reads **Delete** / **Chat deletion is not ready yet. Try again later.**
   - `ThreadList.tsx:805`, the archived-row trash: render the button only when `capabilities.deleteAvailable`. The ⋯ menu carries the sentence.
3. **Paused availability probes must not be HTTP errors.**
   - `app/api/transcribe/route.ts` `GET` and `app/api/tts/route.ts` `GET`: when the boundary returns a failure, answer
     `NextResponse.json({available:false, code:result.code}, {status:200, headers:{'Cache-Control':'no-store'}})`.
     POST keeps today's status codes.
   - Recapture the paused set and expect `errors: []` on every page.
4. **The failure list keeps its header, and the text link goes.**
   - `ThreadList.tsx:529–535`: render the same header row as the normal list: `<span className="text-label font-semibold text-ink-3">Threads</span>`, a spacer, and when `onClose` is set the existing × button with `aria-label="Close threads"` (the same markup as `:610–613`).
   - Put the sentence, Try again (or Sign in) and the deletion line below it in a `p-3` body.
   - Delete the `Close Threads` text button at `:534`.
   - Recapture paused History at phone360 and desk1280, as both people.
5. **A stale-link New chat can attach.**
   - `PanelChat.tsx:872`: `disabled={(!!chat.failureCode && chat.failureCode !== "THREAD_UNAVAILABLE") || chat.pending || uploading}`.
   - Choosing a file clears the unavailable line, the same as sending.
6. **Handoff line for the deferral (finding 6).**
   - Under "Next visual round" in `docs/plans/build/ask-pane-host-phase0-HANDOFF.md`, add exactly:
     > Pane-host layout (landscape strip, 839/840/1000 split, 1100 popout pane, 1280 expansion and Back to app) is not visually verified in Phase 0, because nothing registers a pane. These captures block Canvas Phase 1 build round 1.

## Next-round capture list

- Expired session mid-chat at 1280 and phone360: "Sign in again to continue." plus the Sign in link in the list and the composer, with the draft kept.
- Row ⋯ menu with deletion off, at 1280 and phone360: Delete greyed, with the sentence visible under it. The archived list has no trash button.
- An empty folder **expanded with the chevron**: "Empty — start a chat here."
- Paused, as both people at phone360 and desk1280:
  - History with the normal "Threads" header and ×, plus the sentence and Try again;
  - then **close History** and capture the composer with the kept draft and Send/Attach disabled;
  - log `errors: []`.
- Deep link `/panel?c=<other>` at 1280: Attach enabled. Pick a file and the unavailable line clears.
- The /today 900 sheet immediately after opening History: "Loading chats…". This is still missing; `dock900` here is the /panel popout.
- ⌘K stale result, still outstanding: open a chat result that was archived after the search, and expect the composer line with no button, the list intact.

## Optional

- ⌘K chat rows: "thread ·" has a dangling dot (`CommandPalette.tsx:77`). Render ` · {detail}` only when there is detail, and use the label "chat".
- The voice/tts probes cache `false` for the whole page life (`lib/use-voice-available.ts:13`, `lib/use-tts-available.ts:13`). After Try again recovers, the mic stays hidden until reload. Don't cache a `code: 'ASK_PAUSED'` answer.
- Engineering to confirm: should a paused Ask also hide dictation in Team Chat and Inbox? Only the availability check goes through `askBoundary`, and it reads no chat data.
- The 800×360 sheet transcript is nearly gone behind the settings rows. This is pre-existing. Fold the Model/Context/Mode row behind the settings toggle when height < 400.
- The panel Sign in link still drops the person on Today. Give it `returnTo` once /login has a matching notice.
