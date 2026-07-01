// Client-safe incident-severity constants — NO db import (so the incident form
// can use them without dragging pg into the browser bundle).

export type IncidentSeverity = "near_miss" | "minor" | "recordable" | "serious";

export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  near_miss: "Near miss",
  minor: "Minor (first aid)",
  recordable: "Recordable",
  serious: "Serious",
};

export const SEVERITIES: { value: IncidentSeverity; label: string }[] = [
  { value: "near_miss", label: "Near miss" },
  { value: "minor", label: "Minor (first aid)" },
  { value: "recordable", label: "Recordable" },
  { value: "serious", label: "Serious" },
];
