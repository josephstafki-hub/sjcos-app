# Canvas Phase 3 implementation handoff

2026-11-06 · branch `t3/canvas-phase2-3` · implementation sub-agent; no delegation.

## Purpose and boundary

An Ask floor canvas retains an immutable saved version of the existing floor designer. It never owns a second design document, changes the live document during Canvas restore, generates an estimate, publishes, or sends. Existing project Floor and `/floor/<id>` use the same design ID. No server, browser, package install, live database/service operation, deploy, or push occurred. The disposable cluster tag is `canvas-floor-p3-1106`; it is stopped before handback.

**This is a module handoff, not an integrated release.** Shared canvas files, the canonical floor page, and web actions were deliberately not edited. Apply the exact patch below after Phase 2 settles; then rerun the integration gates. `canvas.floor_enabled` stays false. Never deploy the floor MCP module alone without its registration/pool/adapter hook.

## Build items → files and contract

| Item | Change |
| --- | --- |
| Migration 0114 / lifecycle | `db/migrations/0114_canvas_floor_refs.sql`: backfilled canonical PostgreSQL-jsonb SHA-256, immutable snapshot identity/doc/hash/rev, design-row-lock numbering for every insert, same-design composite FK, exact project/lead scope guard, deferred atomic floor version/reference requirement, reference-only source payload, immutable reference rows, retained FK RESTRICT, legal purge automatically detaches references without deleting snapshots/designs. Existing privacy guard is preserved verbatim except its old unconditional floor-kind rejection. Requests gain `changed` for idempotent no-op Load latest. |
| Shared snapshot command | `lib/plan-version-writes.ts`: migrate/validate under live-design row lock, exact rev check, canonical hash AND bytes comparison, reuse current matching immutable snapshot; explicit named saves may append duplicates; full restore first snapshots current doc and updates rev atomically. Caller owns transaction. |
| Canvas hooks | `lib/canvas-floor.ts`: `prepareFloorCanvas`, `prepareFloorRestore`, `attachFloorCanvas`, `floorVersionMeta`, `readFloorCanvas`, `restoreFloorCanvas`, `saveFloorVersion`, `floorDeletionBlock`. Caller must already fence the owned live thread, current active person, admitted run, flags, provenance, CAS, quotas, request/event records. No standalone route bypass. Wrong/missing/denied scope is unavailable; lead floors require Projects AND Leads. Updating cannot switch design ID. |
| Serialization / canonical loader | `lib/canvas-floor-preview.ts`: only saved geometry + visual scalar props; no catalog, cost rules, estimates, comments, files, photos, underlays, related-design metadata, catalog/selection identities. `lib/plan-designer-loader.ts` supplies the canonical full page with the same area gate and independent catalog/money/cost-book/estimate filtering. Full-page templates remain supported. |
| Designer adapter | `components/floor/Designer.tsx`, `Canvas2D.tsx`: embedded mode forces readOnly, skips focus refresh/global edit hotkeys and returns before all editing/inspector/autosave/publish chrome; existing normal Designer path remains. Preview starts in plan mode, opt-in lazy 3D, Fit/100% and fine-pointer −/+, pan and pinch. |
| Inline host | `components/panel/canvas/floor/FloorCanvasStage.tsx`, `FloorCanvasPane.tsx`: lazy existing Designer keyed to snapshot, hidden/unselected renderer unmount, live-revision notice with explicit CAS Load latest, design-number title/history, same-design canonical handoff, screen-width-based phone hint, read-only actions and About/restore. Selected snapshot never follows the mutable live doc. |
| Floor MCP | `mcp/floor-tools.mjs`: named person rechecked from captured principal + active user/areas on every tool; lead gates/filtering; panel-bound ops require expected_rev; safe numeric design boundary. Named version saves use admitted website adapter; bare legacy saves use shared command in a pool transaction. No private-reference SELECT grant. No new publication tool. |
| Roles | `deploy/db-roles.manifest.json`: private refs have a no-grants entry. Existing plan snapshot grants cover the shared legacy writer. All new trigger functions are SECURITY DEFINER with fixed search_path. |

`node scripts/db-roles-sql.mjs ask_canvas_floor_refs` prints an empty line (zero GRANT statements). The migration records this exact empty grant result: no narrow role can read/write private references. No additional dependency or migration number is needed. PostgreSQL's `jsonb::text` is the canonical stable-key byte encoding, shared by backfill, hashes, lookup and immutable check; no JS-only hash format diverges from the backfill.

## Verification

Expectations were written before implementation and execution. Geometry uses the real existing plan ops (`addRoomRect`, `placeItem`, `addNote`), not hand-authored toy PlanDocs. The 25 separately named adversarial cases cover malformed/unsafe IDs and opaque/financial/nested item properties.

Every command ran one file at a time, with `SJC_TEST_CLUSTER_TAG=canvas-floor-p3-1106`. Database files exclusively use `tests/_harness/testdb.mjs`, actual website session identity, and disposable connections. No default database URL is used.

| File | Passing / failed |
| --- | --- |
| `tests/canvas-floor-db.test.mjs` | 16 / 0 |
| `tests/canvas-floor-adapter.test.mjs` | 30 / 0 |
| `tests/mcp-floor-tools.test.mjs` | 12 / 0 |
| `tests/plan-ops.test.mjs` | 8 / 0 |
| `tests/agent-profile.test.mjs` | 14 / 0 |
| `tests/db-roles-manifest-db.test.mjs` | 6 / 0 |
| `tests/db-roles-paths-db.test.mjs` | 3 / 0 |

The DB contract exercises snapshot reuse/no duplicated design; missing/scope/Projects/Leads denials; stale rev and op CAS; selected-old/live-new separation; Canvas restore preserving canonical doc; immutable doc/number; cross-design and cross-scope references; referenced design/snapshot deletion; immutable reference/pin omission; own vs foreign/tombstoned deletion notices; legal hold; purge releasing refs only; transaction rollback; full restore's Before snapshot/CAS; actual registered MCP save racing the shared web command and Canvas ensure on separate sessions. An additional test applies only the exact web-action handoff diff in memory to the actual source, then runs real web save AND restore races against the actual registered MCP save and Canvas ensure on separate disposable DB sessions. It verifies unique numbers, a valid atomic restore and its correct Before snapshot. This is prospective patch verification, not a claim the shared files were edited. No-op/idempotency and shared host integration still require the coordinator patch to be applied and exercised through real routes.

Actual `useDesigner` handlers are executed with readOnly=true: apply/preview/undo/redo/save cannot change geometry or call the save action. Remaining adapter checks are structural, not browser/layout/WebGL evidence.

Latest `flock /tmp/sjcos-tsc.lock nice -n 19 npx tsc --noEmit -p .`: **exit 0**. Earlier runs caught and fixed this module's issues; a transient Phase 2 `components/panel/canvas/actions.ts` error disappeared when that builder finished its edit. No shared file was fixed by this agent. Handoff patch has `git apply --check` and TypeScript syntax-transpilation checks; that does not claim integrated typechecking. Scoped `git diff --check` passes.

## Exact coordinator patch (do not enable Floor yet)

Generated against the Phase 2 builder's shared files as present on 2026-11-06. `git apply --check` passed without changing them. `mcp/canvas-tools.mjs` already declares the exact floor input; **no schema change is needed**. The existing CanvasViewer goes through CanvasPane; its single dispatch is there instead of duplicating the host. Extra hunks are necessary for the canonical page, every existing web snapshot allocator, human Load latest route and design-number-only history/cards. Rebase these hunks if Phase 2 changes the same lines; do not overwrite Phase 2 work.

```diff
--- a/lib/ask-canvases.ts
+++ b/lib/ask-canvases.ts
@@ -1,4 +1,5 @@
 import 'server-only';
+import {assertFloorAccess,prepareFloorCanvas,prepareFloorRestore,attachFloorCanvas,readFloorCanvas,floorVersionMeta,saveFloorVersion} from '@/lib/canvas-floor';
 import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
 import type { PoolClient } from 'pg';
 import { pool } from '@/lib/db';
@@ -88,7 +89,7 @@
     const flags = Object.fromEntries(rows.map(r => [r.key, r.value === true || r.value === 'true']));
     const staff = p.role === 'owner' || flags['canvas.staff_enabled'] === true;
     const master = process.env.SJC_CANVAS_ENABLED === '1' && staff && (await schemaCapabilities(db)).canvas;
-    const a = { master, diagrams: master && flags['canvas.diagrams_enabled'] === true, pages: master && flags['canvas.pages_enabled'] === true, floor: false, exports: master && (flags['canvas.diagrams_enabled'] === true || flags['canvas.pages_enabled'] === true) && flags['canvas.exports_enabled'] === true && (await schemaCapabilities(db)).files, staff, source: master && flags['canvas.source_enabled'] !== false };
+    const a = { master, diagrams: master && flags['canvas.diagrams_enabled'] === true, pages: master && flags['canvas.pages_enabled'] === true, floor: master && flags['canvas.floor_enabled'] === true && (await db.query("SELECT to_regclass('ask_canvas_floor_refs') IS NOT NULL AS ready")).rows[0].ready, exports: master && (flags['canvas.diagrams_enabled'] === true || flags['canvas.pages_enabled'] === true) && flags['canvas.exports_enabled'] === true && (await schemaCapabilities(db)).files, staff, source: master && flags['canvas.source_enabled'] !== false };
     return { revision: hash([a, rows]).slice(0, 24), ...a }; // Floor remains off; 0108 gates static exports.
 }
 function gate(a: Availability, kind?: string, write = false) { if (!a.master || !a.staff)
@@ -131,11 +132,11 @@
 async function human(): Promise<Actor> { const p = await threadPrincipal(); return { person: { ...p, permissions: [], name: '' }, runId: null, internal: false }; }
 async function load(db: PoolClient, a: Actor, id: string): Promise<Row> { uuid(id); const row = (await db.query(`SELECT c.*,p.slug AS project_slug,l.slug AS lead_slug FROM ask_canvases c LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN leads l ON l.id=c.lead_id WHERE c.id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL FOR UPDATE OF c`, [id, a.person.id])).rows[0]; if (!row)
     fail('CANVAS_UNAVAILABLE'); await ownThread(db, a, row.conversation_id); if (!permitted(a.person, row.required_areas) || (row.project_id && !permitted(a.person, ['projects'])) || (row.lead_id && !permitted(a.person, ['leads'])))
-    fail('CANVAS_UNAVAILABLE'); return row; }
+    fail('CANVAS_UNAVAILABLE'); if(row.kind==='floor_plan')assertFloorAccess(a.person,{project_id:row.project_id,lead_slug:row.lead_slug}); return row; }
 async function version(db: PoolClient, c: Row, n: number): Promise<Row> { const row = (await db.query('SELECT v.*,u.name AS actor_name FROM ask_canvas_versions v JOIN users u ON u.id=v.actor_user_id WHERE canvas_id=$1 AND version=$2 AND purged_at IS NULL', [c.id, n])).rows[0]; if (!row)
-    fail('CANVAS_UNAVAILABLE'); return row; }
+    fail('CANVAS_UNAVAILABLE'); if(c.kind==='floor_plan')row.floor_design=await floorVersionMeta(db,c.id,n); return row; }
 function meta(c: Row): CanvasMeta { return { id: c.id, thread_id: c.conversation_id, user_id: c.owner_user_id, created_run_id: c.created_run_id, kind: c.kind, project_slug: c.project_slug ?? null, lead_slug: c.lead_slug ?? null, latest_version: c.latest_version, created_at: iso(c.created_at), updated_at: iso(c.updated_at) }; }
-function vm(v: Row): VersionMeta { return { version: v.version, title: v.title, summary: v.summary, change_note: v.change_note, actor: { id: v.actor_user_id, name: String(v.actor_name).slice(0, 120) }, run_id: v.run_id, created_at: iso(v.created_at), restored_from_version: v.restored_from_version, design: null }; }
+function vm(v: Row): VersionMeta { return { version: v.version, title: v.title, summary: v.summary, change_note: v.change_note, actor: { id: v.actor_user_id, name: String(v.actor_name).slice(0, 120) }, run_id: v.run_id, created_at: iso(v.created_at), restored_from_version: v.restored_from_version, design: v.floor_design ?? null }; }
 async function classify(db: PoolClient, a: Actor, threadId: string, parent: string[], labels: string[]) {
     const p = await conversationProvenance({ client: db, threadId });
     const complete = p.complete === true && Array.isArray(p.areas);
@@ -154,6 +155,12 @@
     const v = await version(db, c, input.version ?? c.latest_version);
     const canPreview = c.kind === 'diagram' && av.diagrams || c.kind === 'page' && av.pages;
     const result: CanvasGetResponse = { ok: true, canvas: meta(c), selected: vm(v), availability: av, capabilities: { preview: canPreview, code: av.source, download_formats: av.exports && canPreview ? (c.kind === 'page' ? ['html'] : ['svg', 'mmd']) : [], save: av.exports && canPreview && permitted(a.person,['projects']), restore: c.kind !== 'floor_plan' && canPreview, load_latest: false }, preview: canPreview ? { mode: c.kind === 'page' ? 'static_page' : 'diagram_renderer', href: c.kind === 'page' ? `/api/canvas/${id}/versions/${v.version}/preview` : '/api/canvas/renderer', renderer_version: v.renderer_version } : null };
+    if(c.kind==='floor_plan') {
+        const floor=await readFloorCanvas(db,a,c as any,v.version);
+        result.capabilities={preview:av.floor,code:false,download_formats:[],save:false,restore:av.floor,load_latest:av.floor&&floor.changed};
+        result.preview=av.floor?{mode:'floor',href:null,renderer_version:'1'}:null;
+        if(av.floor)result.floor=floor;
+    }
     if (input.include_source) {
         if (!av.source)
             fail('CANVAS_DISABLED');
@@ -183,28 +190,31 @@
         const current = await load(db, a, old.canvas_id);
         gate(av, current.kind);
         await classify(db, a, threadId, current.required_areas, []);
-        return mutationResult(current, await version(db, current, old.version), av);
+        return {...mutationResult(current, await version(db, current, old.version), av),changed:old.changed!==false};
     }
     let source = input.content, from: Row | undefined;
     if (c && input.restore_version) {
-        if (c.kind === 'floor_plan')
-            fail('UNSUPPORTED_KIND');
         from = await version(db, c, input.restore_version);
         source = { kind: c.kind, source: from.source_text };
     }
     if (c && input.base_version !== c.latest_version)
         fail('VERSION_CONFLICT', { latest_version: c.latest_version });
-    if (source?.kind === 'floor_plan')
-        fail('UNSUPPORTED_KIND');
     if (c && source?.kind !== c.kind)
         fail('INVALID_INPUT');
     gate(av, source?.kind, true);
-    const validated = validateCanvasContent(source);
+    const floor=source?.kind==='floor_plan' ? (from&&c ? await prepareFloorRestore(db,a,c as any,from.version) : await prepareFloorCanvas(db,a,source,c as any)) : null;
+    if(floor)source={kind:'floor_plan',source:floor.source};
+    const validated = floor ? null : validateCanvasContent(source);

     const policy = await classify(db, a, threadId, c?.required_areas ?? [], input.required_areas ?? []);
     const title = input.title ?? from?.title ?? (c ? (await version(db, c, c.latest_version)).title : undefined);
     const summary = input.summary ?? from?.summary;
-    const note = input.change_note ?? (from ? `Restored Version ${from.version}` : '');
+    const note = input.change_note ?? (from ? (floor?`Restored floor plan v${floor.snapshot.number}`:`Restored Version ${from.version}`) : '');
+    if(floor&&c&&!from&&(await floorVersionMeta(db,c.id,c.latest_version))?.snapshot_id===floor.snapshot.id) {
+        await db.query(`UPDATE ask_canvases SET required_areas=$2,baseline_hash=$3,classification_revision=classification_revision+1 WHERE id=$1`,[c.id,policy.areas,policy.baselineHash]);
+        await db.query(`INSERT INTO ask_canvas_requests(conversation_id,request_id,owner_user_id,actor_user_id,action,input_hash,effective_policy_hash,canvas_id,version,run_id,changed) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,false)`,[threadId,input.request_id,a.person.id,action,inputHash,policy.baselineHash,c.id,c.latest_version,a.runId]);
+        return {...mutationResult(c,await version(db,c,c.latest_version),av),changed:false};
+    }
     if (action === 'show') {
         let projectId = null, projectSlug = null;
         if (input.project_slug) {
@@ -216,7 +226,8 @@
             projectId = p.id;
             projectSlug = p.slug;
         }
-        c = (await db.query(`INSERT INTO ask_canvases(conversation_id,owner_user_id,created_run_id,kind,project_id,required_areas,baseline_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [threadId, a.person.id, a.runId, source.kind, projectId, policy.areas, policy.baselineHash])).rows[0];
+        if(floor){if(input.project_slug&&input.project_slug!==(floor as any).project_slug)fail('CANVAS_UNAVAILABLE');projectId=floor.project_id;projectSlug=(floor as any).project_slug;}
+        c = (await db.query(`INSERT INTO ask_canvases(conversation_id,owner_user_id,created_run_id,kind,project_id,required_areas,baseline_hash,lead_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [threadId, a.person.id, a.runId, source.kind, projectId, policy.areas, policy.baselineHash,floor?.lead_id??null])).rows[0];
         c!.project_slug = projectSlug;
     }
     else {
@@ -225,7 +236,8 @@
     const n = action === 'show' ? 1 : c!.latest_version + 1;
     if (n > 100)
         fail('QUOTA_EXCEEDED', { limit: 100 });
-    const v = (await db.query(`INSERT INTO ask_canvas_versions(canvas_id,version,conversation_id,owner_user_id,actor_user_id,run_id,title,summary,change_note,source_text,source_bytes,source_sha256,provenance_revision,provenance_complete,provenance_manifest_hash,provenance_inputs,baseline_areas,baseline_hash,restored_from_version,canonical_content) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [c!.id, n, threadId, a.person.id, a.runId, title, summary, note, source.source, Buffer.byteLength(source.source), hash(source.source), policy.revision, policy.complete, policy.manifestHash, JSON.stringify(policy.inputs), policy.areas, policy.baselineHash, from?.version ?? null, source.kind==='page'?JSON.stringify({html:validated.source,validator_version:validated.validator_version}):null])).rows[0];
+    const v = (await db.query(`INSERT INTO ask_canvas_versions(canvas_id,version,conversation_id,owner_user_id,actor_user_id,run_id,title,summary,change_note,source_text,source_bytes,source_sha256,provenance_revision,provenance_complete,provenance_manifest_hash,provenance_inputs,baseline_areas,baseline_hash,restored_from_version,canonical_content) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [c!.id, n, threadId, a.person.id, a.runId, title, summary, note, source.source, Buffer.byteLength(source.source), hash(source.source), policy.revision, policy.complete, policy.manifestHash, JSON.stringify(policy.inputs), policy.areas, policy.baselineHash, from?.version ?? null, source.kind==='page'?JSON.stringify({html:validated!.source,validator_version:validated!.validator_version}):null])).rows[0];
+    if(floor){await attachFloorCanvas(db,c as any,n,floor.snapshot);v.floor_design=floor.design;}
     v.actor_name = a.person.name;
     c = (await db.query('UPDATE ask_canvases SET latest_version=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [c!.id, n])).rows[0];
     await db.query(`INSERT INTO ask_canvas_requests(conversation_id,request_id,owner_user_id,actor_user_id,action,input_hash,effective_policy_hash,canvas_id,version,run_id) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9)`, [threadId, input.request_id, a.person.id, action, inputHash, policy.baselineHash, c!.id, n, a.runId]);
@@ -293,6 +305,7 @@
         const rows = (await db.query('SELECT v.*,u.name AS actor_name FROM ask_canvas_versions v JOIN users u ON u.id=v.actor_user_id WHERE canvas_id=$1 AND purged_at IS NULL AND ($2::int IS NULL OR version<$2) ORDER BY version DESC LIMIT $3', [id, p.before ?? null, (p.limit ?? 20) + 1])).rows;
         const out: CanvasVersionsResponse = { ok: true, versions: [], next_before: null, availability: av };
         for (const r of rows.slice(0, p.limit ?? 20)) {
+            if(c.kind==='floor_plan')r.floor_design=await floorVersionMeta(db,c.id,r.version);
             const v = vm(r);
             if (Buffer.byteLength(JSON.stringify({ ...out, versions: [...out.versions, v] })) > 15500)
                 break;
@@ -353,13 +366,13 @@
     return { ok: true, events, cursor: cursor(a, threadId, 'after', nextHigh, nextHigh), next_before: events.length ? cursor(a, threadId, 'before', events[0].id, high) : null, has_more: rows.length > events.length, availability: av };
 }
 export async function canvasInternal(action: string, input: unknown, context: unknown): Promise<unknown> {
-    if (!['show', 'update', 'get', 'list', 'admit'].includes(action))
+    if (!['show', 'update', 'get', 'list', 'admit', 'floor_save'].includes(action))
         fail('INVALID_INPUT');
     const ctx = context as Row;
     if (!ctx || Object.keys(ctx).sort().join(',') !== 'principal_user_id,run_id,run_profile,run_started_s,transport' || ctx.transport !== 'runner_stdio' || ![ctx.run_id, ctx.principal_user_id].every(v => typeof v === 'string' && idPattern.test(v)) || !['operator', 'business'].includes(ctx.run_profile) || !Number.isSafeInteger(ctx.run_started_s) || ctx.run_started_s <= 0)
         fail('RUN_CONTEXT_REQUIRED');
     abuseLimit(ctx.principal_user_id);
-    const parsed = action === 'admit' ? input as Row : parse(action as 'show', input);
+    const parsed = action === 'admit' || action === 'floor_save' ? input as Row : parse(action as 'show', input);
     if (action === 'admit' && (!parsed || Object.keys(parsed).join(',') !== 'conversation_id' || typeof parsed.conversation_id !== 'string' || !idPattern.test(parsed.conversation_id)))
         fail('RUN_CONTEXT_REQUIRED');
     return withAskJournal(pool, async () => {
@@ -369,7 +382,7 @@
         let entered = false;
         try {
             return await withPrivateRunner(pool, { ...ctx, conversation_id: run.conversation_id }, async () => { entered = true; if (action === 'admit')
-                return { ok: true }; return tx<unknown>({ person: { id: ctx.principal_user_id, role: 'owner', permissions: [], name: '' }, threadId: run.conversation_id, runId: ctx.run_id, internal: true }, (db, a) => action === 'show' || action === 'update' ? mutation(db, a, action, parsed) : action === 'get' ? getIn(db, a, parsed.canvas_id, parsed) : listIn(db, a, run.conversation_id, parsed)); });
+                return { ok: true }; return tx<unknown>({ person: { id: ctx.principal_user_id, role: 'owner', permissions: [], name: '' }, threadId: run.conversation_id, runId: ctx.run_id, internal: true }, (db, a) => action === 'floor_save' ? saveFloorVersion(db,a,parsed) : action === 'show' || action === 'update' ? mutation(db, a, action, parsed) : action === 'get' ? getIn(db, a, parsed.canvas_id, parsed) : listIn(db, a, run.conversation_id, parsed)); });
         }
         catch (e) {
             if (!entered)
@@ -446,3 +459,14 @@
         return fn(db, a, c, v);
     });
 }
+
+export async function canvasFloorLatest(id:string,input:unknown):Promise<CanvasMutationResponse> {
+ const a=await human(),p=input as Row;
+ if(!p||Object.keys(p).sort().join(',')!=='base_version,expected_design_rev,request_id'||!Number.isSafeInteger(p.expected_design_rev)||p.expected_design_rev<0)fail('INVALID_INPUT');
+ return tx(a,async(db,a)=>{
+  const c=await load(db,a,id);if(c.kind!=='floor_plan')fail('INVALID_INPUT');
+  const v=await version(db,c,c.latest_version),design=await floorVersionMeta(db,c.id,c.latest_version);
+  const parsed=parse('update',{request_id:p.request_id,canvas_id:id,base_version:p.base_version,summary:v.summary,change_note:'Loaded latest floor plan',content:{kind:'floor_plan',design_id:design!.id,expected_design_rev:p.expected_design_rev}});
+  return mutation(db,a,'update',parsed,id);
+ });
+}
--- a/lib/canvas-api-types.ts
+++ b/lib/canvas-api-types.ts
@@ -10,7 +10,7 @@
 export type CanvasErrorCode = 'CANVAS_DISABLED'|'AUTH_REQUIRED'|'CANVAS_UNAVAILABLE'|'CONTEXT_PROVENANCE_INCOMPLETE'|'RUN_CONTEXT_REQUIRED'|'INVALID_INPUT'|'UNSUPPORTED_KIND'|'UNSAFE_CONTENT'|'CONTENT_TOO_LARGE'|'TOO_COMPLEX'|'VERSION_CONFLICT'|'DESIGN_CHANGED'|'IDEMPOTENCY_CONFLICT'|'QUOTA_EXCEEDED'|'RENDER_FAILED'|'RENDER_TIMEOUT'|'EXPORT_NOT_READY'|'SAVE_POLICY_CHANGED'|'SAVE_POLICY_CONFLICT'|'FILE_RESTORE_CONFLICT'|'RENDERER_HASH_CONFLICT'|'SAVE_FAILED'|'INTERNAL_ERROR'|'ASK_PAUSED';
 export type CanvasError = {ok:false;code:CanvasErrorCode;message:string;retryable:boolean;details?:Record<string,unknown>};
 export type CanvasCodeResponse = {ok:true;canvas_id:string;version:number;kind:'diagram'|'page';code:string;sha256:string;untrusted:true;availability:Availability};
-export type CanvasGetResponse = {ok:true;canvas:CanvasMeta;selected:VersionMeta;availability:Availability;capabilities:CanvasCapabilities;preview:CanvasPreview;code?:CanvasCodeResponse};
+export type CanvasGetResponse = {ok:true;canvas:CanvasMeta;selected:VersionMeta;availability:Availability;capabilities:CanvasCapabilities;preview:CanvasPreview;code?:CanvasCodeResponse;floor?:import('@/components/panel/canvas/floor/FloorCanvasStage').FloorCanvasPreview};
 export type CanvasMutationResponse = {ok:true;canvas:CanvasMeta;selected:VersionMeta;changed:boolean;card:{canvas_id:string;run_id:string|null;version:number};href:string;availability:Availability};
 export type CanvasListResponse = {ok:true;canvases:{canvas:CanvasMeta;latest:VersionMeta}[];next_cursor:string|null;availability:Availability};
 export type CanvasVersionsResponse = {ok:true;versions:VersionMeta[];next_before:number|null;availability:Availability};
--- a/components/panel/CanvasPane.tsx
+++ b/components/panel/CanvasPane.tsx
@@ -5,6 +5,7 @@
 const CanvasSaveDialog=lazy(()=>import('./CanvasSaveDialog').then(m=>({default:m.CanvasSaveDialog})));
 import {CanvasVersions} from './CanvasVersions';
 import {CanvasOverlay} from './canvas/CanvasOverlay';
+import {FloorCanvasPane} from './canvas/floor/FloorCanvasPane';
 import {PageStage} from './canvas/PageStage';
 import {DiagramStage} from './canvas/DiagramStage';
 import {canvasState,canvasServerState,subscribeCanvas,patchCanvas,loadCanvas,chooseCanvas,selectCanvasVersion,askCanvasChange,publishCanvases,updateCanvas} from './canvas/store';
@@ -45,6 +46,7 @@
  };
  const copyButton=<button disabled={!view.code} className="min-h-11 rounded border border-rule px-3" onClick={()=>void copy()}>Copy code</button>;
  const codeBlock=<>{isPage&&<p className="py-2 text-body">This page can show text, tables, and drawings. Ask Claude to change it.</p>}<p className="py-2 text-meta text-ink-3">{kindLabel} code · Untrusted text · Version {number}</p>{copyButton}<pre tabIndex={0} className="mt-2 overflow-auto whitespace-pre p-3 font-mono text-[13px] [font-variant-ligatures:none] [font-feature-settings:'liga'_0,'calt'_0]">{view.code?.code??'Loading code…'}</pre></>;
+ if(data?.canvas.kind==='floor_plan')return <FloorCanvasPane context={context} slot={slot} data={data}/>;
  if(slot==='title')return <div className="flex min-w-0 items-center"><button data-canvas-title className="h-11 min-w-0 flex-1 truncate px-2 text-left font-serif text-subheading" onClick={()=>sheet('picker')}>{view.error?'Canvas':v?.title??snapshot.label} ▾</button><button className="size-11 shrink-0 rounded" aria-label="Canvas actions" onClick={()=>sheet('menu')}>⋯</button></div>;
  if(slot==='meta')return view.error?<span/>:<span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
   {id!=='empty'&&<span className="min-w-0 truncate">{kindLabel} · Version {number} of {latest}</span>}
--- a/components/panel/CanvasVersions.tsx
+++ b/components/panel/CanvasVersions.tsx
@@ -8,8 +8,8 @@
  const load=async(signal?:AbortSignal,boundary?:number)=>{setLoading(true);setError(false);try{const p=await canvasFetch<CanvasVersionsResponse>(`/api/canvas/${id}/versions?limit=20${boundary?`&before=${boundary}`:''}`,signal);if(!signal?.aborted){setRows(old=>boundary?[...old,...p.versions]:p.versions);setBefore(p.next_before);}}catch{if(!signal?.aborted){setRows([]);setError(true);}}finally{if(!signal?.aborted)setLoading(false);}};
  useEffect(()=>{const c=new AbortController();void load(c.signal);return ()=>c.abort();},[id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <CanvasOverlay title="Versions" onClose={onClose}>
-  {rows.map(v=><button key={v.version} aria-current={v.version===selected?'true':undefined} onClick={()=>{onSelect(v.version);onClose();}} className="flex min-h-14 w-full flex-col justify-center border-b border-rule px-2 text-left">
-   <span>Version {v.version}{v.version===selected?' ✓':''}</span><span className="text-meta text-ink-3">{canvasVersionByline(v.change_note,v.actor.name)}{(v.change_note.trim()||v.actor.name.trim())?' · ':''}<time dateTime={v.created_at}>{canvasVersionTime(v.created_at)}</time></span>
+  {rows.filter((v,i,a)=>!v.design||a.findIndex(x=>x.design?.snapshot_id===v.design?.snapshot_id)===i).map(v=><button key={v.version} aria-current={v.version===selected?'true':undefined} onClick={()=>{onSelect(v.version);onClose();}} className="flex min-h-14 w-full flex-col justify-center border-b border-rule px-2 text-left">
+   <span>{v.design?`Floor plan · ${v.title} · v${v.design.number}`:`Version ${v.version}`}{v.version===selected?' ✓':''}</span><span className="text-meta text-ink-3">{canvasVersionByline(v.change_note,v.actor.name)}{(v.change_note.trim()||v.actor.name.trim())?' · ':''}<time dateTime={v.created_at}>{canvasVersionTime(v.created_at)}</time></span>
   </button>)}
   {loading&&<p role="status">Loading versions…</p>}{error&&<p role="alert">Couldn&apos;t load versions. <button className="min-h-11" onClick={()=>void load(undefined,before??undefined)}>Try again</button></p>}
   {before&&!loading&&<button className="min-h-11" onClick={()=>void load(undefined,before)}>Older versions</button>}
--- a/components/panel/CanvasCard.tsx
+++ b/components/panel/CanvasCard.tsx
@@ -17,14 +17,15 @@
  if(!event||!('version' in event))return null;
  const v=event.version,older=(latestVersion??v.version)>v.version;
  const disabled=showing&&!older;
+ const versionLabel=v.design?`floor plan v${v.design.number}`:`version ${v.version}`;
  return <article className="rounded-md border border-rule bg-card p-3">
   <div className="flex items-center gap-2"><Workflow className="size-4 shrink-0" aria-hidden="true"/><h3 className="truncate font-serif text-subheading">{v.title}</h3></div>
-  <p className="text-meta text-ink-3">{label} · Version {v.version}{older?' · Newer version available':''}</p>
+  <p className="text-meta text-ink-3">{label} · {v.design?`v${v.design.number}`:`Version ${v.version}`}{older?' · Newer version available':''}</p>
   <p className="line-clamp-1 text-body text-ink-2">{v.summary}</p>
   {stopped&&<p className="text-meta text-ink-3">Canvas saved before the run stopped.</p>}
   {event.kind==='saved'&&<p className="text-meta text-ink-3">Saved to {event.project_name}</p>}
   <button className="min-h-11 rounded-md border border-rule bg-card px-3 text-body text-ai-2 focus-visible:outline-2 focus-visible:outline-focus" aria-disabled={disabled||undefined}
-   aria-label={disabled?'Showing':older?`Open version ${v.version}: ${v.title}, ${label.toLowerCase()}, newer version available`:`Open canvas: ${v.title}, ${label.toLowerCase()}, version ${v.version}`}
-   onClick={e=>{if(!disabled)onOpen(event.canvas_id,v.version,e.currentTarget);}}>{disabled?'Showing':older?`Open version ${v.version}`:'Open canvas'}</button>
+   aria-label={disabled?'Showing':older?`Open ${versionLabel}: ${v.title}, ${label.toLowerCase()}, newer version available`:`Open canvas: ${v.title}, ${label.toLowerCase()}, ${versionLabel}`}
+   onClick={e=>{if(!disabled)onOpen(event.canvas_id,v.version,e.currentTarget);}}>{disabled?'Showing':older?`Open ${versionLabel}`:'Open canvas'}</button>
  </article>;
 }
--- a/components/panel/canvas/actions.ts
+++ b/components/panel/canvas/actions.ts
@@ -5,10 +5,10 @@
 export async function canvasPanelIdentity(threadId:string|null){
  if(process.env.SJC_CANVAS_ENABLED!=='1')return {ok:false as const,code:'CANVAS_DISABLED'};
  try{const user=await threadPrincipal();if(threadId)await requireThreadAccess(threadId,user);if(!threadId){
-   const rows=await pool.query("SELECT key,value FROM app_settings WHERE key=ANY($1)",[['canvas.staff_enabled','canvas.diagrams_enabled','canvas.pages_enabled']]);
+   const rows=await pool.query("SELECT key,value FROM app_settings WHERE key=ANY($1)",[['canvas.staff_enabled','canvas.diagrams_enabled','canvas.pages_enabled','canvas.floor_enabled']]);
    const flags=Object.fromEntries(rows.rows.map(r=>[r.key,r.value===true||r.value==='true']));
    const master=user.role==='owner'||flags['canvas.staff_enabled']===true;
-   const availability:Availability={revision:'empty',master,diagrams:master&&flags['canvas.diagrams_enabled']===true,pages:master&&flags['canvas.pages_enabled']===true,floor:false,exports:false,staff:master,source:false};
+   const availability:Availability={revision:'empty',master,diagrams:master&&flags['canvas.diagrams_enabled']===true,pages:master&&flags['canvas.pages_enabled']===true,floor:master&&flags['canvas.floor_enabled']===true,exports:false,staff:master,source:false};
    return {ok:true as const,userId:user.id,availability};
   }
   return {ok:true as const,userId:user.id};}catch(e){return askFailure(e);}
--- a/mcp/sjcos-mcp.mjs
+++ b/mcp/sjcos-mcp.mjs
@@ -2954,7 +2954,7 @@
   // deletes, nothing client-facing), just kept separate to keep this file from
   // growing without bound. See mcp/mood-tools.mjs.
   registerMoodTools(server, { rows, json, uploadDir: path.join(__dirname, "..", "uploads") });
-  registerFloorTools(server, { rows, json });
+  registerFloorTools(server, { rows, json, pool, currentPrincipal, saveSnapshot: input => canvasCall('floor_save',input) });

   // Project financials (job costing): what a job is priced at, has cost, and
   // should make — the same queries, math and writes the app's Money › Overview
--- /dev/null
+++ b/app/api/canvas/[id]/floor-latest/route.ts
@@ -0,0 +1,8 @@
+import { canvasFloorLatest, canvasHumanBody, canvasHumanJson as canvasJson, canvasSameOrigin } from '@/lib/ask-canvases';
+export const runtime = 'nodejs';
+export const dynamic = 'force-dynamic';
+export async function POST(req: Request, { params }: {
+    params: Promise<{
+        id: string;
+    }>;
+}) { return canvasJson(async () => { canvasSameOrigin(req); const { id } = await params; return canvasFloorLatest(id, await canvasHumanBody(req, 8192)); }); }
--- a/app/(os)/floor/[id]/page.tsx
+++ b/app/(os)/floor/[id]/page.tsx
@@ -2,16 +2,7 @@
 import { Shell } from "@/components/shell/Shell";
 import { Designer } from "@/components/floor/Designer";
 import { requireAccess } from "@/lib/dal";
-import {
-  getPlaceableCatalog,
-  getPlanCostRules,
-  getPlanDesign,
-  listPlanDesignComments,
-  listPlanDesignFiles,
-  listPlanDesignVersions,
-} from "@/lib/plan-designs";
-import { listEstimateTargets } from "@/lib/actions/plan-estimate";
-
+import {loadPlanDesigner} from '@/lib/plan-designer-loader';
 // The floor-plan designer (docs/floor-plan-designer-plan.md §2). Server page
 // loads the live design + everything the inspector needs; the Designer is a
 // client component (the 3D scene inside it is loaded client-only).
@@ -28,17 +19,9 @@
   const designId = Number(id);
   if (!Number.isFinite(designId)) notFound();

-  const design = await getPlanDesign(designId);
-  if (!design) notFound();
-
-  const [catalog, rules, comments, files, versions, estimateTargets] = await Promise.all([
-    getPlaceableCatalog(),
-    getPlanCostRules(),
-    listPlanDesignComments(designId),
-    listPlanDesignFiles(designId),
-    listPlanDesignVersions(designId),
-    user.role === "owner" || user.permissions.includes("estimates") ? listEstimateTargets(designId) : Promise.resolve([]),
-  ]);
+  const loaded = await loadPlanDesigner(user,designId).catch(()=>null);
+  if(!loaded)notFound();
+  const {design}=loaded;

   const crumb = design.projectName
     ? `FLOOR PLAN › ${design.projectName.toUpperCase()} › ${design.name.toUpperCase()}`
@@ -49,15 +32,7 @@
   return (
     <Shell breadcrumb={crumb}>
       <Designer
-        design={design}
-        catalog={catalog}
-        costRuleKeys={rules.filter((r) => r.enabled).map((r) => r.measure)}
-        comments={comments}
-        files={files}
-        versions={versions}
-        estimateTargets={estimateTargets}
-        readOnly={false}
-        isOwner={user.role === "owner"}
+        {...loaded}
         initialPanel={sp.comments ? "comments" : (sp.panel as "properties" | undefined) ?? undefined}
       />
     </Shell>
--- a/lib/actions/plan-designs.ts
+++ b/lib/actions/plan-designs.ts
@@ -8,6 +8,9 @@
 // lib/actions/plan-publish.ts and plan-estimate.ts.

 import { revalidatePath } from "next/cache";
+import {pool} from '@/lib/db';
+import {savePlanSnapshot,restorePlanSnapshot,lockPlanDesign} from '@/lib/plan-version-writes';
+import {assertFloorAccess,floorDeletionBlock} from '@/lib/canvas-floor';
 import { query, queryOne } from "@/lib/db";
 import { requireAccess } from "@/lib/dal";
 import { getDesignerDefaults } from "@/lib/plan-designs";
@@ -162,12 +165,14 @@
 }

 export async function deletePlanDesign(id: number): Promise<Result> {
-  await requireAccess("projects");
+  const user=await requireAccess("projects");
   const row = await queryOne<{ project_slug: string | null; lead_slug: string | null }>(
     `SELECT p.slug AS project_slug, d.lead_slug FROM plan_designs d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = $1`,
     [id],
   );
   if (!row) return { ok: false, error: "Design not found." };
+  const block=await floorDeletionBlock(pool,user,String(id));
+  if(block)return {ok:false,error:block.message};
   await query(`DELETE FROM plan_designs WHERE id = $1`, [id]);
   revalidatePath("/floor");
   if (row.project_slug) revalidatePath(`/projects/${row.project_slug}`);
@@ -181,14 +186,10 @@
   label: string,
 ): Promise<{ ok: true; versionId: number; number: number } | { ok: false; error: string }> {
   const user = await requireAccess("projects");
-  const src = await queryOne<{ doc: unknown }>(`SELECT doc FROM plan_designs WHERE id = $1`, [id]);
-  if (!src) return { ok: false, error: "Design not found." };
-  const row = await queryOne<{ id: string; number: number }>(
-    `INSERT INTO plan_design_versions (design_id, number, label, doc, created_by)
-     VALUES ($1, (SELECT COALESCE(MAX(number), 0) + 1 FROM plan_design_versions WHERE design_id = $1), $2, $3::jsonb, $4)
-     RETURNING id, number`,
-    [id, cleanName(label), JSON.stringify(migrateDoc(src.doc)), user.id],
-  );
+  const tx=await pool.connect();let row;
+  try{await tx.query('BEGIN');const d=await lockPlanDesign(tx,String(id));assertFloorAccess(user,d);row=await savePlanSnapshot(tx,String(id),user.id,cleanName(label));await tx.query('COMMIT');}
+  catch(e){await tx.query('ROLLBACK');return {ok:false,error:e instanceof Error?e.message:'Could not save floor plan.'};}finally{tx.release();}
+
   await revalidateDesign(id);
   return { ok: true, versionId: Number(row!.id), number: row!.number };
 }
@@ -197,29 +198,17 @@
  *  first saved as a version labelled "Before restore" so nothing is lost). */
 export async function restorePlanVersion(versionId: number): Promise<{ ok: true; rev: number } | { ok: false; error: string }> {
   const user = await requireAccess("projects");
-  const v = await queryOne<{ design_id: string; number: number; doc: unknown }>(
-    `SELECT design_id, number, doc FROM plan_design_versions WHERE id = $1`,
-    [versionId],
-  );
-  if (!v) return { ok: false, error: "Version not found." };
-  const designId = Number(v.design_id);
-  const live = await queryOne<{ doc: unknown }>(`SELECT doc FROM plan_designs WHERE id = $1`, [designId]);
-  if (!live) return { ok: false, error: "Design not found." };
-  await query(
-    `INSERT INTO plan_design_versions (design_id, number, label, doc, created_by)
-     VALUES ($1, (SELECT COALESCE(MAX(number), 0) + 1 FROM plan_design_versions WHERE design_id = $1), $2, $3::jsonb, $4)`,
-    [designId, `Before restoring v${v.number}`, JSON.stringify(migrateDoc(live.doc)), user.id],
-  );
-  const updated = await queryOne<{ rev: number }>(
-    `UPDATE plan_designs SET doc = $2::jsonb, rev = rev + 1, updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING rev`,
-    [designId, JSON.stringify(migrateDoc(v.doc)), user.id],
-  );
+  const tx=await pool.connect();let designId:number,updated;
+  try{await tx.query('BEGIN');const v=(await tx.query('SELECT design_id FROM plan_design_versions WHERE id=$1',[versionId])).rows[0];if(!v)throw Error('Version not found.');
+   designId=Number(v.design_id);const d=await lockPlanDesign(tx,v.design_id);assertFloorAccess(user,d);updated=await restorePlanSnapshot(tx,String(versionId),d.rev,user.id);await tx.query('COMMIT');}
+  catch(e){await tx.query('ROLLBACK');return {ok:false,error:e instanceof Error?e.message:'Could not restore floor plan.'};}finally{tx.release();}
+
   await revalidateDesign(designId);
   return { ok: true, rev: updated!.rev };
 }

 export async function deletePlanVersion(versionId: number): Promise<Result> {
-  await requireAccess("projects");
+  const user=await requireAccess("projects");
   const v = await queryOne<{ design_id: string; published: string | null }>(
     `SELECT v.design_id, (SELECT id FROM project_floorplans f WHERE f.design_version_id = v.id LIMIT 1) AS published
        FROM plan_design_versions v WHERE v.id = $1`,
@@ -227,6 +216,8 @@
   );
   if (!v) return { ok: false, error: "Version not found." };
   if (v.published) return { ok: false, error: "This version was published to the client — remove that floor plan first." };
+  const block=await floorDeletionBlock(pool,user,String(v.design_id),String(versionId));
+  if(block)return {ok:false,error:block.message};
   await query(`DELETE FROM plan_design_versions WHERE id = $1`, [versionId]);
   await revalidateDesign(Number(v.design_id));
   return { ok: true };

```

## Private query allowlist merge

Computed with `scanTree` from `tests/_harness/ask-private-query-scan.mjs`. Merge `sources` by file and replace `entries` for the same file/function pairs. Do not apply these entries as authorization; the existing thread/run/person fences remain required. After the shared patch, independently recompute/review its shared-file hashes as well.

```json
{
  "sources": {
    "lib/canvas-floor.ts": "7133631661a8a7b7261e7d545f2621f4d13f3d578ac4c30810af770de89b27f5",
    "db/migrations/0114_canvas_floor_refs.sql": "acfba36e45e39f956fb98c1c4325209f444baec7d5c08b2e4707b83126dbb6ab"
  },
  "entries": [
    {
      "file": "lib/canvas-floor.ts",
      "function": "attachFloorCanvas",
      "reason": "fenced-by-helper",
      "classification": "fenced",
      "explanation": "Owner Canvas transaction supplies current person, owned live thread, admitted run and current area checks; deletion preflight only returns own readable links, otherwise fixed generic refusal. Floor MCP uses captured currentPrincipal and rereads active area permissions.",
      "queries": [
        "63dc925beb73b5827b497e69139bc307d321f10eda10f443cc5a215f6638e858"
      ]
    },
    {
      "file": "lib/canvas-floor.ts",
      "function": "floorVersionMeta",
      "reason": "fenced-by-helper",
      "classification": "fenced",
      "explanation": "Owner Canvas transaction supplies current person, owned live thread, admitted run and current area checks; deletion preflight only returns own readable links, otherwise fixed generic refusal. Floor MCP uses captured currentPrincipal and rereads active area permissions.",
      "queries": [
        "c989c33e4e45d97334c03bc1c538c1d022114b8b057e5ede2820610d1b92ba96"
      ]
    },
    {
      "file": "lib/canvas-floor.ts",
      "function": "readFloorCanvas",
      "reason": "fenced-by-helper",
      "classification": "fenced",
      "explanation": "Owner Canvas transaction supplies current person, owned live thread, admitted run and current area checks; deletion preflight only returns own readable links, otherwise fixed generic refusal. Floor MCP uses captured currentPrincipal and rereads active area permissions.",
      "queries": [
        "a9a522be00ee7a6b5fea2017470c210e691e928fdf393c104bc90177d183ebc5"
      ]
    },
    {
      "file": "lib/canvas-floor.ts",
      "function": "floorDeletionBlock",
      "reason": "fenced-by-helper",
      "classification": "fenced",
      "explanation": "Owner Canvas transaction supplies current person, owned live thread, admitted run and current area checks; deletion preflight only returns own readable links, otherwise fixed generic refusal. Floor MCP uses captured currentPrincipal and rereads active area permissions.",
      "queries": [
        "92daf3abd02a1de45ed72c7263b0df65d5c8110ff394ac51eecf4a684e281df9"
      ]
    },
    {
      "file": "db/migrations/0114_canvas_floor_refs.sql",
      "function": "<sql>",
      "reason": "trusted-background",
      "classification": "trusted-background",
      "explanation": "Owner migration only; additive immutable snapshots/reference guards, no request handler.",
      "queries": [
        "acfba36e45e39f956fb98c1c4325209f444baec7d5c08b2e4707b83126dbb6ab"
      ]
    }
  ]
}
```

## Not done / release gates

- Shared patch is supplied, not applied or committed; no integrated Canvas API/UI or MCP registration is claimed. Coordinator must merge allowlist entries and rescan shared changes, then run the real route/admission/provenance/CAS/no-op/idempotency/retention integration tests. Existing untouched full-designer actions are not yet on the shared command.
- Deletion preflight returns authorized links from `floorDeletionBlock`; the minimal web action hook currently exposes its plain refusal through the existing action error UI. Coordinator must render its authorized `links` as **Open canvas** before declaring the rich own-reference deletion notice complete; generic/held/foreign notices expose none.
- Browser/Safari/real WebGL disposal, exact stage budget, focus, history/rotation and canonical full-designer return/unsaved-edit warning remain coordinator checks. No build or browser was started.
- Full Canvas-only subset rollout matrix must be repeated after integration with migration **0114** (the current generic subset harness caps IDs at 112 and is outside this builder's ownership). Migration is exercised through the normal disposable migration loader here.
- Canonical backfill hashes stored jsonb bytes; old snapshots whose pre-current-schema doc needs migrateDoc normalization may produce a fresh snapshot the first time pinned. No existing immutable snapshot is rewritten to normalize it. Validate any such legacy fixtures before claiming perfect historic deduplication.
- Floor export/save hands off to the canonical designer/capture workflow; no Canvas HTML/project-save or publication path is added. Existing published floor/client workflow has not been edited.
- No live migrations, feature enablement, deploy, push, or service restarts. `canvas.floor_enabled=false` remains the deploy boundary. Never deploy only half the shared patch.

## Coordinator screenshot/interaction matrix (state → seed)

Use a disposable practice project and an admitted owned Ask thread after the shared patch; enable Floor only in that isolated QA fixture. Seed with the real MCP `create_plan_design` on that project, then `apply_plan_ops` with explicit expected_rev and addRoomRect/opening/placeRun geometry; call show_canvas floor_plan with its decimal design ID/current rev.

| State | How to seed/check |
| --- | --- |
| Read-only 2D at 360×800 / 390×844 | Open the new floor canvas. Capture design-number title, no edit/inspector/publish/estimate/save chrome, phone ⋯ hint and Open floor plan. Measure stage ≥420px, one host exit/selector. |
| Tablet 820×1180 | Same pin; capture Edit floor plan and level/view controls, pan/pinch/Fit/100%, no duplicate chrome. |
| Desktop 1280 and 1100 popout (~617px pane) | Same pin; capture fine-pointer −/Fit/100%/+, ⋯ Edit floor plan without computer hint; modified wheel and drag pan. |
| Short landscape 800×360 | Rotate selected floor canvas; capture shared left strip/right actions, one exit, stage ≥200px, no lost selected version. |
| Opt-in 3D / release | Tap 3D, switch to Chat/another canvas and back; verify scene/WebGL renderer disposes and only one context exists; returning starts the pinned snapshot. Repeat document hidden/visible and auth/flag loss. |
| Old saved vs live | Keep canvas selected, edit same design via explicit-rev MCP op. Capture unchanged old geometry + “The floor plan changed. Load latest”. Tap Load latest; capture appended reference/design number. Tap again: changed=false, no artificial version. |
| Floor history/restore | Save two design snapshots via real web/MCP version commands; pin both, select older, restore Canvas reference. Capture design v numbers only, distinct snapshots/notes and newer history retained; independently verify full designer still has its live doc. |
| Full designer / existing conflict | Use Edit/Open floor plan; verify exact same `/floor/<id>` as project's Floor chip. Make unsaved edits, cause another rev change and confirm existing leave/conflict/save-as-copy behavior; return to Ask's pinned snapshot. |
| Staff denied / money filtered | Staff A without Projects: unavailable and no geometry/link. Add Projects but not Leads for lead fixture: unavailable. Authorized staff without money/catalog/estimates: inspect network props, ensure no financial/inspector data was serialized. |
| Referenced deletion | Try deleting saved snapshot and design in full designer while own Canvas references it; capture refusal. Repeat with another person's private/tombstoned/held Canvas: fixed generic notice, no title/count/person/link. After legitimate payload purge, delete succeeds unless independently published. |
| Flag/auth change | Flip Floor off or revoke Projects while mounted in QA; next poll removes renderer and geometry/link, leaves the designed unavailable/off state. No cached old pixels on thread/account switch. |

Keep the feature off until shared integration, all pending acceptance cases and the coordinator visual evidence pass.

Final privacy check: own-reference deletion links additionally require current Projects and scoped Leads access, and an active account; losing those areas uses the generic notice. Regression included in the 16 passing DB tests.
