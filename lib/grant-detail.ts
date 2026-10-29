import "server-only";

// What a permission request is actually for. A grant row only knows
// "send_invoice on invoice 28"; this reads the record behind it (the invoice,
// the contract draft, the PO, the bid package, the newsletter…) and says it in
// plain words — headline, the job, the key numbers, the message that goes out
// and a link to the document — for every approval surface: the panel chat
// card, the bell / corner popup, /engine/permissions, and the Telegram title.
// Read-only and best-effort: a lookup that fails falls back to the bare label.

import { query, queryOne } from "@/lib/db";
import { usd } from "@/lib/money";
import { previewInvoiceEmail, previewPurchaseOrderEmail } from "@/lib/send-ops";
import { ACTION_LABEL, stagedSendOf, type GatedAction, type GrantDetail, type OwnerGrant } from "@/lib/owner-grant-types";

type GrantLike = Pick<OwnerGrant, "actions" | "target_kind" | "target_id" | "scope" | "reason">;

const projectHref = (slug: string, tab?: string) => `/projects/${slug}${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`;

/** Who an address belongs to — "Sam Hass", "lead" — and the job, if we know them. */
async function whoIsEmail(email: string): Promise<{ name: string; role: string; job: string | null } | null> {
  return queryOne<{ name: string; role: string; job: string | null }>(
    `SELECT name, role, job FROM (
       SELECT COALESCE(NULLIF(client_name, ''), name) AS name, 'client' AS role, name AS job, 1 AS o, updated_at AS t FROM projects WHERE lower(trim(client_email)) = lower($1)
       UNION ALL SELECT name, 'lead', NULL, 2, created_at FROM leads WHERE lower(trim(email)) = lower($1)
       UNION ALL SELECT name, 'sub', NULL, 3, NULL FROM subs WHERE lower(trim(email)) = lower($1)
       UNION ALL SELECT name, 'vendor', NULL, 4, NULL FROM vendors WHERE lower(trim(email)) = lower($1)
     ) x ORDER BY o, t DESC NULLS LAST LIMIT 1`,
    [email.trim()],
  ).catch(() => null);
}

/** Same for a phone number (digits compared, last 10). */
async function whoIsPhone(phone: string): Promise<string | null> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return null;
  const row = await queryOne<{ who: string }>(
    `SELECT who FROM (
       SELECT name || ' (lead)' AS who, 1 AS o FROM leads WHERE right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1
       UNION ALL SELECT name || ' (sub)', 2 FROM subs WHERE right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1
       UNION ALL SELECT name || ' (vendor)', 3 FROM vendors WHERE right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1
     ) x ORDER BY o LIMIT 1`,
    [digits],
  ).catch(() => null);
  return row?.who ?? null;
}

async function fileNames(ids: string[]): Promise<{ id: string; name: string }[]> {
  if (!ids.length) return [];
  const { rows } = await query<{ id: string; name: string }>(`SELECT id, name FROM files WHERE id = ANY($1::text[])`, [ids]).catch(() => ({ rows: [] as { id: string; name: string }[] }));
  return ids.map((id) => ({ id, name: rows.find((r) => r.id === id)?.name ?? id }));
}

function bare(action: string, g: GrantLike): GrantDetail {
  const label = action === "*" ? "Any send" : (ACTION_LABEL[action as GatedAction] ?? action);
  return {
    headline: `${label}${g.target_id ? ` (${g.target_kind ?? "target"} ${g.target_id})` : ""}`,
    job: null,
    facts: [],
    draft: null,
    draftNote: null,
    links: [],
  };
}

async function emailDetail(g: GrantLike): Promise<GrantDetail> {
  const staged = stagedSendOf(g);
  const to = staged?.email?.to ?? (typeof g.scope?.to === "string" ? g.scope.to : null) ?? g.target_id ?? "";
  const who = to ? await whoIsEmail(to) : null;
  const subject = staged?.email?.subject ?? "";
  const files = await fileNames(staged?.email?.attachment_file_ids ?? []);
  const facts: GrantDetail["facts"] = [{ label: "To", value: who ? `${who.name} (${who.role}) <${to}>` : to }];
  if (subject) facts.push({ label: "Subject", value: subject });
  if (files.length) facts.push({ label: "Attached", value: files.map((f) => f.name).join(", ") });
  return {
    headline: `Email ${who ? who.name : to}${subject ? ` — "${subject}"` : ""}`,
    job: who?.job ?? (who?.role === "lead" ? `Lead: ${who.name}` : null),
    facts,
    draft: staged?.email ? { to: staged.email.to, subject: staged.email.subject, body: staged.email.body } : null,
    draftNote: staged?.email ? null : "No draft attached — the agent writes and sends the email itself after you approve.",
    links: files.map((f) => ({ label: f.name, href: `/api/files/${encodeURIComponent(f.id)}` })),
  };
}

async function smsDetail(g: GrantLike, call: boolean): Promise<GrantDetail> {
  const staged = stagedSendOf(g);
  const to = staged?.sms?.to ?? g.target_id ?? "";
  const who = to ? await whoIsPhone(to) : null;
  const name = who ? who.replace(/ \(.*\)$/, "") : to;
  if (call) {
    return {
      headline: `Call ${name}${who ? ` at ${to}` : ""} — your cell rings first`,
      job: null,
      facts: [{ label: "Number", value: who ? `${who} · ${to}` : to }],
      draft: null,
      draftNote: "Nothing is sent. Approving lets the agent place the call; your phone rings first and connects you.",
      links: [],
    };
  }
  return {
    headline: `Text ${name}${who ? ` (${to})` : ""}`,
    job: null,
    facts: [{ label: "To", value: who ? `${who} · ${to}` : to }],
    draft: staged?.sms ? { to: staged.sms.to, body: staged.sms.body } : null,
    draftNote: staged?.sms ? null : "No draft attached — the agent writes and sends the text itself after you approve.",
    links: [],
  };
}

async function invoiceDetail(id: number): Promise<GrantDetail | null> {
  const inv = await queryOne<{ number: string; milestone: string; amount: number; status: string; due_at: string | null; terms: string | null; line_items: { label: string; amount: number }[]; slug: string; project_name: string }>(
    `SELECT i.number, i.milestone, i.amount, i.status, i.due_at::text AS due_at, i.terms, i.line_items, p.slug, p.name AS project_name
       FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
    [id],
  );
  if (!inv) return null;
  const preview = await previewInvoiceEmail(id).catch(() => null);
  const email = preview?.ok ? preview.email : null;
  const name = (preview?.ok && preview.clientName) || "the client";
  const facts: GrantDetail["facts"] = [
    { label: "Invoice", value: `${inv.number} — ${inv.milestone}` },
    { label: "Amount", value: usd(inv.amount) },
    { label: "To", value: email?.to ? `${name} <${email.to}>` : "No client email on file — the send will fail" },
  ];
  if (inv.terms || inv.due_at) facts.push({ label: "Due", value: inv.terms || inv.due_at! });
  if (inv.status !== "draft") facts.push({ label: "Heads up", value: `This invoice is already ${inv.status} — the send will be refused.` });
  return {
    headline: `Email invoice ${inv.number} (${usd(inv.amount)}) to ${name}`,
    job: inv.project_name,
    facts,
    draft: email ? { to: email.to, subject: email.subject, body: email.body } : null,
    draftNote: email ? "The invoice PDF goes along as an attachment." : null,
    links: [{ label: "Invoice in Money", href: projectHref(inv.slug, "Money") }],
  };
}

async function documentDetail(id: number): Promise<GrantDetail | null> {
  const d = await queryOne<{ title: string; template_key: string; status: string; pdf_file_id: string | null; field_values: Record<string, unknown>; slug: string | null; project_name: string | null; lead_slug: string | null; lead_name: string | null }>(
    `SELECT d.title, d.template_key, d.status, d.pdf_file_id, d.field_values, p.slug, p.name AS project_name, d.lead_slug, l.name AS lead_name
       FROM document_drafts d
       LEFT JOIN projects p ON p.id = d.project_id
       LEFT JOIN leads l ON l.slug = d.lead_slug
      WHERE d.id = $1`,
    [id],
  );
  if (!d) return null;
  const fv = d.field_values ?? {};
  const who = String(fv.client_name ?? "").trim();
  const email = String(fv.client_email ?? "").trim();
  const facts: GrantDetail["facts"] = [
    { label: "Document", value: `${d.title} (draft #${id})` },
    { label: "To sign", value: [who, email && `<${email}>`].filter(Boolean).join(" ") || "the client on file" },
  ];
  // The money on the page, when the template carries it.
  for (const [k, label] of [["contract_total", "Contract total"], ["total", "Total"], ["precon_fee", "Pre-con fee"], ["deposit", "Deposit"]] as const) {
    const v = fv[k];
    if (typeof v === "number" && v > 0) facts.push({ label, value: usd(v) });
    else if (typeof v === "string" && v.trim()) facts.push({ label, value: v.trim() });
  }
  if (d.status === "submitted" || d.status === "signed") facts.push({ label: "Heads up", value: `This document was already ${d.status === "signed" ? "signed" : "sent for signature"} — the send will be refused.` });
  else if (d.status !== "rendered") facts.push({ label: "Heads up", value: "The PDF is out of date — it needs a fresh print (render) before it can go out." });
  const links: GrantDetail["links"] = [];
  if (d.pdf_file_id) links.push({ label: "Open the PDF", href: `/api/files/${encodeURIComponent(d.pdf_file_id)}` });
  if (d.slug) links.push({ label: "Documents tab", href: projectHref(d.slug, "Documents") });
  else if (d.lead_slug) links.push({ label: "Lead documents", href: `/leads/${d.lead_slug}?tab=Documents` });
  return {
    headline: `Send "${d.title}" to ${who || "the client"} for signature`,
    job: d.project_name ?? d.lead_name,
    facts,
    draft: null,
    draftNote: "The client gets a signing link with this PDF — open it to read exactly what they'll sign.",
    links,
  };
}

async function poDetail(id: number, g: GrantLike): Promise<GrantDetail | null> {
  const po = await queryOne<{ po_number: string; title: string; vendor_name: string; subtotal: number; status: string; slug: string; project_name: string }>(
    `SELECT po.po_number, po.title, po.vendor_name, po.subtotal, po.status, p.slug, p.name AS project_name
       FROM purchase_orders po JOIN projects p ON p.id = po.project_id WHERE po.id = $1`,
    [id],
  );
  if (!po) return null;
  const preview = await previewPurchaseOrderEmail(id).catch(() => null);
  const def = preview?.ok ? preview.email : null;
  const edit = stagedSendOf(g)?.email;
  const email = def || edit ? { to: edit?.to || def?.to || "", subject: edit?.subject || def?.subject || "", body: edit?.body || def?.body || "" } : null;
  const facts: GrantDetail["facts"] = [
    { label: "PO", value: `${po.po_number} — ${po.title}` },
    { label: "Total", value: usd(po.subtotal) },
    { label: "To", value: email?.to ? `${po.vendor_name} <${email.to}>` : `${po.vendor_name} — no email on file, the send will fail` },
  ];
  if (!["draft", "queued"].includes(po.status)) facts.push({ label: "Heads up", value: `This PO is already ${po.status} — the send will be refused.` });
  return {
    headline: `Email purchase order ${po.po_number} (${usd(po.subtotal)}) to ${po.vendor_name}`,
    job: po.project_name,
    facts,
    draft: email?.body ? email : null,
    draftNote: email?.body ? null : "Couldn't build the PO email — open the PO to check it.",
    links: [{ label: "POs in Money", href: projectHref(po.slug, "Money") }],
  };
}

async function bidDetail(id: number): Promise<GrantDetail | null> {
  const pkg = await queryOne<{ title: string; trade: string | null; due_date: string | null; slug: string; project_name: string }>(
    `SELECT b.title, b.trade, b.due_date::text AS due_date, p.slug, p.name AS project_name
       FROM bid_packages b JOIN projects p ON p.id = b.project_id WHERE b.id = $1`,
    [id],
  );
  if (!pkg) return null;
  const { rows: invites } = await query<{ sub_name: string; email: string | null; message: string }>(
    `SELECT s.name AS sub_name, s.email, i.message FROM bid_invites i JOIN subs s ON s.slug = i.sub_slug
      WHERE i.package_id = $1 AND i.status = 'draft' ORDER BY s.name`,
    [id],
  );
  const { rows: files } = await query<{ id: string; name: string }>(
    `SELECT f.id, f.name FROM bid_package_files bf JOIN files f ON f.id = bf.file_id WHERE bf.package_id = $1 ORDER BY bf.sort_order, bf.id`,
    [id],
  );
  const facts: GrantDetail["facts"] = [
    { label: "Package", value: `${pkg.title}${pkg.trade ? ` · ${pkg.trade}` : ""}` },
    { label: invites.length === 1 ? "Sub" : `${invites.length} subs`, value: invites.map((i) => `${i.sub_name}${i.email ? "" : " (no email — skipped)"}`).join(", ") || "None waiting — the send will be refused" },
    { label: "Packet", value: files.map((f) => f.name).join(", ") || "Nothing attached — the send will be refused" },
  ];
  if (pkg.due_date) facts.push({ label: "Bids due", value: pkg.due_date });
  const first = invites.find((i) => i.message?.trim());
  return {
    headline: invites.length
      ? `Send the ${pkg.trade || pkg.title} bid package to ${invites.length === 1 ? invites[0].sub_name : `${invites.length} subs`}`
      : `Send the ${pkg.trade || pkg.title} bid package (no subs waiting for it)`,
    job: pkg.project_name,
    facts,
    draft: first ? { to: invites.length > 1 ? `${first.sub_name} (each sub gets their own copy)` : first.sub_name, body: first.message } : null,
    draftNote: first ? null : "Each sub gets the standard bid invite with the packet attached.",
    links: [...files.map((f) => ({ label: f.name, href: `/api/files/${encodeURIComponent(f.id)}` })), { label: "Bidding tab", href: projectHref(pkg.slug, "Bidding") }],
  };
}

async function newsletterDetail(id: number): Promise<GrantDetail | null> {
  const n = await queryOne<{ title: string; intro: string | null; queued: number }>(
    `SELECT n.title, n.intro,
            (SELECT count(*)::int FROM newsletter_outbox o WHERE o.newsletter_id = n.id AND o.status IN ('queued','failed')) AS queued
       FROM newsletters n WHERE n.id = $1`,
    [id],
  );
  if (!n) return null;
  return {
    headline: n.queued
      ? `Mail the newsletter "${n.title}" to ${n.queued} recipient${n.queued === 1 ? "" : "s"}`
      : `Mail the newsletter "${n.title}" (nothing queued yet)`,
    job: null,
    facts: [
      { label: "Issue", value: n.title },
      { label: "Recipients", value: n.queued ? `${n.queued} queued` : "Nothing queued — the release will be refused" },
    ],
    draft: n.intro?.trim() ? { subject: n.title, body: n.intro } : null,
    draftNote: "Open the newsletter page to see the full issue as it will be mailed.",
    links: [{ label: "Newsletter", href: "/newsletter" }],
  };
}

async function outboxDetail(id: number): Promise<GrantDetail | null> {
  const o = await queryOne<{ email: string; name: string | null; subject: string; body: string; status: string }>(
    `SELECT email, name, subject, body, status FROM newsletter_outbox WHERE id = $1`,
    [id],
  );
  if (!o) return null;
  const who = o.name?.trim() || o.email;
  return {
    headline: `Mail "${o.subject}" to ${who}`,
    job: null,
    facts: [
      { label: "To", value: o.name ? `${o.name} <${o.email}>` : o.email },
      ...(o.status === "queued" || o.status === "failed" ? [] : [{ label: "Heads up", value: `This row is already ${o.status}.` }]),
    ],
    draft: { to: o.email, subject: o.subject, body: o.body },
    draftNote: null,
    links: [{ label: "Newsletter", href: "/newsletter" }],
  };
}

/** Plain-words description of what approving `g` does. Never throws. */
export async function describeGrant(g: GrantLike): Promise<GrantDetail> {
  const action = g.actions.length === 1 ? g.actions[0] : g.actions.includes("*") ? "*" : g.actions[0] ?? "*";
  const fallback = bare(action, g);
  try {
    if (action === "*") {
      return { ...fallback, headline: "Any send this message asks for", draftNote: "A blanket permission for one Ask-window message — every send it covers is audited here." };
    }
    if (action === "send_email") return await emailDetail(g);
    if (action === "send_sms") return await smsDetail(g, false);
    if (action === "place_call") return await smsDetail(g, true);
    const n = Number(g.target_id);
    if (!Number.isInteger(n) || n <= 0) {
      return { ...fallback, draftNote: "No record named — the agent picks what to send after you approve. Read its reason before approving." };
    }
    const d =
      action === "send_invoice" ? await invoiceDetail(n)
      : action === "send_document_for_signature" ? await documentDetail(n)
      : action === "send_purchase_order" ? await poDetail(n, g)
      : action === "send_bid_package" ? await bidDetail(n)
      : action === "release_newsletter_issue" ? await newsletterDetail(n)
      : action === "release_newsletter_outbox_item" ? await outboxDetail(n)
      : null;
    return d ?? { ...fallback, draftNote: `Couldn't find ${g.target_kind ?? "record"} ${g.target_id} — it may have been deleted.` };
  } catch (err) {
    console.error("[grant-detail]", (err as Error).message);
    return fallback;
  }
}

// The panel polls every second; a waiting request's detail is reused for a
// few seconds instead of re-reading the invoice / PO each tick.
const cache = new Map<string, { at: number; detail: GrantDetail }>();

/** describeGrant for many grants at once, keyed by grant id. `cacheMs` > 0
 *  reuses a recent answer for the same grant. */
export async function describeGrants<T extends GrantLike & { id: string }>(grants: T[], opts: { cacheMs?: number } = {}): Promise<Record<string, GrantDetail>> {
  const out: Record<string, GrantDetail> = {};
  const now = Date.now();
  const ttl = opts.cacheMs ?? 0;
  await Promise.all(
    grants.map(async (g) => {
      const hit = ttl > 0 ? cache.get(g.id) : undefined;
      if (hit && now - hit.at < ttl) {
        out[g.id] = hit.detail;
        return;
      }
      out[g.id] = await describeGrant(g);
      if (ttl > 0) cache.set(g.id, { at: now, detail: out[g.id] });
    }),
  );
  if (cache.size > 200) for (const [k, v] of cache) if (now - v.at > 60_000) cache.delete(k);
  return out;
}
