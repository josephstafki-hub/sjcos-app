'use server';

import { query } from '@/lib/db';
import { requireAccess, requireRole } from '@/lib/dal';
import { activeMailbox, withMailboxFor } from '@/lib/mailbox';
import { ensureMailboxEmail } from '@/lib/mailbox-email';
import { revalidatePath } from 'next/cache';
import type { DraftIdentity, DraftWriteResult, InboxDraft, SaveDraftInput } from '@/lib/inbox-draft-types';

// Never take mailbox or user_id from a caller. A disconnected staff mailbox
// has its own namespace for SMS/portal drafts, never the owner's fallback.
async function scoped<T>(fn: (mailbox: string, userId: string, owner: boolean, connected: boolean) => Promise<T>) {
  const user = await requireAccess('inbox');
  return withMailboxFor(user, async () => {
    const mb = activeMailbox();
    if (!mb || mb.userId !== user.id) throw new Error('Mailbox scope is unavailable.');
    // The owner's env mailbox may have no configured address; the sweep keys AI
    // suggestions by the real Gmail address, so resolve it the same way here.
    const email = mb.refreshToken ? await ensureMailboxEmail() : '';
    return fn(email || `user:${user.id}`, user.id, user.role === 'owner', Boolean(email && mb.refreshToken));
  });
}

const columns = `id, thread_key AS "threadKey", channel, source, source_message_id AS "sourceMessageId",
  to_email AS "toEmail", cc, subject, body, summary, sources, model, based_on AS "basedOn", accepted_suggestion_id AS "acceptedSuggestionId", human_edited AS "humanEdited", version, status, updated_at::text AS "updatedAt"`;
const channels = ['email', 'sms', 'client_portal', 'sub_portal', 'site_form'];
function validateIdentity(input: DraftIdentity) {
  if (!input || typeof input.threadKey !== 'string' || !input.threadKey.trim() || input.threadKey.length > 500 ||
      !channels.includes(input.channel) || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0) throw new Error('Invalid draft identity.');
}

/** One query for the whole visible window. Human terminal rows are returned
 * as versioned tombstones so other devices can clear their saved copies. */
export async function loadDrafts(threadKeys: string[]): Promise<InboxDraft[]> {
  if (!Array.isArray(threadKeys) || threadKeys.length > 200 || threadKeys.some(k => typeof k !== 'string' || !k || k.length > 500)) throw new Error('Invalid thread keys.');
  return scoped(async (mailbox, userId, owner, connected) => {
    if (!threadKeys.length) return [];
    const { rows } = await query<InboxDraft>(
      `SELECT ${columns} FROM inbox_drafts WHERE mailbox=$1 AND thread_key=ANY($2::text[])
       AND ((source='human' AND user_id=$3) OR ($4 AND source='ai' AND status='ready'))
       ORDER BY updated_at DESC, id`, [mailbox, [...new Set(threadKeys)], userId, owner && connected]);
    return rows;
  });
}

async function currentDraft(mailbox: string, userId: string, input: DraftIdentity) {
  const { rows } = await query<InboxDraft>(`SELECT ${columns} FROM inbox_drafts
    WHERE mailbox=$1 AND user_id=$2 AND thread_key=$3 AND channel=$4 AND source='human'`,
    [mailbox, userId, input.threadKey, input.channel]);
  return rows[0] ?? null;
}

export async function saveDraft(input: SaveDraftInput): Promise<DraftWriteResult> {
  validateIdentity(input);
  if (typeof input.body !== 'string' || input.body.length > 100_000 ||
      typeof input.toEmail !== 'string' || input.toEmail.length > 2000 ||
      typeof input.subject !== 'string' || input.subject.length > 2000 ||
      !Array.isArray(input.cc) || input.cc.length > 100 || input.cc.some(c => typeof c !== 'string' || c.length > 500)) throw new Error('Invalid draft text.');
  const provenance=input.provenance;
  if(provenance&&(typeof provenance.basedOn!=='string'||provenance.basedOn.length>20_000||
    (provenance.model!==null&&!['claude','hermes','qwen'].includes(provenance.model))||
    typeof provenance.humanEdited!=='boolean'||(provenance.acceptedSuggestionId!==null&&!/^[a-f\d-]{36}$/i.test(provenance.acceptedSuggestionId))))throw Error('Invalid draft provenance.');
  if(provenance?.sources&&(!Array.isArray(provenance.sources)||provenance.sources.length>20||provenance.sources.some(s=>!s||typeof s.label!=='string'||s.label.length>2000||(s.kind==='message'?typeof s.messageId!=='string'||typeof s.threadId!=='string'||s.threadId!==input.threadKey:!['project','lead'].includes(s.kind)||typeof s.slug!=='string'||s.slug.length>500))))throw Error('Invalid draft sources.');
  return scoped(async (mailbox, userId, _owner, connected) => {
    if (input.channel === 'email' && !connected) throw new Error('Connect your mailbox to sync email drafts.');
    const params = [mailbox, userId, input.threadKey, input.channel, input.toEmail, input.cc, input.subject, input.body, input.baseVersion, provenance?.model??null, provenance?.basedOn??'',provenance?.acceptedSuggestionId??null,provenance?.humanEdited??false,JSON.stringify(provenance?.sources??[])];
    // Initial saves race on the unique index; existing saves compare-and-swap.
    // A zero-version writer must never overwrite any existing row/tombstone.
    const { rows } = input.baseVersion === 0
      ? await query<InboxDraft>(`INSERT INTO inbox_drafts
          (mailbox,user_id,thread_key,channel,to_email,cc,subject,body,source,model,based_on,accepted_suggestion_id,human_edited,sources)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,'human',$9,$10,$11::uuid,$12,$13::jsonb
          WHERE $11::uuid IS NULL OR EXISTS (SELECT 1 FROM inbox_drafts WHERE id=$11::uuid AND mailbox=$1 AND thread_key=$3 AND channel=$4 AND source='ai')
          ON CONFLICT (mailbox,user_id,thread_key,channel) WHERE source='human' DO NOTHING RETURNING ${columns}`, [...params.slice(0,8),...params.slice(9)])
      : await query<InboxDraft>(`UPDATE inbox_drafts SET to_email=$5,cc=$6,subject=$7,body=$8,
          model=$10,based_on=$11,accepted_suggestion_id=$12::uuid,human_edited=$13,sources=$14::jsonb,
          status='ready',version=version+1,error=NULL,updated_at=now()
          WHERE mailbox=$1 AND user_id=$2 AND thread_key=$3 AND channel=$4 AND source='human'
          AND version=$9 AND ($12::uuid IS NULL OR EXISTS (SELECT 1 FROM inbox_drafts s WHERE s.id=$12::uuid AND s.mailbox=$1 AND s.thread_key=$3 AND s.channel=$4 AND s.source='ai')) RETURNING ${columns}`, params);
    return rows[0] ? { conflict: false, current: rows[0] } : { conflict: true, current: await currentDraft(mailbox, userId, input) };
  });
}

async function finishDraft(input: DraftIdentity, status: 'discarded' | 'sent'): Promise<DraftWriteResult> {
  validateIdentity(input);
  return scoped(async (mailbox, userId) => {
    // Even an unsynced draft needs a tombstone: late offline saves must conflict.
    const { rows } = input.baseVersion === 0
      ? await query<InboxDraft>(`INSERT INTO inbox_drafts (mailbox,user_id,thread_key,channel,source,status)
          VALUES ($1,$2,$3,$4,'human',$5)
          ON CONFLICT (mailbox,user_id,thread_key,channel) WHERE source='human' DO NOTHING RETURNING ${columns}`,
        [mailbox, userId, input.threadKey, input.channel, status])
      : await query<InboxDraft>(`UPDATE inbox_drafts SET status=$5,body='',version=version+1,updated_at=now()
          WHERE mailbox=$1 AND user_id=$2 AND thread_key=$3 AND channel=$4 AND source='human' AND version=$6
          RETURNING ${columns}`, [mailbox, userId, input.threadKey, input.channel, status, input.baseVersion]);
    return rows[0] ? { conflict: false, current: rows[0] } : { conflict: true, current: await currentDraft(mailbox, userId, input) };
  });
}

export async function discardDraft(input: DraftIdentity): Promise<DraftWriteResult> {
  return finishDraft(input, 'discarded');
}

/** Bookkeeping only. The UI must call this AFTER its successful explicit send,
 * using the version of the text sent. Never calls a provider/send action. */
export async function markDraftSent(input: DraftIdentity & { suggestionId?: string }): Promise<DraftWriteResult> {
  if (input.suggestionId && !/^[a-f\d-]{36}$/i.test(input.suggestionId)) throw new Error('Invalid suggestion.');
  const result = await finishDraft(input, 'sent');
  if (!result.conflict && input.suggestionId) {
    await scoped(async (mailbox, _userId, owner, connected) => {
      if (!owner || !connected) return;
      // Exact suggestion only: never retire a newer inbound message's draft.
      await query(`UPDATE inbox_drafts SET status='sent',version=version+1,updated_at=now()
        WHERE id=$1 AND mailbox=$2 AND source='ai' AND status='ready' AND thread_key=$3`,
      [input.suggestionId, mailbox, input.threadKey]);
    });
  }
  return result;
}

export async function dismissSuggestion(id: string): Promise<void> {
  if (typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id)) throw new Error('Invalid suggestion.');
  await scoped(async (mailbox, _userId, owner, connected) => {
    if (!owner || !connected) throw new Error('Only the owner can dismiss inbox suggestions.');
    await query(`UPDATE inbox_drafts SET status='discarded',version=version+1,updated_at=now()
      WHERE id=$1 AND mailbox=$2 AND source='ai' AND status='ready'`, [id, mailbox]);
  });
}

export async function setInboxDraftModel(model: string): Promise<void> {
  await requireRole('owner');
  if (model !== 'claude' && model !== 'hermes') throw new Error('Choose Claude or Hermes.');
  await query(`INSERT INTO app_settings (key,value,updated_at) VALUES ('ai.inboxDraftModel',$1,now())
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [model]);
  revalidatePath('/settings');
}
