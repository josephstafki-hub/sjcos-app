'use client';
import { useState, useTransition } from 'react';
import { setInboxDraftModel } from '@/lib/actions/inbox-drafts';
import { runAction } from '@/lib/run-action';

export function InboxDraftModelPicker({ initial }: { initial: 'claude' | 'hermes' }) {
  const [model, setModel] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState('');
  return <div className="flex w-full items-center gap-3 border-t border-rule-soft py-1.5">
    <label htmlFor="inbox-draft-model" className="flex-1 text-body text-ink">Who writes inbox auto-drafts</label>
    <span role="status" className="text-meta text-ink-2">{pending ? 'Saving…' : feedback}</span>
    <select id="inbox-draft-model" value={model} disabled={pending}
      className="rounded-md border border-rule bg-card px-2 py-1 text-meta text-ink disabled:opacity-60"
      onChange={e => {
        const next = e.target.value === 'hermes' ? 'hermes' : 'claude';
        const previous = model;
        setModel(next);
        startTransition(async () => {
          await runAction(() => setInboxDraftModel(next), { fallback: "Couldn't save the inbox model.",
            onSuccess: () => setFeedback('Saved'), onError: message => { setModel(previous); setFeedback(message); } });
        });
      }}>
      <option value="claude">Claude</option><option value="hermes">Hermes</option>
    </select>
  </div>;
}
