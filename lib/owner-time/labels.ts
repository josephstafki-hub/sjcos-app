import type { ReviewFlag, TimeInterval } from "./intervals";
export const SOURCE_LABELS: Record<TimeInterval["source"], string> = {
  manual: "Manual entry",
  timer: "Timer",
  geofence_prompt: "Site prompt",
  designer_activity: "Design work",
};
export const CATEGORY_LABELS: Record<TimeInterval["category"], string> = {
  site: "Site",
  design: "Design",
  estimating: "Estimating",
  admin: "Admin",
  other: "Other",
};
export function flagLabel(
  f: ReviewFlag,
  intervals: TimeInterval[] = [],
  projects: { id: string; name: string }[] = [],
): string {
  switch (f.flag) {
    case "overlap": {
      const other = intervals.find((i) => i.id === f.relatedIntervalId);
      if (!other)
        return "Overlapping time · counted once. Adjust to check the times.";
      const name =
        projects.find((p) => p.id === other.project_id)?.name ?? "Overhead";
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      return `Overlaps ${name} · ${fmt.format(new Date(other.start_at))} (${SOURCE_LABELS[other.source]}). Counted once; adjust to review.`;
    }
    case "long":
      return "Long work session. Check the start and end times.";
    case "missing_exit":
      return "Clock-out missing. Adjust the end time.";
    case "inferred":
      return "Unconfirmed time. Keep, adjust or discard.";
    case "no_project":
      return "Site time has no job. Adjust to choose a job.";
    default:
      return "Needs review. Check the times, then keep or discard.";
  }
}
