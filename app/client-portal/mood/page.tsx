import Link from "next/link";
import { Chip, Eyebrow } from "@/components/ui";
import { portalSlug } from "@/lib/client-portal";
import { getClientProjectMood } from "@/lib/mood";
import { approveMoodBoard } from "@/lib/actions/mood";
import { queryOne } from "@/lib/db";
import { PortalMoodBoard } from "@/components/portal/PortalMoodBoard";
import { ApproveControl } from "@/components/portal/ApproveControl";

// Client-portal mood boards: the owner-curated boards, read-only, one canvas
// per room, each with a typed-name "this is the direction" approval. Detailed
// feedback still goes through Messages.
export default async function PortalMoodPage() {
  const slug = await portalSlug();
  const boards = slug ? await getClientProjectMood(slug) : [];
  const proj = slug
    ? await queryOne<{ client_name: string | null }>(
        `SELECT client_name FROM projects WHERE slug = $1`,
        [slug],
      )
    : null;
  const signerName = proj?.client_name ?? "";

  return (
    <main className="mx-auto w-full max-w-4xl px-9 py-7">
      <Eyebrow>Mood boards</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        The look and feel we&apos;re building toward.
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Joe curates these as the design comes together. Love it or want a different
        direction? Say so in{" "}
        <Link href="/client-portal/messages" className="font-semibold text-accent-2 underline decoration-rule underline-offset-2 hover:decoration-accent">
          Messages
        </Link>
        .
      </p>
      <div className="my-5 border-t border-rule" />

      {boards.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-ink-3">
          No boards yet. As the design phase gets going, inspiration boards for each room
          will show up here.
        </p>
      ) : (
        <div className="flex flex-col gap-7">
          {boards.map((b) => (
            <section key={b.room}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="font-serif text-[17px] font-semibold text-ink">
                  {b.title || b.room}
                </h2>
                {b.title && b.title !== b.room && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                    {b.room}
                  </span>
                )}
                <div className="flex-1" />
                {b.approvedLabel && (
                  <Chip kind="money" dot>
                    approved {b.approvedLabel}
                  </Chip>
                )}
              </div>
              <PortalMoodBoard board={b} />
              {b.approvedLabel ? (
                b.approvedName && (
                  <div className="mt-1.5 font-mono text-[10px] text-ink-3">
                    Approved by {b.approvedName}
                  </div>
                )
              ) : (
                <ApproveControl
                  label="Approve this direction"
                  signerName={signerName}
                  action={approveMoodBoard.bind(null, b.room)}
                />
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
