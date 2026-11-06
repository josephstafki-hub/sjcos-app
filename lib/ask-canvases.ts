import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { threadPrincipal, requireThreadAccess } from '@/lib/thread-access';
import { withAskJournal, deleteCanvas, capabilities as schemaCapabilities } from '@/lib/ask-thread-journal.mjs';
import { withPrivateRunner } from '@/lib/ask-private-bridge.mjs';
import { conversationProvenance } from '@/lib/ask-context-provenance.mjs';
import { validateCanvasContent } from '@/lib/canvas-content.mjs';
import { canvasSchemas } from '@/mcp/canvas-tools.mjs';
import { PERMISSION_KEYS } from '@/lib/permissions';
import type { Availability, CanvasMeta, VersionMeta, CanvasError, CanvasErrorCode, CanvasGetResponse, CanvasMutationResponse, CanvasListResponse, CanvasVersionsResponse, CanvasEventsResponse, CanvasEvent } from '@/lib/canvas-api-types';
type Person = {
    id: string;
    role: 'owner' | 'staff';
    permissions: string[];
    name: string;
};
type Actor = {
    person: Person;
    threadId?: string;
    runId: string | null;
    internal: boolean;
};
// SQL rows are kept private; only the explicit §5.5 serializers below cross adapters.
type Row = Record<string, any>;
const C = PERMISSION_KEYS.filter(k => k !== 'ai' && k !== 'projects');
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : stable(v)).digest('hex');
function stable(v: unknown): string { if (Array.isArray(v))
    return '[' + v.map(stable).join(',') + ']'; if (v && typeof v === 'object')
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable((v as Row)[k])).join(',') + '}'; return JSON.stringify(v); }
function fail(code: CanvasErrorCode, details?: Record<string, unknown>): never { throw Object.assign(new Error(code), { code, details }); }
const statuses: Partial<Record<CanvasErrorCode, number>> = { CANVAS_DISABLED: 503, AUTH_REQUIRED: 401, CANVAS_UNAVAILABLE: 404, CONTEXT_PROVENANCE_INCOMPLETE: 403, RUN_CONTEXT_REQUIRED: 403, INVALID_INPUT: 400, UNSUPPORTED_KIND: 422, UNSAFE_CONTENT: 422, CONTENT_TOO_LARGE: 413, TOO_COMPLEX: 422, VERSION_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, QUOTA_EXCEEDED: 429, ASK_PAUSED: 503, EXPORT_NOT_READY: 409, SAVE_POLICY_CHANGED: 409, SAVE_POLICY_CONFLICT: 409, FILE_RESTORE_CONFLICT: 409, RENDERER_HASH_CONFLICT: 409, SAVE_FAILED: 409 };
export function canvasFailure(e: unknown): CanvasError {
    const err = e as Row;
    let code = (Object.hasOwn(statuses, err?.code) ? err.code : err?.message) as string;
    if(err?.code==='23514'&&err?.constraint==='ask_canvas_rate_windows_accepted_count_check')code='QUOTA_EXCEEDED';
    if (['ASK_SIGN_IN_REQUIRED', 'ASK_SESSION_REVOKED'].includes(code))
        code = 'AUTH_REQUIRED';
    if (['ASK_THREAD_UNAVAILABLE', 'ASK_ACCESS_DENIED'].includes(code))
        code = 'CANVAS_UNAVAILABLE';
    if (code === 'DELETE_NOT_READY' || code === 'Chats are paused while SJC OS checks its records. Try again in a few minutes.')
        code = 'ASK_PAUSED';
    if (['ASK_THREAD_PRIVACY_REQUIRED', 'ASK_RECOVERY_REQUIRED'].includes(code))
        code = 'ASK_PAUSED';
    if (!Object.hasOwn(statuses, code))
        code = 'INTERNAL_ERROR';
    const message = code === 'UNSUPPORTED_KIND' && err?.details?.rule==='LEAD_DESTINATION' ? "Leads can't hold canvas copies yet. Pick a project, or download it." : code === 'SAVE_POLICY_CHANGED' ? 'Canvas access changed. Review who can read this copy.' : code === 'SAVE_POLICY_CONFLICT' ? 'This version already has a saved copy with different access. Move it to Trash before saving another copy.' : code === 'SAVE_FAILED' ? 'Review who can read this copy again.' : code === 'EXPORT_NOT_READY' ? 'Open this version to prepare the drawing.' : code === 'CANVAS_UNAVAILABLE' ? "This canvas isn't available to this account." : code === 'AUTH_REQUIRED' ? 'Sign in to open this canvas.' : code === 'CANVAS_DISABLED' ? 'Canvas is turned off. Your saved project files are still available.' : code === 'CONTEXT_PROVENANCE_INCOMPLETE' ? 'Start a new chat to make a canvas.' : code === 'ASK_PAUSED' ? 'Chats are paused while SJC OS checks its records. Try again in a few minutes.' : code === 'VERSION_CONFLICT' ? 'A newer version was saved.' : code === 'QUOTA_EXCEEDED' ? 'This chat has reached its canvas limit. Save what you need, or start a new chat.' : code === 'INVALID_INPUT' ? 'Check the canvas request.' : code === 'RUN_CONTEXT_REQUIRED' ? 'An active Ask run is required.' : 'Canvas could not be completed.';
    // Only fixed keys/counts from our own validators. Never expose exception messages.
    const details: Record<string, unknown> = {};
    for (const k of ['max_bytes', 'received_bytes', 'latest_version', 'retry_after', 'limit', 'nodes', 'edges', 'depth', 'elements', 'path_units'])
        if (typeof err?.details?.[k] === 'number')
            details[k] = err.details[k];
    if (typeof err?.details?.rule === 'string' && /^[A-Z_]{1,60}$/.test(err.details.rule))
        details.rule = err.details.rule;
    if(code==='SAVE_POLICY_CHANGED'&&err?.details?.save_policy){const p=err.details.save_policy;details.save_policy=Object.fromEntries(['baseline_areas','baseline_source','provenance_revision','policy_revision','baseline_hash','catalog_version','area_options','project','owner'].map(k=>[k,p[k]]));}
    return { ok: false, code: code as CanvasErrorCode, message, retryable: ['ASK_PAUSED', 'INTERNAL_ERROR', 'QUOTA_EXCEEDED'].includes(code), ...(Object.keys(details).length ? { details } : {}) };
}
export function canvasStatus(e: CanvasError) { return statuses[e.code] ?? 500; }
export async function canvasJson(fn: () => Promise<unknown>) { try {
    return Response.json(await fn(), { headers: privateHeaders });
}
catch (e) {
    const f = canvasFailure(e);
    return Response.json(f, { status: canvasStatus(f), headers: privateHeaders });
} }
export async function canvasHumanJson(fn: () => Promise<unknown>) { return canvasJson(async () => { await threadPrincipal(); return fn(); }); }
export const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Cookie, Authorization' };
const abuseWindows = new Map<string, {
    minute: number;
    count: number;
}>();
function abuseLimit(id: string) { const minute = Math.floor(Date.now() / 60000); const old = abuseWindows.get(id); const next = { minute, count: old?.minute === minute ? old.count + 1 : 1 }; abuseWindows.set(id, next); if (abuseWindows.size > 1024)
    abuseWindows.delete(abuseWindows.keys().next().value!); if (next.count > 120)
    fail('QUOTA_EXCEEDED', { retry_after: 60 - Math.floor(Date.now() / 1000) % 60 }); }
export async function canvasHumanBody(req: Request, max = 8192) { const p = await threadPrincipal(); abuseLimit(p.id); return canvasBody(req, max); }
function parse(action: keyof typeof canvasSchemas, input: unknown): Row { const p = canvasSchemas[action].safeParse(input); if (!p.success)
    fail('INVALID_INPUT'); return p.data as Row; }
function uuid(id: string) { if (!idPattern.test(id))
    fail('INVALID_INPUT'); }
function iso(v: any) { return new Date(v).toISOString(); }
function permitted(p: Person, areas: string[]) { return p.role === 'owner' || areas.every(a => p.permissions.includes(a)); }
async function person(db: PoolClient, id: string): Promise<Person> { const p = (await db.query('SELECT id,role,permissions,name,active FROM users WHERE id=$1', [id])).rows[0]; if (!p?.active || !['owner', 'staff'].includes(p.role) || (p.role === 'staff' && !p.permissions?.includes('ai')))
    fail('AUTH_REQUIRED'); return p; }
async function availability(db: PoolClient, p: Person): Promise<Availability> {
    const rows = (await db.query(`SELECT key,value FROM app_settings WHERE key=ANY($1)`, [['canvas.diagrams_enabled', 'canvas.pages_enabled', 'canvas.floor_enabled', 'canvas.exports_enabled', 'canvas.staff_enabled', 'canvas.source_enabled']])).rows;
    const flags = Object.fromEntries(rows.map(r => [r.key, r.value === true || r.value === 'true']));
    const staff = p.role === 'owner' || flags['canvas.staff_enabled'] === true;
    const master = process.env.SJC_CANVAS_ENABLED === '1' && staff && (await schemaCapabilities(db)).canvas;
    const a = { master, diagrams: master && flags['canvas.diagrams_enabled'] === true, pages: false, floor: false, exports: master && flags['canvas.diagrams_enabled'] === true && flags['canvas.exports_enabled'] === true && (await schemaCapabilities(db)).files, staff, source: master && flags['canvas.source_enabled'] !== false };
    return { revision: hash([a, rows]).slice(0, 24), ...a }; // Page/Floor remain off; 0108 gates diagram exports.
}
function gate(a: Availability, kind?: string, write = false) { if (!a.master || !a.staff)
    fail('CANVAS_DISABLED'); if (kind && write && !(kind === 'diagram' ? a.diagrams : kind === 'page' ? a.pages : a.floor))
    fail('CANVAS_DISABLED'); if (kind && !write && !a.source && !(kind === 'diagram' ? a.diagrams : kind === 'page' ? a.pages : a.floor))
    fail('CANVAS_DISABLED'); }
async function ownThread(db: PoolClient, a: Actor, id: string) { uuid(id); const row = (await db.query('SELECT id FROM ai_conversations WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL FOR UPDATE', [id, a.person.id])).rows[0]; if (!row || (a.threadId && a.threadId !== id))
    fail('CANVAS_UNAVAILABLE'); if (!a.internal)
    await requireThreadAccess(id, a.person, db); return id; }
async function tx<T>(a: Actor, fn: (db: PoolClient, a: Actor) => Promise<T>): Promise<T> {
    return withAskJournal(pool, async () => {
        const db = await pool.connect();
        try {
            await db.query('BEGIN');
            await db.query('SELECT pg_advisory_xact_lock(106,1)');
            a = { ...a, person: await person(db, a.person.id) };
            if (!a.internal)
                await threadPrincipal();
            if (a.runId) {
                const live = (await db.query(`SELECT id FROM dev_agent_runs r WHERE id=$1 AND principal_user_id=$2 AND conversation_id=$3 AND status IN ('pending','running') AND with_mcp AND agent='claude' AND NOT cancellation_requested AND launch_source IN ('panel_web','panel_mobile','panel_voice') AND (profile='business' OR $4='owner') AND NOT EXISTS(SELECT 1 FROM session_revocations v WHERE v.user_id=r.principal_user_id AND v.revoked_before>r.created_at) FOR SHARE`, [a.runId, a.person.id, a.threadId, a.person.role])).rows[0];
                if (!live)
                    fail('RUN_CONTEXT_REQUIRED');
            }
            await db.query(`SELECT set_config('sjcos.ask_actor',$1,true)`, [a.person.id]);
            const result = await fn(db, a);
            await db.query('COMMIT');
            return result;
        }
        catch (e) {
            await db.query('ROLLBACK');
            if (canvasFailure(e).code === 'QUOTA_EXCEEDED')
                await db.query(`INSERT INTO work_items(title,body,status,source_kind,source_id) SELECT 'Check canvas storage limits','A canvas reached a storage or accepted-write limit. Existing history was kept.','waiting_on_human','maintenance','canvas-storage-limit' WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='maintenance' AND source_id='canvas-storage-limit')`).catch(() => { });
            throw e;
        }
        finally {
            db.release();
        }
    });
}
async function human(): Promise<Actor> { const p = await threadPrincipal(); return { person: { ...p, permissions: [], name: '' }, runId: null, internal: false }; }
async function load(db: PoolClient, a: Actor, id: string): Promise<Row> { uuid(id); const row = (await db.query(`SELECT c.*,p.slug AS project_slug,l.slug AS lead_slug FROM ask_canvases c LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN leads l ON l.id=c.lead_id WHERE c.id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL FOR UPDATE OF c`, [id, a.person.id])).rows[0]; if (!row)
    fail('CANVAS_UNAVAILABLE'); await ownThread(db, a, row.conversation_id); if (!permitted(a.person, row.required_areas) || (row.project_id && !permitted(a.person, ['projects'])) || (row.lead_id && !permitted(a.person, ['leads'])))
    fail('CANVAS_UNAVAILABLE'); return row; }
async function version(db: PoolClient, c: Row, n: number): Promise<Row> { const row = (await db.query('SELECT v.*,u.name AS actor_name FROM ask_canvas_versions v JOIN users u ON u.id=v.actor_user_id WHERE canvas_id=$1 AND version=$2 AND purged_at IS NULL', [c.id, n])).rows[0]; if (!row)
    fail('CANVAS_UNAVAILABLE'); return row; }
function meta(c: Row): CanvasMeta { return { id: c.id, thread_id: c.conversation_id, user_id: c.owner_user_id, created_run_id: c.created_run_id, kind: c.kind, project_slug: c.project_slug ?? null, lead_slug: c.lead_slug ?? null, latest_version: c.latest_version, created_at: iso(c.created_at), updated_at: iso(c.updated_at) }; }
function vm(v: Row): VersionMeta { return { version: v.version, title: v.title, summary: v.summary, change_note: v.change_note, actor: { id: v.actor_user_id, name: String(v.actor_name).slice(0, 120) }, run_id: v.run_id, created_at: iso(v.created_at), restored_from_version: v.restored_from_version, design: null }; }
async function classify(db: PoolClient, a: Actor, threadId: string, parent: string[], labels: string[]) {
    const p = await conversationProvenance({ client: db, threadId });
    const complete = p.complete === true && Array.isArray(p.areas);
    const areas = C.filter(k => !complete || [...parent, ...labels, ...(p.areas ?? [])].includes(k));
    if (a.person.role === 'staff' && !complete)
        fail('CONTEXT_PROVENANCE_INCOMPLETE');
    if (!permitted(a.person, areas))
        fail('CANVAS_UNAVAILABLE');
    return { areas, revision: p.revision, complete, inputs: p.inputs, manifestHash: hash(p), baselineHash: hash(areas) };
}
async function getIn(db: PoolClient, a: Actor, id: string, input: Row): Promise<CanvasGetResponse> {
    const av = await availability(db, a.person);
    gate(av);
    const c = await load(db, a, id);
    gate(av, c.kind);
    const v = await version(db, c, input.version ?? c.latest_version);
    const canPreview = c.kind === 'diagram' && av.diagrams;
    const result: CanvasGetResponse = { ok: true, canvas: meta(c), selected: vm(v), availability: av, capabilities: { preview: canPreview, code: av.source, download_formats: av.exports ? ['svg', 'mmd'] : [], save: av.exports && c.kind === 'diagram' && permitted(a.person,['projects']), restore: c.kind !== 'floor_plan' && av.diagrams, load_latest: false }, preview: canPreview ? { mode: 'diagram_renderer', href: '/api/canvas/renderer', renderer_version: v.renderer_version } : null };
    if (input.include_source) {
        if (!av.source)
            fail('CANVAS_DISABLED');
        if (c.kind === 'floor_plan')
            fail('UNSUPPORTED_KIND');
        result.code = { ok: true, canvas_id: id, version: v.version, kind: c.kind, code: v.source_text, sha256: v.source_sha256, untrusted: true, availability: av };
    }
    return result;
}
async function mutation(db: PoolClient, a: Actor, action: 'show' | 'update' | 'restore', input: Row, id?: string): Promise<CanvasMutationResponse> {
    const av = await availability(db, a.person);
    gate(av);
    let c: Row | undefined;
    let threadId = a.threadId;
    if (action !== 'show') {
        c = await load(db, a, id ?? input.canvas_id);
        threadId = c.conversation_id;
    }
    if (!threadId)
        fail('RUN_CONTEXT_REQUIRED');
    await ownThread(db, a, threadId);
    const inputHash = hash({ action, input, ...(id ? { id } : {}) });
    const old = (await db.query('SELECT * FROM ask_canvas_requests WHERE conversation_id=$1 AND request_id=$2', [threadId, input.request_id])).rows[0];
    if (old) {
        if (old.input_hash !== inputHash || old.actor_user_id !== a.person.id)
            fail('IDEMPOTENCY_CONFLICT');
        const current = await load(db, a, old.canvas_id);
        gate(av, current.kind);
        await classify(db, a, threadId, current.required_areas, []);
        return mutationResult(current, await version(db, current, old.version), av);
    }
    let source = input.content, from: Row | undefined;
    if (c && input.restore_version) {
        if (c.kind === 'floor_plan')
            fail('UNSUPPORTED_KIND');
        from = await version(db, c, input.restore_version);
        source = { kind: c.kind, source: from.source_text };
    }
    if (c && input.base_version !== c.latest_version)
        fail('VERSION_CONFLICT', { latest_version: c.latest_version });
    if (source?.kind === 'floor_plan' || source?.kind === 'page')
        fail('UNSUPPORTED_KIND');
    if (c && source?.kind !== c.kind)
        fail('INVALID_INPUT');
    gate(av, source?.kind, true);
    validateCanvasContent(source);
    const policy = await classify(db, a, threadId, c?.required_areas ?? [], input.required_areas ?? []);
    const title = input.title ?? from?.title ?? (c ? (await version(db, c, c.latest_version)).title : undefined);
    const summary = input.summary ?? from?.summary;
    const note = input.change_note ?? (from ? `Restored Version ${from.version}` : '');
    if (action === 'show') {
        let projectId = null, projectSlug = null;
        if (input.project_slug) {
            if (!permitted(a.person, ['projects']))
                fail('CANVAS_UNAVAILABLE');
            const p = (await db.query('SELECT id,slug FROM projects WHERE slug=$1', [input.project_slug])).rows[0];
            if (!p)
                fail('CANVAS_UNAVAILABLE');
            projectId = p.id;
            projectSlug = p.slug;
        }
        c = (await db.query(`INSERT INTO ask_canvases(conversation_id,owner_user_id,created_run_id,kind,project_id,required_areas,baseline_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [threadId, a.person.id, a.runId, source.kind, projectId, policy.areas, policy.baselineHash])).rows[0];
        c!.project_slug = projectSlug;
    }
    else {
        c = (await db.query(`UPDATE ask_canvases SET required_areas=$2,baseline_hash=$3,classification_revision=classification_revision+1 WHERE id=$1 RETURNING *`, [c!.id, policy.areas, policy.baselineHash])).rows[0];
    }
    const n = action === 'show' ? 1 : c!.latest_version + 1;
    if (n > 100)
        fail('QUOTA_EXCEEDED', { limit: 100 });
    const v = (await db.query(`INSERT INTO ask_canvas_versions(canvas_id,version,conversation_id,owner_user_id,actor_user_id,run_id,title,summary,change_note,source_text,source_bytes,source_sha256,provenance_revision,provenance_complete,provenance_manifest_hash,provenance_inputs,baseline_areas,baseline_hash,restored_from_version) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, [c!.id, n, threadId, a.person.id, a.runId, title, summary, note, source.source, Buffer.byteLength(source.source), hash(source.source), policy.revision, policy.complete, policy.manifestHash, JSON.stringify(policy.inputs), policy.areas, policy.baselineHash, from?.version ?? null])).rows[0];
    v.actor_name = a.person.name;
    c = (await db.query('UPDATE ask_canvases SET latest_version=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [c!.id, n])).rows[0];
    await db.query(`INSERT INTO ask_canvas_requests(conversation_id,request_id,owner_user_id,actor_user_id,action,input_hash,effective_policy_hash,canvas_id,version,run_id) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9)`, [threadId, input.request_id, a.person.id, action, inputHash, policy.baselineHash, c!.id, n, a.runId]);
    await db.query(`INSERT INTO ask_canvas_events(conversation_id,owner_user_id,canvas_id,version,run_id,actor_user_id,kind) VALUES($1,$2,$3,$4,$5,$2,$6)`, [threadId, a.person.id, c!.id, n, a.runId, action === 'show' ? 'created' : from ? 'restored' : 'updated']);
    if(a.runId)await db.query('DELETE FROM ask_canvas_attempts WHERE run_id=$1',[a.runId]);
    // Reload aliases without placing slugs in immutable request metadata.
    c = await load(db, a, c!.id);
    return mutationResult(c, v, av);
}
function mutationResult(c: Row, v: Row, av: Availability): CanvasMutationResponse { return { ok: true, canvas: meta(c), selected: vm(v), changed: true, card: { canvas_id: c.id, run_id: v.run_id, version: v.version }, href: `/panel/canvas/${c.id}?v=${v.version}`, availability: av }; }
// HMAC secret is the existing server session key, never a browser-supplied key.
function key() { const k = process.env.SESSION_SECRET; if (!k)
    fail('INTERNAL_ERROR'); return k; }
function cursor(a: Actor, thread: string, direction: string, boundary: unknown, high = '0') { const payload = Buffer.from(JSON.stringify([1, direction, boundary, high])).toString('base64url'); return payload + '.' + createHmac('sha256', key()).update(thread + ':' + a.person.id + ':' + payload).digest('base64url'); }
function decode(s: string, a: Actor, thread: string, directions: string[]): any[] { try {
    if (s.length > 256)
        throw 0;
    const [b, m, ...rest] = s.split('.');
    if (rest.length || !/^[A-Za-z0-9_-]+$/.test(b) || !/^[A-Za-z0-9_-]{43}$/.test(m))
        throw 0;
    const expected = createHmac('sha256', key()).update(thread + ':' + a.person.id + ':' + b).digest();
    const actual = Buffer.from(m, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
        throw 0;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (!Array.isArray(p) || p.length !== 4 || p[0] !== 1 || !directions.includes(p[1]))
        throw 0;
    return p;
}
catch {
    fail('INVALID_INPUT');
} }
async function listIn(db: PoolClient, a: Actor, threadId: string, input: Row): Promise<CanvasListResponse> {
    const av = await availability(db, a.person);
    await ownThread(db, a, threadId);
    gate(av);
    const p = input.cursor ? decode(input.cursor, a, threadId, ['list']) : null;
    const rows = (await db.query(`SELECT id,updated_at,updated_at::text AS stamp FROM ask_canvases WHERE conversation_id=$1 AND owner_user_id=$2 AND deleted_at IS NULL AND ($3::timestamptz IS NULL OR (updated_at,id)<($3::timestamptz,$4::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $5`, [threadId, a.person.id, p?.[2]?.[0] ?? null, p?.[2]?.[1] ?? null, (input.limit ?? 20) + 1])).rows;
    const out: CanvasListResponse = { ok: true, canvases: [], next_cursor: null, availability: av };
    let last: Row | undefined;
    for (const r of rows.slice(0, input.limit ?? 20)) {
        const c = await load(db, a, r.id);
        gate(av, c.kind);
        const entry = { canvas: meta(c), latest: vm(await version(db, c, c.latest_version)) };
        if (Buffer.byteLength(JSON.stringify({ ...out, canvases: [...out.canvases, entry] })) > 15500)
            break;
        out.canvases.push(entry);
        last = r;
    }
    if (last && (rows.length > out.canvases.length))
        out.next_cursor = cursor(a, threadId, 'list', [last.stamp, last.id]);
    return out;
}
export async function canvasGet(id: string, input: unknown = {}): Promise<CanvasGetResponse> { const a = await human(); const p = parse('get', { ...(input as Row), canvas_id: id }); return tx(a, (db, a) => getIn(db, a, id, p)); }
export async function canvasList(threadId: string, input: unknown = {}): Promise<CanvasListResponse> { const a = await human(); const p = parse('list', input); return tx(a, (db, a) => listIn(db, a, threadId, p)); }
export async function canvasRestore(id: string, input: unknown): Promise<CanvasMutationResponse> { const a = await human(); const p = parse('restore', input); return tx(a, (db, a) => mutation(db, a, 'restore', p, id)); }
export async function canvasVersions(id: string, input: unknown = {}): Promise<CanvasVersionsResponse> {
    const a = await human();
    const p = parse('versions', input);
    return tx(a, async (db, a) => {
        const av = await availability(db, a.person);
        gate(av);
        const c = await load(db, a, id);
        gate(av, c.kind);
        const rows = (await db.query('SELECT v.*,u.name AS actor_name FROM ask_canvas_versions v JOIN users u ON u.id=v.actor_user_id WHERE canvas_id=$1 AND purged_at IS NULL AND ($2::int IS NULL OR version<$2) ORDER BY version DESC LIMIT $3', [id, p.before ?? null, (p.limit ?? 20) + 1])).rows;
        const out: CanvasVersionsResponse = { ok: true, versions: [], next_before: null, availability: av };
        for (const r of rows.slice(0, p.limit ?? 20)) {
            const v = vm(r);
            if (Buffer.byteLength(JSON.stringify({ ...out, versions: [...out.versions, v] })) > 15500)
                break;
            out.versions.push(v);
        }
        if (rows.length > out.versions.length)
            out.next_before = out.versions.at(-1)?.version ?? null;
        return out;
    });
}
export async function canvasEvents(threadId: string, input: unknown = {}): Promise<CanvasEventsResponse> { const a = await human(); const p = parse('events', input); return tx(a, (db, a) => eventsIn(db, a, threadId, p)); }
async function eventsIn(db: PoolClient, a: Actor, threadId: string, p: Row): Promise<CanvasEventsResponse> {
    await ownThread(db, a, threadId);
    const av = await availability(db, a.person);
    const direction = p.after ? 'after' : p.before ? 'before' : 'newest';
    const parsed = p.after ? decode(p.after, a, threadId, ['after']) : p.before ? decode(p.before, a, threadId, ['before']) : null;
    const installed = (await schemaCapabilities(db)).canvas;
    if (!installed) {
        if (parsed && (!/^[0-9]+$/.test(parsed[2]) || !/^[0-9]+$/.test(parsed[3])))
            fail('INVALID_INPUT');
        return { ok: true, events: [], cursor: cursor(a, threadId, 'after', parsed?.[3] ?? '0', parsed?.[3] ?? '0'), next_before: null, has_more: false, availability: av };
    }
    const high = parsed?.[3] ?? (await db.query('SELECT COALESCE(max(id),0)::text AS id FROM ask_canvas_events WHERE conversation_id=$1 AND owner_user_id=$2', [threadId, a.person.id])).rows[0].id;
    const boundary = parsed?.[2] ?? high;
    if (!/^[0-9]+$/.test(boundary) || !/^[0-9]+$/.test(high))
        fail('INVALID_INPUT');
    const rows = (await db.query(`SELECT * FROM ask_canvas_events WHERE conversation_id=$1 AND owner_user_id=$2 AND (CASE WHEN $3='after' THEN id>$4::bigint WHEN $3='before' THEN id<$4::bigint ELSE id<=$4::bigint END) ORDER BY CASE WHEN $3='after' THEN id END ASC,id DESC LIMIT $5`, [threadId, a.person.id, direction, boundary, (p.limit ?? 20) + 1])).rows;
    const events: CanvasEvent[] = [];
    let last: string | undefined;
    for (const r of rows.slice(0, p.limit ?? 20)) {
        const base = { id: String(r.id), thread_id: threadId, run_id: r.run_id, actor_user_id: r.actor_user_id, at: iso(r.created_at), group_id: r.run_id && r.canvas_id ? `run:${r.run_id}:canvas:${r.canvas_id}` : `event:${r.id}` };
        let event: CanvasEvent;
        if (!av.master || !av.staff)
            event = { ...base, kind: 'unavailable', canvas_id: r.canvas_id };
        else if (r.kind === 'rejected')
            event = { ...base, kind: 'rejected', canvas_id: null, reason: r.reason };
        else {
            try {
                const c = await load(db, a, r.canvas_id);
                gate(av, c.kind);
                event = { ...base, kind: r.kind, canvas_id: r.canvas_id, version: vm(await version(db, c, r.version)), ...(r.kind==='saved'?{file_id:r.saved_file_id,project_name:r.saved_project_name,effective_policy:r.saved_policy}:{}) } as CanvasEvent;
            }
            catch (e) {
                if (canvasFailure(e).code !== 'CANVAS_UNAVAILABLE' && canvasFailure(e).code !== 'CANVAS_DISABLED')
                    throw e;
                const deleted = (await db.query('SELECT id FROM ask_canvases WHERE id=$1 AND owner_user_id=$2 AND conversation_id=$3 AND deleted_at IS NOT NULL', [r.canvas_id, a.person.id, threadId])).rows[0];
                event = deleted ? { ...base, kind: 'deleted', canvas_id: r.canvas_id } : { ...base, kind: 'unavailable', canvas_id: null };
            }
        }
        if (Buffer.byteLength(JSON.stringify(events)) + Buffer.byteLength(JSON.stringify(event)) > 14500)
            break;
        events.push(event);
        last = String(r.id);
    }
    if (direction !== 'after')
        events.reverse();
    const nextHigh = direction === 'after' ? (last ?? boundary) : high;
    return { ok: true, events, cursor: cursor(a, threadId, 'after', nextHigh, nextHigh), next_before: events.length ? cursor(a, threadId, 'before', events[0].id, high) : null, has_more: rows.length > events.length, availability: av };
}
export async function canvasInternal(action: string, input: unknown, context: unknown): Promise<unknown> {
    if (!['show', 'update', 'get', 'list', 'admit'].includes(action))
        fail('INVALID_INPUT');
    const ctx = context as Row;
    if (!ctx || Object.keys(ctx).sort().join(',') !== 'principal_user_id,run_id,run_profile,run_started_s,transport' || ctx.transport !== 'runner_stdio' || ![ctx.run_id, ctx.principal_user_id].every(v => typeof v === 'string' && idPattern.test(v)) || !['operator', 'business'].includes(ctx.run_profile) || !Number.isSafeInteger(ctx.run_started_s) || ctx.run_started_s <= 0)
        fail('RUN_CONTEXT_REQUIRED');
    abuseLimit(ctx.principal_user_id);
    const parsed = action === 'admit' ? input as Row : parse(action as 'show', input);
    if (action === 'admit' && (!parsed || Object.keys(parsed).join(',') !== 'conversation_id' || typeof parsed.conversation_id !== 'string' || !idPattern.test(parsed.conversation_id)))
        fail('RUN_CONTEXT_REQUIRED');
    return withAskJournal(pool, async () => {
        const run = (await pool.query(`SELECT conversation_id FROM dev_agent_runs WHERE id=$1 AND principal_user_id=$2 AND with_mcp AND agent='claude'`, [ctx.run_id, ctx.principal_user_id])).rows[0];
        if (!run?.conversation_id || (action === 'admit' && parsed.conversation_id !== run.conversation_id))
            fail('RUN_CONTEXT_REQUIRED');
        let entered = false;
        try {
            return await withPrivateRunner(pool, { ...ctx, conversation_id: run.conversation_id }, async () => { entered = true; if (action === 'admit')
                return { ok: true }; return tx<unknown>({ person: { id: ctx.principal_user_id, role: 'owner', permissions: [], name: '' }, threadId: run.conversation_id, runId: ctx.run_id, internal: true }, (db, a) => action === 'show' || action === 'update' ? mutation(db, a, action, parsed) : action === 'get' ? getIn(db, a, parsed.canvas_id, parsed) : listIn(db, a, run.conversation_id, parsed)); });
        }
        catch (e) {
            if (!entered)
                fail('RUN_CONTEXT_REQUIRED');
            if(entered&&['show','update'].includes(action)){
                const code=canvasFailure(e).code;
                const reason=code==='CONTENT_TOO_LARGE'||code==='QUOTA_EXCEEDED'?'too big':code==='UNSUPPORTED_KIND'?'not supported':'not allowed';
                await tx({person:{id:ctx.principal_user_id,role:'owner',permissions:[],name:''},threadId:run.conversation_id,runId:ctx.run_id,internal:true},async(db,a)=>{
                    await ownThread(db,a,run.conversation_id);
                    await db.query('INSERT INTO ask_canvas_attempts(run_id,reason) VALUES($1,$2) ON CONFLICT(run_id) DO UPDATE SET reason=EXCLUDED.reason',[ctx.run_id,reason]);
                });
            }
            throw e;
        }
    });
}
/** Bounded streamed JSON parsing; no compressed requests and no source in errors. */
export async function canvasBody(req: Request, max = 1048576) { if (req.headers.has('content-encoding') || req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    fail('INVALID_INPUT'); const reader = req.body?.getReader(); if (!reader)
    fail('INVALID_INPUT'); let n = 0; const chunks: Uint8Array[] = []; try {
    while (true) {
        const r = await reader.read();
        if (r.done)
            break;
        n += r.value.byteLength;
        if (n > max) {
            await reader.cancel();
            fail('CONTENT_TOO_LARGE', { max_bytes: max, received_bytes: n });
        }
        chunks.push(r.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
catch (e) {
    if (e instanceof SyntaxError)
        fail('INVALID_INPUT');
    throw e;
} }
export function canvasSameOrigin(req: Request) { const origin = req.headers.get('origin'); if (!origin || origin !== new URL(req.url).origin)
    fail('CANVAS_UNAVAILABLE'); }
export async function canvasDelete(id: string, input: unknown) {
    const a = await human();
    const p = parse('delete', input);
    uuid(id);
    if (!(await schemaCapabilities(pool)).canvas)
        fail('CANVAS_DISABLED');
    await tx(a, async (db, actor) => { gate(await availability(db, actor.person)); });
    // Authorization including current areas happens under the same journal lock
    // before a new intent. Retry of an existing fence uses opaque owner status.
    return deleteCanvas(pool, id, p.request_id, undefined, a.person.id, async () => {
        await tx(a, async (db, actor) => { gate(await availability(db, actor.person)); const c = await load(db, actor, id); const old = (await db.query('SELECT input_hash FROM ask_canvas_requests WHERE conversation_id=$1 AND request_id=$2', [c.conversation_id, p.request_id])).rows[0]; if (old)
            fail('IDEMPOTENCY_CONFLICT'); });
    });
}
/** 0108 seam: same journal, session, conversation lock and current source policy. */
export async function canvasFileTransaction<T>(id: string, n: number, fn: (db: PoolClient, actor: Actor, canvas: Row, version: Row) => Promise<T>): Promise<T> {
    const actor = await human();
    return tx(actor, async (db, a) => {
        const av = await availability(db, a.person); gate(av);
        if (!av.exports) fail('CANVAS_DISABLED');
        const c = await load(db, a, id); gate(av, c.kind, true);
        if (c.kind !== 'diagram') fail('UNSUPPORTED_KIND');
        if (!Number.isSafeInteger(n) || n < 1) fail('INVALID_INPUT');
        const v = await version(db, c, n);
        await classify(db, a, c.conversation_id, c.required_areas, v.baseline_areas);
        return fn(db, a, c, v);
    });
}
