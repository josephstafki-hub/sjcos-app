"use server";

// Owner-gated server actions for the document-draft lifecycle (doc-templates
// plan, Phase 4). Thin wrappers over lib/doc-drafts.ts that enforce
// requireRole("owner") and revalidate the affected pages. AI narrative fields
// are drafted via draftDocNarrative (Qwen), then written with actor 'ai' so the
// manifest still blocks AI from touching locked fields. Submitting for signature
// is owner-only and lives here — the agent surface (internal route) never
// exposes it.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { getTemplate } from "@/lib/doc-templates/registry";
import {
  createDocDraft,
  updateDocDraftFields,
  renderDocDraft,
  submitDocDraftForSignature,
  voidDocDraft,
  cloneDocDraft,
  getDocDraft,
} from "@/lib/doc-drafts";
import type { FillScope } from "@/lib/doc-templates/fill";

type R = { ok: true } | { ok: false; error: string };

function revalidateFor(scope: { slug?: string | null; leadSlug?: string | null }) {
  if (scope.slug) revalidatePath(`/projects/${scope.slug}`);
  if (scope.leadSlug) revalidatePath(`/leads/${scope.leadSlug}`);
}

export async function createDocDraftAction(templateKey: string, scope: FillScope): Promise<R> {
  const user = await requireRole("owner");
  const res = await createDocDraft(templateKey, scope, { createdVia: "app", createdBy: user.id });
  if (res.ok) revalidateFor(scope);
  return res;
}

export async function updateDocDraftFieldsAction(id: number, edits: Record<string, unknown>): Promise<R> {
  await requireRole("owner");
  const res = await updateDocDraftFields(id, edits, "owner");
  if (res.ok) revalidatePath("/projects");
  return res;
}

export async function renderDocDraftAction(id: number): Promise<R> {
  await requireRole("owner");
  const res = await renderDocDraft(id);
  if (res.ok) revalidatePath("/projects");
  return res;
}

export async function submitDocDraftForSignatureAction(id: number): Promise<R> {
  const user = await requireRole("owner");
  const res = await submitDocDraftForSignature(id, { id: user.id, name: user.name || "Owner" });
  if (res.ok) {
    revalidatePath("/projects");
    revalidatePath("/client-portal");
  }
  return res;
}

export async function voidDocDraftAction(id: number): Promise<R> {
  await requireRole("owner");
  const res = await voidDocDraft(id);
  if (res.ok) revalidatePath("/projects");
  return res;
}

export async function cloneDocDraftAction(id: number): Promise<R> {
  const user = await requireRole("owner");
  const res = await cloneDocDraft(id, user.id);
  if (res.ok) revalidatePath("/projects");
  return res;
}

/**
 * Draft an AI narrative field (e.g. sow_narrative, work_summary) with Qwen,
 * grounded on the draft's own auto-resolved facts, then write it with actor 'ai'
 * — so the manifest guard still applies (only `source:'ai'` fields accepted).
 */
export async function draftDocNarrative(id: number, fieldKey: string): Promise<R> {
  await requireRole("owner");
  const draft = await getDocDraft(id);
  if (!draft) return { ok: false, error: `Draft ${id} not found.` };
  const template = getTemplate(draft.template_key);
  const field = template?.fields.find((f) => f.key === fieldKey);
  if (!field || field.source !== "ai") {
    return { ok: false, error: `Field '${fieldKey}' is not an AI-writable narrative.` };
  }

  const facts = Object.entries(draft.field_values)
    .filter(([k, v]) => v != null && typeof v !== "object" && k !== fieldKey)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("\n");

  let narrative = "";
  try {
    const res = await ai.ask({
      prompt:
        `Write a concise, professional "${field.label}" for a residential carpentry/remodeling ` +
        `document (${template!.title}). 2–4 short sentences in clear, client-friendly language. ` +
        `Do NOT invent prices, dates, brands, or figures that aren't in the facts below.`,
      context: facts,
    });
    narrative = (res.answer ?? "").trim();
  } catch {
    narrative = "";
  }
  if (!narrative) return { ok: false, error: "AI draft came back empty — try again or write it manually." };

  const upd = await updateDocDraftFields(id, { [fieldKey]: narrative }, "ai");
  if (!upd.ok) return upd;
  revalidatePath("/projects");
  return { ok: true };
}
