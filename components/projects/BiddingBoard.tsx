"use client";

import { ActionMenu } from "./ActionMenu";

// The project Bidding tab (Houzz-Pro-style bid management). The flow reads
// top to bottom the way the work happens:
//
//   1. New bid package  — name the work, tag the trade, set a due date.
//   2. Build the packet — attach plans / takeoffs from the project's files or
//                         upload straight in, and label them for the sub.
//   3. Pick recipients  — the sub roster grouped by trade with one-click
//                         group select; each sub can carry a personal note on
//                         top of the shared scope.
//   4. Send             — EMAILS the packet straight to each sub (scope +
//                         per-sub note in the body, files attached). Bids are
//                         email only; nothing touches the sub portal.
//   5. Record + compare — replies land in Joe's inbox; he records each number
//                         here ("Record bid"), they line up side by side with
//                         the low number flagged, and awarding one closes the
//                         package.
//
// Packages group by trade on the board and the recipient picker sorts by
// trade, so "send the framing packet to my framing subs" is two clicks.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAction } from "@/lib/run-action";
import {
  BadgeDollarSign,
  Check,
  FileText,
  Hammer,
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
import { Button, Card, Chip, EmptyState, Eyebrow, type ChipKind } from "@/components/ui";
import type { BiddingView, BidPackage, BidInvite, BidInviteStatus } from "@/lib/bidding";
import type { ProjectFile } from "@/lib/projects";

/** One sub in the recipient picker — the full roster, keyed by trade. */
interface RosterSub {
  slug: string;
  name: string;
  trade: string;
  email?: string | null;
}
import {
  addBidInvites,
  attachBidFiles,
  awardBid,
  closeBidPackage,
  createBidPackage,
  declineBidInvite,
  labelBidFile,
  markBidWorking,
  recordBid,
  removeBidFile,
  removeBidInvite,
  removeBidPackage,
  sendBidPackage,
  setBidFollowUps,
  updateBidInviteMessage,
  updateBidPackage,
  uploadBidFile,
} from "@/lib/actions/bidding";
import { useRemoved } from "@/lib/use-removed";

type Result = { ok: boolean; error?: string };

/** "$12,500.50" → 1250050; mirrors parseCents in the action for the optimistic row. */
const centsOf = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

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
  working: { kind: "accent", label: "Working on it" },
  submitted: { kind: "money", label: "Bid in" },
  declined: { kind: "flag", label: "Passed" },
  awarded: { kind: "money", label: "Awarded" },
  not_awarded: { kind: "ghost", label: "Not awarded" },
};

const INPUT =
  "rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent";
const LABEL = "text-label font-medium text-ink-3";
const BTN_GHOST =
  "inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-label font-semibold text-ink-2 hover:bg-paper-2";
const BTN_SOLID =
  "inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover disabled:opacity-50";

type Modal =
  | { kind: "pkg"; pkg: BidPackage | null }
  | { kind: "files"; pkgId: number }
  | { kind: "subs"; pkgId: number }
  | { kind: "note"; inviteId: number; pkgId: number }
  | { kind: "compare"; pkgId: number }
  | { kind: "record"; inviteId: number; pkgId: number }
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
  // Optimistic writes (removes, adding subs) get their own transition whose
  // pending flag is ignored: the board already shows the result, so nothing
  // should grey out while the write + router.refresh() round-trip finishes.
  const [, startOptimistic] = useTransition();
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  // Optimistically-added invites per package: placeholder rows (negative ids)
  // that show the moment "Add subs" is clicked and fall away once the refetch
  // carries the real row for that sub (see `packages` below).
  const [added, setAdded] = useState<Map<number, BidInvite[]>>(new Map());
  // Optimistically-answered invites (bid recorded / passed): the row flips to
  // its new status + amount on submit and the override falls away once the
  // refetched row matches it.
  const [answered, setAnswered] = useState<Map<number, BidInvite>>(new Map());
  const [tradeFilter, setTradeFilter] = useState<string | null>(null);

  const { removed, hide, restore } = useRemoved();

  // Single path for every mutation (same contract as SelectionsBoard): the
  // project page is cookie-dynamic, so router.refresh() is what repaints.
  // runAction raises the site-wide toast on failure (and never throws); the
  // local `error` state stays only so the open modal can show the message
  // inline next to its fields.
  function run(
    fn: () => Promise<Result>,
    onSuccess?: () => void,
    fallback = "Something went wrong.",
    onError?: () => void,
    start = startTransition,
  ) {
    setError("");
    start(async () => {
      const r = await runAction(fn, { fallback });
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
    run(fn, undefined, undefined, () => restore(key), startOptimistic);
  }

  /** Add subs optimistically: placeholder rows land now, the modal closes now,
   *  and the placeholders are pulled (with the error shown) only if the write
   *  fails. */
  function addSubs(pkgId: number, subs: RosterSub[]) {
    close();
    const placeholders: BidInvite[] = subs.map((s, i) => ({
      id: -(pkgId * 1000 + i + 1),
      subSlug: s.slug,
      subName: s.name,
      subTrade: s.trade,
      subEmail: s.email ?? null,
      message: "",
      status: "draft",
      sentLabel: "",
      respondedLabel: "",
      autoLabel: "",
      submission: null,
    }));
    setAdded((cur) => new Map(cur).set(pkgId, [...(cur.get(pkgId) ?? []), ...placeholders]));
    const fd = new FormData();
    for (const s of subs) fd.append("subSlug", s.slug);
    const drop = () =>
      setAdded((cur) => {
        const slugs = new Set(subs.map((s) => s.slug));
        return new Map(cur).set(pkgId, (cur.get(pkgId) ?? []).filter((i) => !slugs.has(i.subSlug)));
      });
    run(() => addBidInvites(pkgId, fd), undefined, undefined, drop, startOptimistic);
  }

  /** Answer an invite optimistically (bid in / passed): the row updates now,
   *  the modal closes now, and the override is pulled with the error shown if
   *  the write fails. */
  function answerInvite(next: BidInvite, fn: () => Promise<Result>) {
    setAnswered((cur) => new Map(cur).set(next.id, next));
    const drop = () =>
      setAnswered((cur) => {
        const m = new Map(cur);
        m.delete(next.id);
        return m;
      });
    run(fn, undefined, undefined, drop, startOptimistic);
  }

  function recordLocal(invite: BidInvite, fd: FormData) {
    const descs = fd.getAll("lineDesc").map((v) => String(v).trim());
    const amounts = fd.getAll("lineAmount").map(centsOf);
    const lines = descs
      .map((description, i) => ({ description, amount: amounts[i] ?? 0 }))
      .filter((l) => l.description || l.amount > 0);
    const total = centsOf(fd.get("total")) || lines.reduce((s, l) => s + l.amount, 0);
    answerInvite(
      {
        ...invite,
        status: "submitted",
        respondedLabel: "just now",
        submission: {
          id: -invite.id,
          total,
          notes: String(fd.get("notes") ?? ""),
          exclusions: String(fd.get("exclusions") ?? ""),
          leadTime: String(fd.get("leadTime") ?? ""),
          revision: (invite.submission?.revision ?? 0) + 1,
          whenLabel: "just now",
          lines,
          files: [],
        },
      },
      () => recordBid(invite.id, fd),
    );
  }

  const close = () => {
    setModal(null);
    setError("");
  };

  // Optimistically-removed packages/invites/files drop out of the render the
  // moment their delete is clicked; the refetch confirms a beat later.
  const packages =
    removed.size === 0 && added.size === 0 && answered.size === 0
      ? view.packages
      : view.packages
          .filter((p) => !removed.has(`pkg:${p.id}`))
          .map((p) => {
            const real = p.invites.filter((i) => !removed.has(`invite:${i.id}`));
            const have = new Set(real.map((i) => i.subSlug));
            // A placeholder survives only until the server row for that sub
            // arrives, so there's never a duplicate and nothing to clean up.
            const ghosts = (added.get(p.id) ?? []).filter((i) => !have.has(i.subSlug));
            // Same idea for answered rows: the override wins only until the
            // server row reports the same status and amount.
            const settled = real.map((i) => {
              const o = answered.get(i.id);
              return o &&
                (o.status !== i.status ||
                  (o.submission?.total ?? null) !== (i.submission?.total ?? null))
                ? o
                : i;
            });
            return {
              ...p,
              invites: [...settled, ...ghosts],
              files: p.files.filter((f) => !removed.has(`file:${f.id}`)),
            };
          });

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
    <div className="flex max-w-[880px] flex-col gap-4 max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11">
      <div className="flex flex-col items-start gap-3 @3xl/page:flex-row">
        <div className="min-w-0 basis-full @3xl/page:basis-auto flex-1">
          <h3 className="font-serif text-heading font-semibold text-ink">Bidding</h3>
          <p className="mt-0.5 text-label text-ink-3">
            {packages.length > 0
              ? "Packets emailed to subs, grouped by trade. Record the numbers that come back and compare side by side."
              : "Email plans and takeoffs to a group of subs and collect their numbers in one place."}
          </p>
        </div>
        <Button onClick={() => setModal({ kind: "pkg", pkg: null })}>
          <Plus className="size-3" strokeWidth={2} />
          New bid package
        </Button>
      </div>

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
        <EmptyState compact icon={Users} title="No bid packages yet" description="Start a package for a trade, attach the plans, and choose the subs who will price the work." />
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
              onRecord={(inviteId) => setModal({ kind: "record", inviteId, pkgId: pkg.id })}
              onCompare={() => setModal({ kind: "compare", pkgId: pkg.id })}
              onSend={() => run(() => sendBidPackage(pkg.id))}
              onWorking={(inviteId) => run(() => markBidWorking(inviteId))}
              onToggleFollowUps={() => run(() => setBidFollowUps(pkg.id, !pkg.followUps))}
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
          onAdd={(subs) => addSubs(modal.pkgId, subs)}
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
        />
      )}
      {modal?.kind === "record" && inviteById(modal.pkgId, modal.inviteId) && (
        <RecordBidModal
          invite={inviteById(modal.pkgId, modal.inviteId)!}
          onRecord={(fd) => recordLocal(inviteById(modal.pkgId, modal.inviteId)!, fd)}
          onDecline={(fd) => {
            const inv = inviteById(modal.pkgId, modal.inviteId)!;
            answerInvite({ ...inv, status: "declined", respondedLabel: "just now" }, () =>
              declineBidInvite(inv.id, fd),
            );
          }}
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
  onRecord,
  onCompare,
  onSend,
  onWorking,
  onToggleFollowUps,
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
  onRecord: (inviteId: number) => void;
  onCompare: () => void;
  onSend: () => void;
  onWorking: (inviteId: number) => void;
  onToggleFollowUps: () => void;
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
        <h4 className="text-subheading font-semibold text-ink">{pkg.title}</h4>
        {pkg.trade && <Chip kind="accent">{pkg.trade}</Chip>}
        <Chip kind={chip.kind} dot>
          {chip.label}
        </Chip>
        {pkg.dueLabel && <span className="tabular-nums text-meta text-ink-3">bids due {pkg.dueLabel}</span>}
        <div className="flex-1" />
        {pkg.lowTotal !== null && (
          <span className="tabular-nums text-label text-money">low {usd(pkg.lowTotal)}</span>
        )}
        <Button variant="ghost" iconOnly icon={Pencil} aria-label={`Edit ${pkg.title}`} title="Edit package" onClick={onEdit} />
        {pkg.status === "draft" && <ActionMenu label={`More actions for ${pkg.title}`}><Button variant="ghost" className="text-flag" onClick={onRemove}>Delete package</Button></ActionMenu>}
      </div>
      {pkg.scopeNotes && (
        <p className="mt-1.5 whitespace-pre-line text-body leading-snug text-ink-2">{pkg.scopeNotes}</p>
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
              className="max-w-[220px] truncate text-meta text-ink-2 hover:text-ink"
              title={f.name}
            >
              {f.label || f.name}
            </a>
            <span className="tabular-nums text-meta text-ink-3">{f.sizeLabel}</span>
            {live && (
              <button
                className="text-ink-3 hover:text-flag"
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
          <span className="text-meta text-ink-3">No packet files.</span>
        )}
      </div>

      {/* Recipients */}
      <div className="mt-3 border-t border-rule-soft pt-2.5">
        {pkg.invites.length === 0 ? (
          <div className="flex items-center gap-2 text-body text-ink-3">
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
                  className={`flex flex-wrap items-center gap-2 py-3 ${idx ? "border-t border-rule-soft" : ""}`}
                >
                  <span className="w-full min-w-0 break-words text-subheading font-semibold text-ink @3xl/page:w-auto @3xl/page:flex-1">
                    {inv.subName}
                    {inv.message && (
                      <span className="ml-1.5 text-meta italic text-ink-3" title={inv.message}>
                        + note
                      </span>
                    )}
                  </span>
                  {inv.status === "draft" && !inv.subEmail && (
                    <Chip kind="flag">No email</Chip>
                  )}
                  <Chip kind="ghost">{inv.subTrade || "—"}</Chip>
                  {inv.autoLabel && (
                    <span className="tabular-nums text-meta text-ink-3" title="Auto follow-up email">
                      {inv.autoLabel}
                    </span>
                  )}
                  <Chip kind={ic.kind} dot>
                    {ic.label}
                  </Chip>
                  <span className="w-[76px] text-right tabular-nums text-label text-ink-2">
                    {inv.submission ? usd(inv.submission.total) : "—"}
                  </span>
                  {inv.id < 0 ? (
                    <span className="tabular-nums text-meta text-ink-3">saving…</span>
                  ) : (
                    <>
                  <button
                    className="text-ink-3 hover:text-ink"
                    title="Personal note for this sub"
                    onClick={() => onNote(inv.id)}
                  >
                    <Pencil className="size-3.5" strokeWidth={1.5} />
                  </button>
                  <button
                    className={
                      ["sent", "viewed"].includes(inv.status)
                        ? "text-ink-3 hover:text-accent"
                        : "text-ink-3"
                    }
                    title={
                      ["sent", "viewed"].includes(inv.status)
                        ? "They replied they're working on it — switches to the softer follow-up"
                        : inv.status === "working"
                          ? "Marked working on it"
                          : "Mark working applies to a sent, unanswered invite"
                    }
                    onClick={() => ["sent", "viewed"].includes(inv.status) && onWorking(inv.id)}
                  >
                    <Hammer className="size-3.5" strokeWidth={1.5} />
                  </button>
                  <button
                    className={inv.status === "draft" ? "text-ink-3" : "text-ink-3 hover:text-money"}
                    title={
                      inv.status === "draft"
                        ? "Record a bid once the request is emailed"
                        : "Record the bid from their email reply (or mark them passed)"
                    }
                    onClick={() => inv.status !== "draft" && onRecord(inv.id)}
                  >
                    <BadgeDollarSign className="size-3.5" strokeWidth={1.5} />
                  </button>
                  {inv.status === "draft" ? (
                    <button
                      className="text-ink-3 hover:text-flag"
                      title="Remove from this bid"
                      onClick={() => onRemoveInvite(inv.id)}
                    >
                      <X className="size-3.5" strokeWidth={1.75} />
                    </button>
                  ) : (
                    <span className="w-[14px]" />
                  )}
                    </>
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
              ? `Email to ${draftInvites} sub${draftInvites === 1 ? "" : "s"}`
              : `Email ${draftInvites} more`}
          </button>
        )}
        {pkg.submittedCount > 0 && (
          <button className={BTN_GHOST} onClick={onCompare}>
            <Scale className="size-3" strokeWidth={1.75} />
            Compare bids ({pkg.submittedCount})
          </button>
        )}
        {winner && (
          <span className="inline-flex items-center gap-1 text-label font-semibold text-money">
            <Trophy className="size-3.5" strokeWidth={1.75} />
            {winner.subName} · {winner.submission ? usd(winner.submission.total) : ""}
          </span>
        )}
        <div className="flex-1" />
        {live && (
          <button
            className="text-meta text-ink-3 underline-offset-2 hover:underline"
            title="Auto emails while the package is open: nudge subs who haven't answered (day 2 & 5), check in on subs working on it (day 4), and thank each sub when their bid is recorded"
            onClick={onToggleFollowUps}
          >
            Auto follow-up: {pkg.followUps ? "on" : "off"}
          </button>
        )}
        {pkg.status === "open" && (
          <button className="text-meta text-ink-3 underline-offset-2 hover:underline" onClick={onClose}>
            Close without awarding
          </button>
        )}
        {pkg.status === "open" && pkg.sentLabel && (
          <span className="tabular-nums text-meta text-ink-3">sent {pkg.sentLabel}</span>
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
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{f.name}</span>
                  <span className="tabular-nums text-meta text-ink-3">{f.sizeLabel}</span>
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
            className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-label text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-meta file:text-ink-2"
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
                <span className="min-w-0 max-w-[200px] flex-none truncate text-label text-ink-2" title={f.name}>
                  {f.name}
                </span>
                <input name="label" defaultValue={f.label} placeholder="Label…" className={`${INPUT} min-w-0 flex-1 py-1 text-label`} />
                <button type="submit" disabled={pending} className="text-ink-3 hover:text-ink" title="Save label">
                  <Check className="size-3.5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="text-ink-3 hover:text-flag"
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
  onAdd,
  onClose,
}: {
  pkg: BidPackage;
  roster: RosterSub[];
  onAdd: (subs: RosterSub[]) => void;
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
        onSubmit={(e) => {
          // Optimistic: the parent shows placeholder rows and closes this
          // modal right away; an error surfaces on the board if the write fails.
          e.preventDefault();
          onAdd(roster.filter((s) => picked.has(s.slug)));
        }}
        className="flex flex-col gap-3 p-4"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search subs or trades…"
          className={INPUT}
        />
        <div className="flex max-h-[300px] flex-col gap-2.5 overflow-y-auto">
          {candidates.length === 0 && (
            <div className="py-4 text-center text-body text-ink-3">
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
                    className="text-meta font-semibold text-accent-2 underline-offset-2 hover:underline"
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
                      <span className="flex-1 text-body text-ink">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {invited.size > 0 && (
          <p className="text-meta text-ink-3">
            Already on this bid: {pkg.invites.map((i) => i.subName).join(", ")}
          </p>
        )}
        <ModalActions
          pending={picked.size === 0}
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
        <p className="text-label text-ink-3">
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
}: {
  pkg: BidPackage;
  pending: boolean;
  error: string;
  run: RunFn;
  onClose: () => void;
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
        {bids.length === 0 && <p className="text-body text-ink-3">No bids in yet.</p>}
        <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${Math.max(bids.length, 1)}, minmax(220px, 1fr))` }}>
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
                  <span className="min-w-0 flex-1 break-words text-subheading font-semibold text-ink">
                    {inv.subName}
                  </span>
                  {isWinner && <Chip kind="money" dot>Awarded</Chip>}
                  {!isWinner && isLow && <Chip kind="accent">Low bid</Chip>}
                </div>
                <div className="tabular-nums text-title text-ink">{usd(s.total)}</div>
                <div className="text-label font-medium text-ink-3">
                  rev {s.revision} · {s.whenLabel}
                  {s.leadTime ? ` · lead ${s.leadTime}` : ""}
                </div>

                {s.lines.length > 0 && (
                  <div className="border-t border-rule-soft pt-1.5">
                    {s.lines.map((l, i) => (
                      <div key={i} className="flex items-baseline gap-2 py-0.5">
                        <span className="min-w-0 flex-1 truncate text-label text-ink-2" title={l.description}>
                          {l.description}
                        </span>
                        <span className="tabular-nums text-meta text-ink-3">{l.amount ? usd(l.amount) : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
                {s.exclusions && (
                  <div className="border-t border-rule-soft pt-1.5">
                    <Eyebrow muted>Excludes</Eyebrow>
                    <p className="mt-0.5 whitespace-pre-line text-label leading-snug text-flag">{s.exclusions}</p>
                  </div>
                )}
                {s.notes && (
                  <p className="whitespace-pre-line border-t border-rule-soft pt-1.5 text-label leading-snug text-ink-2">
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
                        className="inline-flex items-center gap-1.5 text-label text-ink-2 hover:text-ink"
                      >
                        <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                        <span className="truncate">{f.name}</span>
                      </a>
                    ))}
                  </div>
                )}

                {canAward && (
                  <div className="mt-auto flex items-center gap-2 border-t border-rule-soft pt-2">
                    <button
                      disabled={pending}
                      onClick={() => run(() => awardBid(inv.id))}
                      className={`${BTN_SOLID} flex-1 justify-center`}
                    >
                      <Trophy className="size-3" strokeWidth={1.75} />
                      Award
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}

/** Transcribe a bid that came back by email (or mark the sub as passed).
 *  Same fields the compare cards show: total or line items, exclusions, lead
 *  time, notes, plus the sub's emailed quote as an attachment. Recording again
 *  files a new revision. */
function RecordBidModal({
  invite,
  onRecord,
  onDecline,
  onClose,
}: {
  invite: BidInvite;
  /** Both close the modal themselves — the board updates optimistically. */
  onRecord: (fd: FormData) => void;
  onDecline: (fd: FormData) => void;
  onClose: () => void;
}) {
  const [lineCount, setLineCount] = useState(0);
  const [declining, setDeclining] = useState(false);
  const answered = ["declined", "awarded", "not_awarded"].includes(invite.status);

  if (declining) {
    return (
      <ModalShell title={`${invite.subName} passed`} onClose={onClose}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onDecline(new FormData(e.currentTarget));
            onClose();
          }}
          className="flex flex-col gap-3 p-4"
        >
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Why they passed (optional)</span>
            <input name="reason" placeholder="Booked through fall, too far out…" className={INPUT} />
          </label>
          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-3 hover:bg-paper-2"
            >
              Back
            </button>
            <button type="submit" className={BTN_SOLID}>
              <Check className="size-3" strokeWidth={1.75} />
              Mark declined
            </button>
          </div>
        </form>
      </ModalShell>
    );
  }

  return (
    <ModalShell title={`Record bid · ${invite.subName}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRecord(new FormData(e.currentTarget));
          onClose();
        }}
        className="flex flex-col gap-3 p-4"
      >
        <p className="text-label text-ink-3">
          Type in what {invite.subName} sent back by email
          {invite.submission ? " — this files a new revision over their last number" : ""}.
        </p>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Bid total</span>
          <input
            name="total"
            inputMode="decimal"
            defaultValue={invite.submission ? (invite.submission.total / 100).toString() : ""}
            placeholder="18,500"
            className={INPUT}
          />
        </label>
        {lineCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Line items (total can be left blank if these add up)</span>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="flex gap-2">
                <input name="lineDesc" placeholder="Rough-in" className={`${INPUT} flex-1`} />
                <input name="lineAmount" inputMode="decimal" placeholder="$" className={`${INPUT} w-[110px]`} />
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setLineCount((n) => n + 1)}
          className="self-start text-meta font-semibold text-accent-2 underline-offset-2 hover:underline"
        >
          + line item
        </button>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={LABEL}>Lead time</span>
            <input name="leadTime" placeholder="3 weeks out" className={INPUT} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Exclusions</span>
          <textarea name="exclusions" rows={2} placeholder="Fixtures, service upgrade…" className={`${INPUT} resize-y`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Notes</span>
          <textarea name="notes" rows={2} placeholder="Anything else from their reply…" className={`${INPUT} resize-y`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Their quote / attachments (optional)</span>
          <input
            name="files"
            type="file"
            multiple
            className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-label text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-meta file:text-ink-2"
          />
        </label>
        <div className="mt-1 flex items-center gap-2">
          {!answered && (
            <button
              type="button"
              onClick={() => setDeclining(true)}
              className="text-meta text-ink-3 underline-offset-2 hover:underline"
            >
              Mark declined…
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-3 hover:bg-paper-2"
          >
            Cancel
          </button>
          <button type="submit" className={BTN_SOLID}>
            <BadgeDollarSign className="size-3" strokeWidth={1.75} />
            {invite.submission ? "Record revision" : "Record bid"}
          </button>
        </div>
      </form>
    </ModalShell>
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
        className={`w-full ${wide ? "max-w-[880px]" : "max-w-[520px]"} rounded-lg border border-rule bg-card shadow-modal`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-heading font-semibold text-ink">{title}</h2>
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
    <div className="rounded-md border border-flag/40 bg-flag-soft px-3 py-2 text-label text-flag">{error}</div>
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
        className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-3 hover:bg-paper-2"
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
