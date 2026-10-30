/** Summary facts come from records, never from a narrative's first sentence. */
export interface RowTodo { title: string; due: string | null }
export function structuredRowSummary(todo: RowTodo | null | undefined, contactDate?: string | null): string {
  if (todo?.title) return `${todo.title}${todo.due ? ` · Due ${todo.due}` : ""}`;
  return contactDate ? `Last contact ${contactDate}` : "No open to-do recorded";
}

/** List context may show scheduled work with its date; it does not promote it
 *  into Today or alter the scheduling trigger. */
export function nextRowTodoSql(entity: "projects" | "leads"): string {
  const key = entity === "projects" ? "project_id" : "lead_id";
  return `(SELECT json_build_object('title', w.title, 'due', to_char(w.due_at AT TIME ZONE 'America/Chicago', 'Mon FMDD'))
    FROM work_items w WHERE w.${key} = ${entity}.id
      AND w.archived_at IS NULL AND w.status NOT IN ('done', 'cancelled')
    ORDER BY w.due_at ASC NULLS LAST, w.created_at ASC, w.id LIMIT 1)`;
}
