import { Shell } from "@/components/shell/Shell";
import { PageHeader, Eyebrow } from "@/components/ui";
import { requireRole } from "@/lib/dal";
import { listGrants, grantLive } from "@/lib/owner-grants";
import { grantWaiting } from "@/lib/owner-grant-types";
import { PermissionsClient } from "@/components/engine/PermissionsClient";
import { describeGrants } from "@/lib/grant-detail";

export const dynamic = "force-dynamic";

/** Owner grants — express permission for agent sends. Agents ask here
 *  (request_owner_permission), Joe approves/denies here, and Joe can mint a
 *  grant by hand for any MCP client. Every spent grant shows its audit. */
export default async function PermissionsPage() {
  await requireRole("owner");
  const grants = await listGrants(80);
  const pending = grants.filter((g) => grantWaiting(g)).length;
  const live = grants.filter(grantLive).length;
  // Plain-words "what this is for" for everything still open.
  const details = await describeGrants(grants.filter((g) => grantWaiting(g) || grantLive(g)));

  return (
    <Shell breadcrumb="OPERATIONS ENGINE · PERMISSIONS">
      <div className="mx-auto max-w-[900px] px-4 @3xl/page:px-6 pb-16 pt-6">
        <div className="mb-4">
          <PageHeader title={<> Agent permissions </>} meta={<> {pending} waiting on you · {live} live grant{live === 1 ? "" : "s"} </>} />
          <p className="mt-2 max-w-[640px] text-body leading-relaxed text-ink-3">
            Agents draft and stage on their own; anything that reaches a real inbox needs your express
            permission. Approve a request below, or hand an agent a grant for a specific send. Each grant is
            spent per use and keeps its own audit trail.
          </p>
        </div>
        <PermissionsClient grants={grants} details={details} />
      </div>
    </Shell>
  );
}
