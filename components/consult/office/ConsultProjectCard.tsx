import { CoverageMark } from "@/components/ui/CoverageMark";
import { Button } from "@/components/ui";
import type { CurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { projectConsults, scheduleOptions } from "@/lib/consult/ui/server";
import { statusLabel, W } from "@/lib/consult/ui/words";
import { AssignControl, ScheduleDialog } from "./ScheduleDialog";

const when = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm");

/**
 * Project Overview card "In-home consultation" (plan §4, §5.1): beside the stage card in
 * pre-construction, or whenever a visit exists. Owner schedules and changes who goes;
 * the assigned visitor opens the field tool; anyone with Projects opens the optional
 * look-over page. Creating a visit never advances a stage.
 */
export async function ConsultProjectCard({ slug, client, viewer, preconstruction }: { slug: string; client: string; viewer: CurrentUser; preconstruction: boolean }) {
  const projectId = (await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug=$1`, [slug]).catch(() => null))?.id;
  if (!projectId) return null;
  const visits = await projectConsults(projectId).catch(() => []);
  if (!visits.length && !preconstruction) return null;
  const owner = viewer.role === "owner";
  const options = owner ? await scheduleOptions(projectId).catch(() => null) : null;
  const live = visits.find((v) => !["complete", "cancelled"].includes(v.status));
  return (
    <section className="border-t border-rule-soft pt-4" aria-labelledby="consult-card-h">
      <h2 id="consult-card-h" className="mb-2 text-subheading font-semibold">{W.app}</h2>
      {visits.length === 0 && <p className="text-body text-ink-3">Not scheduled. After the rough estimate is signed, schedule the detailed visit.</p>}
      <ul className="grid gap-3">
        {visits.slice(0, 3).map((v) => (
          <li key={v.id} className="rounded-md border border-rule px-3 py-2">
            <p className="text-body font-semibold text-ink">{v.templates || W.app}</p>
            <p className="text-meta text-ink-3">{when(v.scheduled_at)} · {v.visitor_name}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-body text-ink">
              {v.status === "complete" ? <CoverageMark variant="coverage" state="covered" size="sm" /> : v.status === "incomplete" ? <CoverageMark variant="coverage" state="partial" size="sm" /> : null}
              <span>{statusLabel(v.status, v.open ?? undefined)}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {v.conducted_by === viewer.id && !["complete", "cancelled"].includes(v.status) && <Button size="md" href={`/consult/${v.id}`}>{v.status === "scheduled" ? W.getReady : "Open visit"}</Button>}
              <Button variant="secondary" size="md" href={`/projects/${slug}/consult/${v.id}`}>Visit page</Button>
              {owner && options && v.status === "scheduled" && <AssignControl consultId={v.id} revision={Number(v.revision)} visitors={options.visitors} current={v.conducted_by} />}
            </div>
          </li>
        ))}
      </ul>
      {owner && options && !live && <div className="mt-3"><ScheduleDialog projectId={projectId} client={client} options={options} ownerId={viewer.id} /></div>}
    </section>
  );
}
