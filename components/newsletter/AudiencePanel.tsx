"use client";

// Per-issue send targeting (P7-N2 follow-up). Lives in an issue's own
// Recipients tab and answers one question: who does THIS send reach? Two
// parts — which existing audiences (created in the global Contacts view) to
// target, and one-time addresses that get just this issue without joining the
// permanent list. Managing the contact list itself and creating audiences is
// NOT here — that's the Contacts view at the top of the page.

import { useState, type TransitionStartFunction } from "react";
import { Plus, Trash2, Tag } from "lucide-react";
import { setExtraRecipients } from "@/lib/actions/newsletter";
import type { NewsletterGroup } from "@/lib/newsletter";

export function AudiencePanel({
  issueId,
  extraRecipients,
  onExtraRecipientsChange,
  groups,
  queueGroupIds,
  setQueueGroupIds,
  pending,
  start,
  locked,
}: {
  issueId: number;
  extraRecipients: { email: string; name: string }[];
  onExtraRecipientsChange: (list: { email: string; name: string }[]) => void;
  groups: NewsletterGroup[];
  queueGroupIds: number[];
  setQueueGroupIds: (fn: (prev: number[]) => number[]) => void;
  pending: boolean;
  start: TransitionStartFunction;
  locked: boolean;
}) {
  const [oneOffEmail, setOneOffEmail] = useState("");
  const [oneOffName, setOneOffName] = useState("");

  function addOneOff() {
    const email = oneOffEmail.trim().toLowerCase();
    if (!email || extraRecipients.some((e) => e.email === email)) return;
    const next = [...extraRecipients, { email, name: oneOffName.trim() }];
    onExtraRecipientsChange(next);
    setOneOffEmail("");
    setOneOffName("");
    start(async () => {
      await setExtraRecipients(issueId, next);
    });
  }
  function removeOneOff(email: string) {
    const next = extraRecipients.filter((e) => e.email !== email);
    onExtraRecipientsChange(next);
    start(async () => {
      await setExtraRecipients(issueId, next);
    });
  }

  return (
    <div className="mx-auto max-w-[560px] space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Tag className="size-4 text-ink-3" strokeWidth={1.5} />
          <span className="text-[13px] font-semibold text-ink">Audience for this issue</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-3">
          Choose which audiences get this issue when you Queue it. None selected means everyone
          active. Create or manage audiences and the contact list from{" "}
          <b>Contacts</b> at the top of the page.
        </p>
        {groups.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-3">
            No audiences yet — create one from Contacts, then it will show up here.
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            {groups.map((g) => (
              <label
                key={g.id}
                className={`flex items-center gap-2 rounded-md px-1 py-1 text-[13px] text-ink ${
                  locked ? "opacity-60" : "cursor-pointer hover:bg-paper-2"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={queueGroupIds.includes(g.id)}
                  onChange={(e) =>
                    setQueueGroupIds((prev) => (e.target.checked ? [...prev, g.id] : prev.filter((x) => x !== g.id)))
                  }
                  className="size-3.5"
                />
                {g.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-rule-soft pt-4">
        <div className="text-[13px] font-semibold text-ink">One-time additions</div>
        <p className="mt-1 text-[11px] text-ink-3">
          Extra addresses that get just this issue — they are NOT added to the contact list.
        </p>
        {extraRecipients.length > 0 && (
          <div className="mt-2 space-y-1">
            {extraRecipients.map((e) => (
              <div
                key={e.email}
                className="flex items-center gap-2 rounded-md border border-rule-soft px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{e.name || e.email}</div>
                {e.name && <div className="truncate font-mono text-[10px] text-ink-3">{e.email}</div>}
                {!locked && (
                  <button
                    type="button"
                    onClick={() => removeOneOff(e.email)}
                    className="text-ink-4 hover:text-flag"
                    aria-label="Remove"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!locked && (
          <div className="mt-2 flex items-end gap-2">
            <input
              value={oneOffEmail}
              onChange={(e) => setOneOffEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOneOff()}
              placeholder="one-off@email.com"
              className="flex-1 rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
            <input
              value={oneOffName}
              onChange={(e) => setOneOffName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOneOff()}
              placeholder="Name · optional"
              className="w-[140px] rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={addOneOff}
              disabled={pending || !oneOffEmail.trim()}
              className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
            >
              <Plus className="size-3.5" strokeWidth={2} /> Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
