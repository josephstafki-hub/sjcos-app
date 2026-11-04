import Link from "next/link";
import type { ProjectConsult } from "@/lib/consult/ui/server";
import { statusLabel, W } from "@/lib/consult/ui/words";

const when = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm");

/**
 * One-line visit strip under the project header (plan §4 entry points): shown on every tab
 * while a consultation is scheduled, in progress or needs finishing, so a job that opens
 * on Floor or Ops still shows it. "Get ready" / "Open visit" only for the assigned visitor.
 */
export function ConsultVisitStrip({ visit: v, slug, viewerId }: { visit: ProjectConsult | null; slug: string; viewerId: string | null }) {
  if (!v) return null;
  const mine = !!viewerId && v.conducted_by === viewerId;
  const link = "inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-label font-semibold no-underline @xl/page:min-h-8";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-info bg-info-soft px-3 py-2 text-body text-ink">
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{W.app}</span>
        <span className="text-ink-2"> · {when(v.scheduled_at)} · {v.visitor_name} · </span>
        <span className="font-semibold">{statusLabel(v.status, v.open ?? undefined)}</span>
      </p>
      <span className="flex flex-wrap gap-2">
        {mine && <a href={`/consult/${v.id}`} className={`${link} bg-ink text-paper`}>{v.status === "scheduled" ? W.getReady : W.openVisit}</a>}
        <Link href={`/projects/${slug}/consult/${v.id}`} className={`${link} border border-rule bg-card text-ink hover:bg-hover`}>Visit page</Link>
      </span>
    </div>
  );
}
