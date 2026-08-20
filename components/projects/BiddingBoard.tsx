"use client";

// The project Bidding tab (Houzz-Pro-style bid management). The flow reads
// top to bottom the way the work happens:
//
//   1. New bid package  — name the work, tag the trade, set a due date.
//   2. Build the packet — attach plans / takeoffs from the project's files or
//                         upload straight in, and label them for the sub.
//   3. Pick recipients  — the sub roster grouped by trade with one-click
//                         group select; each sub can carry a personal note on
//                         top of the shared scope.
//   4. Send             — every draft invite publishes to that sub's portal;
//                         subs without portal access get an invite email
//                         PARKED on the Subs tab (Joe transmits those himself).
//   5. Compare + award  — submitted bids line up side by side (totals, line
//                         items, exclusions, lead time, docs) with the low
//                         number flagged; awarding one closes the package.
//
// Packages group by trade on the board and the recipient picker sorts by
// trade, so "send the framing packet to my framing subs" is two clicks.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  FileText,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Scale,
  Send,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { Card, Chip, Eyebrow, type ChipKind } from "@/components/ui";
import type { BiddingView, BidPackage, BidInvite, BidInviteStatus } from "@/lib/bidding";
import type { ProjectFile } from "@/lib/projects";

/** One sub in the recipient picker — the full roster, keyed by trade. */
interface RosterSub {
  slug: string;
  name: string;
  trade: string;
}
import {
  addBidInvites,
  attachBidFiles,
  awardBid,
  closeBidPackage,
  createBidPackage,
  labelBidFile,
  removeBidFile,
  removeBidInvite,
  removeBidPackage,
  sendBidMessageAsOwner,
  sendBidPackage,
  updateBidInviteMessage,
  updateBidPackage,
  uploadBidFile,
} from "@/lib/actions/bidding";
import { useRemoved } from "@/lib/use-removed";

type Result = { ok: boolean; error?: string };

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    (cents || 0) / 100,
  );

const PKG_CHIP: Record<BidPackage["status"], { kind: ChipKind; label: string }> = {
  draft: { kind: "ghost", label: "Draft" },
  open: { kind: "accent", label: "Out for bid" },
  awarded: { kind: "money", label: "Awarded" },
  closed: { kind: "ghost", label: "Closed" },
};

const INVITE_CHIP: Record<BidInviteStatus, { kind: ChipKind; label: string }> = {
  draft: { kind: "ghost", label: "Not sent" },
  sent: { kind: "info", label: "Sent" },
  viewed: { kind: "info", label: "Viewed" },
  submitted: { kind: "money", label: "Bid in" },
  declined: { kind: "flag", label: "Passed" },
  awarded: { kind: "money", label: "Awarded" },
  not_awarded: { kind: "ghost", label: "Not awarded" },
};

const INPUT =
  "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2";
const BTN_SOLID =
  "inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50";

type Modal =
  | { kind: "pkg"; pkg: BidPackage | null }
  | { kind: "files"; pkgId: number }
  | { kind: "subs"; pkgId: number }
  | { kind: "note"; inviteId: number; pkgId: number }
  | { kind: "compare"; pkgId: number }
  | { kind: "thread"; inviteId: number; pkgId: number }
  | null;

export function BiddingBoard({
  slug,
  view,
  roster,
  projectFiles,
}: {
  slug: string;
  view: BiddingView;
  roster: RosterSub[];
  projectFiles: ProjectFile[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [tradeFilter, setTradeFilter] = useState<string | null>(null);

  const { removed, hide, restore } = useRemoved();

  // Single path for every mutation (same contract as SelectionsBoard): the
  // project page is cookie-dynamic, so router.refresh() is what repaints.
  function run(
    fn: () => Promise<Result>,
    onSuccess?: () => void,
    fallback = "Something went wrong.",
    onError?: () => void,
  ) {
    setError("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? fallback);
        onError?.();
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  /** Delete optimistically: hide the row now, restore it only if the write fails. */
  function removeRow(key: string, fn: () => Promise<Result>) {
    hide(key);
    run(fn, undefined, undefined, () => restore(key));
  }

  const close = () => {
    setModal(null);
    setError("");
  };

  // Optimistically-removed packages/invites/files drop out of the render the
  // moment their delete is clicked; the refetch confirms a beat later.
  const packages =
    removed.size === 0
      ? view.packages
      : view.packages
          .filter((p) => !removed.has(`pkg:${p.id}`))
          .map((p) => ({
            ...p,
            invites: p.invites.filter((i) => !removed.has(`invite:${i.id}`)),
            files: p.files.filter((f) => !removed.has(`file:${f.id}`)),
          }));

  // Modals hold ids, not snapshots — a live-update refresh flows new props in
  // while a modal is open (e.g. a bid landing during compare).
  const pkgById = (id: number) => packages.find((p) => p.id === id) ?? null;
  const inviteById = (pkgId: number, inviteId: number) =>
    pkgById(pkgId)?.invites.find((i) => i.id === inviteId) ?? null;

  const shown = tradeFilter
    ? packages.filter((p) => (p.trade || "General") === tradeFilter)
    : packages;

  // Group the board by trade so "receiving" reads by category of work.
  const groups = new Map<string, BidPackage[]>();
  for (const p of shown) {
    const key = p.trade || "General";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <div className="flex max-w-[880px] flex-col gap-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h3 className="font-serif text-[16px] font-semibold text-ink">Bidding</h3>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {packages.length > 0
              ? "Packets out to subs, grouped by trade. Bids come back here and compare side by side."
              : "Send plans and takeoffs to a group of subs and collect their numbers in one place."}
          </p>
        </div>
        <button className={BTN_SOLID} onClick={() => setModal({ kind: "pkg", pkg: null })}>
          <Plus className="size-3" strokeWidth={2} />
          New bid package
        </button>
      </div>

      {error && !modal && (
        <div className="rounded-md border border-flag/40 bg-flag-soft px-3 py-2 text-[12px] text-flag">{error}</div>
      )}

      {view.trades.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setTradeFilter(null)}>
            <Chip kind={tradeFilter === null ? "solid" : "ghost"}>All trades</Chip>
          </button>
          {view.trades.map((t) => (
            <button key={t} onClick={() => setTradeFilter(tradeFilter === t ? null : t)}>
              <Chip kind={tradeFilter === t ? "solid" : "ghost"}>{t}</Chip>
            </button>
          ))}
        </div>
      )}

      {packages.length === 0 && (
        <Card kind="dashed" className="p-6 text-center text-[13px] text-ink-3">
          No bid packages yet. Start one for a category of work — framing, HVAC, tile — attach the
          plans, and pick which subs price it.
        </Card>
      )}

      {[...groups.entries()].map(([trade, pkgs]) => (
        <div key={trade} className="flex flex-col gap-2.5">
          {groups.size > 1 && <Eyebrow muted>{trade}</Eyebrow>}
          {pkgs.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              pending={pending}
              onEdit={() => setModal({ kind: "pkg", pkg })}
              onFiles={() => setModal({ kind: "files", pkgId: pkg.id })}
              onSubs={() => setModal({ kind: "subs", pkgId: pkg.id })}
              onNote={(inviteId) => setModal({ kind: "note", inviteId, pkgId: pkg.id })}
              onThread={(inviteId) => setModal({ kind: "thread", inviteId, pkgId: pkg.id })}
              onCompare={() => setModal({ kind: "compare", pkgId: pkg.id })}
              onSend={() => run(() => sendBidPackage(pkg.id))}
              onClose={() => run(() => closeBidPackage(pkg.id))}
              onRemove={() => removeRow(`pkg:${pkg.id}`, () => removeBidPackage(pkg.id))}
              onRemoveInvite={(id) => removeRow(`invite:${id}`, () => removeBidInvite(id))}
              onRemoveFile={(id) => removeRow(`file:${id}`, () => removeBidFile(id))}
            />
          ))}
        </div>
      ))}

      {modal?.kind === "pkg" && (
        <PackageModal
          slug={slug}
          pkg={modal.pkg}
          trades={[...new Set([...view.trades, ...roster.map((r) => r.trade)])].filter(Boolean).sort()}
          pending={pending}
          error={error}
          run={run}
          onClose={close}
        />
      )}
      {modal?.kind === "files" && pkgById(modal.pkgId) && (
        <FilesModal
          pkg={pkgById(modal.pkgId)!}
          projectFiles={projectFiles}
          pending={pending}
          error={error}
          run={run}
          onRemoveFile={(id) => removeRow(`file:${id}`, () => removeBidFile(id))}
          onClose={close}
        />
      )}
      {modal?.kind === "subs" && pkgById(modal.pkgId) && (
        <RecipientsModal
          pkg={pkgById(modal.pkgId)!}
          roster={roster}
          pending={pending}
          error={error}
          run={run}
          onClose={close}
        />
      )}
      {modal?.kind === "note" && inviteById(modal.pkgId, modal.inviteId) && (
        <NoteModal
          invite={inviteById(modal.pkgId, modal.inviteId)!}
          pending={pending}
          error={error}
          run={run}
          onClose={close}
        />
      )}
      {modal?.kind === "compare" && pkgById(modal.pkgId) && (
        <CompareModal
          pkg={pkgById(modal.pkgId)!}
          pending={pending}
          error={error}
          run={run}
          onClose={close}
          onThread={(inviteId) => setModal({ kind: "thread", inviteId, pkgId: modal.pkgId })}
        />
      )}
      {modal?.kind === "thread" && inviteById(modal.pkgId, modal.inviteId) && (
        <ThreadModal
          invite={inviteById(modal.pkgId, modal.inviteId)!}
          pending={pending}
          error={error}
          run={run}
          onClose={close}
        />
      )}
    </div>
  );
}

// ─── One package on the board ────────────────────────────────────────────────

function PackageCard({
  pkg,
  pending,
  onEdit,
  onFiles,
  onSubs,
  onNote,
  onThread,
  onCompare,
  onSend,
  onClose,
  onRemove,
  onRemoveInvite,
  onRemoveFile,
}: {
  pkg: BidPackage;
  pending: boolean;
  onEdit: () => void;
  onFiles: () => void;
  onSubs: () => void;
  onNote: (inviteId: number) => void;
  onThread: (inviteId: number) => void;
  onCompare: () => void;
  onSend: () => void;
  onClose: () => void;
  onRemove: () => void;
  onRemoveInvite: (id: number) => void;
  onRemoveFile: (id: number) => void;
}) {
  const chip = PKG_CHIP[pkg.status];
  const draftInvites = pkg.invites.filter((i) => i.status === "draft").length;
  const live = pkg.status === "draft" || pkg.status === "open";
  const winner = pkg.awardedInviteId
    ? pkg.invites.find((i) => i.id === pkg.awardedInviteId) ?? null
    : null;

  return (
    <Card className={`p-3.5 ${pkg.status === "closed" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-serif text-[15px] font-semibold text-ink">{pkg.title}</h4>
        {pkg.trade && <Chip kind="accent">{pkg.trade}</Chip>}
        <Chip kind={chip.kind} dot>
          {chip.label}
        </Chip>
        {pkg.dueLabel && <span className="font-mono text-[11px] text-ink-3">bids due {pkg.dueLabel}</span>}
        <div className="flex-1" />
        {pkg.lowTotal !== null && (
          <span className="font-mono text-[12px] text-money">low {usd(pkg.lowTotal)}</span>
        )}
        <button className="text-ink-3 hover:text-ink" title="Edit package" onClick={onEdit}>
          <Pencil className="size-3.5" strokeWidth={1.5} />
        </button>
        {pkg.status === "draft" && (
          <button className="text-ink-3 hover:text-flag" title="Delete package" onClick={onRemove}>
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>
      {pkg.scopeNotes && (
        <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-snug text-ink-2">{pkg.scopeNotes}</p>
      )}

      {/* The packet */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {pkg.files.map((f) => (
          <span
            key={f.id}
            className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-paper-2 py-1 pl-2 pr-1.5"
          >
            <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
            <a
              href={`/api/portal/bid-file/${f.fileId}`}
              target="_blank"
              rel="noreferrer"
              className="max-w-[220px] truncate text-[11.5px] text-ink-2 hover:text-ink"
              title={f.name}
            >
              {f.label || f.name}
            </a>
            <span className="font-mono text-[9.5px] text-ink-4">{f.sizeLabel}</span>
            {live && (
              <button
                className="text-ink-4 hover:text-flag"
                title="Remove from packet"
                onClick={() => onRemoveFile(f.id)}
              >
                <X className="size-3" strokeWidth={1.75} />
              </button>
            )}
          </span>
        ))}
        {live && (
          <button className={BTN_GHOST} onClick={onFiles}>
            <Paperclip className="size-3" strokeWidth={1.75} />
            {pkg.files.length ? "Add files" : "Attach plans & takeoff"}
          </button>
        )}
        {!live && pkg.files.length === 0 && (
          <span className="text-[11.5px] text-ink-4">No packet files.</span>
        )}
      </div>

      {/* Recipients */}
      <div className="mt-3 border-t border-rule-soft pt-2.5">
        {pkg.invites.length === 0 ? (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
            No subs picked yet.
            {live && (
              <button className={BTN_GHOST} onClick={onSubs}>
                <Users className="size-3" strokeWidth={1.75} />
                Add subs
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {pkg.invites.map((inv, idx) => {
              const ic = INVITE_CHIP[inv.status];
              return (
                <div
                  key={inv.id}
                  className={`flex items-center gap-2 py-1.5 ${idx ? "border-t border-rule-soft" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {inv.subName}
                    {inv.message && (
                      <span className="ml-1.5 text-[11px] italic text-ink-3" title={inv.message}>
                        + note
                      </span>
                    )}
                  </span>
                  <Chip kind="ghost">{inv.subTrade || "—"}</Chip>
                  <Chip kind={ic.kind} dot>
                    {ic.label}
                  </Chip>
                  <span className="w-[76px] text-right font-mono text-[12px] text-ink-2">
                    {inv.submission ? usd(inv.submission.total) : "—"}
                  </span>
                  <button
                    className="text-ink-3 hover:text-ink"
                    title="Personal note for this sub"
                    onClick={() => onNote(inv.id)}
                  >
                    <Pencil className="size-3.5" strokeWidth={1.5} />
                  </button>
                  <button
                    className={`relative ${inv.status === "draft" ? "text-ink-4" : "text-ink-3 hover:text-ink"}`}
                    title={inv.status === "draft" ? "Thread opens once sent" : "Message this sub"}
                    onClick={() => inv.status !== "draft" && onThread(inv.id)}
                  >
                    <MessageSquare className="size-3.5" strokeWidth={1.5} />
                    {inv.thread.length > 0 && (
                      <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-ai" />
                    )}
                  </button>
                  {inv.status === "draft" ? (
                    <button
                      className="text-ink-4 hover:text-flag"
                      title="Remove from this bid"
                      onClick={() => onRemoveInvite(inv.id)}
                    >
                      <X className="size-3.5" strokeWidth={1.75} />
                    </button>
                  ) : (
                    <span className="w-[14px]" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-rule-soft pt-2.5">
        {live && pkg.invites.length > 0 && (
          <button className={BTN_GHOST} onClick={onSubs}>
            <Users className="size-3" strokeWidth={1.75} />
            Add subs
          </button>
        )}
        {live && draftInvites > 0 && (
          <button className={BTN_SOLID} disabled={pending} onClick={onSend}>
            <Send className="size-3" strokeWidth={1.75} />
            {pkg.status === "draft"
              ? `Send to ${draftInvites} sub${draftInvites === 1 ? "" : "s"}`
              : `Send to ${draftInvites} more`}
          </button>
        )}
        {pkg.submittedCount > 0 && (
          <button className={BTN_GHOST} onClick={onCompare}>
            <Scale className="size-3" strokeWidth={1.75} />
            Compare bids ({pkg.submittedCount})
          </button>
        )}
        {winner && (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-money">
            <Trophy className="size-3.5" strokeWidth={1.75} />
            {winner.subName} · {winner.submission ? usd(winner.submission.total) : ""}
          </span>
        )}
        <div className="flex-1" />
        {pkg.status === "open" && (
          <button className="text-[11.5px] text-ink-3 underline-offset-2 hover:underline" onClick={onClose}>
            Close without awarding
          </button>
        )}
        {pkg.status === "open" && pkg.sentLabel && (
          <span className="font-mono text-[10.5px] text-ink-4">sent {pkg.sentLabel}</span>
        )}
      </div>
    </Card>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

type RunFn = (fn: () => Promise<Result>, onSuccess?: () => void, fallback?: string) => void;

function PackageModal({
  slug,
  pkg,
  trades,
  pending,
  error,
  run,
  onClose,
}: {
  slug: string;
  pkg: BidPackage | null;
  trades: string[];
  pending: boolean;
  error: string;
  run: RunFn;
  onClose: () => void;
}) {
  return (
    <ModalShell title={pkg ? "Edit bid package" : "New bid package"} onClose={onClose}>
      <form
        action={(fd) =>
          run(() => (pkg ? updateBidPackage(pkg.id, fd) : createBidPackage(slug, fd)), onClose)
        }
        className="flex flex-col gap-3 p-4"
      >
        <ModalError error={error} />
        <label className="flex flex-col gap-1">
          <span className={LABEL}>What&apos;s being bid</span>
          <input
            name="title"
            required
            defaultValue={pkg?.title ?? ""}
            placeholder={'e.g. "Framing — main house"'}
            className={INPUT}
          />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={LABEL}>Trade / category</span>
            <input
              name="trade"
              list="bid-trades"
              defaultValue={pkg?.trade ?? ""}
              placeholder="Framing"
              className={INPUT}
            />
            <datalist id="bid-trades">
              {trades.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Bids due</span>
            <input name="dueDate" type="date" defaultValue={pkg?.dueDate ?? ""} className={INPUT} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Scope notes — every invited sub sees this</span>
          <textarea
            name="scopeNotes"
            rows={4}
            defaultValue={pkg?.scopeNotes ?? ""}
            placeholder="What's included, site conditions, schedule expectations, how to price it…"
            className={`${INPUT} resize-y`}
          />
        </label>
        <ModalActions pending={pending} onClose={onClose} submitLabel={pkg ? "Save" : "Create package"} />
      </form>
    </ModalShell>
  );
}

function FilesModal({
  pkg,
  projectFiles,
  pending,
  error,
  run,
  onRemoveFile,
  onClose,
}: {
  pkg: BidPackage;
  projectFiles: ProjectFile[];
  pending: boolean;
  error: string;
  run: RunFn;
  onRemoveFile: (id: number) => void;
  onClose: () => void;
}) {
  const attached = new Set(pkg.files.map((f) => f.fileId));
  const attachable = projectFiles.filter((f) => f.type !== "folder" && !attached.has(f.id));

  return (
    <ModalShell title={`Packet · ${pkg.title}`} onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        <ModalError error={error} />

        {attachable.length > 0 && (
          <form action={(fd) => run(() => attachBidFiles(pkg.id, fd))} className="flex flex-col gap-2">
            <Eyebrow muted>From this project&apos;s files</Eyebrow>
            <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded-md border border-rule p-2">
              {attachable.map((f) => (
                <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-paper-2">
                  <input type="checkbox" name="fileId" value={f.id} className="accent-ink" />
                  <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{f.name}</span>
                  <span className="font-mono text-[10px] text-ink-4">{f.sizeLabel}</span>
                </label>
              ))}
            </div>
            <button type="submit" disabled={pending} className={`${BTN_GHOST} self-end`}>
              <Paperclip className="size-3" strokeWidth={1.75} />
              Attach selected
            </button>
          </form>
        )}

        <form action={(fd) => run(() => uploadBidFile(pkg.id, fd))} className="flex flex-col gap-2 border-t border-rule-soft pt-3">
          <Eyebrow muted>Or upload new</Eyebrow>
          <input
            name="file"
            type="file"
            required
            className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
          />
          <div className="flex items-center gap-2">
            <input name="label" placeholder='Label the sub sees, e.g. "Material takeoff"' className={`${INPUT} flex-1`} />
            <button type="submit" disabled={pending} className={BTN_SOLID}>
              Upload
            </button>
          </div>
        </form>

        {pkg.files.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-rule-soft pt-3">
            <Eyebrow muted>In the packet</Eyebrow>
            {pkg.files.map((f) => (
              <form
                key={f.id}
                action={(fd) => run(() => labelBidFile(f.id, fd))}
                className="flex items-center gap-2"
              >
                <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                <span className="min-w-0 max-w-[200px] flex-none truncate text-[12px] text-ink-2" title={f.name}>
                  {f.name}
                </span>
                <input name="label" defaultValue={f.label} placeholder="Label…" className={`${INPUT} min-w-0 flex-1 py-1 text-[12px]`} />
                <button type="submit" disabled={pending} className="text-ink-3 hover:text-ink" title="Save label">
                  <Check className="size-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="text-ink-4 hover:text-flag"
                  title="Remove from packet"
                  onClick={() => onRemoveFile(f.id)}
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function RecipientsModal({
  pkg,
  roster,
  pending,
  error,
  run,
  onClose,
}: {
  pkg: BidPackage;
  roster: RosterSub[];
  pending: boolean;
  error: string;
  run: RunFn;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const invited = new Set(pkg.invites.map((i) => i.subSlug));

  const candidates = roster.filter(
    (s) =>
      !invited.has(s.slug) &&
      (query === "" || `${s.name} ${s.trade}`.toLowerCase().includes(query.toLowerCase())),
  );

  // Grouped by trade; the package's own trade floats to the top since those
  // are almost always the subs this packet is for.
  const byTrade = new Map<string, RosterSub[]>();
  for (const s of candidates) {
    const key = s.trade || "Other";
    byTrade.set(key, [...(byTrade.get(key) ?? []), s]);
  }
  const tradeOrder = [...byTrade.keys()].sort((a, b) => {
    if (a === pkg.trade) return -1;
    if (b === pkg.trade) return 1;
    return a.localeCompare(b);
  });

  const toggle = (slug: string) => {
    const next = new Set(picked);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setPicked(next);
  };
  const toggleTrade = (trade: string) => {
    const members = byTrade.get(trade) ?? [];
    const allIn = members.every((s) => picked.has(s.slug));
    const next = new Set(picked);
    for (const s of members) {
      if (allIn) next.delete(s.slug);
      else next.add(s.slug);
    }
    setPicked(next);
  };

  return (
    <ModalShell title={`Add subs · ${pkg.title}`} onClose={onClose}>
      <form
        action={(fd) => {
          for (const slug of picked) fd.append("subSlug", slug);
          run(() => addBidInvites(pkg.id, fd), onClose);
        }}
        className="flex flex-col gap-3 p-4"
      >
        <ModalError error={error} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search subs or trades…"
          className={INPUT}
        />
        <div className="flex max-h-[300px] flex-col gap-2.5 overflow-y-auto">
          {candidates.length === 0 && (
            <div className="py-4 text-center text-[12.5px] text-ink-3">
              {roster.length === invited.size
                ? "Every sub on the roster is already on this bid."
                : "No subs match."}
            </div>
          )}
          {tradeOrder.map((trade) => {
            const members = byTrade.get(trade)!;
            const allIn = members.every((s) => picked.has(s.slug));
            return (
              <div key={trade}>
                <div className="flex items-center gap-2">
                  <Eyebrow muted>{trade}</Eyebrow>
                  {trade === pkg.trade && <Chip kind="accent">this package&apos;s trade</Chip>}
                  <button
                    type="button"
                    onClick={() => toggleTrade(trade)}
                    className="text-[11px] font-semibold text-accent-2 underline-offset-2 hover:underline"
                  >
                    {allIn ? "Clear all" : `Select all ${members.length}`}
                  </button>
                </div>
                <div className="mt-1 flex flex-col">
                  {members.map((s) => (
                    <label
                      key={s.slug}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-paper-2"
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(s.slug)}
                        onChange={() => toggle(s.slug)}
                        className="accent-ink"
                      />
                      <span className="flex-1 text-[13px] text-ink">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {invited.size > 0 && (
          <p className="text-[11px] text-ink-4">
            Already on this bid: {pkg.invites.map((i) => i.subName).join(", ")}
          </p>
        )}
        <ModalActions
          pending={pending || picked.size === 0}
          onClose={onClose}
          submitLabel={picked.size ? `Add ${picked.size} sub${picked.size === 1 ? "" : "s"}` : "Add subs"}
        />
      </form>
    </ModalShell>
  );
}

function NoteModal({
  invite,
  pending,
  error,
  run,
  onClose,
}: {
  invite: BidInvite;
  pending: boolean;
  error: string;
  run: RunFn;
  onClose: () => void;
}) {
  return (
    <ModalShell title={`Note for ${invite.subName}`} onClose={onClose}>
      <form
        action={(fd) => run(() => updateBidInviteMessage(invite.id, fd), onClose)}
        className="flex flex-col gap-3 p-4"
      >
        <ModalError error={error} />
        <p className="text-[12px] text-ink-3">
          Rides on top of the shared scope notes — only {invite.subName} sees it. Use it to tailor the
          packet: &quot;your number should include the detached garage&quot;, &quot;ignore sheet A-301&quot;, etc.
        </p>
        <textarea
          name="message"
          rows={4}
          defaultValue={invite.message}
          placeholder={`Anything specific to ${invite.subName}…`}
          className={`${INPUT} resize-y`}
        />
        <ModalActions pending={pending} onClose={onClose} submitLabel="Save note" />
      </form>
    </ModalShell>
  );
}

function CompareModal({
  pkg,
  pending,
  error,
  run,
  onClose,
  onThread,
}: {
  pkg: BidPackage;
  pending: boolean;
  error: string;
  run: RunFn;
  onClose: () => void;
  onThread: (inviteId: number) => void;
}) {
  const bids = pkg.invites
    .filter((i) => i.submission && i.status !== "declined")
    .sort((a, b) => a.submission!.total - b.submission!.total);
  const low = bids[0]?.submission?.total;
  const canAward = pkg.status === "open";

  return (
    <ModalShell title={`Compare bids · ${pkg.title}`} onClose={onClose} wide>
      <div className="flex flex-col gap-3 p-4">
        <ModalError error={error} />
        {bids.length === 0 && <p className="text-[13px] text-ink-3">No bids in yet.</p>}
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(bids.length, 1)}, minmax(220px, 1fr))` }}>
          {bids.map((inv) => {
            const s = inv.submission!;
            const isLow = s.total === low;
            const isWinner = inv.status === "awarded";
            return (
              <div
                key={inv.id}
                className={`flex flex-col gap-2 rounded-lg border p-3 ${
                  isWinner ? "border-money bg-money-soft/40" : isLow ? "border-accent" : "border-rule"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-serif text-[14px] font-semibold text-ink">
                    {inv.subName}
                  </span>
                  {isWinner && <Chip kind="money" dot>Awarded</Chip>}
                  {!isWinner && isLow && <Chip kind="accent">Low bid</Chip>}
                </div>
                <div className="font-mono text-[20px] text-ink">{usd(s.total)}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
                  rev {s.revision} · {s.whenLabel}
                  {s.leadTime ? ` · lead ${s.leadTime}` : ""}
                </div>

                {s.lines.length > 0 && (
                  <div className="border-t border-rule-soft pt-1.5">
                    {s.lines.map((l, i) => (
                      <div key={i} className="flex items-baseline gap-2 py-0.5">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={l.description}>
                          {l.description}
                        </span>
                        <span className="font-mono text-[11px] text-ink-3">{l.amount ? usd(l.amount) : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
                {s.exclusions && (
                  <div className="border-t border-rule-soft pt-1.5">
                    <Eyebrow muted>Excludes</Eyebrow>
                    <p className="mt-0.5 whitespace-pre-line text-[12px] leading-snug text-flag">{s.exclusions}</p>
                  </div>
                )}
                {s.notes && (
                  <p className="whitespace-pre-line border-t border-rule-soft pt-1.5 text-[12px] leading-snug text-ink-2">
                    {s.notes}
                  </p>
                )}
                {s.files.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-rule-soft pt-1.5">
                    {s.files.map((f) => (
                      <a
                        key={f.fileId}
                        href={`/api/portal/bid-file/${f.fileId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 hover:text-ink"
                      >
                        <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                        <span className="truncate">{f.name}</span>
                      </a>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center gap-2 border-t border-rule-soft pt-2">
                  {canAward && (
                    <button
                      disabled={pending}
                      onClick={() => run(() => awardBid(inv.id))}
                      className={`${BTN_SOLID} flex-1 justify-center`}
                    >
                      <Trophy className="size-3" strokeWidth={1.75} />
                      Award
                    </button>
                  )}
                  <button className={BTN_GHOST} onClick={() => onThread(inv.id)}>
                    <MessageSquare className="size-3" strokeWidth={1.75} />
                    Message
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}

function ThreadModal({
  invite,
  pending,
  error,
  run,
  onClose,
}: {
  invite: BidInvite;
  pending: boolean;
  error: string;
  run: RunFn;
  onClose: () => void;
}) {
  return (
    <ModalShell title={`${invite.subName} · bid thread`} onClose={onClose}>
      <div className="flex flex-col gap-2 p-4">
        <ModalError error={error} />
        {invite.thread.length === 0 && (
          <p className="text-[12.5px] text-ink-3">No messages yet — questions from {invite.subName} land here.</p>
        )}
        {invite.thread.length > 0 && (
          <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
            {invite.thread.map((m) => {
              const mine = m.author !== "user";
              return (
                <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  <div
                    className={[
                      "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug",
                      mine ? "bg-accent text-ink" : "bg-paper-3 text-ink",
                    ].join(" ")}
                  >
                    {m.body}
                  </div>
                  <span className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-4">
                    {mine ? (m.author === "ai" ? m.name : "You") : m.name} · {m.when}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <MessageComposer
          pending={pending}
          onSend={(fd, reset) => run(() => sendBidMessageAsOwner(invite.id, fd), reset)}
        />
      </div>
    </ModalShell>
  );
}

function MessageComposer({
  pending,
  onSend,
}: {
  pending: boolean;
  onSend: (fd: FormData, reset: () => void) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <form
      action={(fd) => onSend(fd, () => setDraft(""))}
      className="flex flex-col gap-2"
    >
      <textarea
        name="body"
        required
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Message this sub…"
        className={`${INPUT} resize-none`}
      />
      <button type="submit" disabled={pending} className={`${BTN_SOLID} self-end`}>
        <Send className="size-3" strokeWidth={1.75} />
        Send
      </button>
    </form>
  );
}

// ─── Shared modal chrome (same pattern as SelectionsBoard) ───────────────────

function ModalShell({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? "max-w-[880px]" : "max-w-[520px]"} rounded-lg border border-rule bg-card shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-flag/40 bg-flag-soft px-3 py-2 text-[12px] text-flag">{error}</div>
  );
}

function ModalActions({
  pending,
  onClose,
  submitLabel,
}: {
  pending: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
      >
        Cancel
      </button>
      <button type="submit" disabled={pending} className={BTN_SOLID}>
        <Check className="size-3" strokeWidth={1.75} />
        {submitLabel}
      </button>
    </div>
  );
}
