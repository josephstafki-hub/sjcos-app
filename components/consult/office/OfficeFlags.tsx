/**
 * The office look-over's Flags list. r12 extra: a decided flag carries the muted ⚐ (the device's calm
 * "kept" card), and only a flag that still needs a decision keeps the red ⚑. The sentence's own period is
 * dropped before " — " so it never reads "break up. — not an issue".
 * r13: every flag — advisories too — reads through officeFlagText(issue, hint), so the office line names its
 * subject ("Radon 36 pCi/L …", not a bare "Mention mitigation"). The decision sits on its own muted line
 * under the flag ("Not an issue · …"), so it never blurs into a hint that has its own dash.
 * r14 extra: an advisory (radon, …) is never decided, so it has no decision line — by `decisionAllowed`
 * once the model says so, and by `kind === "advisory"` until then.
 */
import { MeasureText } from "@/components/consult/MeasureText";
import { officeFlagText, type EvidenceDraft } from "@/lib/consult/ui/model";

type Flag = { kind?: string; decisionAllowed?: boolean; key: string; issue: string; hint: string };

export const flagDecisionText = (d: EvidenceDraft["flags"][string] | undefined) => (d ? `${d.disposition.replace(/_/g, " ")} · ${d.note}` : "needs a decision");
const sentenceCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const beforeDash = (t: string) => t.trim().replace(/\.$/, "");

export function OfficeFlags({ flags, decisions }: { flags: Flag[]; decisions: EvidenceDraft["flags"] }) {
  if (!flags.length) return null;
  return (
    <div className="mt-4"><p className="eyebrow mb-1">Flags</p>
      <ul className="grid gap-2 text-body">
        {flags.map((f) => {
          const d = decisions[f.key];
          const calm = f.kind === "advisory" || !!d;
          const text = beforeDash(officeFlagText(f.issue, f.hint, f.kind));
          const decidable = f.kind !== "advisory" && f.decisionAllowed !== false;
          return (
            <li key={f.key}>
              {calm
                ? <span className="text-ink-2"><span aria-hidden className="font-semibold">⚐</span> <MeasureText text={text} /></span>
                : <><span aria-hidden className="font-semibold text-flag">⚑</span> <MeasureText text={text} /></>}
              {decidable && <span className="block pl-[1.25em] text-[0.95em] text-ink-2">{sentenceCase(flagDecisionText(d))}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
