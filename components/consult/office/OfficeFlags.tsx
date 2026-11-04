/**
 * The office look-over's Flags list. r12 extra: a decided flag carries the muted ⚐ (the device's calm
 * "kept" card), and only a flag that still needs a decision keeps the red ⚑. The sentence's own period is
 * dropped before " — " so it never reads "break up. — not an issue".
 */
import { MeasureText } from "@/components/consult/MeasureText";
import { officeFlagText, type EvidenceDraft } from "@/lib/consult/ui/model";

type Flag = { kind?: string; key: string; issue: string; hint: string };

export const flagDecisionText = (d: EvidenceDraft["flags"][string] | undefined) => (d ? `${d.disposition.replace(/_/g, " ")} · ${d.note}` : "needs a decision");
const beforeDash = (t: string) => t.trim().replace(/\.$/, "");

export function OfficeFlags({ flags, decisions }: { flags: Flag[]; decisions: EvidenceDraft["flags"] }) {
  if (!flags.length) return null;
  return (
    <div className="mt-4"><p className="eyebrow mb-1">Flags</p>
      <ul className="grid gap-1 text-body">
        {flags.map((f) => {
          const d = decisions[f.key];
          const calm = f.kind === "advisory" || !!d;
          const text = beforeDash(f.kind === "advisory" ? f.hint : officeFlagText(f.issue, f.hint));
          return (
            <li key={f.key}>
              {calm
                ? <span className="text-ink-2"><span aria-hidden className="font-semibold">⚐</span> <MeasureText text={text} /></span>
                : <><span aria-hidden className="font-semibold text-flag">⚑</span> <MeasureText text={text} /></>}
              {" — "}{flagDecisionText(d)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
