"use client";

import { useState, useTransition } from "react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { CAPABILITY_STATES, type CapabilityReport, type CapabilityState } from "@/lib/measure/capabilities";
import { updateCapability } from "@/lib/measure/actions";
import { runAction } from "@/lib/run-action";

const btnCls =
  "rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const inputCls = "w-full rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent";

const STATE_LABEL: Record<CapabilityState, string> = {
  implemented: "Implemented",
  deployed: "Deployed",
  enabled: "Enabled",
  proven: "Proven",
};

function StateChip({ on, label }: { on: boolean; label: string }) {
  return on ? <Chip kind="money">{label}</Chip> : <Chip kind="ghost">{label}</Chip>;
}

export function CapabilitiesTable({ report, canEdit }: { report: CapabilityReport; canEdit: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState<{ state: CapabilityState; on: boolean; version: string; note: string }>({ state: "implemented", on: true, version: "", note: "" });

  const submit = (key: string) => {
    start(async () => {
      const r = await runAction(() => updateCapability(key, { [form.state]: form.on }, form.on ? { version: form.version, note: form.note } : null));
      if (r && r.ok !== false) {
        setEditing(null);
        setForm({ state: "implemented", on: true, version: "", note: "" });
      }
    });
  };

  const groups: { title: string; rows: CapabilityReport["rows"] }[] = [
    { title: "Tasks A00–A24", rows: report.rows.filter((r) => r.group === "task") },
    { title: "Key features", rows: report.rows.filter((r) => r.group !== "task") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card kind="soft" className="px-4 py-3 text-[12px] leading-relaxed text-ink-3">
        {report.caveat} Counts: {CAPABILITY_STATES.map((s) => `${STATE_LABEL[s].toLowerCase()} ${report.counts[s]}`).join(" · ")} of {report.counts.total}.
      </Card>
      {groups.map((g) => (
        <section key={g.title}>
          <Eyebrow>{g.title}</Eyebrow>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="py-2 pr-3">Key</th>
                  <th className="py-2 pr-3">Capability</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">States</th>
                  <th className="py-2 pr-3">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.key} className="border-b border-rule-soft align-top">
                    <td className="py-2 pr-3 font-mono text-[12px] text-ink-2">{r.key}</td>
                    <td className="py-2 pr-3 text-ink">
                      {r.title}
                      {!r.in_catalogue ? <span className="ml-2 text-[11px] text-ink-4">(not in catalogue)</span> : null}
                      {r.notes ? <div className="mt-1 text-[12px] text-ink-3">{r.notes}</div> : null}
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-ink-3">{r.owner || "—"}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {CAPABILITY_STATES.map((s) => (
                          <StateChip key={s} on={r[s]} label={STATE_LABEL[s]} />
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <button type="button" className={btnCls} onClick={() => setOpen(open === r.key ? null : r.key)}>
                          {r.evidence.length} entr{r.evidence.length === 1 ? "y" : "ies"}
                        </button>
                        {canEdit ? (
                          <button type="button" className={btnCls} onClick={() => setEditing(editing === r.key ? null : r.key)}>
                            Set state
                          </button>
                        ) : null}
                      </div>
                      {open === r.key ? (
                        <ul className="mt-2 flex flex-col gap-1 text-[12px] text-ink-2">
                          {r.evidence.length === 0 ? <li className="text-ink-4">No evidence recorded — every state is a claim until one is.</li> : null}
                          {r.evidence.map((e, i) => (
                            <li key={i}>
                              <span className="font-mono text-ink-3">{e.date}</span> · <span className="font-mono">{e.version}</span> ·{" "}
                              {(e.states ?? []).join(", ") || "—"} · {e.note}
                              {e.by ? <span className="text-ink-4"> — {e.by}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {editing === r.key ? (
                        <div className="mt-2 flex max-w-[420px] flex-col gap-2 rounded-md border border-rule bg-paper-2 p-2">
                          <div className="flex gap-2">
                            <select className={inputCls} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value as CapabilityState })}>
                              {CAPABILITY_STATES.map((s) => (
                                <option key={s} value={s}>
                                  {STATE_LABEL[s]}
                                </option>
                              ))}
                            </select>
                            <select className={inputCls} value={form.on ? "true" : "false"} onChange={(e) => setForm({ ...form, on: e.target.value === "true" })}>
                              <option value="true">true (needs evidence)</option>
                              <option value="false">false</option>
                            </select>
                          </div>
                          {form.on ? (
                            <>
                              <input className={inputCls} placeholder="Version (commit / build id)" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                              <input className={inputCls} placeholder="Evidence note (what was observed, where)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                            </>
                          ) : null}
                          <div className="flex gap-2">
                            <button type="button" className={btnCls} disabled={pending || (form.on && (!form.version || !form.note))} onClick={() => submit(r.key)}>
                              Save
                            </button>
                            <button type="button" className={btnCls} onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
