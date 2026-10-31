import type { ThreadChannel } from './types';

export type InboxDraftModel = 'claude' | 'hermes';
export interface DraftText {
  body: string;
  toEmail: string;
  cc: string[];
  subject: string;
}
export interface InboxDraft extends DraftText {
  id: string;
  threadKey: string;
  channel: ThreadChannel;
  source: 'human' | 'ai';
  sourceMessageId: string | null;
  summary: string;
  model: InboxDraftModel | null;
  basedOn: string;
  version: number;
  status: 'ready' | 'drafting' | 'failed' | 'discarded' | 'sent';
  updatedAt: string;
}
export interface DraftIdentity {
  threadKey: string;
  channel: ThreadChannel;
  baseVersion: number;
}
export type SaveDraftInput = DraftIdentity & DraftText;
export type DraftWriteResult = { conflict: false; current: InboxDraft } | { conflict: true; current: InboxDraft | null };
