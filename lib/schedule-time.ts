/** One time grammar for schedule writes and comparisons of legacy labels. */
export function parseScheduleTime(value: string): { label: string; minutes: number } {
  const v = value.trim();
  if (!v || /^(all|all day)$/i.test(v)) return { label: "All day", minutes: 0 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(v);
  if (!m || (!m[2] && !m[3])) throw new Error("Enter a time such as 08:30 or 5pm, or leave it blank for all day.");
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (minute > 59 || (m[3] ? hour < 1 || hour > 12 : hour > 23)) throw new Error("Enter a valid time between 00:00 and 23:59.");
  if (m[3]) hour = hour % 12 + (m[3].toLowerCase() === "pm" ? 12 : 0);
  return { label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, minutes: hour * 60 + minute };
}
export function scheduleFields(fd: FormData) {
  const label = String(fd.get("label") ?? "").trim();
  const date = String(fd.get("date") ?? "").trim();
  if (!label) throw new Error("Describe the meeting or work block.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("Choose a valid date.");
  const time = parseScheduleTime(String(fd.get("time") ?? ""));
  const toneInput = String(fd.get("tone") ?? "accent");
  const tone = ["accent", "ai", "ghost"].includes(toneInput) ? toneInput : "accent";
  const project = String(fd.get("project_id") ?? "").trim();
  if (project && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(project)) throw new Error("Choose a project from the list.");
  return { label, date, time, tone, projectId: project || null };
}
