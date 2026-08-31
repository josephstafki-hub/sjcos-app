"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, X, Pencil, Trash2, ChevronLeft, Send, PackageCheck, Ban, CheckCircle2 } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { PO_STATUS_LABEL, PO_STATUS_KIND, poDollarsToCents, type PoStatus, type PurchaseOrderView, type VendorOption, type AssignedSubOption, type PoVendorKind } from "@/lib/po-types";
import { fmtUsd } from "@/lib/cost-book-units";
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  addPOLine,
  updatePOLine,
  deletePOLine,
  recordReceipt,
  queuePurchaseOrder,
  sendPurchaseOrder,
  closePurchaseOrder,
  voidPurchaseOrder,
  deletePurchaseOrder,
} from "@/lib/actions/purchase-orders";
import { createVendorInline } from "@/lib/actions/vendors";

const inputCls =
  "w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

function StatusIcon({ status }: { status: PoStatus }) {
  if (status === "fulfilled" || status === "closed") return <CheckCircle2 className="size-3.5 text-money" strokeWidth={1.75} />;
  if (status === "void") return <Ban className="size-3.5 text-ink-3" strokeWidth={1.75} />;
  if (status === "partial") return <PackageCheck className="size-3.5 text-accent" strokeWidth={1.75} />;
  if (status === "sent" || status === "queued") return <Send className="size-3.5 text-accent" strokeWidth={1.75} />;
  return <ClipboardList className="size-3.5 text-ink-3" strokeWidth={1.75} />;
}

interface VendorFields {
  vendorKind: PoVendorKind;
  vendorId: string;
  subSlug: string;
  vendorName: string;
  vendorEmail: string;
  vendorPhone: string;
}

const EMPTY_VENDOR: VendorFields = { vendorKind: "one_off", vendorId: "", subSlug: "", vendorName: "", vendorEmail: "", vendorPhone: "" };

/** Tri-mode vendor select: a saved vendor, an assigned sub, or a one-off entry
 *  typed once. Shared by the new-PO form and the header editor. */
function VendorPicker({
  value,
  onChange,
  vendors,
  assignedSubs,
  saveAsVendor,
  onSaveAsVendorChange,
}: {
  value: VendorFields;
  onChange: (v: VendorFields) => void;
  vendors: VendorOption[];
  assignedSubs: AssignedSubOption[];
  saveAsVendor: boolean;
  onSaveAsVendorChange: (v: boolean) => void;
}) {
  const kindBtn = (kind: PoVendorKind, label: string) => (
    <button
      type="button"
      onClick={() => onChange({ ...EMPTY_VENDOR, vendorKind: kind })}
      className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
        value.vendorKind === kind ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink-2 hover:bg-paper-2"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {kindBtn("vendor", "Saved vendor")}
        {kindBtn("sub", "Assigned sub")}
        {kindBtn("one_off", "One-off")}
      </div>

      {value.vendorKind === "vendor" && (
        <select
          value={value.vendorId}
          onChange={(e) => {
            const v = vendors.find((x) => x.id === e.target.value);
            onChange({ ...value, vendorId: e.target.value, vendorName: v?.name ?? "", vendorEmail: v?.email ?? "", vendorPhone: v?.phone ?? "" });
          }}
          className={inputCls}
        >
          <option value="">Select a vendor…</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}{v.trade ? ` · ${v.trade}` : ""}
            </option>
          ))}
        </select>
      )}

      {value.vendorKind === "sub" && (
        <select
          value={value.subSlug}
          onChange={(e) => {
            const s = assignedSubs.find((x) => x.slug === e.target.value);
            onChange({ ...value, subSlug: e.target.value, vendorName: s?.name ?? "", vendorEmail: s?.email ?? "", vendorPhone: s?.phone ?? "" });
          }}
          className={inputCls}
        >
          <option value="">Select an assigned sub…</option>
          {assignedSubs.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}{s.trade ? ` · ${s.trade}` : ""}
            </option>
          ))}
        </select>
      )}

      {value.vendorKind === "one_off" && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <input
            placeholder="Vendor name"
            value={value.vendorName}
            onChange={(e) => onChange({ ...value, vendorName: e.target.value })}
            className={inputCls}
          />
          <input
            placeholder="Email"
            value={value.vendorEmail}
            onChange={(e) => onChange({ ...value, vendorEmail: e.target.value })}
            className={inputCls}
          />
          <input
            placeholder="Phone"
            value={value.vendorPhone}
            onChange={(e) => onChange({ ...value, vendorPhone: e.target.value })}
            className={inputCls}
          />
        </div>
      )}
      {value.vendorKind === "one_off" && (
        <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <input type="checkbox" checked={saveAsVendor} onChange={(e) => onSaveAsVendorChange(e.target.checked)} className="accent-accent" />
          Save as a vendor for next time
        </label>
      )}
    </div>
  );
}

export function PurchaseOrders({
  slug,
  orders,
  vendors,
  assignedSubs,
}: {
  slug: string;
  orders: PurchaseOrderView[];
  vendors: VendorOption[];
  assignedSubs: AssignedSubOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-PO form state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [vendorFields, setVendorFields] = useState<VendorFields>(EMPTY_VENDOR);
  const [saveAsVendor, setSaveAsVendor] = useState(false);

  // Line add/edit modal
  const [lineModal, setLineModal] = useState<{ mode: "add" | "edit"; lineId?: number; description: string; unit: string; qty: string; unitCost: string } | null>(null);

  const selected = editingId != null ? orders.find((o) => o.id === editingId) ?? null : null;

  function reset() {
    setTitle("");
    setNotes("");
    setVendorFields(EMPTY_VENDOR);
    setSaveAsVendor(false);
    setError(null);
  }

  function submitNew(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      let vf = vendorFields;
      if (vf.vendorKind === "one_off" && saveAsVendor && vf.vendorName.trim()) {
        const vres = await createVendorInline({ name: vf.vendorName, email: vf.vendorEmail, phone: vf.vendorPhone });
        if (vres.ok && vres.id) vf = { ...vf, vendorKind: "vendor", vendorId: vres.id };
      }
      const fd = new FormData();
      fd.set("title", title);
      fd.set("notes", notes);
      fd.set("vendorKind", vf.vendorKind);
      fd.set("vendorId", vf.vendorId);
      fd.set("subSlug", vf.subSlug);
      fd.set("vendorName", vf.vendorName);
      fd.set("vendorEmail", vf.vendorEmail);
      fd.set("vendorPhone", vf.vendorPhone);
      const res = await createPurchaseOrder(slug, fd);
      if (res.ok && res.id) {
        setEditingId(res.id);
        setShowNew(false);
        reset();
        router.refresh();
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  function remove(id: number) {
    if (!confirm("Delete this purchase order and all its lines?")) return;
    startTransition(async () => {
      await deletePurchaseOrder(slug, id);
      setEditingId(null);
      router.refresh();
    });
  }

  function queue(id: number) {
    startTransition(async () => {
      const res = await queuePurchaseOrder(slug, id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function send(id: number) {
    startTransition(async () => {
      const res = await sendPurchaseOrder(slug, id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function close(id: number) {
    startTransition(async () => {
      const res = await closePurchaseOrder(slug, id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function voidPo(id: number) {
    if (!confirm("Cancel this purchase order?")) return;
    startTransition(async () => {
      const res = await voidPurchaseOrder(slug, id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function removeLine(lineId: number) {
    startTransition(async () => {
      await deletePOLine(lineId, slug);
      router.refresh();
    });
  }

  function receive(lineId: number, qty: number) {
    startTransition(async () => {
      const res = await recordReceipt(lineId, slug, qty);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function submitLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lineModal || !selected) return;
    const fd = new FormData();
    fd.set("description", lineModal.description);
    fd.set("unit", lineModal.unit);
    fd.set("qtyOrdered", lineModal.qty);
    fd.set("unitCost", lineModal.unitCost);
    startTransition(async () => {
      const res = lineModal.mode === "add" ? await addPOLine(selected.id, slug, fd) : await updatePOLine(lineModal.lineId!, slug, fd);
      if (res.ok) {
        setLineModal(null);
        router.refresh();
      }
    });
  }

  const editable = selected ? selected.status === "draft" || selected.status === "queued" : false;

  return (
    <div className="max-w-[860px] space-y-4">
      {!selected && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-serif text-[17px] font-semibold text-ink">Purchase orders</h3>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                {orders.length} PO{orders.length === 1 ? "" : "s"} ·{" "}
                {orders.filter((o) => o.status === "sent" || o.status === "partial").length} outstanding
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setShowNew((v) => !v); reset(); }}
              className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
            >
              {showNew ? <X className="size-3" strokeWidth={2} /> : <Plus className="size-3" strokeWidth={2} />}
              {showNew ? "Cancel" : "New purchase order"}
            </button>
          </div>

          {showNew && (
            <Card className="p-4">
              <form onSubmit={submitNew} className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-ink-2">Title</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    placeholder="e.g. Framing lumber package"
                    className={inputCls}
                  />
                </label>
                <div>
                  <span className="mb-1 block text-[11px] font-semibold text-ink-2">Vendor</span>
                  <VendorPicker
                    value={vendorFields}
                    onChange={setVendorFields}
                    vendors={vendors}
                    assignedSubs={assignedSubs}
                    saveAsVendor={saveAsVendor}
                    onSaveAsVendorChange={setSaveAsVendor}
                  />
                </div>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-ink-2">Notes (optional)</span>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-y`} />
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
                  <span className="text-[11px] text-ink-3">Add line items next, then send it to the vendor.</span>
                </div>
              </form>
            </Card>
          )}

          {error && !showNew && <div className="text-[12px] text-flag">{error}</div>}

          {orders.length === 0 ? (
            <Card kind="dashed" className="p-8 text-center">
              <ClipboardList className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
              <div className="mt-2 font-serif text-[15px] font-semibold text-ink-2">No purchase orders yet</div>
              <div className="mt-1 text-[12px] text-ink-3">Draft a PO for materials, then send it to the vendor.</div>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {orders.map((o) => (
                <Card key={o.id} className="p-3.5">
                  <div className="flex items-start gap-3">
                    <StatusIcon status={o.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] text-ink-3">{o.poNumber}</span>
                        <span className="truncate font-serif text-[15px] font-semibold text-ink">{o.title}</span>
                        <Chip kind={PO_STATUS_KIND[o.status]}>{PO_STATUS_LABEL[o.status]}</Chip>
                        <span className="font-mono text-[12px] font-semibold text-accent-2">{o.subtotalLabel}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-ink-3">
                        {o.vendorName} · Created {o.createdAtLabel} · {o.lines.length} line{o.lines.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingId(o.id)}
                        className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2"
                      >
                        Open
                      </button>
                      {(o.status === "draft" || o.status === "queued") && (
                        <button
                          type="button"
                          onClick={() => remove(o.id)}
                          className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2 hover:text-flag"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {selected && (
        <>
          <button
            type="button"
            onClick={() => setEditingId(null)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-3 hover:text-ink"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2} /> All purchase orders
          </button>

          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-3">{selected.poNumber}</span>
                  <h3 className="font-serif text-[18px] font-semibold text-ink">{selected.title}</h3>
                  <Chip kind={PO_STATUS_KIND[selected.status]}>{PO_STATUS_LABEL[selected.status]}</Chip>
                </div>
                <div className="mt-0.5 text-[11px] text-ink-3">
                  {selected.vendorName}
                  {selected.vendorEmail ? ` · ${selected.vendorEmail}` : ""}
                  {selected.vendorPhone ? ` · ${selected.vendorPhone}` : ""}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-3">
                  Created {selected.createdAtLabel}
                  {selected.sentAtLabel ? ` · Sent ${selected.sentAtLabel}` : ""}
                </div>
                {selected.notes && <div className="mt-1.5 text-[12px] text-ink-2">{selected.notes}</div>}
              </div>
              <div className="text-right">
                <div className="font-mono text-[22px] font-semibold text-accent-2">{selected.subtotalLabel}</div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {editable && (
                <button
                  onClick={() => setLineModal({ mode: "add", description: "", unit: "ea", qty: "", unitCost: "" })}
                  className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
                >
                  <Plus className="size-3" strokeWidth={2} /> Add line
                </button>
              )}
              {selected.status === "draft" && (
                <button
                  onClick={() => queue(selected.id)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
                >
                  Mark ready to send
                </button>
              )}
              {(selected.status === "draft" || selected.status === "queued") && (
                <button
                  onClick={() => send(selected.id)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
                >
                  <Send className="size-3" strokeWidth={1.75} /> Send to vendor
                </button>
              )}
              {["sent", "partial", "fulfilled"].includes(selected.status) && (
                <button
                  onClick={() => close(selected.id)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-money/40 bg-money/10 px-2.5 py-1 text-[12px] font-semibold text-money hover:bg-money/20 disabled:opacity-60"
                >
                  Mark complete
                </button>
              )}
              {selected.status !== "void" && selected.status !== "closed" && (
                <button
                  onClick={() => voidPo(selected.id)}
                  disabled={pending}
                  className="rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-60"
                >
                  Void
                </button>
              )}
              {(selected.status === "draft" || selected.status === "queued") && (
                <button
                  onClick={() => remove(selected.id)}
                  disabled={pending}
                  className="rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-60"
                >
                  Delete
                </button>
              )}
            </div>
            {error && <div className="mt-2 text-[12px] text-flag">{error}</div>}
          </Card>

          {selected.lines.length === 0 ? (
            <Card kind="dashed" className="p-8 text-center text-[12px] text-ink-3">
              No lines yet — add one above.
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              {selected.lines.map((l, k) => (
                <div key={l.id} className={`group flex items-center gap-3 px-4 py-2.5 text-[13px] ${k ? "border-t border-rule-soft" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{l.description}</div>
                    <div className="font-mono text-[11px] text-ink-3">
                      {l.qtyOrdered} {l.unit} × {l.unitCostLabel}
                      {!editable && (
                        <span className={l.qtyReceived >= l.qtyOrdered && l.qtyOrdered > 0 ? " text-money" : l.qtyReceived > 0 ? " text-accent" : ""}>
                          {" "}· {l.qtyReceived} / {l.qtyOrdered} received
                        </span>
                      )}
                    </div>
                  </div>
                  {!editable && ["sent", "partial", "fulfilled"].includes(selected.status) && (
                    <input
                      type="number"
                      min={0}
                      max={l.qtyOrdered}
                      step="any"
                      defaultValue={l.qtyReceived}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n !== l.qtyReceived) receive(l.id, n);
                      }}
                      title="Qty received"
                      className="w-[64px] rounded-md border border-rule bg-paper px-1.5 py-1 text-right text-[12px] text-ink outline-none focus:border-accent"
                    />
                  )}
                  <span className="w-[76px] flex-none text-right font-mono text-[13px] text-ink">{l.extendedLabel}</span>
                  {editable && (
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() =>
                          setLineModal({ mode: "edit", lineId: l.id, description: l.description, unit: l.unit, qty: String(l.qtyOrdered), unitCost: fmtUsd(l.unitCost).replace("$", "") })
                        }
                        title="Edit"
                        className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
                      >
                        <Pencil className="size-3.5" strokeWidth={1.75} />
                      </button>
                      <button onClick={() => removeLine(l.id)} title="Delete" className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-flag">
                        <Trash2 className="size-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {lineModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[10vh]" onClick={() => setLineModal(null)}>
          <div className="w-full max-w-[440px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-[16px] font-semibold text-ink">{lineModal.mode === "add" ? "Add line" : "Edit line"}</h2>
              <button onClick={() => setLineModal(null)} className="text-ink-3 hover:text-ink" aria-label="Close">
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            <form onSubmit={submitLine} className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Description</span>
                <input
                  value={lineModal.description}
                  onChange={(e) => setLineModal({ ...lineModal, description: e.target.value })}
                  autoFocus
                  required
                  className={inputCls}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Qty</span>
                  <input
                    value={lineModal.qty}
                    onChange={(e) => setLineModal({ ...lineModal, qty: e.target.value })}
                    inputMode="decimal"
                    required
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Unit</span>
                  <input value={lineModal.unit} onChange={(e) => setLineModal({ ...lineModal, unit: e.target.value })} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Unit cost</span>
                  <input
                    value={lineModal.unitCost}
                    onChange={(e) => setLineModal({ ...lineModal, unitCost: e.target.value })}
                    inputMode="decimal"
                    placeholder="$0"
                    className={inputCls}
                  />
                </label>
              </div>
              <div className="flex items-center justify-between border-t border-rule-soft pt-2">
                <span className="text-[12px] text-ink-3">
                  Extended: {fmtUsd(Math.round((Number(lineModal.qty) || 0) * poDollarsToCents(lineModal.unitCost)))}
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setLineModal(null)} className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2">
                    Cancel
                  </button>
                  <button type="submit" disabled={pending} className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50">
                    Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
