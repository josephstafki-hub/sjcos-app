# Backend r3 contract additions

All routes require the session bearer token. Existing fields are retained; changes below
supersede the older area documents. All RPC bodies are strict JSON, unless noted.
RPC replies are `{ok:true,result:T}` or `{error:string}`; status codes follow the main
API document. Dates used as input are validated `YYYY-MM-DD`; UUID means a validated UUID.
No web UI caller was changed.

## Leads

POST `/api/mobile/rpc/leads.create` accepts:
```ts
type CreateLead = {
 name:string; phone?:string; email?:string; address?:string; scope?:string;
 source?:string; budget?:string; value?:string;
 referrer_name?:string; referrer_email?:string;
};
type CreatedLead = {slug:string;redirect:string};
type CreatedLeadResponse = {ok:true;result:CreatedLead;redirect:string};
type ConvertedLeadResponse = {ok:true;result:{projectSlug:string;redirect:string};redirect:string};
```
`budget` supplies the display value if `value` is absent and saves the Budget intake
answer; address saves the Address intake answer. Both use existing lead actions.
POST `/api/mobile/rpc/leads.convert` still accepts `{slug:string;name?:string}`.

GET `/api/mobile/leads` list rows and GET `/api/mobile/leads/[slug]` `lead` add:
```ts
type LeadValue = {value:string;valueCents:number|null;valueFormatted:string};
```
Unknown display value is `""`; numeric value is the stored estimate midpoint converted
from dollars to cents (null when no midpoint is known). Detail `valueFormatted` formats
that midpoint when present; list retains the original display/range string.
Lead intake display values remove Gmail import IDs and format imported UTC receipt
stamps as Central calendar dates. Other intake text is preserved.

POST `/api/mobile/rpc/leads.taskUpdate` accepts `{slug:string;id:number;dueDate:string}`;
id is a positive integer, dueDate is `YYYY-MM-DD` or `""` to clear. Result:
`{ok:boolean;error?:string}`. Requires Leads. The shared action scopes the task to its
lead, logs the change and revalidates. `leads.taskUpdate` is advertised in detail.

POST `/api/mobile/rpc/leads.portalMessage` is now **owner only** (also requires Leads
and the existing Projects check). Staff no longer receive that allowed action. The
shared web action is unchanged per this round's explicit restriction.

GET `/api/mobile/files/[id]` allows Leads access for a file actually carrying a
`lead_slug`; Projects access remains required for other files. Restricted sub paperwork
still requires Subs. This does not allow Leads users to read unrelated files.

## Portal history and initials

GET `/api/mobile/projects/[slug]/messages?before=<id>` requires Projects.
GET `/api/mobile/leads/[slug]/messages?before=<id>` requires Leads.
Both accept an optional positive decimal message ID, return the latest 20 without
`before`, and use the exact timestamp + ID boundary of that message within that channel.
A cursor from another channel cannot expose messages. Response:
```ts
type PortalPage = {
 messages:{id:number;author:"owner"|"ai"|"user";name:string;initials:string;
           body:string;when:string;createdAt:string}[];
 hasMore:boolean;nextBefore:string|null;
};
```
Messages are oldest first. Prepend earlier pages, stop when `hasMore` is false.
Initial job/lead arrays remain available. Initials in both initial arrays and pages are
computed from the author name (Tom Tierney → TT), rather than stale stored initials.

## Schedule

GET `/api/mobile/schedule` block fields added:
```ts
type ScheduleEditFields = {
 projectId:string|null;projectSlug:string|null;tone:"accent"|"ai"|"ghost";
 originalTimeLabel:string;rawTime:string;timeLabel:string;
 start:string|null;end:string|null;timeZone:"America/Chicago";timeZoneLabel:"Central time";
};
```
`rawTime` now contains the original time normalized by the shared grammar when
possible (e.g. 9am → 09:00). `originalTimeLabel` retains the original label. Start/end
are ISO instants for parseable times, null for all-day or ambiguous legacy values.
POST `/api/mobile/rpc/schedule.update` accepts
`{id:string;date?:string;time?:string;label?:string;tone?:"accent"|"ai"|"ghost";projectId?:string|null}`.
Omitted fields are loaded from the existing block before calling the web action.
Use `projectId:null` to unlink. Do not send blank time for an untouched field.
Ambiguous legacy times are refused by shared validation until explicitly corrected.
Result is the existing `{ok:true}|{ok:false;error:string}` (refusals become RPC errors).

## Exact destinations and notifications

```ts
type Destination = {
 type:"project"|"lead"|"sub"|"vendor"|"thread"|"sms"|"call"|"chat"|"approval"|"web";
 id:string|null;slug:string|null;section:string|null;focus:string|null;
 view:string|null;key:string|null;href:string;
};
```
GET `/api/mobile/today/queue` adds `record.destination:Destination` to every item.
Email-backed work items with obligation thread sources also set record type `thread`,
id to the actual Gmail thread ID, and href to `/inbox?thread=<id>&view=inbox`.
Source lookup only covers IDs already in this viewer's scoped queue.

GET `/api/mobile/notifications?limit=50&before=<notification UUID>&unread=1&kind=job`:
limit defaults to 50, range 1–100. `kind` (alias `filter`) accepts all/unread/decision/
mention/job/money/compliance. `unread=1` remains supported. Stable newest-first paging
uses `(created_at,id)`, independent of read state. Response retains existing fields:
```ts
import type {NotificationCard, NotifFilter} from "../../lib/notifications";
type NotificationPage = {
 total:number;decisionCount:number;unread:number;
 filters:{key:NotifFilter;label:string}[];
 notifications:(NotificationCard & {destination:Destination})[];
 hasMore:boolean;nextBefore:string|null;
};
```
`unread` is the whole scoped feed count; total and decisionCount describe this page.
Pass `nextBefore` unchanged. Approval destinations carry the exact approval `key`.
Record URLs retain web section/tab and focus. Legacy generic URLs without a source ID
remain generic: the API cannot reconstruct a missing call/thread identity. `href`
always retains the original URL. Missing SMS configuration displays plain setup copy;
queue summary removes the raw `[UNVERIFIED]` marker.

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

## Safety retry handling

POST `/api/mobile/rpc/projects.safety.report` retains its existing body and adds
`requestId?:string` (UUID). Existing body: `{slug:string;date:string;
severity:"near_miss"|"minor"|"recordable"|"serious";notes:string;reporter?:string}`.
When requestId is supplied the exact result type is:
```ts
type SafetyOperation = {
 requestId:string;status:"pending"|"completed"|"failed";
 result:{ok:boolean;error?:string}|null;message:string|null;
};
```
The first request waits for the existing AI/PDF action. Concurrent/retried requests
return the persisted operation without executing it again. Repeat the SAME payload
and ID after a timeout; changed payload with the same ID returns 400. Completed or
failed outcomes are replayed. A failed uncertain outcome requires checking the job;
do not automatically submit a new ID. Calls without requestId retain `{ok:boolean;
error?:string}` and have no retry guarantee.

The private journal is `drafts/mobile-safety-operations` (mode 0700, files 0600), under
the same persistent checkout/storage model as existing drafts. All hosts must share
this directory. After a process crash an uncertain operation remains pending rather
than risk duplicate incident/PDF creation; coordinator reconciliation is required.
No DB schema, services or live data were changed.

## Warranty, subs and plain labels

POST `/api/mobile/rpc/warranty.acknowledge`, `/warranty.resolve`, `/warranty.reopen`
accept `{id:string}` (UUID), require Warranty, use the corresponding existing web
actions, and return `{ok:boolean;error?:string}`. GET `/api/mobile/warranty` claim
allowedActions are `["warranty.reopen"]` if resolved; otherwise resolve plus acknowledge
when not yet acknowledged. Existing list/log actions are unchanged.

GET `/api/mobile/subs/[slug]` documents add `{mimeType:string|null;fileName:string|null}`;
missing file metadata yields null. `sub.jobsCount` now matches the returned jobs;
paperwork display values use plain status labels, and empty dash values become `""`.
Settings profile meta uses the viewer's role and company (no "all roles"); time zone
field is "Central time". Schedule retains the machine time zone plus timeZoneLabel.
Jobs summary says jobs/total; Leads summary says "in the pipeline" and omits zero
reply counts. Machine IDs, enums and ISO fields remain for clients; use their paired
labels for presentation.

GET `/api/mobile/time/review` additionally returns `project_name:string|null` on
both each `intervals` entry and `running` (when non-null), resolved from the project's
ID even when it is absent from the phone's synced site list. The original interval
fields and running/totals envelopes are unchanged.

## Verification and handoff

One dispatcher test file covers validation, auth, owner gating and results. No server,
browser, build, commit or deployment is part of this change. Coordinator HTTP checks
must cover mailbox isolation, Leads-only photo reads, MMS scope, >20 portal messages,
notification paging ties and incident retry during AI/PDF work. Phone-only interactions,
including playback, earlier-message buttons and target navigation, remain for phone
agents. Outgoing email file upload adapter (proposed F14) is not included here; existing
JSON compose CC is already supported.
