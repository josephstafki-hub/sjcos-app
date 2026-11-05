# Mobile communications

All requests require `Authorization: Bearer <session JWT>`. Send no cookies.
Reads require `inbox`, `comms` (SMS/calls), or `chat` access as indicated by path.
Writes use the shared RPC dispatcher and existing web actions; grants, mailbox
scope, record checks, and scheduled-to-do rules remain authoritative. SMS sends
and call placement require Comms access: the phone click runs the same single-use-grant
creation/spend as the web. Chat sends park outward portal deliveries for approval;
posting never releases them.

All errors are `{ error: string }`: 400 invalid input/web refusal, 401 invalid
session/conflicting identity, 403 access denial, 404 missing record, 500 unexpected
failure (generic text). Missing provider credentials produce clean errors, not a
successful send. GETs have no body. RPC bodies reject unknown fields.

## Exact response types

Imports below refer to the backend repository. These aliases are exact canonical
web types, not approximate mobile copies; optional fields remain optional. IDs
are strings except SMS numeric thread/message IDs. Dates are ISO strings or null
except explicitly documented web fields (`InboxData.when`, `SmsMessage` status,
etc.). `allowedActions` contains the exact RPC action names available to the
viewer (or `open` for a call). Money in context is integer cents; `moneyDisplay`
provides corresponding USD strings and is null whenever money access is absent.

```ts
import type { InboxData, MailboxState } from "@/lib/inbox";
import type { InboxDirectoryEntry } from "@/lib/inbox-directory";
import type { SmsThreadSummary, SmsMessage } from "@/lib/sms";
import type { CallRow, getCallEvents } from "@/lib/voice";
import type { emailCard, emailDetail, chatMessages, linkedRecord } from "@/lib/mobile-rpc/comms-reads";
import type { sendReplyAction, sendNewEmailAction, draftReplyAction } from "@/lib/actions/inbox";
import type { createWorkItem } from "@/lib/actions/engine";
import type { createLeadFromInbox } from "@/lib/actions/leads";
import type { sendSmsReply, startSmsThread, markSmsThreadRead } from "@/lib/actions/sms";
import type { placeCallAction } from "@/lib/actions/calls";
import type { sendChatMessage } from "@/lib/actions/chat";
type ApiError = { error: string };
type RpcResponse<T> = { ok: true; result: T } | { ok: true; redirect: string } | ApiError;
type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;
type EmailCard = ReturnType<typeof emailCard>;
// {id,from,fromEmail,subject,snippet,unread,time,status,label,record,todos,allowedActions}
type EmailDetail = Awaited<ReturnType<typeof emailDetail>>;
// {thread:EmailCard,messages:{id,from,fromEmail,to,cc,time,body,outbound,
// attachments:{id,name,size,type,url:string|null}[]}[],context,replyTarget,moneyDisplay}
// context is the exact InboxContext from lib/inbox-context.ts; moneyDisplay is
// Record<string,string>|null. body is plain text; no HTML fetch is performed.
type EmailViews = {
  views: { id: string; label: string; unread: number }[];
  countsScope: string; mailbox: MailboxState; allowedActions: string[];
};
type EmailThreads = {
  threads: EmailCard[]; nextCursor: string | null;
  emailPaused: boolean; lastSyncedAt: string | null;
};
type RecordSearch = { records: InboxDirectoryEntry[] };
type LinkedRecord = ReturnType<typeof linkedRecord>;
type SmsList = {
  threads: (SmsThreadSummary & {name:string;lastMessage:string|null;
    record:LinkedRecord;allowedActions:string[]})[];
  configured:boolean;allowedActions:string[];
};
type SmsDetail = {thread:SmsThreadSummary;name:string;record:LinkedRecord;
  messages:(SmsMessage & {label:string;statusLabel:string})[];allowedActions:string[]};
type CallList = {
  calls:(CallRow & {label:string;statusLabel:string;name:string;record:LinkedRecord;
    recordingUrl:string|null;allowedActions:string[]})[];
  configured:boolean;allowedActions:string[];
};
type CallDetail = {call:CallRow;events:Awaited<ReturnType<typeof getCallEvents>>;
  name:string;record:LinkedRecord;statusLabel:string;
  label:string;recordingUrl:string|null;allowedActions:string[]};
// CallRow includes transcript, notes_text, and notes:{summary,
// decisions:{text,by}[],action_items:{text,owner,due}[],flags:{kind,text}[]}|null.
// decisions represent decisions/commitments, action_items are the call's to-dos.
type ChatRooms = {rooms:{id:string;name:string;kind:string;label:string;unread:number;
  lastMessage:{id:string;body:string;time:string}|null;allowedActions:string[]}[]};
type ChatMessages = Awaited<ReturnType<typeof chatMessages>>;
// {roomId:string,messages:MobileChatMessage[],hasMore:boolean,
// nextBefore:string|null,nextAfter:string|null,allowedActions:string[]}
type MobileChatMessage = {id:string;name:string;initials:string;body:string;
  kind:string;label:string;time:string;mine:boolean};
```

## Reads

| Method | Path (query parameters) | Exact success type |
|---|---|---|
| GET | `/api/mobile/inbox` | `InboxData` (shipped compatibility response) |
| GET | `/api/mobile/inbox/views` | `EmailViews` |
| GET | `/api/mobile/inbox/threads?view=inbox&cursor=<token>` | `EmailThreads` |
| GET | `/api/mobile/inbox/threads/<id>?view=inbox&cursor=<token>` | `EmailDetail` |
| GET | `/api/mobile/inbox/records?q=<text>&sender=<email>` | `RecordSearch` |
| GET | `/api/mobile/inbox/attachment?thread=<id>&message=<id>&attachment=<id>&download=1` | binary with Content-Type/Content-Disposition |
| GET | `/api/mobile/sms` | `SmsList` |
| GET | `/api/mobile/sms/<positive integer>` | `SmsDetail` |
| GET | `/api/mobile/calls` | `CallList` |
| GET | `/api/mobile/calls/<uuid>` | `CallDetail` |
| GET | `/api/mobile/calls/<uuid>/recording` | audio bytes, using existing `serveFile` response |
| GET | `/api/mobile/chat/rooms` | `ChatRooms` |
| GET | `/api/mobile/chat/rooms/<encoded room id>/messages?limit=50&before=<id>` | `ChatMessages` |
| GET | `/api/mobile/chat/rooms/<encoded room id>/messages?limit=50&after=<id>` | `ChatMessages` |

`view` defaults to `inbox`; accepted values: `inbox`, `needs_reply`,
`awaiting_them`, `snoozed`, `done`, `unread`, `starred`, `sent`, `spam`, `trash`,
and `label:<Gmail label id>`. Smart views filter the current loaded email page;
continue following `nextCursor` even if a filtered page is empty. System/label
views use the web's cached view loader. Pass the **same input cursor and view**
that returned a row when loading detail or creating a to-do/lead from it. A
thread outside that page returns 404, never an extra full Gmail thread fetch.
A stale cache/page may require refetching the list.

Unread counts are explicitly scoped to the loaded email page, not global Gmail
unread totals. They never trigger additional Gmail count/thread calls. Reads
reuse the web's quota-controlled cached loaders and last-good snapshots; no
mobile poll invalidates caches. Opening a detail does not mark email/SMS read.
Attachment bytes are fetched only when explicitly requested. Attachment URLs
and recording URLs require the bearer header, never a cookie or public token.
Recording access preserves the web `/api/files` Projects gate and restricted
Sub-document check in addition to Comms access. `recordingUrl` is null without
Projects access. No credentials/connection failures leak provider stack traces.

Calls list is the same latest 150 window as web. SMS lists all web-visible
threads; lastMessage is the latest stored text. Both use web record resolution.
SMS `optedOut` and `blockedAt` control send availability.

Chat room ids contain colons; URL-encode the whole id. Channel/job/DM visibility
and unread counts come from `getChatData(chatViewerFor(user))`, including staff
membership and DM-party privacy. Archived rooms are excluded. Messages are
returned oldest first within each page. `limit` is 1–100 (default 50). Initial
GET returns the newest page; use `nextBefore` for older messages and `nextAfter`
to poll new arrivals. `after` and `before` are mutually exclusive numeric string
message IDs. For `after`, `hasMore` means more new messages remain: advance to
`nextAfter` until caught up. Empty polls retain the supplied `after`. IDs are
stable database message IDs, not display indexes. No SSE/WebSocket needed for v1.
Mark read explicitly via RPC when the room or SMS detail is on screen.

## Writes

Each row is `POST /api/mobile/rpc/<action>` with the exact JSON body below.
All return `RpcResponse<T>`; void web results become `null`. Web refusals are
unwrapped into `{error}`, not returned as `result.ok:false`.

| Action | JSON body | T (success result) |
|---|---|---|
| `inbox.archive` | `{threadId:string}` | `{ok:boolean;error?:string}` |
| `inbox.done` | `{threadId:string}` | `{ok:boolean;error?:string}` |
| `inbox.undoDone` | `{threadId:string}` | `{ok:boolean;error?:string}` |
| `inbox.reply` | `{threadId:string;body:string;toEmail?:string;subject?:string;replyAll?:boolean}` | `Awaited<ReturnType<typeof sendReplyAction>>` |
| `inbox.compose` | `{to:string;subject:string;body:string;cc?:string}` | `Awaited<ReturnType<typeof sendNewEmailAction>>` |
| `inbox.draft` | `{threadId:string;model?:"qwen"\|"hermes"\|"claude";intent?:string}` | `Awaited<ReturnType<typeof draftReplyAction>>` |
| `inbox.link` | `{threadId:string;type:"lead"\|"project"\|"sub"\|"vendor";slug:string}` | `{ok:boolean;error?:string}` |
| `inbox.createTodo` | `{threadId:string;view?:string;cursor?:string;title:string;body?:string;dueAt?:string}` | `Awaited<ReturnType<typeof createWorkItem>>` |
| `inbox.createLead` | `{threadId:string;view?:string;cursor?:string;name:string;scope?:string;phone?:string}` | `{slug?:string}` |
| `sms.send` | `{threadId:number;body:string}` | `Awaited<ReturnType<typeof sendSmsReply>>` |
| `sms.new` | `{phone:string;body:string;contactName?:string;link?:{type:"lead"\|"project"\|"sub"\|"vendor";slug:string}}` | `Awaited<ReturnType<typeof startSmsThread>>` |
| `sms.read` | `{threadId:number}` | `{ok:boolean}` |
| `calls.place` | `{phone:string;contactName?:string}` | `Awaited<ReturnType<typeof placeCallAction>>` |
| `chat.send` | `{roomId:string;body:string}` | `Awaited<ReturnType<typeof sendChatMessage>>` |
| `chat.read` | `{roomId:string}` | `null` |

Email Done is archive, Undo Done restores INBOX, exactly as web. Email writes
run in the signed-in user's mailbox (staff never act on the owner's mailbox).
CreateTodo additionally requires Engine access and a real message id from the
cached reader; it uses the web email-obligation association/deduplication path.
`dueAt` is `YYYY-MM-DD` and the scheduling trigger applies unchanged. CreateLead
requires Leads access, uses the email's sender address, then links the new lead.
This is two existing web actions, not an atomic transaction. New SMS links the
thread after a successful send; failures retain the web's failed thread.
`calls.place` rings the calling user's cell first, then the counterparty (see r9 below).

Nonempty body/title/name values trim whitespace and are capped at 20,000 chars;
thread IDs are `[-A-Za-z0-9_]`, up to 512 chars. Email subject/recipient fields
are capped at 2,000 chars (compose `to` at 20,000); intent at 200. Phone input
is at most 100 chars, contactName at 300, record slug at 200. View at 600,
cursor at 2,000, chat room id at 300. SMS thread IDs must be positive integers.

## Existing compatibility POSTs

These still return their shipped success shape, and now reuse web actions:

| Method/path | JSON body | Exact success |
|---|---|---|
| POST `/api/mobile/inbox/reply` | `{threadId:string;toEmail:string;subject:string;body:string;replyAll?:boolean}` | `{ok:true}` |
| POST `/api/mobile/inbox/compose` | `{to:string;subject:string;body:string;cc?:string}` | `{ok:true}` |
| POST `/api/mobile/inbox/draft` | `{threadId:string;model?:"qwen"\|"hermes"}` | `Omit<Awaited<ReturnType<typeof draftReplyAction>>, "ok">` |

Use the RPC endpoints for new clients. Compatibility endpoints tolerate unknown
keys and return the same `{error}` failures. Compatibility draft defaults to
Qwen, as before; RPC draft follows the web action's default (Hermes).

Web-only omissions: keyboard shortcuts, sender preference/screening rules,
channel creation, room participant management, room archiving. Outbound files use the multipart endpoint below; JSON write bodies stay unchanged.
Forwarding original attachments remains web-only. See r9 for the users schema addition.

## Verification and handoff

Shared-lock TypeScript check: no errors under the owned paths. Existing
`node --test tests/mobile-rpc.test.mjs`: eight passed. No server, browser,
provider send, database mutation, build, commit, or push was run for verification.
Coordinator should HTTP-smoke bearer reads, staff mailbox/DM isolation, missing
credential write failures, attachment download and recording playback against
the QA production preview. Email unread counts are page scoped; a mailbox-wide
unread total would need a separate quota-aware web helper and is not inferred.


# Backend r3 updates (supersede corresponding definitions above)

Full cross-area contract: [backend-r3.md](backend-r3.md).

## Email

GET `/api/mobile/inbox/threads/[id]?view=...&cursor=...` now resolves the ID in the
caller's mailbox directly using the shared cached Gmail loader + web thread mapper.
The compatible view/cursor parameters are accepted but do not constrain detail lookup.
No list-page or label-count requests are added. Attachment authorization is unchanged.
Link/create-to-do/create-lead resolve that same authoritative source, not a list page.
Thread cards additionally include `starred:boolean`, and advertise inbox.star/inbox.read.

POST `/api/mobile/rpc/inbox.star`: `{threadId:string;starred:boolean}`.
POST `/api/mobile/rpc/inbox.read`: `{threadId:string;read:boolean}`.
Both require Inbox, wrap existing mailbox actions and return `{ok:true}` on success.

## Received MMS

GET `/api/mobile/sms/[id]` messages retain `media` and extend each entry:
```ts
type SmsMedia = {file_id:string;mime:string;name:string;size:number;
 mimeType:string;fileName:string;url:string};
```
GET `/api/mobile/sms/[id]/media/[fileId]` serves bytes with Comms authorization **and**
checks that the file belongs to a message in that thread. URLs support the shared file
handler's thumbnail/download parameters. Projects access is unnecessary. MIME and file
name come from stored metadata; use the same bearer token to fetch media.

## Backend r9 — staff sends, caller cell, email uploads (2026-11-04)

These rules supersede earlier owner-only/fixed-owner-cell descriptions. All routes
require a bearer session; writes reject a conflicting cookie identity. No other
owner-only action changed (invoice send, file publish, first-response send, settings).

### Updated existing actions and read fields

| POST path | Exact JSON input | Exact success response | Access |
|---|---|---|---|
| `/api/mobile/rpc/sms.send` | `{threadId:number;body:string}` | `RpcResponse<Awaited<ReturnType<typeof sendSmsReply>>>` | Comms |
| `/api/mobile/rpc/sms.new` | `{phone:string;body:string;contactName?:string;link?:{type:"lead"\|"project"\|"sub"\|"vendor";slug:string}}` | `RpcResponse<Awaited<ReturnType<typeof startSmsThread>>>` | Comms |
| `/api/mobile/rpc/calls.place` | `{phone:string;contactName?:string}` | `RpcResponse<{ok:boolean;callId?:string;error?:string}>` | Comms |
| `/api/mobile/rpc/projects.portal.send` | `{slug:string;body:string}` | `{ok:true;result:null}` | Projects |
| `/api/mobile/rpc/leads.portalMessage` | `{slug:string;body:string}` | `{ok:true;result:null}` | Leads **and** Projects |

All also return `ApiError` on failure. Existing field validation is unchanged.
SMS and calls still invoke the existing web actions and their grant paths. Portal
posts still use the existing portal actions and delivery approval rules.

The existing `allowedActions:string[]` fields change as follows (no renamed fields):

- GET `/api/mobile/sms`: top-level includes `sms.new` for Comms users; each thread
  includes `sms.send` when neither `optedOut` nor `blockedAt` is set, plus `sms.read`.
- GET `/api/mobile/sms/[id]`: same per-thread send/read rule.
- GET `/api/mobile/calls` and `/api/mobile/calls/[id]`: includes `calls.place` for Comms users.
- GET `/api/mobile/projects/[slug]`: includes `projects.portal.send` for Projects users.
- GET `/api/mobile/leads/[slug]`: includes `leads.portalMessage` for users with both areas.

### GET `/api/mobile/me`

No body or area permission; only logged-in staff/owner. Exact response:

```ts
import type { CurrentUser } from "@/lib/dal";
type MeResponse = {
  user: CurrentUser; // {id,email,name,role,initials,linkSlug,permissions}
  callPhone: string | null; // stored users.phone, normalized +1 E.164
  callPhoneFormatted: string | null; // e.g. "(612) 555-1234"
  // Settings › Phone lines (0110). The company's main line clients see, and
  // this login's own line when one is assigned to it. Show them where people
  // look for "what number do I text from".
  businessLine: LineBadge | null;
  myLine: LineBadge | null;
} | { error: string };
type LineBadge = { number: string; formatted: string; label: string }; // number is +1 E.164
```

Texts and calls go out from `myLine` when set, else `businessLine`; a reply stays on
the line its thread is on (`SmsThreadSummary.businessNumber`). Threads and calls on
another team member's own line are not returned to a staff login.

`callPhone` is the stored personal setting, not the owner's fallback number. Null
means unset, including for an owner who can still call using the configured fallback.
401 missing/invalid session, 403 portal roles, 500 unexpected failure.

### POST `/api/mobile/rpc/me.callPhone`

No area permission; only logged-in staff/owner. Dedicated RPC route (the shared
area-gated dispatcher and registry are unchanged). Exact JSON and response:

```ts
type CallPhoneInput = { phone: string | null };
type CallPhoneResponse =
  | { ok: true; result: { phone: string | null } }
  | { error: string };
```

Required `phone`, no other keys. A string is at most 100 characters and uses the
shared US `normalizeE164` validator: `(612) 555-1234` becomes `+16125551234`.
Empty/invalid/non-US numbers return 400; `null` clears it. Only the authenticated
user's row is updated. 401 invalid/conflicting identity, 403 portal roles, 500
unexpected failure. This endpoint writes through the website database login;
there is no new permission for narrow database logins to write users.

Migration: `db/migrations/0073_users_call_phone.sql`, adds nullable `users.phone`
with a normalized US E.164 check. No new table, trigger, worker/MCP write path or
role grant; the existing DB role manifest stays unchanged.

Web/mobile call placement passes the authenticated caller to `placeCall`:
owner uses their stored cell or, if null, existing `cfg.forwardTo`; staff uses
their stored cell. Missing staff cell returns exactly:
`{error:"Add your cell number in Settings to call from the business line."}`
through RPC (HTTP 400). The own-cell guard compares the recipient with the
selected caller cell. That cell is stored in `calls.owner_number` and in the
initial dial intent. Normalization, grant validation/spending and call flow stay
on the existing path. Legacy granted agent calls without a human caller retain
the configured owner bridge.

### POST `/api/mobile/inbox/send`

Bearer plus Inbox access. `Content-Type: multipart/form-data; boundary=...`;
let the HTTP client generate the boundary. Exact fields:

```ts
type EmailSendFields = {
  mode: "new" | "reply" | "replyAll";
  threadId?: string; // required for reply/replyAll; [-A-Za-z0-9_], max 512
  view?: string; // max 600; accepted for client context, not used for sending
  to: string; // max 20,000; new requires nonblank; replies may use "" for web target
  cc?: string; // comma-separated, max 2,000
  subject: string; // max 2,000; replies retain the web's threaded subject behavior
  body: string; // trimmed nonempty, max 20,000
  files?: File[]; // zero or more repeated multipart parts named "files"
};
type EmailSendResponse = { ok: true } | { error: string };
```

`new` calls `sendNewEmailAction`; `reply`/`replyAll` calls `sendReplyAction` with
`replyAll:false`/`true`. The original FormData reaches `outgoingAttachments` in
those actions. Files use the exact web limits: at most 50 files, combined raw
size at most 20 MiB, JPEG/PNG/GIF/WebP/HEIC/HEIF, PDF, DOC/DOCX, XLS/XLSX,
PPT/PPTX, TXT/CSV/RTF/ODT. The shared validator checks filename, extension and
MIME agreement before reading bytes; its errors return 400. Mailbox selection,
attachment processing and sending use the same web actions. Reply Cc extends
the shared web action/Gmail helper with an optional field; reply-all merges it
with the web's resolved Cc recipients. Existing web/JSON callers omit that field
and keep their behavior. No new helper was exported from existing files.

400 invalid multipart/fields or web refusal, 401 invalid/conflicting session,
403 no Inbox access, 500 unexpected failure. Existing JSON `inbox.compose` and
`inbox.reply` RPCs and compatibility routes keep their existing shapes.

Validation: `node --test tests/mobile-rpc.test.mjs` passes 21 tests, including
mocked production registrations for staff SMS/calls, lead portal dual-area checks,
profile normalization/clearing/identity scoping, multipart action forwarding,
and caller-cell bridge/fallback/refusal paths. Locked `tsc --noEmit` passed.
Migration application and bearer HTTP/provider smoke tests remain for the QA
coordinator; no database migration, provider send, server, browser, build, commit
or push was run here. No open API questions; email forwarding remains web-only.
