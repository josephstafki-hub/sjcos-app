"use client";

import { FinancialTable } from "./FinancialTable";
import { ActionMenu } from "./ActionMenu";
import { Fragment, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileEdit, Plus, X, Sparkles } from "lucide-react";
import { Button, Card, TableWrapper, TableHead, TableBody, TableHeader, TableRow, TableCell, TablePrimaryCell, TableGroupRow } from "@/components/ui";
import { fmtUsd } from "@/lib/cost-book-units";
import { CO_STATUS_LABEL, type ChangeOrderView } from "@/lib/co-types";
import { WHERE, type ScopeChangeContext } from "@/lib/estimate-kinds";
import { createChangeOrder, draftChangeOrder, sendChangeOrder, deleteChangeOrder } from "@/lib/actions/change-orders";
import { runAction } from "@/lib/run-action";
import { TabLink } from "./TabNav";


/** Money tab · "Change orders" section. Draft a CO (optional AI scope draft),
 *  send it for the client to e-sign in the portal, track its status.
 *
 *  A change order is a change to a SIGNED contract. Until the job is under
 *  contract (`phase.path !== "change_order"`) the "New" button gives way to a
 *  pointer at Money › Pre-con changes, where a client addition or change is
 *  priced as a pre-con change estimate — docs/estimates-and-change-orders.md. */
export function ChangeOrders({ slug, orders, phase }: { slug: string; orders: ChangeOrderView[]; phase: ScopeChangeContext }) {
  const router = useRouter();
  const canCreate = phase.path === "change_order";
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [drafting, startDraft] = useTransition();

  function reset() {
    setTitle("");
    setDescription("");
    setPrice("");
    setError(null);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("title", title);
    fd.set("description", description);
    fd.set("price", price);
    setError(null);
    startTransition(async () => {
      const res = await runAction(() => createChangeOrder(slug, fd), { fallback: "Couldn't save the change order." });
      if (res.ok) {
        reset();
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function aiDraft() {
    if (!title.trim()) {
      setError("Add a title first so the draft has context.");
      return;
    }
    setError(null);
    startDraft(async () => {
      const text = await draftChangeOrder(slug, title, description);
      if (text) setDescription(text);
    });
  }

  function send(id: number) {
    startTransition(async () => {
      const res = await runAction(() => sendChangeOrder(slug, id), { fallback: "Couldn't send the change order." });
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function remove(id: number) {
    startTransition(async () => {
      await runAction(() => deleteChangeOrder(slug, id), { fallback: "Couldn't delete the change order." });
      router.refresh();
    });
  }

  const inputCls =
    "w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-body text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

  return (
    <div className="max-w-[760px] space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-label font-medium text-ink-3">
          {orders.length} change order{orders.length === 1 ? "" : "s"} ·{" "}
          {orders.filter((o) => o.status === "sent").length} awaiting signature
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-label font-semibold text-paper hover:bg-ink-hover"
          >
            {open ? <X className="size-3" strokeWidth={2} /> : <Plus className="size-3" strokeWidth={2} />}
            {open ? "Cancel" : "New change order"}
          </button>
        )}
      </div>

      {!canCreate && (
        <Card className="border-rule-soft bg-card p-3.5">
          <div className="text-label font-medium text-accent-2">
            Pre-construction · {phase.statusLabel}
          </div>
          <div className="mt-1 text-label text-ink-2">
            Change orders start once the contract is signed. Until then a client addition or change is priced as a
            pre-con change estimate under{" "}
            <TabLink tab="Money" section="Pre-con changes" className="font-semibold text-accent-2 underline-offset-2 hover:underline">
              {WHERE.preconChanges}
            </TabLink>
            .
          </div>
        </Card>
      )}

      {open && canCreate && (
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-meta font-semibold text-ink-2">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Add recessed lighting to living room"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-meta font-semibold text-ink-2">
                Scope description
                <button
                  type="button"
                  onClick={aiDraft}
                  disabled={drafting}
                  className="inline-flex items-center gap-1 rounded border border-ai px-1.5 py-0.5 text-meta font-semibold text-ai-2 hover:bg-ai-soft disabled:opacity-60"
                >
                  <Sparkles className="size-2.5" strokeWidth={1.75} />
                  {drafting ? "Drafting…" : "Draft with AI"}
                </button>
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe the added or changed work…"
                className={`${inputCls} resize-y`}
              />
            </label>
            <label className="block max-w-[220px]">
              <span className="mb-1 block text-meta font-semibold text-ink-2">Amount (USD)</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="numeric"
                placeholder="$2,500"
                className={inputCls}
              />
            </label>
            {error && <div className="text-label text-flag">{error}</div>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-accent bg-accent px-3 py-1.5 text-label font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save draft"}
              </button>
              <span className="text-meta text-ink-3">Save it, then send it for the client to e-sign.</span>
            </div>
          </form>
        </Card>
      )}

      {error && !open && <div className="text-label text-flag">{error}</div>}

      {orders.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <FileEdit className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
          <div className="mt-2 font-serif text-subheading font-semibold text-ink-2">No change orders yet</div>
          <div className="mt-1 text-label text-ink-3">
            {canCreate
              ? "Draft a change to the signed contract's scope + price and send it to the client to approve and e-sign."
              : "Nothing to do here before the contract is signed."}
          </div>
        </Card>
      ) : (
        <TableWrapper><FinancialTable>
          <TableHead><TableRow><TableHeader>Change order</TableHeader><TableHeader numeric>Amount</TableHeader><TableHeader><span className="sr-only">Actions</span></TableHeader></TableRow></TableHead>
          <TableBody>{(["draft","sent","approved","declined"] as const).map(status => {const group=orders.filter(o => o.status === status);return group.length > 0 && <Fragment key={status}><TableGroupRow colSpan={3} count={group.length}>{CO_STATUS_LABEL[status]}</TableGroupRow>{group.map(o => <TableRow key={o.id}>
            <TablePrimaryCell meta={<>{o.description && <span className="block">{o.description}</span>}Created {o.createdAtLabel}</>}>{o.title}</TablePrimaryCell>
            <TableCell numeric className="whitespace-nowrap">{fmtUsd(o.priceCents)}</TableCell>
            <TableCell>{(status === "draft" || status === "declined") && <ActionMenu label={`More actions for ${o.title}`}><Button variant="ghost" size="sm" disabled={pending} onClick={() => send(o.id)}>Send for signature</Button><Button variant="ghost" className="text-flag" onClick={() => remove(o.id)} disabled={pending}>Delete</Button></ActionMenu>}</TableCell>
          </TableRow>)}</Fragment>})}</TableBody>
          <tfoot><TableRow className="border-t border-rule"><TableCell className="font-semibold">Approved total</TableCell><TableCell numeric className="font-semibold">{fmtUsd(orders.filter(o => o.status === "approved").reduce((sum,o) => sum+o.priceCents,0))}</TableCell><TableCell /></TableRow></tfoot>
        </FinancialTable></TableWrapper>
      )}
    </div>
  );
}
