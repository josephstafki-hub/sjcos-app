"use server";

// Settings › Phone lines (owner only). Add a number the business owns on
// Telnyx, make it the company's main line, give it to a team member, switch
// texts / calls off for it, or retire it. lib/phone-lines.ts reads them.
//
// Switching the main line moves every NEW text and call (agents, the website
// opt-in confirmation, anyone without a line of their own). Conversations
// already on the old number stay on it: replies follow the thread's line.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { withTransaction } from "@/lib/commands/db";
import { requireRole } from "@/lib/dal";
import { normalizeE164 } from "@/lib/comms/phone";
import { smsConfigFrom, voiceConfigFrom } from "@/lib/comms/env";
import { probePhoneNumber, type NumberReadiness } from "@/lib/telnyx";

export type PhoneLineResult = { ok: true } | { ok: false; error: string };

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/messages");
  revalidatePath("/calls");
}

function pgMessage(err: unknown): string {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === "23505" && e.constraint === "phone_lines_one_per_user") return "That person already has a line. Unassign it first.";
  if (e.code === "23505") return "That number is already in the list.";
  if (e.code === "23514") return "That isn't a valid line (a US number like (612) 555-1234).";
  return e.message ?? "Couldn't save the line.";
}

export async function addPhoneLine(input: { number: string; label: string; assignedUserId?: string | null; notes?: string }): Promise<PhoneLineResult> {
  await requireRole("owner");
  const norm = normalizeE164(input.number);
  if (!norm.ok) return { ok: false, error: norm.error };
  const label = input.label.trim().slice(0, 80);
  try {
    await query(
      `INSERT INTO phone_lines (number, label, assigned_user_id, notes, is_company_default)
       VALUES ($1, $2, $3, $4, NOT EXISTS (SELECT 1 FROM phone_lines WHERE is_company_default) AND $3::uuid IS NULL)`,
      [norm.e164, label, input.assignedUserId || null, (input.notes ?? "").trim().slice(0, 1000)],
    );
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
  refresh();
  return { ok: true };
}

export async function updatePhoneLine(
  id: string,
  patch: { label?: string; assignedUserId?: string | null; smsEnabled?: boolean; voiceEnabled?: boolean; active?: boolean; voicemailGreeting?: string | null; notes?: string },
): Promise<PhoneLineResult> {
  await requireRole("owner");
  const line = await queryOne<{ is_company_default: boolean }>(`SELECT is_company_default FROM phone_lines WHERE id = $1`, [id]);
  if (!line) return { ok: false, error: "Line not found." };
  if (line.is_company_default && (patch.assignedUserId || patch.active === false)) {
    return { ok: false, error: "This is the main line. Make another line the main line first." };
  }
  if (patch.assignedUserId) {
    const u = await queryOne<{ role: string; active: boolean }>(`SELECT role, active FROM users WHERE id = $1`, [patch.assignedUserId]);
    if (!u || !["owner", "staff"].includes(u.role)) return { ok: false, error: "Lines can only go to you or a team member." };
  }
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (patch.label !== undefined) set("label", patch.label.trim().slice(0, 80));
  if (patch.assignedUserId !== undefined) set("assigned_user_id", patch.assignedUserId || null);
  if (patch.smsEnabled !== undefined) set("sms_enabled", patch.smsEnabled);
  if (patch.voiceEnabled !== undefined) set("voice_enabled", patch.voiceEnabled);
  if (patch.active !== undefined) set("active", patch.active);
  if (patch.voicemailGreeting !== undefined) set("voicemail_greeting", patch.voicemailGreeting?.trim().slice(0, 600) || null);
  if (patch.notes !== undefined) set("notes", patch.notes.trim().slice(0, 1000));
  try {
    await query(`UPDATE phone_lines SET ${sets.join(", ")} WHERE id = $1`, vals);
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
  refresh();
  return { ok: true };
}

/** Make this the company's main line (one switch, in one statement so there
 *  is never zero or two). Refused for a line someone owns or one switched
 *  off; texts and calls must both be on. */
export async function makeMainLine(id: string): Promise<PhoneLineResult> {
  await requireRole("owner");
  const line = await queryOne<{ assigned_user_id: string | null; active: boolean; sms_enabled: boolean; voice_enabled: boolean }>(
    `SELECT assigned_user_id, active, sms_enabled, voice_enabled FROM phone_lines WHERE id = $1`,
    [id],
  );
  if (!line) return { ok: false, error: "Line not found." };
  if (line.assigned_user_id) return { ok: false, error: "This line belongs to a team member. Unassign it first." };
  if (!line.active) return { ok: false, error: "Turn this line back on first." };
  if (!line.sms_enabled || !line.voice_enabled) return { ok: false, error: "The main line needs both texts and calls switched on." };
  // Two steps in one transaction: the old main line off, then this one on
  // (the one-default unique index is checked row by row).
  try {
    await withTransaction(async (run) => {
      await run(`UPDATE phone_lines SET is_company_default = false, updated_at = now() WHERE is_company_default AND id <> $1`, [id]);
      await run(`UPDATE phone_lines SET is_company_default = true, updated_at = now() WHERE id = $1`, [id]);
    });
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
  refresh();
  return { ok: true };
}

export async function deletePhoneLine(id: string): Promise<PhoneLineResult> {
  await requireRole("owner");
  const line = await queryOne<{ is_company_default: boolean; number: string }>(`SELECT is_company_default, number FROM phone_lines WHERE id = $1`, [id]);
  if (!line) return { ok: false, error: "Line not found." };
  if (line.is_company_default) return { ok: false, error: "This is the main line. Make another line the main line first." };
  const used = await queryOne<{ n: number }>(
    `SELECT ((SELECT count(*) FROM sms_threads WHERE business_number = $1) + (SELECT count(*) FROM calls WHERE business_number = $1))::int AS n`,
    [line.number],
  );
  if ((used?.n ?? 0) > 0) return { ok: false, error: "This number has calls or texts on it. Switch it off instead, so they keep their line." };
  await query(`DELETE FROM phone_lines WHERE id = $1`, [id]);
  refresh();
  return { ok: true };
}

/** Ask Telnyx whether the number is on the account, on the messaging profile,
 *  on the Call Control app and on the 10DLC campaign. Read-only. */
export async function checkPhoneLine(id: string): Promise<{ ok: true; readiness: NumberReadiness } | { ok: false; error: string }> {
  await requireRole("owner");
  const line = await queryOne<{ number: string }>(`SELECT number FROM phone_lines WHERE id = $1`, [id]);
  if (!line) return { ok: false, error: "Line not found." };
  const sms = smsConfigFrom();
  const voice = voiceConfigFrom();
  const apiKey = sms?.apiKey ?? voice?.apiKey ?? (process.env.SMS_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, error: "Telnyx isn't set up on this server (SMS_API_KEY)." };
  const readiness = await probePhoneNumber(apiKey, line.number, {
    messagingProfileId: sms?.messagingProfileId ?? null,
    callControlAppId: voice?.applicationId ?? null,
  });
  return { ok: true, readiness };
}
