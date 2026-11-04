# Field API

All requests use `Authorization: Bearer <session JWT>`. RPC requests are JSON and return `RpcResponse<T> = {ok:true; result:T} | {ok:true; redirect:string} | {error:string}`. A web refusal is returned as `{error:string}`. The original endpoints are preserved below; completed screen reads and additional writes follow.

| Method and path | Input | Success response / gate |
|---|---|---|
| GET `/api/mobile/scan/jobs` | none | `{jobs: {slug:string; name:string; client_name:string \| null}[]}`; owner or staff |
| POST `/api/receipts/scan` | multipart `photo` (one or more files), `project_slug?`, `note?`, `one_receipt?` (`"1"`) | `{ok:true; receipts:{id:number; existed:boolean}[]; skipped:string[]}`; owner or staff |
| POST `/api/mobile/rpc/schedule.create` | `ScheduleFields` | `RpcResponse<{ok:true}>`; projects |
| POST `/api/mobile/rpc/schedule.update` | `ScheduleFields & {id:string}` | `RpcResponse<{ok:true}>`; projects |
| POST `/api/mobile/rpc/schedule.delete` | `{id:string}` | `RpcResponse<{ok:true; removed: RemovedBlock \| null}>`; projects |
| POST `/api/mobile/rpc/warranty.create` | `{slug:string; issue:string; source?:string}` | `RpcResponse<{ok:boolean; error?:string}>`; warranty |
| POST `/api/mobile/rpc/unsorted.file` | `{id:number; target:FileTarget; logCost?:boolean; kind?:string; amountCents?:number \| null; vendorLabel?:string; note?:string}` | `RpcResponse<import("../../lib/unsorted-docs-core").FileResult>`; money |
| POST `/api/mobile/rpc/unsorted.note` | `{id:number; note:string}` | `RpcResponse<{ok:true; id:number; agent_queued:boolean}>`; money |
| POST `/api/mobile/rpc/unsorted.undo` | `{id:number}` | `RpcResponse<{ok:true; id:number}>`; money |

```ts
type ScheduleFields = {date:string; time:string; label:string; tone?:"accent"|"ai"|"ghost"; projectId?:string|null};
type RemovedBlock = import("../../lib/actions/schedule").RemovedBlock;
type FileTarget = {to:"project"; projectSlug:string}|{to:"overhead"}|{to:"dismiss"};
```

The receipt upload stores the photos immediately and starts extraction afterward, as on the web. Each file is limited to 20 MB. Do not send cookies alongside bearer authentication.

## Completed screen reads

All GET requests have no body, require a bearer session, and return the object below
(no RPC envelope). Dates named `date`, `due`, `until`, `expiry`, or `week` are
`YYYY-MM-DD`; timestamps are ISO 8601. Missing facts are null, never invented.
Money is integer cents plus a dollar display string. `allowedActions` are RPC keys.
Errors are `{error:string}` with 400 for invalid parameters, 401 for missing/invalid
session, 403 for area denial, 404 for absent files, and generic 500 for failures.
All screen reads send `Cache-Control: private, no-store`.

| Method / path | Gate | Response |
|---|---|---|
| GET `/api/mobile/unsorted?tab=needs` | money | `UnsortedResponse` (default tab) |
| GET `/api/mobile/unsorted?tab=filed` | money | `UnsortedResponse` (latest 60 resolved items) |
| GET `/api/mobile/unsorted/[id]/file?fileId=...` | money | Binary original or image thumbnail; file must belong to this document |
| GET `/api/mobile/schedule?week=YYYY-MM-DD` | projects | `ScheduleResponse` |
| GET `/api/mobile/warranty` | warranty | `WarrantyResponse` |
| GET `/api/mobile/compliance` | compliance | `ComplianceResponse` |
| GET `/api/mobile/money` | money | `MoneyResponse` |

File URLs support `download=1` and the shared file server's image thumbnail `w`.
Without `fileId`, the document's first attachment, then email body, is served.
Send bearer headers when loading previews/downloads; no cookie or signed URL is required.

Schedule uses the web's Monday–Friday week and weekend roll-forward. `week` chooses
the week containing that date; omitted means the web's current week. `start`/`end`
are null for all-day/milestone/invalid legacy labels; a start without a recorded
end has null `end`. Never infer a duration. Times use America/Chicago, including
DST on the block's date. Conflicts reuse the web's deterministic check and its
explicit limitation about missing durations. Meetings are also present in days.
`auto` entries have synthetic ids and no edit/delete actions.

Warranty coverage includes active, expired, and unconfirmed records; filter by
`status`. `until:null` means no recorded end date, including live projects for
which the web only shows configured warranty terms. Claims include resolved items.
Compliance includes the same open compliance + insurance-renewal source as the
web; `soon` means due today through 14 days, `overdue` means before today Central.
Money uses the same company budget loader and attention grouping as `/money`;
`paidCents` is cost paid to suppliers/subs, while `collectedCents` is client paid.
Totals cover open jobs; `closedTotals` covers closed jobs. Unknown profit is null.

```ts
import type { ProjectChoice } from "../../lib/unsorted-docs-core";
import type { CompanyJobRow, AttentionItem } from "../../lib/budget-company";
import type { CompanyTotals } from "../../lib/budget-types";

type UnsortedResponse = {
  tab:string; projects:ProjectChoice[];
  items:{
    id:number; title:string; kind:string; summary:string; vendor:string;
    amountCents:number|null; amountLabel:string; date:string|null;
    receivedAt:string|null; createdAt:string;
    status:"pending"|"needs_agent"|"filed"|"dismissed"; statusLabel:string;
    suggestions:{projectSlug:string; projectName:string; reason:string}[];
    overheadLikely:boolean; whyUnsure:string; agentNote:string; ownerNote:string;
    filedTo:"project"|"overhead"|null; projectSlug:string|null;
    projectName:string|null; resolvedAt:string|null;
    files:{id:string; name:string; mimeType:string|null; previewUrl:string; downloadUrl:string}[];
    allowedActions:string[];
  }[];
};
type MobileScheduleBlock = {
  id:string; projectSlug:string|null; projectName:string|null; label:string;
  start:string|null; end:string|null; timeLabel:string; rawTime:string;
  timeZone:string; kind:string; auto:boolean; allowedActions:string[];
};
type ScheduleResponse = {
  week:string|null;
  days:{date:string; label:string; today:boolean; blocks:MobileScheduleBlock[]}[];
  meetings:MobileScheduleBlock[];
  conflicts:{detected:boolean; label:string}; allowedActions:string[];
};
type WarrantyResponse = {
  claims:{id:string; project:string; projectSlug:string|null; issue:string;
    channel:string; openedAt:string|null; resolved:boolean; statusLabel:string;
    allowedActions:string[]}[];
  coverage:{project:string; projectSlug:string|null; until:string|null;
    status:"active"|"expired"|"unconfirmed"; statusLabel:string; terms:string}[];
  projects:{slug:string; name:string}[]; allowedActions:string[];
};
type ComplianceResponse = {
  deadlines:{id:string; what:string; due:string|null; who:string; step:string;
    statusLabel:string; overdue:boolean; soon:boolean; allowedActions:string[]}[];
  policies:{id:number; type:string; carrier:string; renewal:string|null;
    archived:boolean; statusLabel:string}[]; allowedActions:string[];
};
type MobileMoneyJob = CompanyJobRow & {
  stageLabel:string; contractedCents:number; contractedLabel:string;
  collectedLabel:string; costLabel:string; paidLabel:string; owedLabel:string;
  orderedLabel:string; estToFinishLabel:string; unpaidInvoicesLabel:string;
  balanceCents:number; balanceLabel:string; profitLabel:string;
  profitStatusLabel:string; attentionGroups:string[]; allowedActions:string[];
};
type MobileMoneyTotals = CompanyTotals & {
  contractedLabel:string; collectedLabel:string; balanceLabel:string;
  unpaidInvoicesLabel:string; unbilledLabel:string;
  profitPriceCoverageLabel:string; profitLabel:string;
};
type MoneyResponse = {
  open:MobileMoneyJob[]; closed:MobileMoneyJob[];
  totals:MobileMoneyTotals; closedTotals:MobileMoneyTotals;
  attention:{label:string; items:(AttentionItem & {amountLabel:string})[]}[];
  allowedActions:string[];
};
```

The imported types above are exact existing web contracts (not approximations).

## Additional writes

| Method / path | JSON body | Success result / gate |
|---|---|---|
| POST `/api/mobile/rpc/unsorted.setAside` | `{id:number}` | `RpcResponse<import("../../lib/unsorted-docs-core").FileResult>`; money |
| POST `/api/mobile/rpc/unsorted.dismiss` | `{id:number}` | Same result and gate |

Both names wrap `fileUnsortedAction(id, {target:{to:"dismiss"}})`, exactly the
web's “Not a business cost — set it aside”. Undo uses existing `unsorted.undo`.
The original actions and scan endpoints above remain available.
