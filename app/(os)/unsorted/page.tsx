import { Shell } from "@/components/shell/Shell";
import { UnsortedClient, type DocFile } from "@/components/unsorted/UnsortedClient";
import { requireAccess } from "@/lib/dal";
import { runDirect } from "@/lib/commands/db";
import { listOpenDocs, listResolvedDocs, projectChoices } from "@/lib/unsorted-docs";

export const dynamic = "force-dynamic";

/** Invoices, receipts and rebates from email that an agent couldn't tie to a
 *  project. Joe looks at the document, taps one of the agent's guesses (or
 *  Overhead, or types a project / a note for the agent), and it's filed.
 *  ?tab=filed shows what was filed lately, by Joe or an agent, with Undo. */
export default async function UnsortedPage({ searchParams }: { searchParams: Promise<{ tab?: string; open?: string }> }) {
  await requireAccess("money");
  const { tab, open } = await searchParams;
  const [openDocs, resolved, projects] = await Promise.all([
    listOpenDocs(runDirect),
    listResolvedDocs(runDirect, 60),
    projectChoices(runDirect),
  ]);
  const ids = [...openDocs, ...resolved].flatMap((d) => [...d.attachment_file_ids, ...(d.email_file_id ? [d.email_file_id] : [])]);
  const files = ids.length
    ? await runDirect<DocFile>(`SELECT id, name, COALESCE(mime_type, '') AS mime_type, size_label FROM files WHERE id = ANY($1::text[])`, [ids])
    : [];
  return (
    <Shell breadcrumb="MONEY · UNSORTED">
      <UnsortedClient
        docs={openDocs}
        resolved={resolved}
        projects={projects}
        files={Object.fromEntries(files.map((f) => [f.id, f]))}
        initialTab={tab === "filed" ? "filed" : "sort"}
        openId={open ? Number(open) : null}
      />
    </Shell>
  );
}
