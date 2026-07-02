"use server";

// Permit packet generation (Phase-7 deferred epic). Owner-gated. Renders a
// building-permit application packet PDF from real project data + a Qwen-drafted
// scope narrative, stores it in the project Files (PERMIT tag). Reuses the
// Phase-2 document infrastructure. Reads stay in lib/permits.ts.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { storeBuffer } from "@/lib/upload-store";
import { emit } from "@/lib/notify";
import { ai } from "@/lib/ai";
import { gatherPermitData, renderPermitPacketPdf } from "@/lib/documents";

type Result = { ok: true; id?: string } | { ok: false; error: string };

/** Owner: generate a building-permit application packet PDF for a project. The
 *  scope narrative is AI-drafted (never the valuation/figures); stored as a
 *  PERMIT-tagged file the owner downloads and attaches to the jurisdiction's
 *  official application. */
export async function generatePermitPacket(slug: string): Promise<Result> {
  await requireRole("owner");
  const d = await gatherPermitData(slug);
  if (!d) return { ok: false, error: "Project not found." };

  // Qwen drafts a permit-appropriate scope-of-work paragraph — factual, no
  // invented figures/dates.
  let narrative = "";
  try {
    const res = await ai.ask({
      prompt:
        `Write a concise, factual scope-of-work paragraph (3–5 sentences) for a residential building ` +
        `permit application for a carpentry/remodeling project titled "${d.projectName}". Describe the ` +
        `nature of the work in the plain terms a building official expects (e.g. demolition, framing, ` +
        `structural, MEP rough-in, finishes) at a high level. Do NOT invent dimensions, dollar amounts, ` +
        `code sections, or specifics not implied by the title.`,
      context: d.address ? `Project address: ${d.address}` : undefined,
    });
    narrative = (res.answer ?? "").trim();
  } catch {
    narrative = "";
  }

  const pdf = await renderPermitPacketPdf(d, narrative);
  const stored = await storeBuffer(pdf, {
    filename: `${d.projectName} — Permit Packet.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: slug,
    tag: "PERMIT · Application",
    subtitle: `Generated ${d.dateLabel}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  await emit({
    kind: "job",
    tag: "Permit",
    accent: "accent",
    icon: "project",
    title: `Permit packet generated · ${d.projectName}`,
    subline: "Building-permit application packet ready to file",
    href: `/projects/${slug}`,
  });

  revalidatePath(`/projects/${slug}`);
  return { ok: true, id: stored.id };
}
