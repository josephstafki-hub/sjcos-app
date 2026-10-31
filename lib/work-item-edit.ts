import type { Run } from './commands/core';

export interface WorkItemEdit {
  title?: string;
  body?: string;
  priority?: string;
  due_at?: string | null;
  project_slug?: string | null;
  lead_slug?: string | null;
}

/** Shared by the queue editor and MCP. Patch semantics: absent keeps, null
 * clears. The table trigger remains the authority for future-day snoozing. */
export async function editWorkItem(run: Run, id: string, patch: WorkItemEdit): Promise<{ok: true} | {ok: false; error: string}> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return {ok:false,error:'Work item not found.'};
  if (patch.title !== undefined && !patch.title.trim()) return {ok:false,error:'Title is required.'};
  if (patch.priority !== undefined && !['low','normal','high','urgent'].includes(patch.priority)) return {ok:false,error:'Choose a priority.'};
  if (patch.due_at) {
    const date = new Date(patch.due_at);
    if (!Number.isFinite(date.getTime()) || (/^\d{4}-\d{2}-\d{2}$/.test(patch.due_at) && date.toISOString().slice(0,10) !== patch.due_at)) return {ok:false,error:'Choose a valid due date.'};
  }
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const key of ['title','body','priority','due_at'] as const) {
    if (patch[key] === undefined) continue;
    params.push(key === 'due_at' ? patch[key] || null : patch[key]?.trim());
    const bind = `$${params.length}`;
    sets.push(key === 'due_at'
      ? `due_at = CASE WHEN length(${bind}::text) = 10 THEN (${bind}::date::timestamp AT TIME ZONE 'America/Chicago') ELSE ${bind}::timestamptz END`
      : `${key} = ${bind}`);
    if (key === 'due_at' && !patch.due_at) sets.push(`snoozed_until = CASE WHEN snoozed_until = work_item_due_day_start(due_at) THEN NULL ELSE snoozed_until END`);
  }
  for (const [key, table, column] of [['project_slug','projects','project_id'],['lead_slug','leads','lead_id']] as const) {
    if (patch[key] === undefined) continue;
    const slug = patch[key]?.trim();
    const [job] = slug ? await run<{id:string}>(`SELECT id FROM ${table} WHERE slug = $1`, [slug]) : [];
    if (slug && !job) return {ok:false,error:`That ${key === 'project_slug' ? 'project' : 'lead'} could not be found. Choose another job.`};
    params.push(job?.id ?? null);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) return {ok:false,error:'No changes to save.'};
  const changed = await run(`UPDATE work_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, params);
  return changed.length ? {ok:true} : {ok:false,error:'Work item not found.'};
}
