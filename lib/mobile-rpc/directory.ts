import { z } from "zod";
import { defineAction } from "./dispatch";
import { setSubNotes } from "@/lib/actions/subs";
import { toggleVendorFav, setVendorNotes } from "@/lib/actions/vendors";
import { acceptSubDocument, rejectSubDocument } from "@/lib/actions/sub-docs";
import { setNotifyToggle, updateProfile } from "@/lib/actions/settings";
import { assignSubToProject, removeSubFromProject } from "@/lib/actions/projects";
import { restoreSubAssignment } from "@/lib/actions/directory-maintenance";
const slug = z.string().min(1).max(200);
const notes = z.string().max(4000);
const assignment = z.object({projectSlug: slug, subSlug: slug}).strict();
export const directoryActions = {
  "subs.assign": defineAction({area: "projects", input: assignment.extend({role: z.string().max(500).optional()}), run: v => assignSubToProject(v.projectSlug, v.subSlug, v.role ?? "")}),
  "subs.removeAssignment": defineAction({area: "projects", input: assignment, run: v => removeSubFromProject(v.projectSlug, v.subSlug)}),
  "subs.restoreAssignment": defineAction({area: "projects", input: assignment, run: v => restoreSubAssignment(v.projectSlug, v.subSlug)}),
  "subs.notes": defineAction({area: "subs", ownerOnly: true, input: z.object({slug, notes}).strict(), run: v => setSubNotes(v.slug, v.notes)}),
  "vendors.notes": defineAction({area: "vendors", ownerOnly: true, input: z.object({slug, notes}).strict(), run: v => setVendorNotes(v.slug, v.notes)}),
  "vendors.toggleFavorite": defineAction({area: "vendors", input: z.object({slug}).strict(), run: v => toggleVendorFav(v.slug)}),
  "subs.acceptDocument": defineAction({area: "subs", ownerOnly: true, input: z.object({slug, documentId: z.number().int().positive(), expires: z.iso.date().nullable()}).strict(), run: v => { const f = new FormData(); if (v.expires) f.set("expires", v.expires); return acceptSubDocument(v.slug, v.documentId, f); }}),
  "subs.rejectDocument": defineAction({area: "subs", ownerOnly: true, input: z.object({slug, documentId: z.number().int().positive(), reason: z.string().max(4000)}).strict(), run: v => { const f = new FormData(); f.set("reason", v.reason); return rejectSubDocument(v.slug, v.documentId, f); }}),
  "settings.profile": defineAction({ownerOnly: true, input: z.object({name: z.string().min(1).max(200), email: z.email().max(320), company: z.string().max(200), phone: z.string().max(100)}).strict(), run: v => { const f = new FormData(); for (const [k, value] of Object.entries(v)) f.set(k, value); return updateProfile(f); }}),
  "settings.notify": defineAction({ownerOnly: true, input: z.object({key: z.enum(["notify.decisions", "notify.money", "notify.compliance", "notify.mentions", "notify.emailDigest", "notify.sms"]), on: z.boolean()}).strict(), run: v => setNotifyToggle(v.key, v.on)}),
};
