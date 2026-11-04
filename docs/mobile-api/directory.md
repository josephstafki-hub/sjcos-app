# Directory API

All requests use `Authorization: Bearer <session JWT>`. RPC requests are JSON and return `RpcResponse<T> = {ok:true; result:T} | {ok:true; redirect:string} | {error:string}`. A web refusal is returned as `{error:string}`. The existing write actions are preserved below; completed reads and assignment actions follow.

| Method and path | JSON body | Success result and gate |
|---|---|---|
| POST `/api/mobile/rpc/subs.notes` | `{slug:string; notes:string}` | `RpcResponse<null>`; owner |
| POST `/api/mobile/rpc/vendors.notes` | `{slug:string; notes:string}` | `RpcResponse<null>`; owner |
| POST `/api/mobile/rpc/vendors.toggleFavorite` | `{slug:string}` | `RpcResponse<{ok:true; id?:string; slug?:string}>`; vendors |
| POST `/api/mobile/rpc/subs.acceptDocument` | `{slug:string; documentId:number; expires:string \| null}` | `RpcResponse<{ok:true}>`; owner |
| POST `/api/mobile/rpc/subs.rejectDocument` | `{slug:string; documentId:number; reason:string}` | `RpcResponse<{ok:true; notice?:string}>`; owner; the web action may send or stage a follow-up |
| POST `/api/mobile/rpc/settings.profile` | `{name:string; email:string; company:string; phone:string}` | `RpcResponse<null>`; owner |
| POST `/api/mobile/rpc/settings.notify` | `{key:NotifyKey; on:boolean}` | `RpcResponse<null>`; owner |

```ts
type NotifyKey = "notify.decisions" | "notify.money" | "notify.compliance" | "notify.mentions" | "notify.emailDigest" | "notify.sms";
```

## Completed reads (no body)

All endpoints require bearer authentication. Screen reads return objects directly,
with `Cache-Control: private, no-store`. Errors are `{error:string}` (400 invalid
input/missing COI email; 401 invalid session; 403 permission denial; 404 absent
record/file; generic 500 for unexpected failures). Dates are `YYYY-MM-DD`,
`createdAt` is ISO 8601, money is integer cents plus a dollar string.

| Method / path | Gate | Response |
|---|---|---|
| GET `/api/mobile/subs` | subs | `SubsResponse` (backward compatible additions) |
| GET `/api/mobile/subs/[slug]` | subs | `SubResponse` (existing `{sub:...}` envelope preserved) |
| GET `/api/mobile/subs/[slug]/coi-request` | subs | `CoiDraftResponse` |
| GET `/api/mobile/subs/[slug]/documents/[id]/file` | subs | Binary document; id must belong to this sub |
| GET `/api/mobile/vendors` | vendors | `VendorsResponse` |
| GET `/api/mobile/vendors/[slug]` | vendors | `VendorResponse` |
| GET `/api/mobile/search?q=...` | today + each result's area | `SearchResponse` |
| GET `/api/mobile/settings` | owner + today | `SettingsResponse` |

`subs.coiRequestDraft` in allowedActions means fetch the COI draft GET above, then
open the native mail composer with `{to,subject,body}`. This is the same prefilled
mailto draft as the web; the GET sends nothing. No email gives 400 and omits that
action. Document URLs load with a bearer header; shared file-server options
`download=1` and image thumbnail `w` work. Subs access is the web's paperwork
access check, including restricted paperwork for staff with Subs access.

Sub rates are blank strings (same object shape on detail) without Money access;
owner notes are null for everyone except the owner. Assignment actions require
Projects access, exactly as the web's server actions. Removed assignments appear
only for viewers who can restore them. Job `active` means not in warranty stage.
Sub trades and all shipped list/detail fields are preserved. Paperwork uses the web
loader's latest 30 document window, newest first.

Vendor purchase orders are read-only and require Purchase orders or Money access;
otherwise the array is empty and `purchaseOrdersVisible` is false. Notes are the
web vendor's notes; only the owner can edit them. Favorite changes require Vendors.

Search calls the shared `searchPanelForUser` web-palette loader with the already
authenticated bearer principal, using escaped ILIKE name search, eight results per
type, plus project client contacts. Types are project, lead, sub, vendor, contact;
contacts navigate to their containing project. No denied area's table is queried.
The query is trimmed and capped at 120 characters; blank returns an empty array.
Profile and notification toggles reuse the web Settings loader and its labels,
defaults, and values; profile name/email come from the authenticated user.

```ts
import type { SubCard, SubDetail, TradeFilter } from "../../lib/subs";
import type { VendorCard } from "../../lib/vendors";
import type { SettingsData } from "../../lib/settings";

type SubsResponse = {
  summary:string; trades:TradeFilter[];
  subs:(SubCard & {
    phone:string|null; email:string|null; coiExpires:string|null;
    coiStatusLabel:string; allowedActions:string[];
  })[];
  allowedActions:string[];
};
type SubResponse = {sub: Pick<SubDetail,
  "slug"|"name"|"initials"|"tradeLine"|"working"|"coiStatus"|"coiLabel"|
  "jobsCount"|"rating"|"reliability"|"recentJobs"|"paperwork"|"taxNote"|
  "phone"|"email"|"contact"|"rate"|"archived"
> & {
  trade:string; notes:string|null;
  coi:{status:SubCard["coiStatus"]; statusLabel:string; expires:string|null};
  documents:{id:number; type:string; typeLabel:string; status:string;
    statusLabel:string; expiry:string|null; url:string|null;
    allowedActions:string[]}[];
  jobs:{slug:string; name:string; start:string|null; end:string|null;
    active:boolean; allowedActions:string[]}[];
  removedJobs:{projectSlug:string; name:string; allowedActions:string[]}[];
  allowedActions:string[];
}};
type CoiDraftResponse = {to:string; subject:string; body:string};
type VendorsResponse = {
  summary:string;
  vendors:(VendorCard & {category:string; favorite:boolean;
    statusLabel:string; allowedActions:string[]})[];
  allowedActions:string[];
};
type VendorResponse = {
  slug:string; name:string; initials:string; category:string;
  phone:string; email:string; favorite:boolean; statusLabel:string; notes:string;
  purchaseOrders:{id:string; number:string; projectSlug:string; projectName:string;
    title:string; amountCents:number; status:string; createdAt:string;
    amountLabel:string; statusLabel:string; allowedActions:string[]}[];
  purchaseOrdersVisible:boolean; allowedActions:string[];
};
type SearchResponse = {
  results:{type:string; id:string; slug:string; title:string; subtitle:string}[];
  allowedActions:string[];
};
type SettingsResponse = {
  profile:SettingsData["profile"];
  notifyToggles:SettingsData["notifyToggles"];
  allowedActions:string[];
};
```

Imported types reference the exact web contracts. For standalone clients, profile
is `{name:string; meta:string; email:string; company:string; phone:string;
fields:{label:string; value:string}[]}` and each notification toggle is
`{key:string; label:string; on:boolean}`. Notify keys are the six `NotifyKey` values
listed above, in web order. `allowedActions` is empty on read-only objects; detail
cards carry only the actions available to this viewer.

## Additional writes

| Method / path | JSON body | Success result / gate |
|---|---|---|
| POST `/api/mobile/rpc/subs.assign` | `{projectSlug:string; subSlug:string; role?:string}` | `RpcResponse<null>`; projects |
| POST `/api/mobile/rpc/subs.removeAssignment` | `{projectSlug:string; subSlug:string}` | `RpcResponse<null>`; projects |
| POST `/api/mobile/rpc/subs.restoreAssignment` | `{projectSlug:string; subSlug:string}` | `RpcResponse<{ok:boolean}>`; projects |

These wrap `assignSubToProject`, `removeSubFromProject`, and
`restoreSubAssignment` without replacing their validation, transaction, chat-room,
revalidation, or invite logic. Assignment may park a portal invite for Joe, never
send it. Restore refusal is returned as `{error:string}` by the dispatcher. A
missing job on assign/remove has the web's no-op behavior. Existing actions above
remain available; no client-facing send or grant rules changed.


# Backend r3 updates (supersede corresponding definitions above)

Full cross-area contract: [backend-r3.md](backend-r3.md).

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
