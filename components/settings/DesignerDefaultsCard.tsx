"use client";

import { useState, useTransition } from "react";
import { Card, Button } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { DEFAULTS, fmtIn, parseIn, type DesignerDefaults } from "@/lib/plan-doc";
import { DOOR_STYLES, FINISH_PRESETS } from "@/lib/plan-library";
import { saveDesignerDefaults } from "@/lib/actions/plan-designs";

const NUMBER_FIELDS: { key: keyof DesignerDefaults; label: string; hint: string }[] = [
  { key: "wallThickIn", label: "Wall thickness", hint: "4½ for 2×4 + drywall, 6½ for 2×6" },
  { key: "ceilingIn", label: "Ceiling height", hint: "Level default" },
  { key: "counterIn", label: "Counter height", hint: "Top of counter" },
  { key: "backsplashIn", label: "Backsplash height", hint: "Above the counter" },
  { key: "wallCabGapIn", label: "Counter → wall cabinet", hint: "Gap under wall cabinets" },
  { key: "toeIn", label: "Toe kick", hint: "Base cabinet recess" },
  { key: "overhangIn", label: "Counter overhang", hint: "Front and ends" },
  { key: "seatingOverhangIn", label: "Seating overhang", hint: "Island bar side" },
  { key: "doorWidthIn", label: "Door width", hint: "New doors" },
  { key: "doorHeightIn", label: "Door height", hint: "" },
  { key: "windowWidthIn", label: "Window width", hint: "New windows" },
  { key: "windowHeightIn", label: "Window height", hint: "" },
  { key: "windowSillIn", label: "Window sill", hint: "Above the floor" },
];

export function DesignerDefaultsCard({ defaults }: { defaults: DesignerDefaults }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of NUMBER_FIELDS) out[f.key] = fmtIn(defaults[f.key] as number);
    out.doorStyle = defaults.doorStyle;
    out.finish = defaults.finish;
    return out;
  });
  const initialValues = Object.fromEntries([...NUMBER_FIELDS.map(f=>[f.key,fmtIn(defaults[f.key] as number)]), ["doorStyle",defaults.doorStyle], ["finish",defaults.finish]]);
  const [baseline,setBaseline] = useState(initialValues);
  const dirty = Object.keys(values).some(k=>values[k]!==baseline[k]);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function save() {
    setError("");
    const patch: Partial<DesignerDefaults> = {};
    for (const f of NUMBER_FIELDS) {
      const n = parseIn(values[f.key] ?? "");
      if (n == null || n < 0) {
        setError(`${f.label}: enter inches like 4.5 or 8' 0"`);
        return;
      }
      (patch as Record<string, number | string>)[f.key] = n;
    }
    patch.doorStyle = values.doorStyle;
    patch.finish = values.finish;
    start(async () => {
      const r = await runAction(() => saveDesignerDefaults(patch));
      if (!r.ok) setError(r.error ?? "Could not save defaults.");
      if (r.ok) {
        setBaseline({...values});
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    });
  }

  function reset() {
    const out: Record<string, string> = {};
    for (const f of NUMBER_FIELDS) out[f.key] = fmtIn(DEFAULTS[f.key] as number);
    out.doorStyle = DEFAULTS.doorStyle;
    out.finish = DEFAULTS.finish;
    setValues(out);
  }

  const cabinetFinishes = FINISH_PRESETS.filter((f) => f.category === "cabinet" || f.category === "paint");

  return (
    <Card className="max-w-[760px] p-4">
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 @xl/page:grid-cols-2">
        {NUMBER_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-meta text-ink-3">{f.label}</span>
            <input
              disabled={pending}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
            />
            {f.hint && <span className="text-meta text-ink-3">{f.hint}</span>}
          </label>
        ))}
        <label className="flex flex-col gap-1">
          <span className="text-meta text-ink-3">Default door style</span>
          <select
            disabled={pending}
            value={values.doorStyle}
            onChange={(e) => setValues((v) => ({ ...v, doorStyle: e.target.value }))}
            className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
          >
            {DOOR_STYLES.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-ink-3">Default cabinet finish</span>
          <select
            disabled={pending}
            value={values.finish}
            onChange={(e) => setValues((v) => ({ ...v, finish: e.target.value }))}
            className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
          >
            {cabinetFinishes.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <div role="alert" className="mt-3 text-meta text-flag">{error}</div>}
      <div className="sticky bottom-3 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-card p-3">
        {dirty && <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save defaults"}</Button>}
        <button disabled={pending} onClick={reset} className="text-meta text-ink-3 hover:text-ink">
          Reset to built-in
        </button>
        {saved && <span className="text-meta text-money">Saved.</span>}
      </div>
    </Card>
  );
}
