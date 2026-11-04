# Mobile operator API

Bearer authentication, `ai` access (not Today), cookie identity must match bearer
identity if cookies are sent. Use no cookies from native clients. Staff may use
Auto/Claude; Hermes/Qwen act as Joe and are refused for staff. The web action
still makes the final agent choice and starts staff Claude runs with staff identity.
Model, context, mode and effort choices are the same web metadata; the runner's
staff business profile remains authoritative. Job search and grant decisions are
owner-only. No new tables or direct business writes.

**Coordinator integration required:** the preamble prohibits editing
`lib/mobile-rpc/index.ts`, but main does not yet import this slice. Add
`import { operatorActions } from "./operator"` and spread `...operatorActions`
into `mobileActions`. Until that integration, the GET/multipart routes work but
all JSON RPC names below return unknown-action 404.

## Exact response types

Types imported below are the canonical web contract, reused without approximation.
Their definitions in the named modules are authoritative, including nested tool
logs, grant previews, questions, run focus and changes. The native client can
copy these shared definitions; response types here describe every endpoint.

```ts
import type { ChatMessage, ConversationDetail } from "../../lib/ai-chat";
import type { SendResult, UploadResult } from "../../lib/actions/ai-chat";
import type { PollResult, PendingGrant, SteerResult } from "../../lib/actions/dev-agents";
import type { AgentInteraction, InteractionResponse } from "../../lib/agent-interactions";
import type { SteerStatus } from "../../lib/run-steers";
import type { RunReview } from "../../lib/agent-review";
import type { RailFolder, RailThread, ThreadStatus, FolderEntityRef } from "../../lib/thread-rail";
import type { JobPick } from "../../lib/thread-folders";
import type { AgentMeta, ClaudeOptions, ClaudeModelOption, ClaudeContext, ClaudeMode, ClaudeEffort } from "../../lib/dev-agents-meta";

type ApiError = { error: string };
type RpcResponse<T> = { ok: true; result: T } | { ok: true; redirect: string } | ApiError;
type Context = { type: "project" | "lead" | "vendor" | "sub"; slug: string };
type Attachment = { name: string; path: string };
type Thread = RailThread & {
  status: ThreadStatus;
  label: string;
  unread: boolean;
  pendingRunId: string | null;
  allowedActions: string[];
};
type Folder = RailFolder & { allowedActions: string[] };
type RailResponse = { folders: Folder[]; threads: Thread[]; allowedActions: string[] };
type ArchivedResponse = { threads: Thread[] };
type ConversationResponse = ConversationDetail & { allowedActions: string[] };
type RunResponse = PollResult;
type ReviewResponse = { review: RunReview | null; grants: PendingGrant[] };
type JobsResponse = { jobs: JobPick[] };
type ConfigResponse = {
  agents: AgentMeta[];
  defaults: ClaudeOptions;
  models: ClaudeModelOption[];
  contexts: { value: ClaudeContext; label: string; note: string }[];
  modes: { value: ClaudeMode; label: string; note: string }[];
  efforts: { value: ClaudeEffort; label: string }[];
  starters: string[];
  allowedActions: string[];
};
type NewResponse = {
  conversationId: string;
  context: Context | null;
  options: Partial<ClaudeOptions> | null;
};
type Ok = { ok: boolean };
type OptionalError = { ok: boolean; error?: string };
type FileUnderResponse = { ok: boolean; folderId: string | null };
type FolderCreatedResponse = { ok: boolean; id: string };
type GrantResponse = { ok: true; id?: string; message?: string };
type PollRpcResponse = { poll: PollResult };
```

`RailThread` carries id, agent, title, folderId, createdAt, updatedAt,
lastActivityAt, unsettledAt, settledOverride, settledAt, archivedAt, pinnedAt,
pinOrderKey, needsApproval, needsInput, working, workingSince, lastRunId,
lastRunStatus, lastRunEndedAt and suggestedFolder (entity kind/id/name or null).
`RailFolder` carries id, name, entityKind, entityId, entityHref, collapsed,
archivedAt and sortKey. Entity ids are slugs or UUIDs, as on the web. The folder
supplies entity binding; simply viewing a record never files a new thread.

`ChatMessage` carries role (`user`/`assistant`), markdown in `body`, attachments,
costUsd, createdAt, subjectWorkItemId, agent and optional tokenUsage, steer,
runId, workLog, durationSeconds. ConversationDetail also includes id, agent,
title, claudeSessionId, folderId, folderName, pendingRunId and
pendingRunStartedAt (epoch milliseconds or null). RunReview supplies the same
activity log, duration, tool count and before/after change evidence as RunReview.tsx.
Rail and conversation timestamps are ISO. Poll/review deliberately retain the
web result unchanged (some timestamps use PostgreSQL timezone-bearing text).

## Reads

All success responses are direct JSON objects. Every read may instead return
`ApiError`: 401 invalid session/conflicting identity, 403 area/owner denial,
400 invalid query/id, 500 generic unexpected failure. Missing conversation: 404.

| Method/path | Response | Input/gate |
| --- | --- | --- |
| GET `/api/mobile/operator/rail` | `RailResponse` | AI |
| GET `/api/mobile/operator/archived` | `ArchivedResponse` | AI |
| GET `/api/mobile/operator/conversations/:id` | `ConversationResponse` | AI; UUID |
| GET `/api/mobile/operator/runs/:id` | `RunResponse` | AI + web run ownership; UUID |
| GET `/api/mobile/operator/runs/:id/review` | `ReviewResponse` | AI + web run ownership; UUID |
| GET `/api/mobile/operator/jobs?q=...` | `JobsResponse` | owner; q defaults empty, max 200 chars |
| GET `/api/mobile/operator/config?agent=auto&route=/projects/kitchen` | `ConfigResponse` | AI; agent defaults auto; route optional |

Rail and archived reads accept `currentId=<uuid>`, `seenRunIds=<comma-separated
UUIDs>` (first 500), `since=<ISO timestamp>`. These mirror panelStore's local
seen state: native clients persist their own seen ids, mark a run seen when
opening its thread, and send them on refresh. There is no server read receipt.
`unread` means an unseen finished/failed run under the web status priority
(approval > question > working > failed > completed > idle). `since` excludes
older completions, like the web tab's start time. `pendingRunId` is the latest
run id when working. Use the same partition rules as the web: archived hidden;
settledOverride `settled` on the settled shelf; otherwise pinnedAt to pinned;
remaining threads active. Folders include archived folders so they can be restored.
The rail's existing web loader caps non-archived threads at 500.

Config returns the panel's real starters (`startersForRoute`), picker labels,
options and defaults. Staff agents omit Hermes/Qwen. Metadata `async` is legacy;
all agents can now return a pending run: use SendResult to decide to poll.

## JSON writes

Each name below is a separate POST endpoint at `/api/mobile/rpc/<name>`.
JSON bodies reject unknown properties. IDs below are UUIDs; strings have bounds
in the registration schemas. Each result column is wrapped in `RpcResponse<T>`.
Returned web failures with `error` become HTTP 400 `ApiError`, except PollResult
is nested under `poll` to preserve terminal errors and nextRunId. Unauthorized
area/owner is 403, missing auth 401, unknown action 404, unexpected error 500.

| Name | Exact body type | Result T |
| --- | --- | --- |
| `operator.new` | `{ agent: "auto" \| "claude" \| "qwen" \| "hermes"; folderId?: string \| null; entity?: FolderEntityRef; context?: Context; options?: Partial<ClaudeOptions> }` | `NewResponse` |
| `operator.send` | `{ id: string; prompt: string; context?: Context; options?: Partial<ClaudeOptions>; attachments?: Attachment[]; subjectWorkItemId?: string; allowSends?: boolean }` | `Extract<SendResult, {ok:true}>` |
| `operator.poll` | `{ runId: string }` | `PollRpcResponse` |
| `operator.stop` | `{ runId: string }` | `OptionalError` |
| `operator.steer` | `{ runId: string; text: string }` | `Exclude<SteerResult, {error:string}>` |
| `operator.answer` | `{ id: string; response: InteractionResponse }` | `Ok` |
| `operator.dismiss` | `{ id: string }` | `Ok` |
| `operator.approveGrant` | `{ id: string }` | `GrantResponse` (owner) |
| `operator.denyGrant` | `{ id: string; note?: string }` | `GrantResponse` (owner) |
| `operator.resetSession` | `{ id: string }` | `Ok` |
| `operator.rename` | `{ id: string; title: string }` | `Ok` |
| `operator.archive` | `{ id: string; archived: boolean }` | `OptionalError` |
| `operator.pin` | `{ id: string; pinned: boolean }` | `Ok` |
| `operator.settle` | `{ id: string }` | `OptionalError` |
| `operator.unsettle` | `{ id: string }` | `Ok` |
| `operator.move` | `{ id: string; folderId: string \| null }` | `Ok` |
| `operator.fileUnder` | `{ id: string; entity: FolderEntityRef }` | `FileUnderResponse` |
| `operator.delete` | `{ id: string }` | `Ok` |
| `operator.createFolder` | `{ name: string }` | `FolderCreatedResponse` |
| `operator.renameFolder` | `{ id: string; name: string }` | `Ok` |
| `operator.collapseFolder` | `{ id: string; collapsed: boolean }` | `Ok` |
| `operator.archiveFolder` | `{ id: string; archived: boolean }` | `OptionalError` |

New-thread options and page context are returned for the phone to hold and pass
on each send, exactly like panelStore's client-held options and PageAiContext.
They are not persisted by newConversationAction. New threads remain Unfiled
unless folderId or entity is explicitly supplied. Context is independent of
filing. Project/lead context loads the web detail and uses projectContext /
leadContext; sub/vendor uses PageAiContext's route fallback. Caller must have
that record's area permission. `operator.send` reuses sendMessageAction with
those serialized records; it does not accept arbitrary serialized context text.
LiveActionNav's `focus` is present unchanged on polls; native UI decides whether
to navigate or offer a link.

Steer text is 1–8000 characters; `{ok:false,finished:true}` means submit it as
a new message instead. Answer uses exactly the web union:
`{kind:"question",answers:{question:string,choices:string[],other?:string}[]}`
or `{kind:"permission",decision:"allow"|"deny",note?:string}`.
Run/interaction ownership checks remain in the web actions. Their thrown
ownership errors are generic HTTP 500, with no run details disclosed, matching
the existing dispatcher's unexpected-error behavior.

Grant decisions call **approveGrant / denyGrant**, exactly as GrantCard does.
Show detail, recipient, reason, expiry and state. Do not enable Approve when
`detail === null` (web requires preview first). Approval can immediately send
parked client-facing content; show this before confirmation. Staff cannot
approve/deny. Express permission (`allowSends:true`) is owner-only, per-message,
and never stored in options. Existing grants and staged sends are authoritative.

## Upload

POST `/api/mobile/operator/upload`: multipart/form-data, repeated `files` fields.
Returns `Extract<UploadResult,{ok:true}>` = `{ok:true,files:Attachment[]}` directly,
or `ApiError`. Same AI bearer/identity checks; 400 invalid multipart/no files/file
over 25 MB, 500 storage failure. Calls uploadChatFilesAction unchanged. Upload
first, then send the returned `files` as `attachments`. Paths are opaque server
references; do not construct paths. The web action sanitizes them on send.
No attachment-download endpoint is introduced by this slice.

## Poll lifecycle

The web waits **2000 ms** between polls, up to **1440 polls per run** (~48 minutes).
`ok:true,status:"pending"|"running"` carries activity (the live text/tool log),
contextTokens, interactions, grants, focus and steers. It does **not** expose a
separate streamed assistant-answer-so-far field: the web uses `activity` until
completion. No phone-only stream is invented.

`ok:true,status:"done"` carries answer, activity, costUsd, agent, contextTokens,
tokenUsage, sessionId, focus, steers and optional nextRunId. `ok:false,error`
is terminal failure/stopped/missing-run; it can also carry nextRunId and steers.
Follow nextRunId after **either** terminal outcome; otherwise stop polling,
reload the conversation and rail, and load the completed run review. Stop is
settled by the same web runner; poll until its terminal response. Null context
values mean unknown; use the model/context picker window fallback. For a
reported window the web takes the largest numeric contextWindow among
`tokenUsage.modelUsage` entries.

## Deliberately omitted / verification

Raw audio voice upload is skipped: voiceTurnAction takes `(conversationId,
transcript:string,pageContext?)`, not an uploaded audio file. Native dictation
can submit its transcript through operator.send. The browser's recording,
client-local panel layout/window ownership and automatic navigation are UI work.
Folder bind/reorder/delete/ensure-entity actions were outside the requested set;
filing a thread under an entity still creates its job folder through the web.

`node --test tests/mobile-rpc.test.mjs` covers the production operator whitelist
through dispatcher mocks: AI access, staff agent/express-send restrictions,
owner grant gate, happy-path context/options/attachments forwarding, error poll
continuation, and a missing conversation read (404). No AI runs or database
writes. Coordinator must wire the registry and smoke-test real bearer requests,
file upload, staff run ownership and approval preview in the QA app.
