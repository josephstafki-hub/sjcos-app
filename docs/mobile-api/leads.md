# Leads mobile API

Bearer authentication and the RPC envelope follow `docs/mobile-api.md`; Leads access is required. `GET /api/mobile/leads` retains `LeadsData` from `lib/leads.ts`, with each lead additionally containing `temperatureLabel: string`, `phone: string | null`, `email: string | null`, `nextTaskDue: string | null` (date). Stage keys and labels/counts are in `stages`, and rows include scope, value, age and flag. Value is the web's display string, often a range, not a single cents amount.

`GET /api/mobile/leads/[slug]` retains its existing `{ lead }` fields, and adds:

```ts
import type { LeadStage } from '../../lib/types';
import type { LeadTask } from '../../lib/lead-tasks';
import type { LeadActivityRow } from '../../lib/lead-activity';
import type { LeadFirstResponse } from '../../lib/lead-first-response';
import type { PortalMessage } from '../../lib/portal-messages';
type AddedLeadFields = {
  stageStepper: { stages: {key: LeadStage; label: string}[]; current: LeadStage; next: {key: LeadStage; label: string} | null };
  allowedActions: string[];
  contact: {name: string; phone: string | null; email: string | null; address: string};
  intakeAnswers: {label: string; value: string}[];
  tasks: LeadTask[]; activity: LeadActivityRow[];
  score: Awaited<ReturnType<typeof import('../../lib/intake').getLeadScore>>;
  firstResponse: LeadFirstResponse | null;
  firstResponseSend: {canSend: boolean; effect: string};
  portalMessages: PortalMessage[];
  conversation: import('../../lib/leads').LeadDetail['conversation'];
  photos: {id: string; name: string; url: string}[];
};
```

Estimate is null without estimates access. The `/api/mobile/files/[id]` photo URL requires the Jobs slice bearer-authenticated file route. The web lead conversation loader currently returns curated conversation, not live email/SMS. Activity and portal message times are web display labels. The first response's `pending` status plus a contact email and owner role enables sending; server-side checks can still refuse. Sending calls the web action, immediately emails the client, and for the rough-estimate branch may advance the stage and create a task. There is no web action to save an edited first-response draft separately.

All writes below are `POST /api/mobile/rpc/<action>`, with strict JSON bodies. Results use the standard `RpcResponse<T>`; void results become null and redirects become `{ok:true,redirect:string}`. Web action return types are authoritative.

| Action | Body | Result |
|---|---|---|
| leads.create | `{name:string, scope?:string, value?:string, source?:string, referrer_name?:string, referrer_email?:string}` | `null` or redirect; web may automatically email a referrer |
| leads.advance, leads.lost, leads.reopen | `{slug:string}` | `null` |
| leads.setStage | `{slug:string, stage:LeadStage}` | `null` |
| leads.convert | `{slug:string, name?:string}` | `null` or redirect |
| leads.contact | `{slug:string, email:string, phone:string}` | `{ok:boolean,error?:string}` |
| leads.intake | `{slug:string, question:string, answer:string}` | `{ok:boolean}` |
| leads.taskAdd | `{slug:string,title:string,dueDate:string}` | `LeadTask \| null`; dueDate is YYYY-MM-DD or empty |
| leads.taskDone | `{slug:string,id:number,done:boolean}` | `{ok:boolean}` |
| leads.taskDelete | `{slug:string,id:number}` | `{ok:boolean}` |
| leads.sendFirstResponse | `{slug:string,subject:string,body:string}` | `{ok:true,response:LeadFirstResponse \| null}`; owner only |
| leads.portalMessage | `{slug:string,body:string}` | `null`; also requires Projects access; posts immediately to the client portal |

Web actions do not support editing contact name/address or changing an existing task's due date. Those operations and saving a first-response draft need shared web actions before they can be exposed here.


# Backend r3 updates (supersede corresponding definitions above)

Full cross-area contract: [backend-r3.md](backend-r3.md).

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
