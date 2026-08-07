"use client";

// The sub portal's "Bid requests" surface. Each invite is a card: the scope
// (shared notes + a personal note if Joe wrote one), the packet to download,
// and the answer path — a bid form (total or line items that sum to one,
// lead time, exclusions, uploaded docs), a pass link with an optional reason,
// and a per-bid thread straight to Joe. Submitting again files a revision.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, MessageSquare, Plus, Send, X } from "lucide-react";
import { Card, Chip, Eyebrow, type ChipKind } from "@/components/ui";
import type { SubBidInvite, BidInviteStatus } from "@/lib/bidding";
import { declineBidInvite, sendBidMessageAsSub, submitBid } from "@/lib/actions/bidding";

type Result = { ok: boolean; error?: string };

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    (cents || 0) / 100,
  );

const STATUS_CHIP: Record<BidInviteStatus, { kind: ChipKind; label: string }> = {
  draft: { kind: "ghost", label: "—" },
  sent: { kind: "info", label: "New" },
  viewed: { kind: "info", label: "Awaiting your bid" },
  submitted: { kind: "money", label: "Bid sent" },
  declined: { kind: "ghost", label: "Passed" },
  awarded: { kind: "money", label: "You got it" },
  not_awarded: { kind: "ghost", label: "Went another way" },
};

const INPUT =
  "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3";
const BTN_SOLID =
  "inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50";

export function SubBids({ invites }: { invites: SubBidInvite[] }) {
  if (invites.length === 0) return null;
  return (
    <Card className="border-accent/40 p-3.5">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[15px] font-semibold text-ink">Bid requests</h2>
        <Chip kind="accent" dot>
          {invites.filter((i) => ["sent", "viewed"].includes(i.status)).length} open
        </Chip>
      </div>
      <div className="mt-2 flex flex-col gap-3">
        {invites.map((inv) => (
          <BidCard key={inv.id} invite={inv} />
        ))}
      </div>
    </Card>
  );
}

function BidCard({ invite }: { invite: SubBidInvite }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [showThread, setShowThread] = useState(invite.thread.length > 0);

  function run(fn: () => Promise<Result>, onSuccess?: () => void) {
    setError("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Something went wrong.");
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  const chip = STATUS_CHIP[invite.status];
  const open = ["sent", "viewed"].includes(invite.status);
  const answered = invite.submission !== null;

  return (
    <div className="rounded-lg border border-rule bg-paper-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-serif text-[14px] font-semibold text-ink">{invite.packageTitle}</span>
        {invite.trade && <Chip kind="ghost">{invite.trade}</Chip>}
        <Chip kind={chip.kind} dot>
          {chip.label}
        </Chip>
        <div className="flex-1" />
        {invite.dueLabel && (
          <span className="font-mono text-[10.5px] text-ink-3">bids due {invite.dueLabel}</span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-3">{invite.projectName}</div>

      {invite.scopeNotes && (
        <p className="mt-2 whitespace-pre-line text-[12.5px] leading-snug text-ink">{invite.scopeNotes}</p>
      )}
      {invite.message && (
        <div className="mt-2 rounded-md border border-accent/40 bg-accent-soft/50 px-2.5 py-1.5">
          <Eyebrow muted>For you specifically</Eyebrow>
          <p className="mt-0.5 whitespace-pre-line text-[12.5px] leading-snug text-ink">{invite.message}</p>
        </div>
      )}

      {invite.files.length > 0 && (
        <div className="mt-2.5">
          <Eyebrow muted>Plans &amp; takeoffs</Eyebrow>
          <div className="mt-1 flex flex-col gap-1">
            {invite.files.map((f) => (
              <a
                key={f.id}
                href={`/api/portal/bid-file/${f.fileId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
              >
                <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                <span className="truncate">{f.label || f.name}</span>
                <span className="font-mono text-[9.5px] text-ink-4">{f.sizeLabel}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-flag/40 bg-flag-soft px-2.5 py-1.5 text-[12px] text-flag">
          {error}
        </div>
      )}

      {/* Your bid, once one is in */}
      {answered && (
        <div className="mt-2.5 rounded-md border border-rule bg-paper px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Eyebrow muted>Your bid</Eyebrow>
            <span className="font-mono text-[14px] text-ink">{usd(invite.submission!.total)}</span>
            <span className="font-mono text-[9.5px] uppercase text-ink-4">
              rev {invite.submission!.revision} · {invite.submission!.whenLabel}
            </span>
            <div className="flex-1" />
            {open || invite.status === "submitted" ? (
              <button
                className="text-[11.5px] font-semibold text-accent-2 underline-offset-2 hover:underline"
                onClick={() => setShowForm((v) => !v)}
              >
                {showForm ? "Never mind" : "Revise bid"}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Answer paths */}
      {open && !answered && !showForm && !showDecline && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <button className={BTN_SOLID} onClick={() => setShowForm(true)}>
            <Send className="size-3" strokeWidth={1.75} />
            Send your bid
          </button>
          <button
            className="text-[11.5px] text-ink-3 underline-offset-2 hover:underline"
            onClick={() => setShowDecline(true)}
          >
            Pass on this one
          </button>
        </div>
      )}

      {showForm && (
        <BidForm
          pending={pending}
          onSubmit={(fd) => run(() => submitBid(invite.id, fd), () => setShowForm(false))}
          onCancel={() => setShowForm(false)}
        />
      )}

      {showDecline && (
        <form
          action={(fd) => run(() => declineBidInvite(invite.id, fd), () => setShowDecline(false))}
          className="mt-2.5 flex flex-col gap-2 rounded-md border border-rule bg-paper p-2.5"
        >
          <span className={LABEL}>Passing — let Joe know why (optional)</span>
          <input name="reason" placeholder="Booked through fall / out of my lane / …" className={INPUT} />
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="text-[11.5px] text-ink-3" onClick={() => setShowDecline(false)}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={BTN_SOLID}>
              Confirm pass
            </button>
          </div>
        </form>
      )}

      {/* Thread */}
      <div className="mt-2.5 border-t border-rule-soft pt-2">
        <button
          className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-3 hover:text-ink"
          onClick={() => setShowThread((v) => !v)}
        >
          <MessageSquare className="size-3" strokeWidth={1.75} />
          {invite.thread.length > 0 ? `Questions & answers (${invite.thread.length})` : "Ask Joe a question"}
        </button>
        {showThread && (
          <div className="mt-2 flex flex-col gap-2">
            {invite.thread.map((m) => {
              const fromJoe = m.author !== "user";
              return (
                <div key={m.id} className={`flex flex-col ${fromJoe ? "items-start" : "items-end"}`}>
                  <div
                    className={[
                      "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug",
                      fromJoe ? "bg-paper-3 text-ink" : "bg-accent text-ink",
                    ].join(" ")}
                  >
                    {m.body}
                  </div>
                  <span className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-4">
                    {fromJoe ? m.name : "You"} · {m.when}
                  </span>
                </div>
              );
            })}
            <ThreadComposer
              pending={pending}
              onSend={(fd, reset) => run(() => sendBidMessageAsSub(invite.id, fd), reset)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BidForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<number[]>([]);
  const [nextKey, setNextKey] = useState(0);

  return (
    <form action={onSubmit} className="mt-2.5 flex flex-col gap-2.5 rounded-md border border-rule bg-paper p-3">
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Bid total ($)</span>
          <input name="total" inputMode="decimal" placeholder="12,500" className={`${INPUT} w-[130px] font-mono`} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Lead time</span>
          <input name="leadTime" placeholder='e.g. "2 weeks out, 5 days on site"' className={INPUT} />
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <span className={LABEL}>Breakdown (optional — helps your number stand up)</span>
        {rows.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <input name="lineDesc" placeholder="Labor / materials / …" className={`${INPUT} min-w-0 flex-1`} />
            <input name="lineAmount" inputMode="decimal" placeholder="$" className={`${INPUT} w-[100px] font-mono`} />
            <button
              type="button"
              className="text-ink-4 hover:text-flag"
              onClick={() => setRows(rows.filter((k) => k !== key))}
              aria-label="Remove line"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 self-start text-[11.5px] font-semibold text-accent-2 hover:underline"
          onClick={() => {
            setRows([...rows, nextKey]);
            setNextKey(nextKey + 1);
          }}
        >
          <Plus className="size-3" strokeWidth={2} />
          Add line item
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Exclusions — what your number does NOT cover</span>
        <input name="exclusions" placeholder="Permits, dump fees, …" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Notes</span>
        <textarea name="notes" rows={2} placeholder="Anything Joe should know about your price…" className={`${INPUT} resize-y`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Attach your bid docs (optional)</span>
        <input
          name="files"
          type="file"
          multiple
          className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="text-[11.5px] text-ink-3" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={BTN_SOLID}>
          <Send className="size-3" strokeWidth={1.75} />
          {pending ? "Sending…" : "Send bid to Joe"}
        </button>
      </div>
    </form>
  );
}

function ThreadComposer({
  pending,
  onSend,
}: {
  pending: boolean;
  onSend: (fd: FormData, reset: () => void) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <form action={(fd) => onSend(fd, () => setDraft(""))} className="flex items-end gap-2">
      <textarea
        name="body"
        required
        rows={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Ask about the scope, schedule, drawings…"
        className={`${INPUT} min-w-0 flex-1 resize-none`}
      />
      <button type="submit" disabled={pending} className={BTN_SOLID} aria-label="Send">
        <Send className="size-3" strokeWidth={1.75} />
      </button>
    </form>
  );
}
