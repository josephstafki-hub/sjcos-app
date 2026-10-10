// Decision summary → the standard card shape. Pure, no imports, so the
// server (stageDecision, Telegram cards) and the client (/engine/decisions)
// share it.
//
// Agents write summaries by hand through the MCP stage tools and don't always
// use the card's field names: a 2026-10-09 Mahowald decision arrived with
// `recipients` as one sentence and its substance under `what_happened`,
// `effect_of_approving`, `gaps_before_release`. The Telegram sweep then threw
// on recipients.map every 2 minutes and Joe was never told; the page showed a
// bare title. Normalising keeps every field visible whatever shape it came in.

export interface CardRecipient {
  name: string;
  address?: string;
  role?: string;
}

export interface NormalizedSummary {
  recipients: CardRecipient[];
  inclusions: string[];
  exclusions: string[];
  quantities: { label: string; qty: number | string; unit?: string }[];
  attachments: { label: string; revision?: string; fileId?: string }[];
  assumptions: string[];
  gaps: string[];
  changes: string[];
  effect?: string;
  recommendation?: string;
  /** Any other text the agent wrote, labelled from its key, in its order. */
  notes: { label: string; text: string }[];
}

const LIST_KEYS = ["inclusions", "exclusions", "assumptions", "gaps", "changes"] as const;

/** Synonyms agents have used for the standard fields. */
const ALIASES: Record<string, (typeof LIST_KEYS)[number] | "effect"> = {
  effect_of_approving: "effect",
  if_approved: "effect",
  gaps_before_release: "gaps",
  open_items: "gaps",
  missing: "gaps",
  included: "inclusions",
  excluded: "exclusions",
};

const KNOWN = new Set<string>([...LIST_KEYS, "recipients", "quantities", "attachments", "effect", "recommendation", ...Object.keys(ALIASES)]);

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(text).filter(Boolean);
  const t = text(v);
  return t ? [t] : [];
}

function objects<T extends { label: string }>(v: unknown): T[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is T => !!x && typeof x === "object" && typeof (x as { label?: unknown }).label === "string");
}

function recipients(v: unknown): CardRecipient[] {
  const items = Array.isArray(v) ? v : v == null ? [] : [v];
  const out: CardRecipient[] = [];
  for (const r of items) {
    if (r && typeof r === "object") {
      const o = r as Record<string, unknown>;
      const name = text(o.name) || text(o.address) || text(o.email);
      if (!name) continue;
      const address = text(o.address) || text(o.email);
      out.push({ name, ...(address && address !== name ? { address } : {}), ...(text(o.role) ? { role: text(o.role) } : {}) });
    } else {
      const t = text(r);
      if (t) out.push({ name: t });
    }
  }
  return out;
}

function label(key: string): string {
  const words = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function normalizeSummary(raw: unknown): NormalizedSummary {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: NormalizedSummary = {
    recipients: recipients(s.recipients),
    inclusions: [],
    exclusions: [],
    quantities: objects(s.quantities),
    attachments: objects(s.attachments),
    assumptions: [],
    gaps: [],
    changes: [],
    notes: [],
  };
  for (const k of LIST_KEYS) out[k].push(...list(s[k]));
  const effect = text(s.effect);
  if (effect) out.effect = effect;
  const rec = text(s.recommendation);
  if (rec) out.recommendation = rec;
  for (const [k, target] of Object.entries(ALIASES)) {
    if (!(k in s)) continue;
    if (target === "effect") {
      const t = list(s[k]).join(" ");
      if (t) out.effect = out.effect ? `${out.effect} ${t}` : t;
    } else out[target].push(...list(s[k]));
  }
  if (typeof raw === "string" && raw.trim()) out.notes.push({ label: "Summary", text: raw.trim() });
  for (const [k, v] of Object.entries(s)) {
    if (KNOWN.has(k)) continue;
    const t = list(v).join("; ");
    if (t) out.notes.push({ label: label(k), text: t });
  }
  return out;
}
