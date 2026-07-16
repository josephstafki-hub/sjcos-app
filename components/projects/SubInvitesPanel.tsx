import { Mail, Send, X } from "lucide-react";
import { Card, Chip, SubmitButton } from "@/components/ui";
import { approveSubInvite, dismissSubInvite } from "@/lib/actions/projects";
import type { QueuedSubInvite } from "@/lib/sub-invites";

/** Parked sub-portal invites for a project (P1-B5).
 *
 *  The app composes these on assignment and STOPS. Nothing here sends: "Send it
 *  myself" is a plain mailto: link that opens Joe's own mail client with the
 *  text prefilled, so the outbound step stays entirely in his hands. */
export function SubInvitesPanel({ slug, invites }: { slug: string; invites: QueuedSubInvite[] }) {
  if (invites.length === 0) return null;

  return (
    <Card className="mt-3.5 max-w-[680px] overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2.5">
        <Mail className="size-3.5 flex-none text-ink-3" strokeWidth={1.75} />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          {invites.length} portal invite{invites.length === 1 ? "" : "s"} waiting on you
        </span>
        <div className="flex-1" />
        <Chip kind="flag" dot>
          Nothing sent
        </Chip>
      </div>

      {invites.map((inv, i) => {
        // No email on file, or the link inside is already dead → don't offer to
        // send it. A bounced sub is worse than no invite.
        const mailto =
          inv.toEmail && !inv.expired
            ? `mailto:${encodeURIComponent(inv.toEmail)}?subject=${encodeURIComponent(inv.subject)}&body=${encodeURIComponent(inv.body)}`
            : null;

        return (
          <div key={inv.id} className={`px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-serif text-[13.5px] font-semibold text-ink">{inv.subName}</div>
                <div className="truncate font-mono text-[10px] text-ink-3">
                  {inv.toEmail ?? "no email on file — add one on their record"} · queued {inv.when}
                </div>
              </div>
            </div>

            <div className="mt-1.5 text-[12.5px] font-medium text-ink-2">{inv.subject}</div>
            {inv.expired && (
              <div className="mt-1 text-[11px] leading-snug text-flag">
                The link in this one has expired — remove {inv.subName} from the job and re-assign
                to compose a fresh invite.
              </div>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-ink-3 hover:text-ink-2">
                Read the email
              </summary>
              <pre className="mt-1.5 whitespace-pre-wrap rounded-md border border-rule bg-paper-2 p-2.5 font-sans text-[12px] leading-snug text-ink-2">
                {inv.body}
              </pre>
            </details>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {mailto && (
                <a
                  href={mailto}
                  className="inline-flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
                >
                  <Send className="size-3" strokeWidth={1.75} />
                  Send it myself
                </a>
              )}
              <form action={approveSubInvite.bind(null, inv.id, slug)}>
                <SubmitButton className="rounded-md border border-rule px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-3">
                  Mark handled
                </SubmitButton>
              </form>
              <div className="flex-1" />
              <form action={dismissSubInvite.bind(null, inv.id, slug)}>
                <SubmitButton className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-ink-4 hover:text-flag">
                  <X className="size-3" strokeWidth={1.75} />
                  Dismiss
                </SubmitButton>
              </form>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
