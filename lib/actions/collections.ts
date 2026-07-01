"use server";

// Collections write paths (Phase-4 P4-7). Owner-gated. Generates a Day-15 demand
// letter and a Day-30 MN mechanic's-lien statement draft from an overdue invoice,
// both with a legal disclaimer. The app assists — it never files or auto-collects.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { storeBuffer } from "@/lib/upload-store";
import { emit } from "@/lib/notify";
import { sendNewEmailAction } from "@/lib/actions/inbox";
import {
  gatherCollectionData,
  renderDemandLetterPdf,
  renderLienPackagePdf,
} from "@/lib/documents";

type Result = { ok: true; id?: string } | { ok: false; error: string };

const usd = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;

/** Owner: generate a past-due demand letter for an overdue invoice; optionally
 *  email it to the client. Stored in the project Files. */
export async function generateDemandLetter(invoiceId: number, send = false): Promise<Result> {
  await requireRole("owner");
  const d = await gatherCollectionData(invoiceId);
  if (!d) return { ok: false, error: "Invoice not found." };

  const pdf = await renderDemandLetterPdf(d);
  const stored = await storeBuffer(pdf, {
    filename: `${d.projectName} — Demand Letter ${d.invoiceNumber}.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: d.projectSlug,
    tag: "COLLECTIONS · Demand letter",
    subtitle: `Generated ${d.dateLabel} · ${d.daysOverdue}d overdue`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  if (send && d.clientEmail) {
    const first = d.clientName.split(/\s+/)[0] || "there";
    await sendNewEmailAction({
      to: d.clientEmail,
      subject: `Past-due: invoice ${d.invoiceNumber} — ${d.projectName}`,
      body:
        `Hi ${first},\n\nThis is a friendly reminder that invoice ${d.invoiceNumber} for "${d.milestone}" ` +
        `(${usd(d.amount)}) is now ${d.daysOverdue} days past due. Please remit payment within 10 days, or ` +
        `reply here if there's anything to resolve. A formal notice is attached.\n\nThank you,\nJoe\n${d.company.name}`,
    });
  }

  await emit({
    kind: "money",
    tag: "Collections",
    accent: "flag",
    icon: "money",
    flagged: true,
    title: `Demand letter generated · ${d.projectName}`,
    subline: `${d.invoiceNumber} · ${usd(d.amount)} · ${d.daysOverdue}d overdue`,
    href: `/projects/${d.projectSlug}`,
  });

  revalidatePath(`/projects/${d.projectSlug}`);
  return { ok: true, id: stored.id };
}

/** Owner: generate a Day-30 MN mechanic's-lien statement draft. Stored in Files.
 *  Draft only — carries a prominent disclaimer; the app never files. */
export async function generateLienPackage(invoiceId: number): Promise<Result> {
  await requireRole("owner");
  const d = await gatherCollectionData(invoiceId);
  if (!d) return { ok: false, error: "Invoice not found." };

  const pdf = await renderLienPackagePdf(d);
  const stored = await storeBuffer(pdf, {
    filename: `${d.projectName} — Lien Statement DRAFT ${d.invoiceNumber}.pdf`,
    mime: "application/pdf",
    idPrefix: "doc",
    projectKey: d.projectSlug,
    tag: "COLLECTIONS · Lien draft",
    subtitle: `DRAFT · generated ${d.dateLabel} · review with counsel`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  await emit({
    kind: "money",
    tag: "Collections",
    accent: "flag",
    icon: "money",
    flagged: true,
    title: `Lien statement DRAFT generated · ${d.projectName}`,
    subline: `${d.invoiceNumber} · ${usd(d.amount)} · review with your attorney`,
    href: `/projects/${d.projectSlug}`,
  });

  revalidatePath(`/projects/${d.projectSlug}`);
  return { ok: true, id: stored.id };
}
