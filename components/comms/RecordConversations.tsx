import type React from "react";
import Link from "next/link";
import { MessageSquare, PhoneCall } from "lucide-react";
import { Card } from "@/components/ui";
import { can, getCurrentUser } from "@/lib/dal";
import { getRecordConversations, type RecordKind } from "@/lib/comms-summaries";

/** "Calls & texts" on a lead / job / sub / vendor page: every conversation with
 *  them on any of the business lines, as a short summary, so the whole team
 *  shares the picture whoever's phone it happened on (lib/comms-summaries.ts).
 *  A row opens the full conversation only for someone who may read that line. */
export async function RecordConversations({
  kind,
  slug,
  className = "",
  variant = "card",
}: {
  kind: RecordKind;
  slug: string;
  className?: string;
  /** "section": a plain block for a page's side column (the job page). */
  variant?: "card" | "section";
}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "staff")) return null;
  // Messages / Calls need the comms area; without it, summaries only.
  const openable = can(user, "comms");
  const rows = (await getRecordConversations(kind, slug, user, 8)).map((r) => (openable ? r : { ...r, href: null }));
  const Frame = ({ children }: { children: React.ReactNode }) =>
    variant === "section" ? (
      <section className={`border-t border-rule-soft pt-4 ${className}`}>{children}</section>
    ) : (
      <Card className={`p-4 ${className}`}>{children}</Card>
    );
  return (
    <Frame>
      <h2 className="text-subheading font-semibold text-ink">Calls &amp; texts</h2>
      <p className="mt-0.5 text-meta text-ink-3">From every business line, summarized for the whole team.</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-meta text-ink-3">No calls or texts yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-rule-soft">
          {rows.map((r) => {
            const Icon = r.kind === "call" ? PhoneCall : MessageSquare;
            const body = (
              <>
                <div className="flex items-start gap-2">
                  <Icon aria-hidden className="mt-0.5 size-3.5 flex-none text-ink-3" strokeWidth={1.5} />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-body font-medium text-ink">{r.title}</div>
                    <div className="mt-0.5 text-meta text-ink-3">
                      {r.when} · {r.line}
                    </div>
                    <p className="mt-1 break-words text-meta leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{r.summary}</p>
                  </div>
                </div>
              </>
            );
            return (
              <li key={r.key} className="py-2.5 first:pt-0 last:pb-0">
                {r.href ? (
                  <Link href={r.href} className="-mx-1.5 block rounded-md px-1.5 py-1 hover:bg-paper-2">
                    {body}
                  </Link>
                ) : (
                  <div className="py-1" title="Summary only: this conversation is on a team member's own line">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Frame>
  );
}
