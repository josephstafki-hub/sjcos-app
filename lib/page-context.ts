// Qwen page-context serializers (Review-round-3 S4). Each function turns an
// already-loaded page record into a compact text brief that the Ask-Qwen bar
// passes to askQwen() as `pageContext`, so page-invoked Qwen answers from the
// real records in view. Pure (no DB hits) — pages pass the data they already
// fetched. Qwen 2.5 is text-only, so this is structured TEXT, not vision.

import type { LeadDetail } from "./leads";
import type { ProjectDetail, ProjectsData } from "./projects";
import type { TodayData } from "./today";
import type { WarrantyData } from "./warranty";
import { stageLabel } from "./leads";
import { projectStageLabel } from "./projects";

/** Brief for a lead detail page. */
export function leadContext(lead: LeadDetail): string {
  const lines = [
    `LEAD: ${lead.name}`,
    `Stage: ${stageLabel(lead.stage)}`,
    `Scope: ${lead.scope}`,
    lead.address && `Address: ${lead.address}`,
    `Source: ${lead.source} · age ${lead.ageDays}d${lead.hot ? " · HOT" : ""}`,
    lead.email && `Email: ${lead.email}`,
    lead.phone && `Phone: ${lead.phone}`,
    lead.intake.length && `Intake:\n${lead.intake.map((i) => `  - ${i.label}: ${i.value}`).join("\n")}`,
    lead.estimate &&
      `Rough estimate (${lead.estimate.status}, ${lead.estimate.total}):\n${lead.estimate.lines
        .map((l) => `  - ${l.label}: ${l.value}`)
        .join("\n")}`,
    lead.projectSlug && `Converted to project: ${lead.projectSlug}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** Brief for a project detail page. */
export function projectContext(project: ProjectDetail): string {
  const m = project.money;
  const lines = [
    `PROJECT: ${project.name} (${project.contractValue})`,
    `Stage: ${projectStageLabel(project.status)}`,
    project.subtitle && `Subtitle: ${project.subtitle}`,
    `Money: contract ${m.contract}, paid ${m.paid}, next draw ${m.nextDraw}, open COs ${m.openCOs} (${m.billedPct}% billed)`,
    project.subs.length &&
      `Subs: ${project.subs.map((s) => `${s.name} (${s.trade})`).join(", ")}`,
    project.milestones.length &&
      `Milestones:\n${project.milestones.map((ms) => `  - ${ms.name} · ${ms.date} · ${ms.value} (${ms.status})`).join("\n")}`,
    project.latestLog && `Latest log (${project.latestLog.date}): ${project.latestLog.body}`,
    project.punch.length &&
      `Punch list: ${project.punch.filter((p) => !p.done).length} open of ${project.punch.length}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** Brief for the projects list page. */
export function projectsContext(data: ProjectsData): string {
  const lines = [
    `PROJECTS LIST · ${data.summary}`,
    ...data.groups
      .filter((g) => g.items.length)
      .map(
        (g) =>
          `${g.title}:\n${g.items
            .map((p) => `  - ${p.name} · ${p.stage} · ${p.value} · ${p.billed}% billed`)
            .join("\n")}`,
      ),
  ];
  return lines.join("\n");
}

/** Brief for the Warranty page. */
export function warrantyContext(data: WarrantyData): string {
  const lines = [
    `WARRANTY · ${data.eyebrow}`,
    data.claims.length &&
      `Active claims:\n${data.claims
        .map((c) => `  - ${c.project} (${c.client}): ${c.issue} — ${c.deadline}. ${c.step}.`)
        .join("\n")}`,
    data.projects.length &&
      `Under warranty:\n${data.projects
        .map(
          (p) =>
            `  - ${p.project} (${p.client}) · closed ${p.closed} · ${p.warranty}${p.flag ? ` · ${p.flag}` : ""}${
              p.items && p.items.length ? ` · covers ${p.items.map((i) => `${i.label} (${i.expires})`).join(", ")}` : ""
            }`,
        )
        .join("\n")}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** Brief for the Today page. */
export function todayContext(data: TodayData): string {
  const lines = [
    `TODAY · ${data.dateLabel}`,
    data.headerChips.length &&
      `Headline metrics: ${data.headerChips.map((c) => c.label).join(" · ")}`,
    data.priorities.length &&
      `Priorities:\n${data.priorities.map((p) => `  - [${p.tag}] ${p.title}${p.sub ? ` — ${p.sub}` : ""}`).join("\n")}`,
    data.schedule.length &&
      `Today's schedule:\n${data.schedule.map((s) => `  - ${s.time} ${s.label}`).join("\n")}`,
    data.waiting.items.length &&
      `Waiting on me:\n${data.waiting.items.map((w) => `  - ${w.label}`).join("\n")}`,
  ].filter(Boolean);
  return lines.join("\n");
}
