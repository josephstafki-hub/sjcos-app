# Phone alerts contract

## Changes in R2

This section supersedes conflicting R1 and original notes. All request shapes stay
unchanged; the additions below let older clients continue reading the feed.

- APNs `{aps:{alert:{title:'SJC OS',body}}}` →
  `{aps:{alert:{title:<real alert title without "[SJC OS] " or "Approve: ">,body:<plain app body>}}}`.
  No record URL or Telegram reply instructions in app copy. Title-only alerts keep
  their informative title. Hidden previews remain the phone's responsibility:
  every category must use `showTitle:false`, `showSubtitle:false` and a placeholder.
- `PushCategory` → same union plus `'SJC_DECISION_SEND'|'SJC_GRANT_SEND'`.
  These use the same verbs as their base categories, with **Approve & send** as the
  approve label. `sends:true` indicates approving performs the staged send.
- `PushMessage` → same fields plus
  `{from:'owner'|'agent'|'system',agentName:string|null,draftBinding:string|null}`.
  Render owner notes as You, agent notes using `agentName` (e.g. Claude), and system
  acknowledgments as system lines. Agent titles say e.g. "Claude has a question";
  their body contains only the answer/question. `draftBinding` is opaque server
  evidence; clients still submit only the original messageId and exact actionId.
- `outcome:<note or status>` → `outcome:<status first, optionally " — " + note>`.
  Map `approved|sent|consumed|used|done` to Approved, `rejected|declined|denied` to
  Declined, `changes_requested|Changes requested` to Changes requested,
  `superseded|Replaced…` to Replaced, and `On hold until <Central time>` to that hold
  label. `answered` (or replies to portal messages) means Answered; other closed rows fall back to
  Closed. Keep the note separately visible. Holds reopen when elapsed.
- Unauthenticated errors `{error:string}` → same plus
  `{code:'session_expired_or_invalid'|'session_revoked',retryable:boolean,deliveryStopped:boolean}`.
  In particular DELETE devices with an expired/invalid bearer returns HTTP 401,
  `code:'session_expired_or_invalid',retryable:true,deliveryStopped:false`.
  Retain the pending unregister intent/original credential; a generic 401 never
  confirms removal. `session_revoked` with `deliveryStopped:true` confirms this
  credential no longer authorizes delivery (not that all other sessions ended).
  Valid authenticated DELETE still returns `{ok:true}`. Registration now stores
  the bearer expiry as well as original authentication time, and delivery excludes
  expired registrations. Register again with the renewed bearer while alerts are
  enabled; renewing a login alone does not extend the device registration.
- Action idempotency keeps the R1 shapes: generation-fenced claims and row locks
  prevent lease-expiry overlap from repeating domain mutations. Terminal results
  are immutable. HTTP 202 retains the exact UUID/request. Uncertain effects remain
  `needs_review`; never create a new UUID to resend them.
- Parked draft cards carry their submission/content binding. An old messageId
  cannot approve, decline or pull a revised draft. Folded summaries are durable
  jobs with the saved channel selection and recipient receipts; retries may arrive
  after a channel setting changes and still honor the saved selection.

## Changes in R1

This section supersedes the round-0 delivery notes below.

- Action response: `{ok,message,outcome,followUp?}` → same fields plus optional
  `{retryable?:boolean,needsReview?:boolean,evidence?:object}`. HTTP 202 with
  `outcome:'in_progress',retryable:true` means retain the exact UUID/request and retry.
  `outcome:'recorded'` → `outcome:'needs_review',needsReview:true,evidence:{...}` for
  interrupted effects whose acceptance is uncertain. Show a persistent review state;
  never silently discard it or generate another UUID. Completed retries return the
  saved first result. A claim interrupted before mutation resumes; a committed decision
  with effects not started resumes its saved resolution without reapproving.
- Errors: `400|401|403|404|500` → `400|401|403|404|409|500` (and 202 above).
- Device register: same request/response; cross-user token conflict previously silently
  moved the token → HTTP 409 unless the previous account explicitly unregistered it.
  Registration binds to the registering session's original `authAt` (fallback `iat`);
  revoked sessions and inactive users cannot receive pushes. No client field added.
- APNs `aps.alert.title: <client/card title>` → `aps.alert.title: 'SJC OS'`.
  Full feed titles and Telegram text remain unchanged. Native categories must still
  suppress hidden previews for both title and body.
- Held cards: `{state:'open',outcome:null}` → `{state:'decided',outcome:'On hold until … Central'}`
  during the hold, returning to `open` when it expires. No new state enum.
- Threaded approval cards: `allowedActions:['reply']` → the current card's approval
  verbs plus reply, even with `replyToId`. Conversational reply/ack rows stay reply-only.
- Test push: a rejected/disabled/no-longer-authorized device previously returned
  `{ok:true,messageId}` → an error response; success shape is unchanged.


Bearer authentication on every endpoint. Owner only except device registration/deletion
(active staff may register; staff devices never receive owner alerts). Errors use
`{ error: string }` (with the R2 authentication fields above) and HTTP 400/401/403/404/409/500. No secrets in responses.

Implementation clarifications: grant cards use their linked decision and the same
Approve / Request changes / Hold verbs as Telegram (no separate grant decline).
`push.saveSettings` uses the existing RPC `{ok:true,result:...}` envelope. All other
routes return the types below directly. Test requests identify this phone by token.

```ts
export type PushAction = 'approve'|'decline'|'changes'|'hold'|'reply';
export type PushCategory = 'SJC_DECISION'|'SJC_DECISION_SEND'|'SJC_GRANT_SEND'|'SJC_DRAFT_SEND'|'SJC_DRAFT'|'SJC_GRANT'|'SJC_REPLY'|'SJC_INFO';
export interface Destination {
 type:'project'|'lead'|'sub'|'vendor'|'thread'|'sms'|'call'|'chat'|'approval'|'web';
 id:string|null; slug:string|null; section:string|null; focus:string|null;
 view:string|null; key:string|null; href:string;
}
export interface RegisterDeviceRequest {
 token:string; platform:'ios'|'android'; environment:'sandbox'|'production';
 appVersion?:string; build?:string; deviceName?:string;
}
export interface RegisterDeviceResponse { ok:true; deviceId:string }
export interface DeleteDeviceRequest { token:string }
export interface DeleteDeviceResponse { ok:true }
export interface SaveSettingsRequest { channels:{app:boolean;telegram:boolean} }
export interface PushSettings extends SaveSettingsRequest {
 quietHours:{ timeZone:'America/Chicago'; start:'21:00'; end:'07:00' };
 configured:{app:boolean;telegram:boolean};
}
// GET settings -> PushSettings; RPC push.saveSettings -> {ok:true,result:PushSettings}
export interface TestPushRequest { token:string }
export interface TestPushResponse { ok:true; messageId:string }
export interface PushMessage {
 id:string; kind:string; title:string; body:string|null; href:string|null;
 from:'owner'|'agent'|'system'; agentName:string|null; draftBinding:string|null;
 decisionId:string|null; workItemId:string|null; grantId:string|null;
 portalChannelKey:string|null; portalMessageId:string|null; ownerReplyId:string|null;
 replyToId:string|null; threadKey:string; category:PushCategory;
 state:'open'|'decided'|'info'; outcome:string|null;
 createdAt:string; deliveredAt:string|null; approvalKey:string|null;
 contentHash:string|null; sends:boolean; dest:Destination;
 allowedActions:PushAction[]; replies:PushMessage[];
}
// GET messages?before=<opaque cursor>&limit=50 (1..100)
export interface PushMessagesResponse { messages:PushMessage[]; nextCursor:string|null }
// GET messages/:id
export interface PushMessageResponse { message:PushMessage; thread:PushMessage[] }
export interface PushActionRequest {
 actionId:string; // UUID, reused on retries of this exact request
 messageId:string; action:PushAction; text?:string; // required for changes/reply
}
export interface PushActionResponse { ok:boolean; message:string; outcome:string; followUp?:string; retryable?:boolean; needsReview?:boolean; evidence?:object }
export interface PushOpenResponse { badge:number; decidedMessageIds:string[] }
export interface AlertPushPayload {
 aps:{alert:{title:string;body:string};sound:'default';badge:number;
  'thread-id':string;category:PushCategory};
 sjc:{v:1;messageId:string;kind:string;href:string;dest:Destination;
  approvalKey:string|null;contentHash:string|null;sends:boolean};
}
export interface CleanupPushPayload {
 aps:{'content-available':1;badge:number};
 sjc:{v:1;kind:'cleanup';decidedMessageIds:string[];badge:number};
}
```

The server stores full plain text; APNs bodies are shortened to fit 4 KB.
Action identifiers registered by iOS are the lowercase `PushAction` values.
A stale or already decided action returns `ok:false` with a readable `message`.
Hold is four hours. `changes` with text pulls back the request immediately.
Messages are persisted even when the App channel is switched off. `open` also
reconciles decisions made on the web; call it on foreground and cleanup pushes.

Delivery notes: cleanup from web/MCP writes is queued transactionally and sent
by the five-minute push drain; foreground `/open` sends it immediately too.
No time-sensitive interruption level is sent until the entitlement is confirmed.
A crash before domain mutation resumes the same actionId. Committed decision
resolutions resume only their saved effects. Uncertain effects return durable
`outcome:'needs_review',needsReview:true,evidence:{...}`; do not resend them. Successful replies are retained
as `kind:'reply'`, title `Your reply`; answers/acknowledgments use `kind:'ack'`.

Backend setup: apply migration `0092_phone_push.sql` before deploying these routes.
Set `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_TOPIC` on the server.
Without an Apple key, use `SJC_OUTBOUND_DISABLED=1` for recorded fake deliveries.
`APNS_API_BASE` is the HTTP/2 transport seam; tests mock it without opening a server.
QA regression runs can preload `tests/_harness/qa-push.mjs` with
`SJC_QA_TEST_DATABASE_URL` pointing at a migrated isolated `sjcos_push*` database
on port 5499. It never starts a cluster. Legacy tests also use
`FIN_TEST_DATABASE_URL`. Run each file separately. The older notification tests
need an active owner fixture; the portal fixture expects the name Joe Stafki.

R3 backend approval guarantee: phone, Telegram and web work-item Approve all
capture the draft binding and complete send source (content, receipt/revision,
recipient and portal target) in the transaction that claims approval. Dispatch
uses only that owner-only immutable snapshot. A changed current card is refused
and must be reviewed again; editing a draft after approval cannot change what
is sent. Saved intent keys and uncertain-effect recovery remain unchanged.
No phone request/response fields or action identifiers change. `draftBinding`
is still opaque and is never supplied by the phone. Hold outcomes now use
Central time with lowercase am/pm, showing the date only for another day.
