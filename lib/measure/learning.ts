// Learning governance (A18) — pure classifier over agent_memories rows.
//
// The W5 learning layer parks everything an agent notices as a pending memory.
// Before Joe reviews it, this classifier says what KIND of thing it is so the
// review (and the procedure checks) can treat them differently:
//
//   one_job_preference     "The Larsons want texts, not email" — scoped to a
//                          lead/project; never a company rule.
//   factual_correction     "The deck is 14×20, not 12×20" — a fact fix; it may
//                          update evidence, it grants no authority.
//   proposed_company_rule  "From now on always send invoices the same day" —
//                          a rule that would change what agents may do. It is
//                          a PROPOSAL until Joe approves it in /engine; it must
//                          never be loaded as an instruction while pending.
//   observation            anything else (what happened, no rule implied).
//
// Nothing here promotes anything. The DB defaults (can_use_as_instruction =
// false, review_status = 'pending') are the real guard; this file only labels.

export type MemoryClass = "one_job_preference" | "factual_correction" | "proposed_company_rule" | "observation";

export interface MemoryLike {
  memory_type: string; // observation / instruction / preference / fact
  summary?: string | null;
  content: string;
  lead_id?: string | null;
  project_id?: string | null;
  review_status?: string | null;
  can_use_as_instruction?: boolean | null;
}

const COMPANY_SCOPE = /\b(from now on|going forward|always|never|every (client|job|lead|invoice|sub|vendor|time)|all (clients|jobs|leads|invoices|subs|vendors)|company[- ]wide|as a rule|by default|standard practice|policy|whenever)\b/i;
const AUTHORITY = /\b(send|release|approve|approval|pay|payment|invoice|markup|margin|profit|price|pricing|rate|discount|sign|contract|permission|grant|authority|without (asking|joe|approval)|no need to ask|don'?t ask|skip (the )?approval)\b/i;
const CORRECTION = /\b(actually|correct(ed|ion)?|not \d|is not|isn'?t|was wrong|wrong|instead of|should (be|read)|typo|mis(spelled|typed|read)|the (real|right) (number|address|name|email|phone|date|size|amount))\b/i;
const FACT_SHAPE = /\b(\d+(\.\d+)?\s?(ft|feet|'|"|in|sq ?ft|lf|x|×)|\$\s?\d|@|\d{3}[-.\s]?\d{4}|address|email|phone|dimension|measures?|model|sku|color|colour)\b/i;
const PREFERENCE = /\b(prefers?|wants?|likes?|doesn'?t (want|like)|asked (us|me) to|would rather|please (don'?t|do)|texts? (not|instead of) email|email(s)? (not|instead of) text)\b/i;

/** Label one memory. Deterministic; safe on partial rows. */
export function classifyMemory(m: MemoryLike): MemoryClass {
  const text = `${m.summary ?? ""}\n${m.content ?? ""}`;
  const scopedToJob = Boolean(m.lead_id || m.project_id);
  const companyScope = COMPANY_SCOPE.test(text);
  const authority = AUTHORITY.test(text);
  const type = (m.memory_type || "observation").toLowerCase();

  // A rule about what agents may do, phrased for every job → proposed company rule.
  if ((type === "instruction" || type === "preference") && companyScope) return "proposed_company_rule";
  if (type === "instruction" && authority && !scopedToJob) return "proposed_company_rule";

  // Typed rows: the type is the author's own label, so honour it.
  if (type === "fact") return "factual_correction";
  if (type === "preference") return "one_job_preference";
  if (type === "instruction") return scopedToJob ? "one_job_preference" : "proposed_company_rule";

  // Untyped observations: look at the words.
  if (companyScope && authority) return "proposed_company_rule";
  if (CORRECTION.test(text) && FACT_SHAPE.test(text)) return "factual_correction";
  if (PREFERENCE.test(text) && scopedToJob) return "one_job_preference";
  return "observation";
}

/** True when a memory would change authority (what agents may send/pay/price)
 *  and is not yet approved — "proposed rule, not authority". */
export function isUnapprovedAuthorityChange(m: MemoryLike): boolean {
  if (m.review_status && m.review_status !== "pending") return false;
  const text = `${m.summary ?? ""}\n${m.content ?? ""}`;
  return classifyMemory(m) === "proposed_company_rule" && AUTHORITY.test(text);
}

export const MEMORY_CLASS_LABEL: Record<MemoryClass, string> = {
  one_job_preference: "One-job preference",
  factual_correction: "Factual correction",
  proposed_company_rule: "Proposed company rule (not authority until approved)",
  observation: "Observation",
};
