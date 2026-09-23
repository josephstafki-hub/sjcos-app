import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/dal";
import { getSigningContext } from "@/lib/esign";
import { InPersonSigning } from "@/components/esign/InPersonSigning";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign · SJC OS" };

/** In-person signing screen. The owner (or staff with the projects area) opens
 *  a signature request here on their own device — the iPad — and hands it to
 *  the client to read and sign. Outside the (os) route group on purpose: no
 *  Shell, no operator dock, nothing on screen but the document and the pad.
 *  The client never needs an account; the signing is recorded under the
 *  owner's session with the owner named as witness (lib/actions/esign.ts). */
export default async function SignInPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("projects");
  const { id } = await params;
  const reqId = Number(id);
  if (!Number.isFinite(reqId) || reqId <= 0) notFound();

  const ctx = await getSigningContext(reqId);
  if (!ctx) notFound();

  return (
    <InPersonSigning
      request={ctx.request}
      scopeName={ctx.scopeName}
      backHref={ctx.backHref}
      witnessName={user.name || "SJ Carpentry"}
    />
  );
}
