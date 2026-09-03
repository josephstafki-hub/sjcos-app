import "server-only";

// Shared plumbing for the SMS and voice paths: phone → record matching (the
// same rule the email path uses, by counterparty identity), work-item filing
// with dedup, the app_settings stamps the health check reads, and the 10DLC
// state file the registration script writes.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { query, queryOne } from "./db";
import { last10 } from "./comms/phone";

export type CommsLinkType = "lead" | "sub" | "client" | "project" | "vendor";

export interface RecordMatch {
  linkType: CommsLinkType;
  linkSlug: string;
  contactName: string;
  leadId: string | null;
  projectId: string | null;
}

/** Match a phone number to a lead / project (via the converted lead) / sub /
 *  vendor by last-10-digits. Converted leads resolve to their project, like
 *  the email detectors do. Null = unmatched (the thread/call still exists,
 *  linked to nothing). */
export async function matchPhoneToRecord(phone: string): Promise<RecordMatch | null> {
  const l10 = last10(phone);
  if (l10.length < 10) return null;
  const row = await queryOne<{
    type: CommsLinkType;
    slug: string;
    name: string;
    lead_id: string | null;
    project_id: string | null;
  }>(
    `SELECT * FROM (
       SELECT 'project'::text AS type, p.slug, COALESCE(NULLIF(p.client_name, ''), l.name) AS name,
              l.id AS lead_id, p.id AS project_id, 0 AS rank
         FROM leads l JOIN projects p ON p.lead_id = l.id
        WHERE l.phone IS NOT NULL AND right(regexp_replace(l.phone, '\\D', '', 'g'), 10) = $1
       UNION ALL
       SELECT 'lead', l.slug, l.name, l.id, NULL, 1
         FROM leads l
        WHERE l.phone IS NOT NULL AND right(regexp_replace(l.phone, '\\D', '', 'g'), 10) = $1
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = l.id)
       UNION ALL
       SELECT 'sub', s.slug, s.name, NULL, NULL, 2
         FROM subs s
        WHERE s.phone IS NOT NULL AND right(regexp_replace(s.phone, '\\D', '', 'g'), 10) = $1
       UNION ALL
       SELECT 'vendor', v.slug, v.name, NULL, NULL, 3
         FROM vendors v
        WHERE v.phone IS NOT NULL AND right(regexp_replace(v.phone, '\\D', '', 'g'), 10) = $1
     ) m ORDER BY rank LIMIT 1`,
    [l10],
  );
  if (!row) return null;
  return { linkType: row.type, linkSlug: row.slug, contactName: row.name, leadId: row.lead_id, projectId: row.project_id };
}

/** lead_id / project_id for a manual link (link_type + slug). */
export async function linkIds(linkType: string | null, linkSlug: string | null): Promise<{ leadId: string | null; projectId: string | null }> {
  if (!linkType || !linkSlug) return { leadId: null, projectId: null };
  if (linkType === "lead") {
    const r = await queryOne<{ id: string; project_id: string | null }>(
      `SELECT l.id, p.id AS project_id FROM leads l LEFT JOIN projects p ON p.lead_id = l.id WHERE l.slug = $1`,
      [linkSlug],
    );
    return { leadId: r?.id ?? null, projectId: r?.project_id ?? null };
  }
  if (linkType === "project" || linkType === "client") {
    const r = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [linkSlug]);
    return { leadId: null, projectId: r?.id ?? null };
  }
  return { leadId: null, projectId: null };
}

/** Page for a linked record. */
export function linkHref(linkType: string | null, linkSlug: string | null): string | null {
  if (!linkType || !linkSlug) return null;
  const seg: Record<string, string> = { lead: "leads", sub: "subs", project: "projects", client: "projects", vendor: "vendors" };
  return seg[linkType] ? `/${seg[linkType]}/${linkSlug}` : null;
}

// ─── Work items ──────────────────────────────────────────────────────────────

export interface CommsWorkItemInput {
  title: string;
  body: string;
  priority?: "low" | "normal" | "high" | "urgent";
  status?: string;
  leadId?: string | null;
  projectId?: string | null;
  /** 'sms' | 'call' | 'comms' */
  sourceKind: string;
  /** Dedup key: an OPEN item with the same source_kind + source_id is updated, not duplicated. */
  sourceId: string;
  expectedSkillSlug?: string | null;
  dueAt?: Date | null;
  createdBy?: string;
}

/** File (or refresh) a work item for Joe. Never throws — a filing failure is
 *  logged and returns null; callers that must be loud wrap it. */
export async function fileCommsWorkItem(input: CommsWorkItemInput): Promise<string | null> {
  try {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM work_items
        WHERE source_kind = $1 AND source_id = $2 AND status NOT IN ('done','cancelled')
        ORDER BY created_at DESC LIMIT 1`,
      [input.sourceKind, input.sourceId],
    );
    if (existing) {
      await query(
        `UPDATE work_items
            SET body = $2, priority = $3, updated_at = now(),
                lead_id = COALESCE($4, lead_id), project_id = COALESCE($5, project_id)
          WHERE id = $1`,
        [existing.id, input.body, input.priority ?? "normal", input.leadId ?? null, input.projectId ?? null],
      );
      return existing.id;
    }
    const r = await queryOne<{ id: string }>(
      `INSERT INTO work_items
         (title, body, status, priority, assignee_kind, assignee_key, due_at, lead_id, project_id,
          source_kind, source_id, expected_skill_slug, requires_approval, created_by)
       VALUES ($1,$2,$3,$4,'human','human-joe',$5,$6,$7,$8,$9,$10,true,$11)
       RETURNING id`,
      [
        input.title.slice(0, 200),
        input.body,
        input.status ?? "waiting_on_human",
        input.priority ?? "normal",
        input.dueAt ?? null,
        input.leadId ?? null,
        input.projectId ?? null,
        input.sourceKind,
        input.sourceId,
        input.expectedSkillSlug ?? null,
        input.createdBy ?? "comms",
      ],
    );
    return r?.id ?? null;
  } catch (err) {
    console.error("[comms] work item filing failed", err);
    return null;
  }
}

// ─── app_settings stamps ─────────────────────────────────────────────────────

export async function setCommsSetting(key: string, value: string): Promise<void> {
  try {
    await query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
    );
  } catch (err) {
    console.error(`[comms] setting ${key} failed`, err);
  }
}

export async function getCommsSetting(key: string): Promise<string | null> {
  try {
    const r = await queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    return r?.value ?? null;
  } catch {
    return null;
  }
}

/** Stamp "a verified webhook landed" for the health check. Fire-and-forget. */
export function touchWebhookStamp(channel: "sms" | "voice"): void {
  void setCommsSetting(`comms.${channel}.last_webhook_at`, new Date().toISOString());
}

// ─── 10DLC state file ────────────────────────────────────────────────────────

export interface TendlcState {
  brandId?: string;
  tcrBrandId?: string | null;
  campaignId?: string;
  tcrCampaignId?: string | null;
  helpMessage?: string;
  assignments?: Record<string, { campaignId: string; assignmentStatus: string | null; at: string }>;
  vettingRequestedAt?: string;
  updatedAt?: string;
}

export function tendlcStatePath(): string {
  return (process.env.TENDLC_STATE_FILE ?? "").trim() || path.join(process.cwd(), ".10dlc-state.json");
}

let stateCache: { at: number; value: TendlcState | null } | null = null;

/** The ids scripts/register-10dlc.mjs wrote. Null when nothing is registered
 *  yet. Cached for a minute — it changes a handful of times, ever. */
export function readTendlcState(): TendlcState | null {
  if (stateCache && Date.now() - stateCache.at < 60_000) return stateCache.value;
  let value: TendlcState | null = null;
  try {
    const p = tendlcStatePath();
    if (existsSync(p)) value = JSON.parse(readFileSync(p, "utf8")) as TendlcState;
  } catch (err) {
    console.error("[comms] 10DLC state file unreadable", err);
  }
  stateCache = { at: Date.now(), value };
  return value;
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
}
