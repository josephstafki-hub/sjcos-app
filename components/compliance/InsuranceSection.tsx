"use client";
import { useRef, useState, useTransition } from "react";
import { MoreHorizontal, Plus, ShieldCheck, X } from "lucide-react";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Segmented,
  Table,
  TableWrapper,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TablePrimaryCell,
  TableCell,
} from "@/components/ui";
import {
  savePolicy,
  archivePolicy,
  restorePolicy,
} from "@/lib/actions/insurance";
import { POLICY_TYPES } from "@/lib/insurance-types";
import type { InsurancePolicy } from "@/lib/insurance";
import { useDialogDismiss } from "@/lib/use-dialog-dismiss";
import { runAction } from "@/lib/run-action";
const input =
  "mt-1.5 h-9 w-full min-w-0 rounded-md border border-rule bg-card px-3 text-body max-sm:h-11";
export function InsuranceSection({
  policies,
}: {
  policies: InsurancePolicy[];
}) {
  const [editing, setEditing] = useState<InsurancePolicy | "new" | null>(null);
  const [view, setView] = useState("current");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const trigger = useRef<HTMLElement | null>(null);
  useDialogDismiss(Boolean(editing), () => setEditing(null), trigger);
  const shown = policies.filter((p) =>
    view === "archived" ? p.archived : !p.archived,
  );
  const edit = (p: InsurancePolicy | "new") => {
    trigger.current = document.activeElement as HTMLElement;
    setError("");
    setEditing(p);
  };
  const p = editing === "new" ? null : editing;
  return (
    <section id="insurance-policies" className="mt-10 scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-heading">Insurance policies</h2>
        <Button variant="secondary" icon={Plus} onClick={() => edit("new")}>
          Add policy
        </Button>
      </div>
      <Segmented
        aria-label="Policy views"
        value={view}
        onChange={setView}
        options={[
          { value: "current", label: "Current policies" },
          { value: "archived", label: "Archived" },
        ]}
      />
      <div className="mt-3">
        {!shown.length ? (
          <Card>
            <EmptyState
              compact
              icon={ShieldCheck}
              title={
                view === "archived"
                  ? "No archived policies"
                  : "Track your insurance"
              }
              description={
                view === "archived"
                  ? "Archived policies stay here and can be restored."
                  : "Add liability, workers’ compensation, auto or umbrella policies to track renewals in the compliance calendar."
              }
            />
          </Card>
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <tr>
                  <TableHeader>Policy & carrier</TableHeader>
                  <TableHeader>Renewal</TableHeader>
                  <TableHeader>
                    <span className="sr-only">Actions</span>
                  </TableHeader>
                </tr>
              </TableHead>
              <TableBody>
                {shown.map((policy) => (
                  <TableRow key={policy.id}>
                    <TablePrimaryCell
                      meta={policy.carrier || "Carrier not recorded"}
                    >
                      <button
                        className="text-left hover:underline"
                        onClick={() => edit(policy)}
                      >
                        {policy.typeLabel}
                      </button>
                      {(policy.coverage > 0 || policy.premium > 0) && (
                        <p className="mt-1 text-meta font-normal tabular-nums text-ink-3">
                          {policy.coverage > 0
                            ? `Coverage $${policy.coverage.toLocaleString()}`
                            : ""}
                          {policy.coverage > 0 && policy.premium > 0
                            ? " · "
                            : ""}
                          {policy.premium > 0
                            ? `Premium $${policy.premium.toLocaleString()}/year`
                            : ""}
                        </p>
                      )}
                      {policy.policyNumber && (
                        <p className="mt-1 text-meta font-normal text-ink-3">
                          Policy #{policy.policyNumber}
                        </p>
                      )}
                    </TablePrimaryCell>
                    <TableCell>
                      <Chip
                        kind={
                          policy.status === "expired"
                            ? "flag"
                            : policy.status === "expiring"
                              ? "warn"
                              : policy.status === "current"
                                ? "ok"
                                : "neutral"
                        }
                      >
                        {policy.status === "none"
                          ? "No date"
                          : policy.status === "expiring"
                            ? "Due soon"
                            : policy.status === "expired"
                              ? "Expired"
                              : "Current"}
                      </Chip>
                      <p className="mt-1 text-meta text-ink-3">
                        {policy.expiresLabel}
                      </p>
                    </TableCell>
                    <TableCell>
                      <details className="relative">
                        <summary
                          aria-label={`Actions for ${policy.carrier || policy.typeLabel}`}
                          className="cursor-pointer list-none rounded-md p-2 hover:bg-hover"
                        >
                          <MoreHorizontal className="size-4" />
                        </summary>
                        <div className="absolute right-0 z-10 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => edit(policy)}
                          >
                            Edit policy
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={policy.archived ? "" : "text-flag"}
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                await runAction(() =>
                                  policy.archived
                                    ? restorePolicy(policy.id)
                                    : archivePolicy(policy.id),
                                );
                              })
                            }
                          >
                            {policy.archived
                              ? "Restore policy"
                              : "Archive policy"}
                          </Button>
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </div>
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onClick={() => setEditing(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={p ? "Edit policy" : "Add policy"}
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-rule-soft bg-card shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule-soft px-5 py-4">
              <h2 className="font-serif text-title">
                {p ? "Edit policy" : "Add policy"}
              </h2>
              <Button
                icon={X}
                iconOnly
                aria-label="Close"
                title="Close"
                onClick={() => setEditing(null)}
              />
            </div>
            <form
              className="grid grid-cols-2 gap-4 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                start(async () => {
                  const r = await runAction(() => savePolicy(fd));
                  if (r.ok) setEditing(null);
                  else setError(r.error ?? "Couldn't save the policy.");
                });
              }}
            >
              <input type="hidden" name="id" value={p?.id ?? 0} />
              <label className="min-w-0 text-label">
                Type
                <select
                  autoFocus
                  name="policyType"
                  defaultValue={p?.policyType ?? "gl"}
                  className={input}
                >
                  {POLICY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 text-label">
                Carrier
                <input
                  name="carrier"
                  defaultValue={p?.carrier}
                  className={input}
                />
              </label>
              <label className="col-span-2 text-label">
                Policy number
                <input
                  name="policyNumber"
                  defaultValue={p?.policyNumber}
                  className={input}
                />
              </label>
              <label className="min-w-0 text-label">
                Coverage ($)
                <input
                  name="coverage"
                  inputMode="numeric"
                  defaultValue={p?.coverage || ""}
                  className={input}
                />
              </label>
              <label className="min-w-0 text-label">
                Premium ($/year)
                <input
                  name="premium"
                  inputMode="numeric"
                  defaultValue={p?.premium || ""}
                  className={input}
                />
              </label>
              <label className="min-w-0 text-label">
                Effective
                <input
                  type="date"
                  name="effective"
                  defaultValue={p?.effective}
                  className={input}
                />
              </label>
              <label className="min-w-0 text-label">
                Expires
                <input
                  type="date"
                  name="expires"
                  defaultValue={p?.expires}
                  className={input}
                />
              </label>
              <label className="col-span-2 text-label">
                Notes
                <input name="notes" defaultValue={p?.notes} className={input} />
              </label>
              {error && (
                <p role="alert" className="col-span-2 text-meta text-flag">
                  {error}
                </p>
              )}
              <div className="col-span-2 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
