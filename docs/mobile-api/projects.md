# Jobs (projects) mobile contract

Bearer session required on every endpoint, including file/image URLs. Never send
cookies. Reads require Projects; money fields require Invoices, matching the web
job header and Money panel. Money-only staff do not receive invoice data. A staff
viewer without Invoices gets null money/cents/percentage, empty legacy money
strings and milestones, and a stage-only pulse. Existing response keys remain.
Failures are `{ error: string }`: 400 input/refusal, 401 authentication/conflicting
cookie identity on writes, 403 area/role, 404 missing job/file, 500 generic failure.
No section endpoints: detail includes all sections in one request.

## Reads

- `GET /api/mobile/projects` → `JobsResponse` (no body).
- `GET /api/mobile/projects/:slug` → `JobResponse` (no body).
- `GET /api/mobile/files/:id?w=480&download=1` → file bytes (no body). Both
  query parameters optional. Uses the same restricted-sub-paperwork check and
  `serveFile` as web `/api/files/:id`, with mandatory bearer authentication.
  Thumbnails use the shared width ladder and return WebP; full files retain MIME
  type and safe inline/download headers. URLs are relative to the API origin.

The definitions below use the existing web types for backward-compatible fields;
the new phone fields are explicit. `ChipKind` is the existing visual token union.
All cents are integers, date-only strings are `YYYY-MM-DD`, timestamps are UTC ISO.

```ts
import type { ProjectDetail, ProjectLog, ProjectListItem, ProjectGroup,
  AssignedSub, ProjectFile } from "@/lib/projects";
import type { Invoice } from "@/lib/money";
import type { ClientActivityRow } from "@/lib/client-activity";
import type { PortalMessage } from "@/lib/portal-messages";
import type { ProjectStatus } from "@/lib/types";
import type { ProjectScheduleBlock } from "@/lib/schedule";
import type { RemovedBlock } from "@/lib/actions/schedule";

type Action = string; // exact names in Writes below; "open" and "upload" are UI controls
// ProjectFile: id,name,type ('doc'|'img'|'folder'),sizeLabel,modifiedLabel,
// clientVisible,clientUpload,subtitle,uploadedLabel,fromLead.
type FileRecord = ProjectFile & {
  kind: 'doc'|'img'|'folder'; kindLabel: string;
  fullUrl: string; thumbnailUrl: string|null; publishedToClient: boolean;
};
type JobRow = ProjectListItem & {
  id: string; stageKey: ProjectStatus; stageLabel: string;
  clientName: string; address: string|null; statusLine: string;
  totalCents: number|null; paidCents: number|null; percentPaid: number|null;
  nextScheduledItem: {date:string; time:string; label:string}|null;
  allowedActions: Action[];
};
type JobsResponse = {
  summary:string;
  groups:(Omit<ProjectGroup,'items'> & {items:JobRow[]})[];
  jobs:JobRow[];
  stages:{key:ProjectStatus;label:string;count:number}[];
  allowedActions:Action[];
};
type PhoneInvoice = Invoice & {
  amountCents:number; amountFormatted:string;
  balanceCents:number; balanceFormatted:string; sentAt:string|null;
  allowedActions:Action[];
}; // inherited Invoice includes id, number, milestone, status, lifecycle,
   // statusLabel, dueAt (date|null), amount, balance, paid, pending, credits,
   // returns, lines, daysOverdue, delivery/sync state and manual payment history.
type JobResponse = {
  project:ProjectDetail; // shipped fields retained; money redacted without Invoices
  dailyLogs:(ProjectLog & {photoFiles:FileRecord[]})[];
  header:{id:string;slug:string;name:string;clientName:string;address:string|null;
    stageKey:ProjectStatus;stageLabel:string;nextStageLabel:string|null};
  pulse:string;
  client:{name:string;phone:string|null;email:string|null;address:string|null};
  activity:(ClientActivityRow & {kindLabel:string;createdAt:string|null})[];
  schedule:(ProjectScheduleBlock & {allowedActions:Action[]})[];
  subs:AssignedSub[]; // slug,name,trade,role,phone,email,scope,startDate,endDate,
                     // coiStatus,coiLabel; missing dates are empty strings
  money:null|{
    totalCents:number;totalFormatted:string;paidCents:number;paidFormatted:string;
    balanceCents:number;balanceFormatted:string;percentPaid:number;
    nextDraw:null|{label:string;percent:number;amountCents:number;
      amountFormatted:string;triggerStatus:string|null};
    invoices:PhoneInvoice[];
  };
  punch:{id:number;item:string;owner:string;done:boolean;clientConfirmed:boolean}[];
  documents:{id:string;title:string;kindLabel:string;statusLabel:string;
    signed:boolean;url:string|null}[];
  files:FileRecord[]; photos:FileRecord[];
  messages:(PortalMessage & {createdAt:string|null})[];
  selections:{decided:number;waiting:number;decisions:{id:number;name:string;
    status:'draft'|'pending'|'approved'|'declined';statusLabel:string;
    chosenOptionName:string|null}[]};
  allowedActions:Action[];
};
```

The list follows the web list (warranty jobs excluded), with chips for every
lifecycle stage, including zero counts. Search `jobs` locally. `value`/`paid`
are the inherited formatted money strings. `statusLine` is the web next to-do
summary, falling back to stage. Next schedule is the first recorded block today
or later, Central time. Detail schedule covers today through day 13 Central.
Activity is the latest 30 web client-activity entries, including linked lead
history. Messages are the web thread's latest 20, oldest first. Daily logs are
newest first; files include carried-forward lead files. Document kinds respect
Estimates/Invoices/Change orders permissions. A null PDF URL means no stored PDF.
Selections contain only decision names/status and chosen option, never budgets or
editing data. Next draw is the first unbilled line of the latest approved formal
estimate, or null. Job totals come from Postgres's job-money ledger, not invoice sums.

## Writes

Each action is `POST /api/mobile/rpc/<action>`, JSON object, strict unknown-field
rejection. Shared envelope: `{ok:true,result:T}` or `{ok:true,redirect:string}`
or `{error:string}`. Void web actions have `result:null`. Refetch detail after
writes. UUIDs are strings; invoice/punch ids are positive integers.

| Action | Exact JSON body | T | Gate |
|---|---|---|---|
| `projects.create` | `{name:string;clientName:string;address?:string;value?:string}` | successful redirect `/projects/<slug>` | Projects |
| `projects.advance` | `{slug:string}` | `null` | Projects |
| `projects.dailyLog.add` | `{slug:string;body:string;date?:string}` | `{ok:true;id:string}` | Projects |
| `projects.dailyLog.edit` | `{slug:string;id:string;body:string}` | `{ok:true;id:string}` | Projects |
| `projects.schedule.add` | `{slug:string;date:string;time?:string;endTime?:string;label:string}` | `{ok:true}` | Projects |
| `projects.schedule.remove` | `{slug:string;id:string}` | `{ok:true;removed:RemovedBlock|null}` | Projects |
| `projects.schedule.restore` | `{slug:string;block:RemovedBlock}` | `{ok:true}` | Projects |
| `projects.invoice.payment` | `{id:number;amountCents:number;method?:string;date?:string;reference?:string}` | `{ok:true}` | Invoices |
| `projects.invoice.send` | `{id:number}` | `{ok:true}` | owner + Invoices |
| `projects.punch.add` | `{slug:string;item:string;owner?:string}` | `{id:number;item:string;owner:string;done:boolean}|null` | Projects |
| `projects.punch.toggle` | `{slug:string;id:number;done:boolean}` | `null` | Projects |
| `projects.punch.remove` | `{slug:string;id:number}` | `null` | Projects |
| `projects.safety.report` | `{slug:string;date:string;severity:'near_miss'|'minor'|'recordable'|'serious';notes:string;reporter?:string}` | `{ok:boolean;error?:string}` | Projects |
| `projects.portal.send` | `{slug:string;body:string}` | `null` | owner |
| `projects.file.publish` | `{slug:string;id:string;visible:boolean}` | `{ok:true;delivery:DeliveryNote|null}` | owner |

`DeliveryNote` is the exact web type from `lib/portal-publish.ts`.
`RemovedBlock = {id:string;date:string;time:string;label:string;tone:string;
project_id:string|null;sort_min:number;signature:string}`. Return this unchanged
for Undo; signature prevents fabricated restores. Blocks are checked against the
job. Schedule `time` uses the web grammar (blank/all day, `08:30`, `5pm`);
`endTime` uses `HH:MM`, must follow start on the same day, and is stored as the
shared time label `08:30 – 17:00`. No new duration column.

Daily add **appends** to that day's existing body with a blank line; edit explicitly
replaces the body of the specified job log. `date` defaults to database today,
matching the web. Existing `POST /api/mobile/projects/:slug/daily-log` accepts
`{body:string;date?:string}`, appends through the same action, and returns
`{ok:true;id:string}`. This fixes its destructive overwrite. Daily text/name/item
fields are trimmed, nonempty and at most 20,000 characters; log ids are UUIDs.

Payments call `recordManualPayment`: cents, method, date → receivedAt, reference
→ ledger note. Invoice send calls the exact web `sendInvoice` action, including
`clientSendVerdict` and delivery audit. The web allows Joe's direct click or scoped
delegated authority; mobile conservatively exposes direct sending only to the
owner. No grant bypass or separate transport. Confirm before sending.

Stage advance calls the web action unchanged, including milestone billing and
completion outreach side effects; warn/confirm that advancing may send emails.
Portal messages call `sendProjectMessage` (the web immediately posts on a human
click). Mobile restricts this to owner. File publishing calls
`setFileClientVisibility`; publishing can email the client using the existing web
notification path. Confirm before portal send/publish.

## Upload

`POST /api/mobile/uploads`, multipart body:
`slug` (required), `file` (one nonempty File), `dailyLogId` (optional UUID of an
existing log on this job). Success `{ok:true;files:FileRecord[]}` (one record).
Projects access, bearer identity must match the action DAL identity. Uses the web
`storeUpload` through the project upload server action. Maximum 25 MiB per file;
over-limit returns 413. General files accept the same types as web; log attachments
are images only. Upload once per file; attach to a log after add returns its id.
A log photo is a normal project file tagged `daily-log:<uuid>` in existing metadata;
its upload increments the log's photo count. Historical numeric-only photo counts
can exceed `photoFiles.length`; no made-up photo attachments are returned.

## Integration and exclusions

No floor/mood editing, selections editing, bidding, financial-document editing,
document generation, permits, or scope register endpoints. No tables/migrations.
Shared web helpers changed: daily add appends and returns id; new explicit
`editProjectDailyLog`; project upload returns optional id; new
`uploadProjectDailyLogPhoto`; shared schedule parser accepts a start/end range.
Coordinator should HTTP-test real bearer owner/staff sessions, PDF/image access,
append vs edit, upload + linked photo, signed Undo and actual send approval checks
on the private QA clone. No servers or browsers were started by this slice.


# Backend r3 updates (supersede corresponding definitions above)

Full cross-area contract: [backend-r3.md](backend-r3.md).

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
