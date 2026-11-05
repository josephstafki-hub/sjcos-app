import "server-only";

// Phone lines (0110): the numbers the business owns on Telnyx, which one is the
// company's main line, and which belongs to one team member.
//
//   company line   the default: agents' texts and calls, the website opt-in
//                  confirmation, and anyone without a line of their own. Joe
//                  switches it in Settings › Phone lines (e.g. to his ported
//                  Google Voice number) — every new text and call follows.
//   own line       assigned to one login. Their texts and calls go out from it,
//                  its inbound calls ring their cell, its texts notify them.
//
// Who sees what: the owner sees every line's conversations; a team member sees
// the company lines' conversations and their own. Everyone sees the short
// summaries on the shared lead / client / sub / vendor records
// (lib/comms-summaries.ts), whichever line the conversation was on.
//
// No rows yet (fresh install, or before the migration's seed found anything):
// the env number (SMS_FROM_NUMBER / VOICE_FROM_NUMBER) is the company line, and
// the first website read adds it as a row.

import { query, queryOne } from "./db";
import { formatUsPhone, isE164 } from "./comms/phone";

export interface PhoneLine {
  id: string;
  number: string;
  formatted: string;
  label: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  isCompanyDefault: boolean;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  active: boolean;
  voicemailGreeting: string | null;
  notes: string;
}

interface LineRow {
  id: string;
  number: string;
  label: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  is_company_default: boolean;
  sms_enabled: boolean;
  voice_enabled: boolean;
  active: boolean;
  voicemail_greeting: string | null;
  notes: string;
}

const toLine = (r: LineRow): PhoneLine => ({
  id: r.id,
  number: r.number,
  formatted: formatUsPhone(r.number),
  label: r.label,
  assignedUserId: r.assigned_user_id,
  assignedUserName: r.assigned_user_name,
  isCompanyDefault: r.is_company_default,
  smsEnabled: r.sms_enabled,
  voiceEnabled: r.voice_enabled,
  active: r.active,
  voicemailGreeting: r.voicemail_greeting,
  notes: r.notes,
});

/** The env number, before any line exists. */
export function envBusinessNumber(): string | null {
  for (const k of ["SMS_FROM_NUMBER", "VOICE_FROM_NUMBER"]) {
    const v = (process.env[k] ?? "").trim();
    if (isE164(v)) return v;
  }
  return null;
}

/** Missing table (code ahead of the migration) or a login without the grant:
 *  fall back to the env number rather than break every text and call. */
function tolerable(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "42P01" || code === "42501" || code === "42883";
}

/** Add the env number as the company line when there are no lines at all.
 *  Website (owner login) only; narrow logins can't insert and don't need to. */
export async function ensurePhoneLinesSeeded(): Promise<void> {
  const env = envBusinessNumber();
  if (!env) return;
  try {
    await query(
      `INSERT INTO phone_lines (number, label, is_company_default)
       SELECT $1, 'SJC main line', true WHERE NOT EXISTS (SELECT 1 FROM phone_lines)
       ON CONFLICT DO NOTHING`,
      [env],
    );
  } catch (err) {
    if (!tolerable(err)) throw err;
  }
}

const LINE_SELECT = `SELECT l.id, l.number, l.label, l.assigned_user_id, u.name AS assigned_user_name, l.is_company_default,
       l.sms_enabled, l.voice_enabled, l.active, l.voicemail_greeting, l.notes
  FROM phone_lines l LEFT JOIN users u ON u.id = l.assigned_user_id`;

/** Every line, main line first. Website reads (joins users.name). */
export async function listPhoneLines(): Promise<PhoneLine[]> {
  try {
    const { rows } = await query<LineRow>(
      `${LINE_SELECT} ORDER BY l.is_company_default DESC, l.active DESC, (l.assigned_user_id IS NULL) DESC, l.created_at`,
    );
    return rows.map(toLine);
  } catch (err) {
    if (tolerable(err)) return [];
    throw err;
  }
}

/** The company's main number: the default line, else the env number. */
export async function companyLineNumber(): Promise<string | null> {
  try {
    const row = await queryOne<{ number: string }>(`SELECT number FROM phone_lines WHERE is_company_default AND active`);
    if (row) return row.number;
  } catch (err) {
    if (!tolerable(err)) throw err;
  }
  return envBusinessNumber();
}

/** The number this login's texts / calls go out from: their own active line
 *  (when it carries that channel), else the company line. Null user (agents,
 *  automations) = the company line. */
export async function outboundNumberFor(userId: string | null | undefined, channel: "sms" | "voice"): Promise<string | null> {
  if (userId) {
    try {
      const own = await queryOne<{ number: string }>(
        `SELECT number FROM phone_lines WHERE assigned_user_id = $1 AND active AND ${channel === "sms" ? "sms_enabled" : "voice_enabled"}`,
        [userId],
      );
      if (own) return own.number;
    } catch (err) {
      if (!tolerable(err)) throw err;
    }
  }
  return companyLineNumber();
}

export interface LineRoute {
  lineId: string;
  label: string;
  assignedUserId: string | null;
  userName: string | null;
  /** The assigned person's cell (null when unassigned, unset, or they're disabled). */
  forwardTo: string | null;
  voicemailGreeting: string | null;
  isCompanyDefault: boolean;
}

/** Which of our lines a number is (inbound text / call), via the SECURITY
 *  DEFINER lookup so the worker can ring a team member's cell without reading
 *  users.phone itself. Null = not a known line (treat as the company line). */
export async function routeForNumber(number: string | null | undefined): Promise<LineRoute | null> {
  if (!number) return null;
  try {
    const r = await queryOne<{
      line_id: string;
      label: string;
      assigned_user_id: string | null;
      user_name: string | null;
      forward_to: string | null;
      voicemail_greeting: string | null;
      is_company_default: boolean;
    }>(`SELECT * FROM phone_line_route($1)`, [number]);
    if (!r) return null;
    return {
      lineId: r.line_id,
      label: r.label,
      assignedUserId: r.assigned_user_id,
      userName: r.user_name,
      forwardTo: r.forward_to,
      voicemailGreeting: r.voicemail_greeting,
      isCompanyDefault: r.is_company_default,
    };
  } catch (err) {
    if (tolerable(err)) return null;
    throw err;
  }
}

/** Every number that is some team member's own line (active or not). Their
 *  conversations are theirs + the owner's; everything else is shared. */
export async function personalLineOwners(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { rows } = await query<{ number: string; assigned_user_id: string }>(
      `SELECT number, assigned_user_id FROM phone_lines WHERE assigned_user_id IS NOT NULL`,
    );
    for (const r of rows) map.set(r.number, r.assigned_user_id);
  } catch (err) {
    if (!tolerable(err)) throw err;
  }
  return map;
}

export interface Viewer {
  id: string;
  role: string;
}

/** SQL filter for conversations a viewer may read in full, on a column holding
 *  our number (sms_threads.business_number, calls.business_number). Owner:
 *  everything. Team member: lines that are nobody's own, plus their own.
 *  `param` is the placeholder index for the viewer's id. */
export function lineVisibilityClause(viewer: Viewer, column: string, param: number): { sql: string; params: unknown[] } {
  if (viewer.role === "owner") return { sql: "true", params: [] };
  return {
    sql: `(${column} IS NULL OR NOT EXISTS (
            SELECT 1 FROM phone_lines pl WHERE pl.number = ${column} AND pl.assigned_user_id IS NOT NULL AND pl.assigned_user_id <> $${param}::uuid))`,
    params: [viewer.id],
  };
}

export interface LineBadge {
  number: string;
  formatted: string;
  label: string;
}

/** What the sidebar / headers show: the company's main line, and the
 *  viewer's own line when they have one. Never throws. */
export async function lineBadgesFor(viewer: Viewer | null): Promise<{ company: LineBadge | null; mine: LineBadge | null }> {
  try {
    const { rows } = await query<{ number: string; label: string; is_company_default: boolean; assigned_user_id: string | null }>(
      `SELECT number, label, is_company_default, assigned_user_id FROM phone_lines
        WHERE active AND (is_company_default OR ($1::uuid IS NOT NULL AND assigned_user_id = $1::uuid))`,
      [viewer?.id ?? null],
    );
    const badge = (r: { number: string; label: string }): LineBadge => ({ number: r.number, formatted: formatUsPhone(r.number), label: r.label });
    const c = rows.find((r) => r.is_company_default);
    const m = viewer ? rows.find((r) => r.assigned_user_id === viewer.id) : undefined;
    const env = envBusinessNumber();
    return {
      company: c ? badge(c) : env ? { number: env, formatted: formatUsPhone(env), label: "SJC main line" } : null,
      mine: m ? badge(m) : null,
    };
  } catch {
    const env = envBusinessNumber();
    return { company: env ? { number: env, formatted: formatUsPhone(env), label: "SJC main line" } : null, mine: null };
  }
}

/** Short name for a line: "Abigail's line" for someone's own line, else its
 *  label, else the formatted number. */
export function lineName(l: Pick<PhoneLine, "assignedUserName" | "label" | "formatted">): string {
  if (l.assignedUserName) return `${l.assignedUserName.split(/\s+/)[0]}'s line`;
  return l.label || l.formatted;
}

/** For /messages and /calls: the number this login texts / calls from, and a
 *  name for every line. Website reads. Never throws. */
export async function linesForViewer(viewer: Viewer, channel: "sms" | "voice"): Promise<{ sendingFrom: { formatted: string; label: string } | null; names: Record<string, string> }> {
  try {
    await ensurePhoneLinesSeeded();
    const [lines, from] = await Promise.all([listPhoneLines(), outboundNumberFor(viewer.id, channel)]);
    const names: Record<string, string> = {};
    for (const l of lines) names[l.number] = lineName(l);
    const line = lines.find((l) => l.number === from);
    return {
      sendingFrom: from ? { formatted: formatUsPhone(from), label: line ? lineName(line) : "" } : null,
      names,
    };
  } catch {
    const env = envBusinessNumber();
    return { sendingFrom: env ? { formatted: formatUsPhone(env), label: "" } : null, names: {} };
  }
}
