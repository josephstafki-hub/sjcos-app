import {conflictSideLabel} from './words.ts';
import "server-only";
/**
 * Server reads for the consult pages. The snapshot goes through the same minted
 * person-context path as GET /api/consult/{id} (consult_verify_context enforces
 * assignment); the extra page data (names, addresses, media, evidence) are plain
 * owner-login reads made only after that check passed.
 */
import { randomUUID } from "node:crypto";
import { pool, query, queryOne } from "@/lib/db";
import { readSession } from "@/lib/session";
import type { CurrentUser } from "@/lib/dal";
import { snapshot } from "@/lib/consult/protocol";
import type { Display, Snapshot } from "./model";
import type { Boot } from "./controller";
import type { ListVisit } from "@/components/consult/field/VisitList";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT = `COALESCE(NULLIF(p.client_name,''), l.name, p.name)`;
const ADDRESS = `NULLIF(COALESCE(NULLIF(p.address,''), l.address),'')`;

export async function sessionEpoch(): Promise<number> {
  const s = await readSession();
  return Math.floor(Number(s?.authAt ?? s?.iat ?? 0));
}
async function flag(key: string): Promise<boolean> {
  return (await queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key=$1`, [key]))?.value === "true";
}
const label = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm");

export interface VisitHead { id: string; status: string; scheduled_at: string; conducted_by: string; revision: string; completion_generation: string; slug: string; project: string; project_id: string; client: string; address: string | null; visitor_name: string; visitor_role: string; assigned: boolean; open: number | null }
export async function visitHead(id: string, user: CurrentUser): Promise<VisitHead | null> {
  if (!UUID.test(id)) return null;
  return queryOne<VisitHead>(`SELECT c.id, c.status, c.scheduled_at, c.conducted_by, c.revision::text, c.completion_generation::text, p.slug, p.name AS project, p.id AS project_id,
      ${CLIENT} AS client, ${ADDRESS} AS address, u.name AS visitor_name, u.role AS visitor_role,
      EXISTS(SELECT 1 FROM consult_assignments a WHERE a.consult_id=c.id AND a.user_id=$2 AND a.revoked_at IS NULL) AS assigned,
      (SELECT sum(jsonb_array_length(x->'open'))::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.completeness_cache->'checks')='array' THEN c.completeness_cache->'checks' ELSE '[]' END) x) AS open
     FROM consults c JOIN projects p ON p.id=c.project_id LEFT JOIN leads l ON l.id=p.lead_id JOIN users u ON u.id=c.conducted_by WHERE c.id=$1`, [id, user.id]);
}

export function displayOf(h: VisitHead): Display {
  return { client: h.client, project: h.project, slug: h.slug, address: h.address, visitor_name: h.visitor_name, visitor_staff: h.visitor_role === "staff", scheduled_label: label(h.scheduled_at) };
}

export async function bootFor(user: CurrentUser, h: VisitHead): Promise<Boot> {
  return {
    status:h.status, closed_at:(await queryOne<{closed_at:string|null}>("SELECT closed_at FROM consults WHERE id=$1",[h.id]))?.closed_at??null, completeness:(await queryOne<{completeness_cache:unknown}>("SELECT completeness_cache FROM consults WHERE id=$1",[h.id]))?.completeness_cache??null,
    consult_id: h.id, user: { id: user.id, name: user.name, role: user.role }, session_epoch: await sessionEpoch(),
    display: displayOf(h), auto_apply: await flag("consult_auto_apply_findings"), capture_enabled: await flag("consult_capture"), home: `/projects/${h.slug}`,
  };
}

export async function listVisits(user: CurrentUser): Promise<ListVisit[]> {
  const { rows } = await query<ListVisit & { open: number | null }>(`SELECT c.id, c.status, c.scheduled_at, ${CLIENT} AS client, ${ADDRESS} AS address, u.name AS visitor,
      COALESCE((SELECT string_agg(f.definition->>'title', ' + ' ORDER BY f.key) FROM consult_form_pins pin JOIN consult_form_versions f ON f.id=pin.form_id WHERE pin.consult_id=c.id AND pin.kind='template'), '') AS templates,
      (SELECT sum(jsonb_array_length(x->'open'))::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.completeness_cache->'checks')='array' THEN c.completeness_cache->'checks' ELSE '[]' END) x) AS open
     FROM consults c JOIN projects p ON p.id=c.project_id LEFT JOIN leads l ON l.id=p.lead_id JOIN users u ON u.id=c.conducted_by
     WHERE ($2='owner' OR EXISTS(SELECT 1 FROM consult_assignments a WHERE a.consult_id=c.id AND a.user_id=$1 AND a.revoked_at IS NULL))
     ORDER BY c.scheduled_at DESC, c.id LIMIT 200`, [user.id, user.role]);
  return rows.map((r) => ({ ...r, scheduled_at: new Date(r.scheduled_at).toISOString(), open: r.open ?? undefined }));
}

/** Same minted person context as the API route; throws on refusal (not assigned, revoked …). */
export async function readSnapshot(user: CurrentUser, id: string): Promise<Snapshot> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const session = await readSession();
    if (!session) throw new Error("signed_out");
    const claims = { kind: "in_home_consult", sub: user.id, role: user.role, areas: user.permissions, mode: "person", operation: "read", consult_id: id, iat: session.authAt ?? session.iat ?? 0, exp: Date.now() / 1000 + 120, run_id: randomUUID(), nonce: randomUUID() };
    const key = await c.query("SELECT key_id FROM consult_context_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1");
    if (!key.rows.length) throw new Error("consult_key_unavailable");
    const context = (await c.query("SELECT consult_mint_context($1,$2) v", [claims, key.rows[0].key_id])).rows[0].v;
    const s = (await snapshot(c, context, id)) as unknown as Snapshot;
    await c.query("COMMIT");
    return s;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

export interface ProjectConsult { id: string; status: string; scheduled_at: string; visitor_name: string; conducted_by: string; revision: string; templates: string; open: number | null }
export async function projectConsults(projectId: string): Promise<ProjectConsult[]> {
  const { rows } = await query<ProjectConsult>(`SELECT c.id, c.status, c.scheduled_at, c.conducted_by, c.revision::text, u.name AS visitor_name,
      COALESCE((SELECT string_agg(f.definition->>'title', ' + ' ORDER BY f.key) FROM consult_form_pins pin JOIN consult_form_versions f ON f.id=pin.form_id WHERE pin.consult_id=c.id AND pin.kind='template'), '') AS templates,
      (SELECT sum(jsonb_array_length(x->'open'))::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.completeness_cache->'checks')='array' THEN c.completeness_cache->'checks' ELSE '[]' END) x) AS open
     FROM consults c JOIN users u ON u.id=c.conducted_by WHERE c.project_id=$1 ORDER BY c.scheduled_at DESC LIMIT 10`, [projectId]);
  return rows.map((r) => ({ ...r, scheduled_at: new Date(r.scheduled_at).toISOString() }));
}

export interface FormOption { id: string; key: string; title: string; version: number }
export interface ScheduleOptions { templates: FormOption[]; addOns: FormOption[]; modules: string[]; visitors: { id: string; name: string; role: string }[]; suggested: string[]; captureOn: boolean }
const ADD_ONS = ["garage", "openings", "flooring"];
/** Published, newest version per key; every published module is pinned too (schedule requires it). */
export async function scheduleOptions(projectId: string): Promise<ScheduleOptions> {
  const { rows } = await query<{ id: string; kind: string; key: string; version: number; title: string }>(`SELECT DISTINCT ON (kind,key) id, kind, key, version, definition->>'title' AS title FROM consult_form_versions WHERE status='published' ORDER BY kind, key, version DESC`);
  const visitors = (await query<{ id: string; name: string; role: string }>(`SELECT id, name, role FROM users WHERE active AND (role='owner' OR (role='staff' AND 'projects'=ANY(permissions))) ORDER BY role='owner' DESC, name`)).rows;
  const order = ["kitchen", "bath", "deck", "addition", "basement", "whole", "general"];
  const t = rows.filter((r) => r.kind === "template");
  const suggested = (await query<{ key: string }>(`SELECT DISTINCT split_part(key,'.',1) AS key FROM scope_items WHERE project_id=$1 AND status <> 'superseded'`, [projectId]).catch(() => ({ rows: [] as { key: string }[] }))).rows.map((r) => r.key).filter((k) => order.includes(k));
  return {
    templates: t.filter((r) => !ADD_ONS.includes(r.key)).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
    addOns: t.filter((r) => ADD_ONS.includes(r.key)),
    modules: rows.filter((r) => r.kind === "module").map((r) => r.id),
    visitors, suggested, captureOn: await flag("consult_capture"),
  };
}

export interface LookOverExtra {
  media: { id: string; instance_id: string; field_key: string | null; shot_key: string | null; kind: string; file_id: string; sha256: string; taken_at: string }[];
  evidence: Record<string, unknown> | null;
  provenance: Record<string, { actor: string; source: string; device: string | null; at: string }>;
  conflicts: Record<string, { current: { id: string; value: unknown; status: string; revision: number; actor: string; at: string; unit?:string|null; device_id?:string|null; person?:string; source_label?:string; available?:boolean; skip_reason?:string|null; skip_note?:string|null }; proposed: { id: string; value: unknown; status: string; actor: string; at: string; unit?:string|null; device_id?:string|null; person?:string; source_label?:string; available?:boolean; skip_reason?:string|null; skip_note?:string|null } }>;
  pendingDevice: { photos: number } | null;
  closedAt: string | null; completedAt: string | null; reopenReason: string | null; completeness: unknown;
  autoApply: boolean;
}
export async function lookOverExtra(id: string): Promise<LookOverExtra> {
  const media = (await query<LookOverExtra["media"][number]>(`SELECT id, instance_id, field_key, shot_key, kind, file_id, sha256, taken_at FROM consult_media WHERE consult_id=$1 AND removed_at IS NULL ORDER BY taken_at`, [id])).rows;
  const ev = await queryOne<{ evidence: Record<string, unknown> }>(`SELECT evidence FROM consult_close_evidence WHERE consult_id=$1`, [id]);
  const prov = (await query<{ instance_id: string; field_key: string; actor: string; source: string; device_id: string | null; created_at: string }>(`SELECT a.instance_id, a.field_key, u.name AS actor, a.source, a.device_id::text, a.created_at FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id JOIN users u ON u.id=a.actor WHERE h.consult_id=$1`, [id])).rows;
  const conf = (await query<{ instance_id: string; field_key: string; cid: string; cv: unknown; cs: string; crev: string; ca: string; cat: string; pid: string; pv: unknown; ps: string; pa: string; pat: string }>(`SELECT x.instance_id, x.field_key, a.id AS cid, a.value AS cv, a.status AS cs, h.revision::text AS crev, ua.name AS ca, a.created_at AS cat, b.id AS pid, b.value AS pv, b.status AS ps, ub.name AS pa, b.created_at AS pat
     FROM consult_conflicts x JOIN consult_field_heads h USING(consult_id,instance_id,field_key) JOIN consult_answers a ON a.id=x.current_answer_id JOIN consult_answers b ON b.id=x.proposed_answer_id JOIN users ua ON ua.id=a.actor JOIN users ub ON ub.id=b.actor
     WHERE x.consult_id=$1 AND x.resolved_at IS NULL`, [id])).rows;
  const row = await queryOne<{ closed_at: string | null; completed_at: string | null; reopen_reason: string | null; completeness_cache: unknown }>(`SELECT closed_at, completed_at, reopen_reason, completeness_cache FROM consults WHERE id=$1`, [id]);
  const conflicts: LookOverExtra["conflicts"] = {};
  for (const c of conf) conflicts[`${c.instance_id}:${c.field_key}`] = { current: { id: c.cid, value: c.cv, status: c.cs, revision: Number(c.crev), actor: c.ca, at: String(c.cat) }, proposed: { id: c.pid, value: c.pv, status: c.ps, actor: c.pa, at: String(c.pat) } };
  const sides=(await query(`SELECT a.*,u.name person FROM consult_answers a JOIN users u ON u.id=a.actor WHERE a.consult_id=$1 AND a.id IN (SELECT current_answer_id FROM consult_conflicts WHERE consult_id=$1 AND resolved_at IS NULL UNION SELECT proposed_answer_id FROM consult_conflicts WHERE consult_id=$1 AND resolved_at IS NULL)`,[id])).rows;
  for(const pair of Object.values(conflicts))for(const side of [pair.current,pair.proposed]){const answer=sides.find(a=>a.id===side.id);Object.assign(side,answer??{}, {source_label:answer?conflictSideLabel(answer,sides.find(a=>a.id===(side===pair.current?pair.proposed:pair.current).id)):undefined,available:!!answer&&(answer.status!=='answered'||answer.value!==undefined)});}
  const provenance: LookOverExtra["provenance"] = {};
  for (const p of prov) provenance[`${p.instance_id}:${p.field_key}`] = { actor: p.actor, source: p.source, device: p.device_id, at: String(p.created_at) };
  const pendingPhotos = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM consult_uploads WHERE consult_id=$1 AND status NOT IN ('committed','expired')`, [id]).catch(() => null);
  return { media, evidence: ev?.evidence ?? null, provenance, conflicts, pendingDevice: pendingPhotos?.n ? { photos: pendingPhotos.n } : null, closedAt: row?.closed_at ?? null, completedAt: row?.completed_at ?? null, reopenReason: row?.reopen_reason ?? null, completeness: row?.completeness_cache ?? null, autoApply: await flag("consult_auto_apply_findings") };
}

/** Devices that captured this visit (owner look-over: move / recover). Plain ids and names only. */
export interface ConsultDeviceRow { device_id: string; epoch: number; user_id: string; user_name: string; closed: boolean; revoked: boolean; created_at: string }
export async function consultDevices(id: string): Promise<ConsultDeviceRow[]> {
  const { rows } = await query<ConsultDeviceRow>(`SELECT d.device_id::text, d.epoch::int AS epoch, d.user_id::text, u.name AS user_name, (d.close_manifest IS NOT NULL) AS closed, (d.revoked_at IS NOT NULL) AS revoked, d.created_at
     FROM consult_devices d JOIN users u ON u.id=d.user_id WHERE d.consult_id=$1 ORDER BY d.created_at`, [id]).catch(() => ({ rows: [] as ConsultDeviceRow[] }));
  return rows.map((r) => ({ ...r, epoch: Number(r.epoch), created_at: new Date(r.created_at).toISOString() }));
}

/** The visit a project strip shows: the latest one scheduled, in progress or needing finishing. */
export async function liveProjectConsult(slug: string): Promise<ProjectConsult | null> {
  const project = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug=$1`, [slug]).catch(() => null);
  if (!project) return null;
  const visits = await projectConsults(project.id).catch(() => [] as ProjectConsult[]);
  return visits.find((v) => ["scheduled", "in_progress", "incomplete"].includes(v.status)) ?? null;
}
