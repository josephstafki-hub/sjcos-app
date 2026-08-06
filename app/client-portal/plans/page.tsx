import { Eyebrow } from "@/components/ui";
import { portalSlug } from "@/lib/client-portal";
import { getClientFloorplans } from "@/lib/floorplans";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { ClientFloorplans } from "@/components/portal/ClientFloorplans";

// Client-portal floor plans: every posted version, newest first, with a
// typed-name approval on the current one.
export default async function PortalPlansPage() {
  const slug = await portalSlug();
  const [plans, user] = await Promise.all([
    slug ? getClientFloorplans(slug) : Promise.resolve([]),
    getCurrentUser(),
  ]);

  // Prefill the approval with the project's client name (nicer than the
  // synthetic account name minted by the invite link).
  const proj = slug
    ? await queryOne<{ client_name: string | null }>(
        `SELECT client_name FROM projects WHERE slug = $1`,
        [slug],
      )
    : null;
  const signerName = proj?.client_name || user?.name || "";

  return (
    <main className="mx-auto w-full max-w-3xl px-9 py-7">
      <Eyebrow>Floor plans</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        Your plans, every version in one place.
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        The newest version is what&apos;s current. Approving it tells Joe you&apos;re good to
        build from it.
      </p>
      <div className="my-5 border-t border-rule" />
      <ClientFloorplans plans={plans} signerName={signerName} />
    </main>
  );
}
