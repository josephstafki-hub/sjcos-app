"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { setSubNotes } from "@/lib/actions/subs";
import { AI_NAME } from "@/lib/ai-name";

/** Editable, persisted owner notes on a sub. Save is enabled only when the text
 *  differs from what's stored; the action re-checks the owner role. */
export function SubNotes({ slug, notes }: { slug: string; notes: string }) {
  const [text, setText] = useState(notes);
  const [saved, setSaved] = useState(notes);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const dirty = text !== saved;

  function save() {
    setError(false);
    startTransition(async () => {
      try {
        await setSubNotes(slug, text);
        setSaved(text);
      } catch {
        setError(true);
      }
    });
  }

  return (
    <Card className="max-w-[680px] p-3.5">
      <div className="mb-2 flex items-center">
        <h3 className="flex-1 font-serif text-[15px] font-semibold text-ink">Notes</h3>
        {dirty && !pending && <span className="font-mono text-[10px] text-ink-4">unsaved</span>}
        {pending && <span className="font-mono text-[10px] text-ink-4">saving…</span>}
        {!dirty && !pending && saved && (
          <span className="font-mono text-[10px] text-money">saved</span>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={`What the ${AI_NAME} (and you) should remember about this sub — reliability, scheduling quirks, rate notes…`}
        className="w-full resize-y rounded-md border border-rule bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-accent"
      />
      {error && (
        <div className="mt-1.5 text-[11px] text-flag">Couldn&apos;t save — try again.</div>
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save notes
        </button>
      </div>
    </Card>
  );
}
