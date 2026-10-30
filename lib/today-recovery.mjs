// Shared by Today server actions and MCP: explicit recovery, never promotion.
import { isOnItemSql } from './work-item-assignees.mjs';

function scope(viewer, params) {
  if (!viewer || viewer.role === 'owner') return '';
  params.push(viewer.id);
  return ` AND ${isOnItemSql(`$${params.length}`)}`;
}
function condition(view) {
  if (view === 'done') return "w.status IN ('done','cancelled')";
  if (view === 'snoozed') return "w.status NOT IN ('done','cancelled') AND w.snoozed_until > now()";
  throw new Error('Choose Done or Snoozed.');
}
export async function listRecoverableWork(run, viewer, view) {
  const params = [];
  const access = scope(viewer, params);
  return run(`SELECT w.id, w.title, w.status,
      to_char(w.due_at AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') AS due,
      p.name AS project_name, l.name AS lead_name
    FROM work_items w
    LEFT JOIN projects p ON p.id = w.project_id
    LEFT JOIN leads l ON l.id = w.lead_id
    WHERE ${condition(view)} AND w.assignee_kind = 'human'
      AND (w.assignee_key IS NULL OR w.assignee_key = 'human-joe')${access}
    ORDER BY w.updated_at DESC, w.id`, params);
}
export async function recoverWorkItem(run, id, view, viewer) {
  const params = [id];
  const access = scope(viewer, params);
  // Reopen preserves scheduling. Bring back today deliberately changes the
  // due day too: the table trigger would otherwise re-snooze future work.
  const fields = view === 'snoozed'
    ? 'due_at = now(), snoozed_until = NULL'
    : "status = 'queued', completed_at = NULL, archived_at = NULL, snoozed_until = CASE WHEN work_item_due_day_start(w.due_at) > now() THEN work_item_due_day_start(w.due_at) ELSE w.snoozed_until END";
  const result = await run(`UPDATE work_items w SET ${fields}, updated_at = now()
    WHERE w.id = $1 AND ${condition(view)} AND w.assignee_kind = 'human'
      AND (w.assignee_key IS NULL OR w.assignee_key = 'human-joe')${access}
    RETURNING w.id`, params);
  return result.length > 0;
}
