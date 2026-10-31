/** Client-safe labels and scopes for daily work surfaces. */
export type QueueScope = 'all' | 'mine' | 'others';
export function queueScopeMatches(status: string, onMe: boolean, scope: QueueScope): boolean {
  if (scope === 'mine') return onMe;
  if (scope === 'others') return status === 'waiting_on_client' || status === 'waiting_on_sub';
  return true;
}
export function laneLabel(lane: string): string {
  return ({ all: 'All lanes', sends: 'Client messages and documents', payments: 'Payments', square: 'Square', qbo: 'QuickBooks', routine_followup: 'Routine follow-ups', weekly_summary: 'Weekly summaries', purchases: 'Purchases', publication: 'Publishing', agents: 'Agents' } as Record<string, string>)[lane] ?? lane.replaceAll('_', ' ');
}
export function notificationStatusCopy(n: { title: string; subline: string; resolution: string | null }): { title: string; subline: string } {
  if (n.resolution) {
    const state = ({ approved: 'Approved', consumed: 'Approved', rejected: 'Declined', expired: 'Expired', revoked: 'Revoked', superseded: 'Replaced', closed: 'Closed', info: 'Done', done: 'Done' } as Record<string, string>)[n.resolution] ?? 'Settled';
    return { title: n.title, subline: `${state} · Open the record for delivery status.` };
  }
  // Legacy invite announcements have no approval ref. They describe when an
  // invite was prepared, not its present state (these are handled on the job).
  if (n.title.startsWith('Portal invite queued —')) {
    const project = n.subline.split(/ · awaiting your OK| · nothing has been sent/)[0];
    return { title: n.title.replace('Portal invite queued —', 'Portal invite prepared —'), subline: `${project} · Check current status on the project's Subs tab.` };
  }
  return { title: n.title, subline: n.subline };
}
