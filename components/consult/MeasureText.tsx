/**
 * r9 extra: a measurement inside a sentence (24″, 6′ 9″, 20 1/2″) is set in the mono face the field
 * shows it in, so a flag hint's inch mark matches the field above it. Straight marks become ″ / ′ first.
 * Pure — used by the visit (client) and the office look-over (server).
 */
import { Fragment } from "react";
import { curly } from "@/lib/consult/typography";

const FRAC = "(?:\\s\\d+\\/\\d+|[½¼¾⅛⅜⅝⅞])?";
const MEASURE = new RegExp(`(\\d+′(?:\\s?\\d+${FRAC}″)?|\\d+${FRAC}″)`, "g");

export function MeasureText({ text }: { text: string }) {
  const parts = curly(text).split(MEASURE);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="whitespace-nowrap font-mono">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}
