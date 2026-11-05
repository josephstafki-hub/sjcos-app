# Phone lines

Joe, 2026-11-05: show the number the app uses where it's easy to see; he will port
his Google Voice line into Telnyx later and wants to switch between the two. Also:
a number can be assigned to an employee's login, while client / lead / sub / supplier
information stays shared across every account ("summaries would be fine").

## The model (migration 0110)

- `phone_lines`: one row per number on the Telnyx account. Exactly one active row is
  the **main line** (`is_company_default`). A row with `assigned_user_id` is that
  person's **own line**. Each line can have texts and/or calls switched off, and its own
  voicemail greeting.
- `sms_threads` is one conversation per **(person, our number)**. `business_number`
  says which line it is on. A reply always goes out from the thread's line.
- With no rows, the env number (`SMS_FROM_NUMBER` / `VOICE_FROM_NUMBER`) is the main
  line, and the first Settings visit adds it as a row. The migration seeds it from
  the call and text records.

## Who uses which number

| What | Number |
|---|---|
| New text or call from a login with its own line | their line |
| New text or call from anyone else (owner, staff, agents) | main line |
| Reply in a text thread | the thread's line |
| HELP auto-reply | the line they texted |
| Website opt-in confirmation | main line |
| Inbound call to someone's own line | rings their cell (`users.phone`), else Joe's |
| Inbound text to someone's own line | their bell, not Joe's push |
| Voicemail on someone's own line | callback to-do assigned to them |

STOP / START and Block apply to the person on **every** line.

## Who sees what

- Owner: every line's texts and calls.
- Team member: the company lines plus their own line. Another member's own line is
  not listed, opened or counted for them (`lineVisibilityClause` in
  `lib/phone-lines.ts`; enforced in `/messages`, `/calls`, the Inbox's SMS channel
  and the mobile API).
- Everyone with the record's area: the **Calls & texts** card on lead, job, sub and
  vendor pages (`components/comms/RecordConversations.tsx`). It lists every line's
  conversations with a short summary: the AI call notes for calls, and for texts
  `sms_threads.summary`, written hourly by `refreshTextSummaries()` on the detector
  timer (Claude haiku, 1–2 sentences). A row opens the full conversation only for
  someone allowed to read that line; others never see the words from someone else's
  line, only the summary or counts.

## Switching to the ported Google Voice number

1. Port the number into Telnyx (Google Voice: unlock for transfer, transfer PIN).
2. In Telnyx put it on the SJC OS messaging profile, the Call Control app and the
   10DLC campaign.
3. Settings › Phone lines › Add a number, then **Check with Telnyx** (it reads the
   account, messaging profile, Call Control app and campaign assignment), then
   **Make main line**. Switch back the same way.

## Where the number shows

- Web: bottom of the left rail ("SJC phone line", plus "My line" for someone with
  their own; click to copy), the Messages and Calls page headers, each thread / call
  ("on Abigail's line").
- iPhone app: Inbox header, Settings › Calling, and the "Call …?" confirmation.
  Read from `GET /api/mobile/me` (`businessLine`, `myLine`).
