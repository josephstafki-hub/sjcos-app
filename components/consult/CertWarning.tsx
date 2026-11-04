/**
 * r10 R10-2 / domain 4: a certification that runs out before the planned finish. Advice for Joe,
 * never a close block. One line, the ⚐ beside its words, each date kept whole on one line. Shared by
 * the field (under the expiry field, the Renovate Right sheet, Before you wrap) and the office look-over.
 */
import { certWarningParts, type CertificationWarning } from "@/lib/consult/rrp";

export function CertWarningText({ w }: { w: CertificationWarning }) {
  const p = certWarningParts(w);
  return <><span aria-hidden className="mr-1 font-semibold">⚐</span>{p.lead} <span className="whitespace-nowrap">{p.expiry}</span> {p.mid} <span className="whitespace-nowrap">{p.finish}</span>. {p.tail}</>;
}

/** The calm card: the "What we know so far" style, never the ! Problem style. */
export function CertWarningList({ list, className = "" }: { list: CertificationWarning[]; className?: string }) {
  if (!list.length) return null;
  return (
    <div role="note" className={`grid gap-1 rounded-md border-2 border-rule-soft bg-paper px-3 py-2 text-ink ${className}`}>
      {list.map((w) => <p key={w.field_address}><CertWarningText w={w} /></p>)}
    </div>
  );
}
