import type { QueueViewer } from './queue-scope';
import type { Run } from './commands/core';
export interface RecoverableWork { id: string; title: string; status: string; due: string | null; project_name: string | null; lead_name: string | null }
export function listRecoverableWork(run: Run, viewer: QueueViewer, view: 'done' | 'snoozed'): Promise<RecoverableWork[]>;
export function recoverWorkItem(run: Run, id: string, view: 'done' | 'snoozed', viewer?: QueueViewer): Promise<boolean>;
