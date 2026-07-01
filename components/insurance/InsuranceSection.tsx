"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Plus, X, Pencil, Trash2 } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { InsurancePolicy } from "@/lib/insurance";
import { POLICY_TYPES } from "@/lib/insurance-types";
import { savePolicy, archivePolicy } from "@/lib/actions/insurance";

const STATUS_CHIP: Record<string, "money" | "accent" | "flag" | "ghost"> = {
  current: "money",
  expiring: "accent",
  expired: "flag",
  none: "ghost",
};
const usd = (n: number) => `$${Math.round(n || 0).toLocaleString("en-US")}`;

/** Insurance policies section for /compliance — per-policy tracking with renewal
 *  status + add/edit/archive. */
export function InsuranceSection({ policies }: { policies: InsurancePolicy[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<InsurancePolicy | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function archive(id: number) {
    startTransition(async () => {
      await archivePolicy(id);
      router.refresh();
    });
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="size-4 text-accent" strokeWidth={1.75} />
        <h2 className="flex-1 font-serif text-[18px] font-semibold text-accent-2">Insurance policies</h2>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          <Plus className="size-3" strokeWidth={2} />
          Add policy
        </button>
      </div>

      {policies.length === 0 ? (
        <Card kind="dashed" className="p-6 text-center text-[12px] text-ink-3">
          No policies tracked yet. Add your GL, Workers&apos; Comp, auto, and umbrella policies.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {policies.map((p) => (
            <Card key={p.id} className="p-3.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-serif text-[14px] font-semibold text-ink">{p.typeLabel}</span>
                <Chip kind={STATUS_CHIP[p.status]} dot>
                  {p.status === "current" ? `renews ${p.expiresLabel}` : p.status === "expiring" ? `renews ${p.expiresLabel}` : p.status === "expired" ? "expired" : "no date"}
                </Chip>
                <button onClick={() => setEditing(p)} aria-label="Edit" className="rounded p-0.5 text-ink-4 hover:text-ink">
                  <Pencil className="size-3.5" strokeWidth={1.5} />
                </button>
                <button onClick={() => archive(p.id)} disabled={pending} aria-label="Archive" className="rounded p-0.5 text-ink-4 hover:text-flag">
                  <Trash2 className="size-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <div className="mt-1 text-[11px] text-ink-3">
                {p.carrier || "—"}{p.policyNumber ? ` · #${p.policyNumber}` : ""}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-2">
                {p.coverage > 0 && <span>Coverage {usd(p.coverage)}</span>}
                {p.premium > 0 && <span>Premium {usd(p.premium)}/yr</span>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <PolicyModal
          policy={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function PolicyModal({
  policy,
  onClose,
  onSaved,
}: {
  policy: InsurancePolicy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const inputCls = "w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[8vh]" onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">{policy ? "Edit policy" : "Add policy"}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <form
          className="grid grid-cols-2 gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              setError("");
              const r = await savePolicy(fd);
              if (r.ok) onSaved();
              else setError(r.error ?? "Couldn't save.");
            });
          }}
        >
          <input type="hidden" name="id" value={policy?.id ?? 0} />
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-2">Type</span>
            <select name="policyType" defaultValue={policy?.policyType ?? "gl"} className={inputCls}>
              {POLICY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-2">Carrier</span>
            <input name="carrier" defaultValue={policy?.carrier} className={inputCls} />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-2">Policy #</span>
            <input name="policyNumber" defaultValue={policy?.policyNumber} className={inputCls} />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-2">Coverage ($)</span>
            <input name="coverage" defaultValue={policy?.coverage || ""} inputMode="numeric" className={inputCls} />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-2">Premium ($/yr)</span>
            <input name="premium" defaultValue={policy?.premium || ""} inputMode="numeric" className={inputCls} />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-2">Effective</span>
            <input name="effective" type="date" defaultValue={policy?.effective} className={inputCls} />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-2">Expires</span>
            <input name="expires" type="date" defaultValue={policy?.expires} className={inputCls} />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-ink-2">Notes</span>
            <input name="notes" defaultValue={policy?.notes} className={inputCls} />
          </label>
          {error && <div className="col-span-2 text-[12px] text-flag">{error}</div>}
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
