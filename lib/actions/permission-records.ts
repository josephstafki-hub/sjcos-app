"use server";

import { requireRole } from "@/lib/dal";
import { query } from "@/lib/db";
import { normalizeE164 } from "@/lib/comms/phone";

export type PermissionRecord = { id: string; label: string };

/** Owner-only record search for the grant form; no sends or grant mutations. */
export async function searchPermissionRecords(action: string, search: string): Promise<{ records: PermissionRecord[]; error?: string }> {
  await requireRole("owner");
  const contacts = `SELECT name, email, phone FROM leads
    UNION ALL SELECT COALESCE(NULLIF(client_name,''),name), client_email, NULL::text AS phone FROM projects
    UNION ALL SELECT name, email, phone FROM subs
    UNION ALL SELECT name, email, phone FROM vendors`;
  const sources: Record<string, string> = {
    send_email: `SELECT email AS id, name || ' · ' || email AS label FROM (${contacts}) c WHERE NULLIF(trim(email),'') IS NOT NULL`,
    send_sms: `SELECT phone AS id, name || ' · ' || phone AS label FROM (${contacts}) c WHERE NULLIF(trim(phone),'') IS NOT NULL`,
    place_call: `SELECT phone AS id, name || ' · ' || phone AS label FROM (${contacts}) c WHERE NULLIF(trim(phone),'') IS NOT NULL`,
    send_invoice: `SELECT i.id::text, i.number || ' · ' || p.name || ' · ' || i.milestone || ' · ' || i.status AS label FROM invoices i JOIN projects p ON p.id=i.project_id`,
    send_document_for_signature: `SELECT d.id::text, d.title || ' · ' || COALESCE(p.name,l.name,'No project') || ' · ' || d.status AS label FROM document_drafts d LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN leads l ON l.slug=d.lead_slug`,
    send_purchase_order: `SELECT o.id::text, o.po_number || ' · ' || o.title || ' · ' || o.vendor_name || ' · ' || p.name AS label FROM purchase_orders o JOIN projects p ON p.id=o.project_id`,
    send_bid_package: `SELECT b.id::text, b.title || ' · ' || p.name || ' · ' || b.status AS label FROM bid_packages b JOIN projects p ON p.id=b.project_id`,
    release_newsletter_issue: `SELECT id::text, title || ' · ' || status AS label FROM newsletters`,
    release_newsletter_outbox_item: `SELECT id::text, subject || ' · ' || COALESCE(NULLIF(name,''),email) || ' · ' || email || ' · ' || status AS label FROM newsletter_outbox`,
  };
  const source = Object.hasOwn(sources, action) ? sources[action] : undefined;
  if (!source) return { records: [] };
  try {
    const { rows } = await query<PermissionRecord>(`SELECT DISTINCT id, label FROM (${source}) records WHERE label ILIKE $1 ORDER BY label, id LIMIT 40`, [`%${search.trim().slice(0, 120)}%`]);
    const records = action === "send_sms" || action === "place_call" ? rows.flatMap((r) => {
      const phone = normalizeE164(r.id);
      return phone.ok ? [{ ...r, id: phone.e164 }] : [];
    }) : rows;
    return { records };
  } catch {
    return { records: [], error: "Records could not be loaded. Try searching again." };
  }
}
