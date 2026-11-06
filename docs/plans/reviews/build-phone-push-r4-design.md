SCORES: design=10 completeness=10

# Phone alerts — build round 4, DESIGN judge

Phone `sjcos-mobile` @ 5b1b883 (R3 fix = `git diff ac18de1 5b1b883`, one file: `src/components/alerts/alert-parts.tsx`). Backend `sjcos-app` @ 50cb82b1 (R3 fix = `git diff 9b4ba319 1152a759`).
I viewed all 22 PNGs in `~/qa-sjcos/mobile/shots/push-r4/` (01, 10 p1–p3, 20 p1–p10, 30 p1–p2, 31, 40 ×4, 42) and compared them with push-r3. I also re-read the refreshed payloads in `push-payloads-r1/` (dated Nov 5 14:48).
I ignored the seed markers (`[QA ee2c3d12]`, `qa-phone-seed asks:`, `long_multibyte_draft`, the "QA run <uuid>" text inside the seeded message), the dev-client gear and the Notify me switches (ruled out of scope). The iPad shots are carried over from R3 and run the older bundle, so I judged the iPad title fix from code.

**Verdict.** All six R3 required fixes are in, both on screen and in code. They were fixed the way I asked or better. Nothing left would stop a top-tier app from shipping this or lose anything Telegram did. What remains is optional polish (below).

## R3 required fixes — verified

| # | R3 fix | Status | Evidence |
|---|---|---|---|
| 1 | History chip fits its label and lines up with the text column | **Done** | `alert-parts.tsx:175-179` wraps the Chip in `chipLine: { flexDirection: "row", paddingLeft: 32 + space.sm + 4 }` (`:191`), which matches `iconBox` 32 + `rowMain` gap `space.sm + 4` (`list.tsx:561,563`). In 20 p7–p10 every chip ("On hold until 5:48 pm Central", Declined, Approved, Changes requested, Answered, Replaced) is a pill at its natural width, starting at x≈176 under the title/subtitle. The full-width bars are gone. |
| 2 | One-line titles don't get a 44pt box; the title block is the tap target | **Done** | `titleLink` was deleted. `<Pressable style={styles.head} disabled={!onOpenThread} accessibilityRole="link" accessibilityHint=…>` wraps CardTitle + time line (`:76-87`). `CardTitle` no longer has `onPress`/role. In 20 p1–p6 the time line sits right under the title on every card, and the target is title + meta (≥44pt). |
| 3 | Hold time in words; lowercase meridiem in "Expires" | **Done** | `0092_phone_push.sql` outcome CASE: today → `'FMHH12:MI am'`, otherwise → `'Mon FMDD "at" FMHH12:MI am'`. 20 p7/p8: "On hold until 5:48 pm Central". `cards.ts:194` adds `hour12:true` and lowercases AM/PM. 20 p4–p6: "Expires Thu, Nov 12, 1:48 pm Central". |
| 4 | "Read all" lines up with the body text | **Done** | `inlineLink: { alignSelf: "flex-start", marginLeft: -space.sm }` on Read all, the record link and "N replies". Plain buttons pad by `space.sm` (`button.tsx:106`), so the offset is exact. 20 p2/p4: "Read all" at x=81, body at x=81. |
| 5 | Stale permission nudge without machine words | **Done (code)** | `notify-owner.ts:639-663`: the query joins `to_jsonb(d)`. The app title is `Still waiting ${hours}h: ${decision.title}` (fallback "Permission to review"), and the body is `cardText(decision,{app:true})` minus line 1 (fallback `Why: …`). Both go in through `emit` and `telegram.appText`. `recordAppMessage` (`phone-push.ts:37`) prefers `appText`, so the phone never sees "claude asks to send_email (uuid)" or "Reason:". `decisionId` is now passed explicitly. Telegram keeps its own text. No grant-nudge payload was captured (`stale_approval.json` is the draft nudge), so this is judged from code. |
| 6 | No leading blank line in internal drafts | **Done** | `notify-owner.ts:419` adds the spacer only after To/Subject. `draft_approve_internal.json` body now starts "Review the internal…". 40_banner_draft_approve_internal shows two full lines of content. 20 p3 card shows no top gap. |

## Per-screen table

| Screen (shot) | Design | Completeness vs Telegram | Notes |
|---|---|---|---|
| Today (01) | 9.5 | n/a | Unchanged; approvals card with Approve & send. |
| Settings › Phone alerts (10 p1–p3) | 9 | 9.5 | Retry state clear. The doubled Telegram caption is still there (Optional 1). It only shows while Telegram is disconnected, which is not the production state. |
| Feed › Waiting on you (20 p1–p6) | 10 | 10 | Eyebrows, bodies, button sets and spacing are right. Read all lines up. The title block is the tap target with no dead space. |
| Feed › Today history (20 p6–p10) | 9.5 | 10 | Pills hug their labels and sit in the text column. Outcome words read cleanly, and the hold time is in words. Feed times use "PM" while the chip uses "pm" (Optional 4). |
| Thread › changes requested (30) | 9.5 | 10 | Right authors and sides, plain ack, Claude labelled. Joe's note shows twice (Optional 3). |
| Thread › portal (31) | 9.5 | 10 | Answered header, portal placeholder, footnote ack. |
| Banners (40 ×4) | 10 | 10 | Specific titles. Draft/decision banners show To + the first line. The internal draft has no wasted line. The portal banner shows the client's words. |
| Lock screen (42) | 9.5 | 10 | Stacks per alert, specific titles. In permission bodies, Message still comes before Subject (Optional 2). |
| Lock-screen actions / hidden previews / landscape iPad (code) | 9.5 | 10 | Unchanged since R3 and still right (`categories.ts` `_SEND` categories, `PREVIEW_PLACEHOLDER`, `SplitPane`). |

## REQUIRED fixes

None.

## Optional (carry forward; none blocks shipping)

1. **Settings caption** (`sjcos-mobile src/lib/push/settings-core.ts` `serverStatus`): when the "Telegram isn't connected, so alerts only come to the app." hint shows, drop the " · Telegram: not connected" segment (10 p2/p3). Drop "Phone alerts: set up on the server" when it is configured, because Joe can't act on it.
2. **Permission body order** (`sjcos-app lib/decisions/cards.ts:181`): sort `s.notes` so `Subject` comes before `Message`. The lock screen then reads To / Subject / Message (42, 20 p3). Today Postgres `jsonb` key order puts the message first and pushes the subject below the fold.
3. **Thread header duplicate** (30): in the full view, hide `outcomeNote` ("Changes requested: …") when its text equals a "you" reply already in the thread.
4. **Time case** (`sjcos-mobile src/lib/format.ts` `formatTime`): lowercase the meridiem ("1:48 pm"). The same screen now shows "1:48 PM" in the row and "5:48 pm" in its chip (20 p7), and threads show "You · 1:48 PM".
5. **Stale draft nudge spacing** (`stale_approval.json`, 20 p1 first card): the body runs "Subject: …\nHello…" with no blank line, but the original draft alert has one (20 p1 second card). Use the same `lines.push(...(lines.length ? [""] : []), body)` rule on the nudge path so both look the same.
6. **Press feedback on the card title block** (`alert-parts.tsx:76`): `style={({ pressed }) => [styles.head, pressed && { opacity: 0.6 }]}` so the new tap target visibly responds.
7. Portal title `Client B wrote in the client portal (Client A)` → `Client B · Client A job`. The parenthetical truncates in rows and banners (20 p9, 40).
8. `settings.tsx` "Notifications — Approvals, payments and mentions" → "Alerts and notifications — Everything SJC OS has sent you".
9. Hold 4 hours doesn't need device auth (it changes nothing irreversible; Telegram's Hold had no gate).

## Still uncaptured (judged from code, not blocking)

- The grant stale-nudge push (no payload in `push-payloads-r1/`). See R3 #5 above.
- Long-press action menus, hidden-preview lock screen, landscape iPad, registered-state Settings / test-alert arrival: code unchanged since R3 and correct.
