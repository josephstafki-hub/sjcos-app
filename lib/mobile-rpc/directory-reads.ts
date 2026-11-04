import "server-only";
import type { CurrentUser } from "@/lib/dal";
import { hasAccess } from "@/lib/api-auth";
import { runDirect } from "@/lib/commands/db";
import { subPaperworkForOwner } from "@/lib/sub-docs";
import { query } from "@/lib/db";
import { getSubsData, getSub } from "@/lib/subs";
import { getVendorsData, getVendor } from "@/lib/vendors";
import { searchPanelForUser } from "@/lib/panel-search";
import { getSettingsData } from "@/lib/settings";
import { ReadError, label, money } from "./field-reads";

export async function subsRead(u: CurrentUser) {
  const [data, contacts] = await Promise.all([getSubsData(), query<{slug:string; phone:string|null; email:string|null; expires:string|null}>(`SELECT slug,phone,email,coi_expires_at::text AS expires FROM subs`)]);
  return {...data, subs:data.subs.map(s => ({...s, rate:hasAccess(u,"money") ? s.rate : "", phone:contacts.rows.find(c => c.slug === s.slug)?.phone ?? null, email:contacts.rows.find(c => c.slug === s.slug)?.email ?? null, coiExpires:contacts.rows.find(c => c.slug === s.slug)?.expires ?? null, coiStatusLabel:label(s.coiStatus), allowedActions:[] as string[]})), allowedActions:[] as string[]};
}
export async function subRead(u: CurrentUser, slug: string) {
  const sub = await getSub(slug);
  if (!sub) throw new ReadError("Sub not found",404);
  const [coi, documents, jobs] = await Promise.all([
    query<{expires:string|null}>(`SELECT coi_expires_at::text AS expires FROM subs WHERE slug=$1`,[slug]),
    subPaperworkForOwner(runDirect, slug),
    query<{slug:string; name:string; start:string|null; end:string|null; active:boolean}>(`SELECT p.slug,p.name,ps.start_date::text AS start,ps.end_date::text AS end,p.status <> 'warranty' AS active FROM project_subs ps JOIN projects p ON p.id=ps.project_id WHERE ps.sub_slug=$1 ORDER BY ps.assigned_at DESC`,[slug]),
  ]);
  const canAssign = hasAccess(u,"projects");
  return {sub: {slug, name:sub.name, initials:sub.initials, trade:sub.rawTrade, archived:sub.archived,
    tradeLine:sub.tradeLine, working:sub.working, coiStatus:sub.coiStatus, coiLabel:sub.coiLabel,
    jobsCount:sub.jobsCount, rating:sub.rating, reliability:sub.reliability, recentJobs:sub.recentJobs, paperwork:sub.paperwork, taxNote:sub.taxNote,
    phone:sub.phone, email:sub.email, contact:sub.contact, coi:{status:sub.coiStatus, statusLabel:label(sub.coiStatus), expires:coi.rows[0]?.expires ?? null},
    rate:hasAccess(u,"money") ? sub.rate : {amount:"", unit:"", note:""}, notes:u.role === "owner" ? sub.notes : null,
    documents:documents.documents.map(d => ({id:d.id, type:d.docType, typeLabel:d.docType === "coi" ? "Certificate of insurance" : d.docType === "w9" ? "W-9" : label(d.docType), status:d.status, statusLabel:label(d.status), expiry:d.expiresAt, url:d.fileId ? `/api/mobile/subs/${encodeURIComponent(slug)}/documents/${d.id}/file` : null, allowedActions:u.role === "owner" && ["received","under_review"].includes(d.status) ? ["subs.acceptDocument","subs.rejectDocument"] : []})),
    jobs:jobs.rows.map(j => ({...j, allowedActions:canAssign ? ["subs.removeAssignment"] : []})), removedJobs:canAssign ? sub.removedJobs.map(j => ({...j, allowedActions:["subs.restoreAssignment"]})) : [],
    allowedActions:[...(sub.email ? ["subs.coiRequestDraft"] : []), ...(u.role === "owner" ? ["subs.notes"] : []), ...(canAssign ? ["subs.assign"] : [])]}};
}
export async function coiRequestDraft(slug: string) {
  const s = await getSub(slug);
  if (!s) throw new ReadError("Sub not found",404);
  if (!s.email) throw new ReadError("Add an email before requesting a COI");
  return {to:s.email, subject:"Certificate of insurance requested", body:"Please send your current certificate of insurance for our records. Thank you."};
}
export async function vendorsRead() {
  const d = await getVendorsData();
  return {...d, vendors:d.vendors.map(v => ({...v, category:v.trade, favorite:v.fav, statusLabel:v.archived ? "Archived" : "Active", allowedActions:["vendors.toggleFavorite"]})), allowedActions:[] as string[]};
}
export async function vendorRead(u: CurrentUser, slug: string) {
  const v = await getVendor(slug);
  if (!v) throw new ReadError("Vendor not found",404);
  const mayPO = hasAccess(u,"purchase_orders") || hasAccess(u,"money");
  const orders = mayPO ? (await query<{id:string; number:string; projectSlug:string; projectName:string; title:string; amountCents:number; status:string; createdAt:string}>(`SELECT po.id::text AS id,po.po_number AS number,p.slug AS "projectSlug",p.name AS "projectName",po.title,po.subtotal AS "amountCents",po.status,po.created_at::text AS "createdAt" FROM purchase_orders po JOIN vendors v ON v.id=po.vendor_id JOIN projects p ON p.id=po.project_id WHERE v.slug=$1 ORDER BY po.created_at DESC`,[slug])).rows : [];
  return {slug:v.slug, name:v.name, initials:v.initials, category:v.trade, phone:v.phone, email:v.email, favorite:v.fav, statusLabel:v.archived ? "Archived" : "Active", notes:v.notes, purchaseOrders:orders.map(p => ({...p, amountCents:Number(p.amountCents), amountLabel:money(Number(p.amountCents)), statusLabel:label(p.status), createdAt:new Date(p.createdAt).toISOString(), allowedActions:[] as string[]})), purchaseOrdersVisible:mayPO, allowedActions:["vendors.toggleFavorite",...(u.role === "owner" ? ["vendors.notes"] : [])]};
}
export async function settingsRead(u: CurrentUser) {
  const d = await getSettingsData();
  return {profile:{...d.profile, name:u.name, email:u.email}, notifyToggles:d.notifyToggles, allowedActions:["settings.profile","settings.notify"]};
}
export async function searchRead(u: CurrentUser, raw: string) {
  const hits = await searchPanelForUser(u, raw, true);
  return {results:hits.filter(r => ["project","lead","sub","vendor","client"].includes(r.kind)).map(r => ({
    type:r.kind === "client" ? "contact" : r.kind, id:r.recordId ?? r.id,
    slug:decodeURIComponent(r.href.split("/")[2]?.split("?")[0] ?? ""),
    title:r.title, subtitle:r.kind === "client" ? r.detail : label(r.kind),
  })), allowedActions:[] as string[]};
}
