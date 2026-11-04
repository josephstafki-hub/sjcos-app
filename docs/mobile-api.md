# Mobile API

All routes require `Authorization: Bearer <session JWT>`. Tokens use the same
signature, expiry, active-user and `authAt`/`iat` revocation checks as web sessions.
RPC actions additionally use the web DAL (cookie first, bearer fallback); requests
with a conflicting cookie identity are rejected with 401. Do not send cookies
from the native client.

Reads return the object directly. Writes accept JSON objects, reject unknown
fields, and return `RpcResponse<T>`. IDs below are UUID strings unless stated
otherwise. Timestamps are ISO strings; queue due dates are `YYYY-MM-DD` or null.
All reads require Today access; approvals and team additionally require owner.

```ts
import type { SendResult } from "../lib/actions/ai-chat";
import type { PollResult } from "../lib/actions/dev-agents";
import type { QueueSnapshot } from "../lib/today";
import type { NotificationCard, NotifFilter } from "../lib/notifications";

type ApiError = { error: string };
type RpcResponse<T> =
  | { ok: true; result: T }
  | { ok: true; redirect: string }
  | ApiError;
type Person = { userId: string; name: string; initials: string };
type RecordLink = {
  type: "project" | "lead" | "sub" | "vendor" | "thread" | "none";
  id: string | null; // slug where that record uses slugs
  label: string;
  href: string | null; // web-relative URL, also for type:none
};
type QueueAction = "open" | "today.complete" | "today.snooze" |
  "today.assign" | "today.promote" | "today.sendBack" | "today.handoff";
type QueueItem = {
  id: string; // UUID for to-dos; synthetic string for signals
  title: string;
  summary: string;
  kind: string; // plain words
  source: string; // job/lead name or Office & admin
  dueDate: string | null;
  assignees: Person[]; // empty means owner's own, as on the web
  record: RecordLink;
  allowedActions: QueueAction[];
  aiHandoff: ("do" | "prep")[];
};
type QueueResponse = {
  upNext: QueueItem[];
  waiting: { items: QueueItem[]; total: number };
};
type Approval = {
  id: string;
  key: string; // decision:<uuid>, work_item:<uuid>, or grant:<uuid>
  kind: "decision" | "work_item" | "permission";
  grantId: string | null;
  title: string;
  effect: string | null;
  sends: boolean; // use "Approve & send" only when true
  record: RecordLink;
  createdAt: string;
  body: string | null;
  subject: string | null;
  to: string | null;
  contentHash: string | null;
};
type ApprovalsResponse = { approvals: Approval[] };
type RecoveryResponse = { items: {
  id: string; title: string; status: string;
  due: string | null; // web display date, e.g. Nov 04, 2026
  project_name: string | null; lead_name: string | null;
}[] };
type TeamResponse = { users: Person[] };
type NotificationsResponse = {
  total: number;
  decisionCount: number;
  unread: number;
  filters: { key: NotifFilter; label: string }[];
  notifications: NotificationCard[];
};
// NotificationCard and QueueSnapshot above are the exact existing web types,
// exported by the referenced modules (no mobile-specific approximation).
type HandoffResult = { conversationId: string; turn: Extract<SendResult, { ok: true }> };
type ApprovalResult = {
  ok: true; message: string; kind: "success" | "info" | "error";
};
type PermissionResult = { ok: true; id?: string; message?: string };
```

## Reads (no body)

| Method | Path | Success response |
| --- | --- | --- |
| GET | `/api/mobile/today/queue` | `QueueResponse` |
| GET | `/api/mobile/today/recovery?view=done` | `RecoveryResponse` |
| GET | `/api/mobile/today/recovery?view=snoozed` | `RecoveryResponse` |
| GET | `/api/mobile/approvals` | `ApprovalsResponse` |
| GET | `/api/mobile/notifications` | `NotificationsResponse` |
| GET | `/api/mobile/notifications?unread=1` | `NotificationsResponse` |
| GET | `/api/mobile/team` | `TeamResponse` |

The shipped `GET /api/mobile/today` remains unchanged (`TodayData` from
`lib/today.ts`), including today's schedule. The queue read uses the same scoped
queue builder and promotion rules as the web. Allowed actions match the web card
controls for this user's role, lane and position. The recovery read reuses the web
Done/Snoozed service and assignment scope; use its ids with `today.restore`.
A missing or invalid recovery view returns 400.

Approvals reuse the web list (up to 1,000 items; the web draft-preview service
contributes up to 10 work-item drafts) and permissions list (up to 1,000 grants).
The owner receives pending decisions, staged drafts, and pending permission
requests, including legacy grants without a decision. For a permission with a
`grantId`, use `permissions.approve` / `permissions.deny`; otherwise use the
approval key and preview's contentHash unchanged. This preserves stale-card and
owner-grant enforcement. An approval can execute a client-facing send immediately;
show `effect`, preview, and `sends` before confirmation.

Notifications load the same latest 300 cards as the web, scoped to the viewer.
`unread` is the full feed's unread count, even when only 300 cards are loaded.
`unread=1` filters the returned cards; `total`, `decisionCount` and `filters`
still describe the unfiltered loaded window. NotificationCard's exact shape is:

```ts
type NotificationCard = {
  id: string;
  kind: "decision" | "mention" | "job" | "money" | "compliance";
  tag: string;
  accent: "flag" | "accent" | "ai" | "money" | "ghost";
  title: string;
  subline: string;
  when: string;
  whenAbsolute: string;
  createdAt: string;
  flagged: boolean;
  href: string;
  icon: "money" | "mail" | "star" | "chat" | "project" | "site" | "shield";
  read: boolean;
  ref: string | null;
  resolution: string | null;
  actionable: boolean;
};
```

## Writes

Only POST is supported at `/api/mobile/rpc/[action]`. Each row below is one
endpoint; its body is the exact TypeScript input shape. All require Today access;
“owner” rows reject staff regardless of area permissions.

| Method / path | JSON body | Success response | Gate |
| --- | --- | --- | --- |
| POST `/api/mobile/rpc/today.handoff` | `{ id: string; kind: "do" \| "prep" }` | `RpcResponse<HandoffResult>` | owner |
| POST `/api/mobile/rpc/today.pollHandoff` | `{ runId: string }` | `RpcResponse<Extract<PollResult, { ok: true }>>` | owner |
| POST `/api/mobile/rpc/today.complete` | `{ id: string }` | `RpcResponse<QueueSnapshot>` | Today |
| POST `/api/mobile/rpc/today.snooze` | `{ id: string; until?: string }` | `RpcResponse<QueueSnapshot>` | Today |
| POST `/api/mobile/rpc/today.promote` | `{ id: string }` | `RpcResponse<QueueSnapshot>` | owner |
| POST `/api/mobile/rpc/today.sendBack` | `{ id: string }` | `RpcResponse<QueueSnapshot>` | owner |
| POST `/api/mobile/rpc/today.assign` | `{ id: string; userIds: string[] }` | `RpcResponse<QueueSnapshot>` | owner |
| POST `/api/mobile/rpc/today.restore` | `{ id: string; view: "done" \| "snoozed" }` | `RpcResponse<QueueSnapshot>` | Today |
| POST `/api/mobile/rpc/approvals.approve` | `{ key: string; contentHash: string \| null }` | `RpcResponse<ApprovalResult>` | owner |
| POST `/api/mobile/rpc/approvals.decline` | `{ key: string; contentHash: string \| null; note?: string }` | `RpcResponse<ApprovalResult>` | owner |
| POST `/api/mobile/rpc/permissions.approve` | `{ id: string }` | `RpcResponse<PermissionResult>` | owner |
| POST `/api/mobile/rpc/permissions.deny` | `{ id: string; note?: string }` | `RpcResponse<PermissionResult>` | owner |
| POST `/api/mobile/rpc/notifications.read` | `{ id: string }` | `RpcResponse<null>` | Today |
| POST `/api/mobile/rpc/notifications.readAll` | `{}` | `RpcResponse<null>` | Today |

Snooze defaults to three days using the existing action. `until` accepts an ISO
future datetime with `Z` or an explicit offset and sets the date through that same
action. The existing scheduled-due-date trigger remains authoritative.
Assignment accepts at most 100 UUIDs; `[]` returns the item to the owner's own
queue. Approval keys accept only `decision:<uuid>` / `work_item:<uuid>`.
Notes have a 4,000-character limit. Return values from queue writes are the web
`QueueSnapshot`, **not** `QueueResponse`; refetch `/today/queue` for normalized
cards. A web action may no-op when a stale item is no longer eligible, matching
web behavior.

Errors: 400 for malformed JSON, schema failures (first Zod issue), or an explicit
web-action refusal; 401 for no/invalid/revoked session; 403 for area/role denial or
an authentication redirect; 404 for an unknown action; 500 with a generic message
for unexpected failures (details logged server-side). All use `ApiError`.
Success redirects become `{ ok: true, redirect: string }`; redirects to login,
logout, or the caller's role home become 403. Never follow redirects as HTTP.

## AI handoffs

`today.handoff` resolves the item from the caller's current queue, then reuses
`doItDirective` / `prepDirective`, `newConversationAction`, and `sendMessageAction`
from the browser panel. “do” is available for checkable chat-lane items; “prep”
for deep-lane items. The returned conversation and run are persisted by the web
workflow. Poll a pending turn via `today.pollHandoff`; `nextRunId` means follow
that run. Canonical `SendResult` and `PollResult` types above describe both the
pending and completed variants exactly. No AI calls are made by the test suite.
These handoffs use Hermes/Qwen and are owner-only because those runtimes act as
Joe; staff do not receive an AI handoff in allowedActions. `allowSends` is always
false. Client-facing sends still require the web's staged approval/grant flow.

## Verification

`tests/mobile-rpc.test.mjs` exercises the real dispatcher with injected principals
and actions, without Next request storage or database mutations. It covers unknown
actions, JSON/schema validation, missing authentication, area and owner gates,
success, Next redirect conversion and web-action refusal. It is not an HTTP or
real-token integration test; the coordinator should smoke-test bearer-backed
routes and revalidation in the production QA preview.

### today.create

`POST /api/mobile/rpc/today.create` — body `{ title: string; notes?: string; dueDate?: "YYYY-MM-DD"; projectSlug?: string }`.
Wraps the web Engine "New to-do" action (`createWorkItem`, engine area). Returns the Today queue snapshot.

## Backend r3 additions

See [backend-r3.md](mobile-api/backend-r3.md) for the superseding exact contracts:
notification cursors/destinations, direct email lookup, portal history, lead create/
convert results and values, lead photo authorization, schedule edit preservation,
safety request IDs, MMS file reads, warranty lifecycle actions and sub file metadata.
Notifications now default to 50 newest-first cards with cursor paging rather than the
web's 300-card unread-first window. `unread` remains the full scoped count.
