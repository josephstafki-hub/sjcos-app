"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileEdit, Plus, X, Check, Clock, Ban, Sparkles, Trash2 } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { CO_STATUS_LABEL, CO_STATUS_KIND, type CoStatus, type ChangeOrderView } from "@/lib/co-types";
import { createChangeOrder, draftChangeOrder, sendChangeOrder, deleteChangeOrder } from "@/lib/actions/change-orders";

function StatusIcon({ status }: { status: CoStatus }) {
  if (status === "approved") return <Check className="size-3.5 text-money" strokeWidth={2} />;
  if (status === "declined") return <Ban className="size-3.5 text-ink-3" strokeWidth={1.75} />;
  if (status === "sent") return <Clock className="size-3.5 text-accent" strokeWidth={1.75} />;
  return <FileEdit className="size-3.5 text-ink-3" strokeWidth={1.75} />;
}

/** Owner project "Change orders" tab. Draft a CO (optional Qwen scope draft),
 *  send it for the client to e-sign in the portal, track its status. */
export function ChangeOrders({ slug, orders }: { slug: string; orders: ChangeOrderView[] }) {
  const router = useRouter();
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
      const res = await createChangeOrder(slug, fd);
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
      const res = await sendChangeOrder(slug, id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function remove(id: number) {
    startTransition(async () => {
      await deleteChangeOrder(slug, id);
      router.refresh();
    });
  }

  const inputCls =
    "w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

  return (
    <div className="max-w-[760px] space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          {orders.length} change order{orders.length === 1 ? "" : "s"} ·{" "}
          {orders.filter((o) => o.status === "sent").length} awaiting signature
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          {open ? <X className="size-3" strokeWidth={2} /> : <Plus className="size-3" strokeWidth={2} />}
          {open ? "Cancel" : "New change order"}
        </button>
      </div>

      {open && (
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-2">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Add recessed lighting to living room"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-ink-2">
                Scope description
                <button
                  type="button"
                  onClick={aiDraft}
                  disabled={drafting}
                  className="inline-flex items-center gap-1 rounded border border-ai px-1.5 py-0.5 text-[10px] font-semibold text-ai-2 hover:bg-ai-soft disabled:opacity-60"
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
              <span className="mb-1 block text-[11px] font-semibold text-ink-2">Amount (USD)</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="numeric"
                placeholder="$2,500"
                className={inputCls}
              />
            </label>
            {error && <div className="text-[12px] text-flag">{error}</div>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save draft"}
              </button>
              <span className="text-[11px] text-ink-3">Save it, then send it for the client to e-sign.</span>
            </div>
          </form>
        </Card>
      )}

      {error && !open && <div className="text-[12px] text-flag">{error}</div>}

      {orders.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <FileEdit className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
          <div className="mt-2 font-serif text-[15px] font-semibold text-ink-2">No change orders yet</div>
          <div className="mt-1 text-[12px] text-ink-3">
            Draft a change to the scope + price and send it to the client to approve and e-sign.
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {orders.map((o) => (
            <Card key={o.id} className="p-3.5">
              <div className="flex items-start gap-3">
                <StatusIcon status={o.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-serif text-[15px] font-semibold text-ink">{o.title}</span>
                    <Chip kind={CO_STATUS_KIND[o.status]}>{CO_STATUS_LABEL[o.status]}</Chip>
                    <span className="font-mono text-[12px] font-semibold text-accent-2">{o.priceLabel}</span>
                  </div>
                  {o.description && <p className="mt-1 text-[12px] text-ink-2">{o.description}</p>}
                  <div className="mt-1 text-[11px] text-ink-3">Created {o.createdAtLabel}</div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1.5">
                  {(o.status === "draft" || o.status === "declined") && (
                    <button
                      type="button"
                      onClick={() => send(o.id)}
                      disabled={pending}
                      className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
                    >
                      Send for signature
                    </button>
                  )}
                  {(o.status === "draft" || o.status === "declined") && (
                    <button
                      type="button"
                      onClick={() => remove(o.id)}
                      disabled={pending}
                      aria-label="Delete change order"
                      className="rounded-md border border-rule bg-card px-1.5 py-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-60"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
