SCORES: design=8 completeness=9

# Phone alerts — build round 3, DESIGN judge

Phone `sjcos-mobile` @ ac18de1 (diff 70c9a28..ac18de1), backend `sjcos-app` @ 9b4ba319 (R2 fix 263c5260..0c879d50).
I read all 23 iPhone shots in `~/qa-sjcos/mobile/shots/push-r3/` and both iPad shots, compared them with push-r2, and read the 29 payloads in `push-payloads-r1/`.
I ignored the seed markers (`[QA a0abe1d7]`, `qa-phone-seed asks:`, `long_multibyte_draft` …), the dev gear and the Notify me switches (ruled out of scope).

**Verdict.** This round closes most of the gap. Lock-screen titles name the alert again. Bodies have no URLs, ids, `Status:` lines or `Grant id:` lines. Joe's note sits on the right as "You", the agent's answer is labelled "Claude", and the system acknowledgement is a centred footnote. The thread header reads "Answered" or "Changes requested". Eyebrows follow the category. "Open alert" is gone, and history rows now carry real outcome words (Approved / Declined / Replaced / Changes requested / Answered). The structure and copy now reach the bar.

What still holds it below 9 is visual polish that this round introduced, plus two server strings that still read like a machine:
- The history chip stretches into a full-width coloured bar.
- Card titles that fit on one line get a 44pt box, which leaves a gap under them.
- "On hold until Nov 05 04:46 pm".
- "Read all" sits out of line with the text above it.
- The stale-permission nudge says "asks to send_email (uuid)".
- Internal draft alerts start with a blank line.

## R2 required fixes — verified

| # | R2 fix | Status | Evidence |
|---|---|---|---|
| 1 | Real title on lock screen; drop "Approve:"; payment/contract name the job | **Done** | 40_*, 42; payloads have the record title; `apns.ts` passes `m.title`; "Payment received · Client A", "Contract signed · Client A". Live payment titles (`payments/owner-alert.ts:63` "Paid online: $X from who") were already specific. |
| 2 | No Telegram link, machine date, Status line | **Done** (one leftover; see Required 3) | `notify.ts:42,80` without `appUrl`; `cardText({app:true})` drops Status; "Expires Thu, Nov 12, 12:46 PM Central" (20 p4). The hold chip text is still machine-formatted. |
| 3 | No ids / bookkeeping labels | **Done** | 20 p3 permission: To / Message / Subject / Why / If approved; no Grant id; no "Approving does it now". Order nit in Optional. |
| 4 | Authors + plain agent/system words | **Done** | 30: "You" right (dark), centred ack in the new copy, "Claude · 12:46 PM" left. Agent push title is "Claude has a question". `from`/`agent_name` columns in 0092. |
| 5 | One reply affordance in thread | **Done** | 30, 31: composer only. |
| 6 | Thread header matches feed | **Done** | 31 "36 min ago · Answered"; `threadHeader()` in `feed.ts`. |
| 7 | Portal body without Telegram instructions | **Done** | 31, 40 portal banner: body is the client's words only. |
| 8 | History: chip under text, chevron, aligned time | **Partly** | Time column aligned (x≈670–795 every row), chevron on every row, titles get full width, "Decision" detail gone. **But the chip renders as a full-width bar starting under the icon** (Required 1). |
| 9 | Outcome words | **Done** | Approved / Declined / Replaced / Changes requested / Answered / On hold; fallback "Closed". |
| 10 | Eyebrow by category | **Done** | DRAFT TO SEND / DRAFT TO APPROVE / PERMISSION / DECISION (20 p1–p5). |
| 11 | Remove "Open alert"; title opens thread | **Done, with a regression** | Link gone; "1 reply" only when replies exist. `titleLink: { minHeight: 44 }` pads one-line titles (Required 2). |
| 12 | Still-waiting card says which draft + what Approve does | **Done for drafts** | 20 p1: To / Subject / body / "Approve sends this email now.", category SJC_DRAFT_SEND; real title is "Approval waiting Nh: <item title>". **The grant nudge was not touched** (Required 5). |
| 13 | Lock-screen "Approve & send"; one "Change…" verb | **Done** | `categories.ts:56-59` adds `SJC_DECISION_SEND`/`SJC_GRANT_SEND`; payloads carry them (permission_waiting, open_decision_email, history_approved). "Change…" everywhere. |
| 14 | Notify me switches | **Out of scope** (ruling) | — |
| 15 | Settings stuck state / status line / inset | **Done** | 10 p1–p2: "Couldn't reach Apple yet. Tap to try again." with the row retrying (`pressPhone`); switch shows on while `settingUp`; "Phone alerts: set up on the server"; Telegram hint; caption inset matches other footers (x≈47). Copy duplication in Optional. |

## Per-screen table

| Screen (shot) | Design | Completeness vs Telegram | Notes |
|---|---|---|---|
| Today card (ipad_01) | 9 | n/a | Unchanged and good. On iPhone the card is gone after allow, as expected. |
| Settings › Phone alerts (10 p1–p2) | 8.5 | 9 | Retry state clear; switch/subtitle agree. Caption says "Telegram … not connected" twice (Optional 1). |
| Settings › Quiet hours / On this phone (10 p2–p4) | 8.5 | 9 | Fine. "Notifications — Approvals, payments and mentions" rename still optional. |
| Feed › Waiting on you (20 p1–p5, ipad_02) | 8 | 9.5 | Bodies now read as plain words, button sets match Telegram per category, eyebrows right. Two problems: a gap under one-line titles on iPad (Required 2), and "Read all" indented 16pt from the body text (Required 4). |
| Feed › Today history (20 p5–p9) | 7 | 9 | Times aligned, chevrons consistent, outcome words right. Chips are full-width tinted bars from the icon edge to the trailing edge, so they read as progress bars or banners, not status chips (Required 1). "On hold until Nov 05 04:46 pm Central" (Required 3). |
| All notifications (25) | 8.5 | n/a | Pre-existing list; not part of this change. |
| Thread › changes requested (30 p1–p2) | 9 | 9.5 | Right authors, right sides, plain ack, Claude labelled, no duplicate Reply. The header card repeats Joe's note as "Changes requested: …" directly above his own bubble (Optional 3). |
| Thread › portal (31) | 9 | 9.5 | "Answered" header, You bubble, "Posted in the portal for Client B." footnote, portal placeholder. Parenthetical title still optional. |
| Banners (40 ×3) | 9 | 9.5 | Titles name the alert. The draft banner shows To + Subject and the portal banner shows the client's words. |
| Lock screen (42) | 8.5 | 9 | Specific titles; per-alert stacks (thread-id per approval). The permission body puts "Message:" before "Subject:", so the subject drops below the fold (Optional 2). An internal draft starts with a blank line (Required 6). |
| Lock-screen action sets (code) | 9 | 9.5 | `_SEND` categories say "Approve & send"; "Change…" everywhere; decisions/grants offer Approve / Change… / Hold like Telegram's keyboard. Device-auth only (Joe ruling). |

## REQUIRED fixes

1. **History chip: hug its label and line up with the text column, not the icon** (phone).
   `src/components/alerts/alert-parts.tsx` AlertRow children: `{state ? <Chip … /> : null}` renders inside `styles.children` (`src/components/ui/list.tsx:579`). That View stretches its child (default `alignItems: stretch`) and starts at the row's left padding, under the icon. The result is the full-width green/red/grey bars in 20 p7–p9.
   Change it to:
   ```tsx
   {state ? (
     <View style={styles.rowChip}>
       <Chip label={state.label} tone={state.tone} size="sm" />
     </View>
   ) : null}
   // styles
   rowChip: { flexDirection: "row", paddingLeft: 32 + space.sm + 4 }, // iconBox width + rowMain gap
   ```
   The chip then sits under the title/subtitle at its natural width, the way the "1 reply" detail line does.

2. **One-line card titles must not reserve 44pt** (phone).
   `alert-parts.tsx` `titleLink: { minHeight: 44, textAlignVertical: "center" }`: `textAlignVertical` is Android-only, so on iOS the text sits at the top and the empty space falls between the title and "11 min ago". ipad_02 shows it on every card. On iPhone it will show on any real title short enough to fit on one line (seed titles are long, which hides it).
   Fix: delete `titleLink`. Make the whole `styles.head` block (title + time line) the pressable target instead, which is naturally ≥44pt:
   - wrap `<View style={styles.head}>` in `<Pressable accessibilityRole="link" accessibilityHint="Opens the alert and its conversation" onPress={onOpenThread ? () => onOpenThread(m) : undefined} disabled={!onOpenThread}>`;
   - remove `onPress`/`accessibilityRole` from `CardTitle`.

3. **Hold time in words** (backend). `db/migrations/0092_phone_push.sql` (the outcome CASE, `to_char(d.held_until AT TIME ZONE 'America/Chicago','Mon DD HH12:MI AM')`) produces "On hold until Nov 05 04:46 pm Central" (20 p7).
   Change the format to `'Mon FMDD "at" FMHH12:MI am'`. The chip then reads "On hold until Nov 5 at 4:46 pm Central".
   Better: when `held_until` is today in Central, use `'FMHH12:MI am'` alone ("On hold until 4:46 pm"). The phone's `holdLabel` (`src/lib/push/actions.ts`) already passes non-ISO text through.
   While there, `lib/decisions/cards.ts` app `Expires …`: add `hour12: true` and lowercase the meridiem (`.replace(/\b(AM|PM)\b/g, s => s.toLowerCase())`). It then matches the house "9 pm" style used two lines away in Settings ("9 pm to 7 am") and in the hold chip.

4. **"Read all" aligned with the text it expands** (phone). The R2 swap to `<Button variant="plain" size="sm">` brings `px: space.md` padding (`src/components/ui/button.tsx:32`). The label now sits 16pt right of the body's left edge (20 p2, p3; ipad_02 "Read all" at x=124 vs body x=116).
   Pass `style={{ alignSelf: "flex-start", marginLeft: -space.md }}` to that Button (and to the `recordLabel` / "N replies" buttons in `styles.links`, which have the same inset). The tap target stays the same and the text lines up.

5. **The stale permission nudge still shows machine words on the lock screen** (backend). `lib/notify-owner.ts:654`:
   `title: \`Grant request waiting ${grant.hours}h: ${grant.requested_by} asks to ${grant.actions[0] ?? "?"}${grant.target_id ? \` (${grant.target_id})\` : ""}\``
   This renders e.g. "Grant request waiting 6h: claude asks to send_email (3f2a9c…uuid)", with a body "Reason: …". It loses what R2 #3/#12 fixed for every other card, and it is the one alert Joe sees after ignoring a permission for 4 hours.
   - Join the pending decision's `title` in the query (`d.title`) and use `title: \`Still waiting ${grant.hours}h: ${d.title}\``.
   - Use `body: cardText(decision, { app: true }).split("\n").slice(1).join("\n")` (same as `announceDecision`), or at least `Why: ${grant.reason}`, not "Reason:".
   - Pass `telegram.appText` the same way `notify.ts:58` does, so Telegram keeps its own text.

6. **No leading blank line in internal draft alerts** (backend). `lib/notify-owner.ts:418`: `if (draft?.body) lines.push("", draft.body.slice(0, 1200));` When there is no To/Subject (internal drafts), the body starts with `\n`. See payloads `draft_approve_internal.json` and `history_declined*.json`: `'\nReview the internal…'`. On the lock screen and in Notification Center that wastes one of the four preview lines.
   Change it to `if (draft?.body) lines.push(...(lines.length ? [""] : []), draft.body.slice(0, 1200));`.

## Optional

1. Settings caption (`src/lib/push/settings-core.ts` `serverStatus`): when the hint line shows, drop the "· Telegram: not connected" segment so the same fact isn't said twice (10 p2). When everything is configured, "Phone alerts: set up on the server" can go entirely. It describes the server, and Joe can't act on it.
2. Permission body order: Postgres `jsonb` sorts keys (shorter first, then alphabetical), so `message` lands before `subject` (20 p3, 42). In `cardText` sort `s.notes` with `["Subject","Message"]` first. Then the lock screen shows "To / Subject / Message…" and the subject isn't pushed below the fold.
3. Thread header (30): in the full (thread) view, hide `outcomeNote` when it equals the text of a "you" reply in the thread. Today Joe's note shows twice, stacked: once as "Changes requested: …" in the card and once as his own bubble.
4. Feed times "12:46 PM" vs the app's lowercase "pm" elsewhere. Use the house format in `formatTime`.
5. Portal title `Client B wrote in the client portal (Client A)` → `Client B · Client A job`: the parenthetical reads like another person, and it truncates in rows and banners.
6. `settings.tsx` "Notifications — Approvals, payments and mentions" → "Alerts and notifications — Everything SJC OS has sent you".
7. Hold 4 hours needn't require device auth (it changes nothing irreversible; Telegram's Hold had no gate).

## Still uncaptured (judged from code, not blocking)

- Hidden-preview lock screen: `categories.ts` registers every category with `showTitle:false`, `showSubtitle:false` and the `PREVIEW_PLACEHOLDER` text ("Needs your OK", "A draft to approve", "New message").
- Long-press action menus: code above.
- Landscape iPad: `SplitPane` + `useKeepSelectionOnRotate` unchanged since R1.
- Registered-state Settings and test-alert arrival: sim can't get a token. Code: `phone.registered` gates the test row.
