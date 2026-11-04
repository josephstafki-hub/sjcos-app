/** AI responses sometimes wrap publication copy in JSON. Only known copy fields
 * are accepted; never turn arbitrary metadata into client-facing prose. */
export function normalizeMarketingCopy(raw: string): { title?: string; body: string } {
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const source = (fence?.[1] ?? raw).trim();
  if (!/^[{[]/.test(source)) return { body: source };
  let value: unknown;
  try { value = JSON.parse(source); } catch { return { body: '' }; }
  const prose = (x: unknown): string => {
    if (typeof x === 'string') return x.trim();
    if (Array.isArray(x)) return x.map(prose).filter(Boolean).join('\n\n');
    if (!x || typeof x !== 'object') return '';
    const r = x as Record<string, unknown>;
    return [prose(r.heading ?? r.subheading), prose(r.paragraph ?? r.text ?? r.content ?? r.body ?? r.paragraphs)].filter(Boolean).join('\n\n');
  };
  if (Array.isArray(value)) return { body: prose(value) };
  if (!value || typeof value !== 'object') return { body: '' };
  const envelope = value as Record<string, unknown>;
  const post = envelope.blogPost ?? envelope.blog_post ?? envelope.socialPost ?? envelope.social_post ?? envelope;
  if (typeof post === 'string') return {body: post.trim()};
  if (!post || typeof post !== 'object') return {body: ''};
  const r = post as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim() : undefined;
  const body = prose(r.content ?? r.body ?? r.paragraphs ?? r.sections ?? r.post ?? r.caption ?? r.text);
  const tags = Array.isArray(r.hashtags) ? r.hashtags.filter((t): t is string => typeof t === 'string').map(t => `#${t.trim().replace(/^#/, '')}`).join(' ') : '';
  return { ...(title ? {title} : {}), body: [body, tags].filter(Boolean).join('\n\n') };
}

// ─── Grounded drafting ──────────────────────────────────────────────────────
// Joe, 2026-11-03: the Louiselle drafts claimed a bathroom remodel and room
// additions on what was a kitchen refresh, and printed the client's name and
// street address. The model now sees only the job's own record of the work
// (lib/closeout/marketing.ts loadJobFacts) and its answer is checked against
// it before it is saved; a draft that fails the check twice is replaced by a
// plain template built from the same facts.

export interface JobFacts {
  /** The work's name, e.g. the estimate title "Kitchen Refresh". May be "". */
  work: string;
  /** City only, never the street. May be "". */
  city: string;
  /** Short scope notes from the job/lead, e.g. "Basement finish". */
  scope: string[];
  /** Estimate lines the client agreed to (no prices). */
  lines: { section: string; text: string }[];
  /** Approved change orders, "title: description". */
  changes: string[];
  /** Client and project names and the address: never in a post. */
  privateWords: string[];
}

/** "13186 Crane St NW, Minneapolis, Minnesota, 55448" → "Minneapolis". */
export function cityFromAddress(address: string | null | undefined): string {
  const parts = (address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const city = parts[1].replace(/\s+(MN|Minnesota|WI|Wisconsin)\b.*$/i, "").replace(/\s+\d{5}(-\d{4})?$/, "").trim();
  return city && !/\d/.test(city) ? city : "";
}

/** A scope note or title that only names paperwork or a place, not work. */
const notWork = (s: string) => !s.trim() || /^\d/.test(s.trim()) || /\bestimate\b|\bES-\d|\bhouzz\b|\binvoice\b/i.test(s);

/** Facts with the paperwork-only notes taken out. */
function usable(f: JobFacts) {
  return { ...f, work: notWork(f.work) ? "" : f.work.trim(), scope: f.scope.filter((s) => !notWork(s)) };
}

/** Every word of the job's record, lowercased (what a post may draw on). */
function factText(f: JobFacts): string {
  return [f.work, f.city, ...f.scope, ...f.lines.map((l) => `${l.section} ${l.text}`), ...f.changes].join(" \n ").toLowerCase();
}

/** Rooms and areas a model likes to add. A post may name one only when the
 *  job's record does. */
const AREAS: [string, RegExp][] = [
  ["kitchen", /\bkitchens?\b/i],
  ["bathroom", /\bbath(room)?s?\b/i],
  ["basement", /\bbasements?\b/i],
  ["addition", /(?<!\bin )\badditions?\b/i],
  ["deck", /\bdecks?\b/i],
  ["porch", /\bporch(es)?\b/i],
  ["patio", /\bpatios?\b/i],
  ["garage", /\bgarages?\b/i],
  ["bedroom", /\bbedrooms?\b/i],
  ["laundry room", /\blaundry\b/i],
  ["mudroom", /\bmud ?rooms?\b/i],
  ["attic", /\battics?\b/i],
  ["roof", /\broof(s|ing)?\b/i],
  ["siding", /\bsiding\b/i],
  ["fence", /\bfenc(e|es|ing)\b/i],
  ["staircase", /\bstair(s|case|cases|way|ways)?\b/i],
  ["sunroom", /\bsun ?rooms?\b/i],
  ["fireplace", /\bfireplaces?\b/i],
  ["windows", /\bwindows?\b/i],
];

const STOP = new Set(["the", "and", "llc", "inc", "co", "mn", "minnesota", "street", "st", "avenue", "ave", "road", "rd", "drive", "dr", "lane", "ln", "blvd", "boulevard", "court", "ct", "north", "south", "east", "west", "northwest", "northeast", "southwest", "southeast", "nw", "ne", "sw", "se", "n", "s", "e", "w"]);

/** What's wrong with a draft against the job's record, in words a model can
 *  act on. Empty = fine. */
export function draftProblems(text: string, facts: JobFacts): string[] {
  const out: string[] = [];
  const known = factText(facts);
  const city = facts.city.toLowerCase();
  for (const [label, re] of AREAS) {
    if (re.test(text) && !re.test(known)) out.push(`It mentions ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}, which isn't part of this job.`);
  }
  // Names and the street: case-sensitive whole words, so "great" in a
  // sentence doesn't trip on a client called Great Clips.
  const named = new Set<string>();
  for (const src of facts.privateWords) {
    const head = src.split("·")[0];
    for (const tok of head.split(/[^\p{L}\p{N}'-]+/u)) {
      const low = tok.toLowerCase();
      if (tok.length < 3 || STOP.has(low) || city.includes(low) || (!/^\d+$/.test(tok) && new RegExp(`\\b${low}\\b`).test(known))) continue;
      if (/^\d+$/.test(tok) ? new RegExp(`\\b${tok}\\b`).test(text) : new RegExp(`(^|[^\\p{L}])${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(text)) named.add(tok);
    }
  }
  if (named.size) out.push(`It names the client or their address (${[...named].join(", ")}). Say "a homeowner"${facts.city ? ` or "in ${facts.city}"` : ""} instead.`);
  if (/\$\s?\d/.test(text)) out.push("It mentions a price.");
  return out;
}

/** The post's headline: the work and the city, never the client's name. */
export function draftHeadline(facts: JobFacts): string {
  const f = usable(facts);
  const work = f.work || f.scope[0] || "A recent project";
  return f.city ? `${work} in ${f.city}` : work;
}

/** The prompt for one draft: the job's record and the rules, nothing else. */
export function buildDraftPrompt(kind: "social" | "blog", facts: JobFacts): string {
  const f = usable(facts);
  const facts_: string[] = [];
  if (f.work) facts_.push(`Work: ${f.work}`);
  if (f.city) facts_.push(`City: ${f.city}`);
  for (const s of f.scope) facts_.push(`Scope note: ${s}`);
  if (f.lines.length) {
    facts_.push("Work done (from the estimate the client signed):");
    for (const l of f.lines.slice(0, 40)) facts_.push(`- ${l.section && l.section !== "General" ? `${l.section}: ` : ""}${l.text}`);
  }
  for (const c of f.changes) facts_.push(`- Added later: ${c}`);
  const thin = !f.lines.length && !f.changes.length;
  const shape =
    kind === "blog"
      ? `Write a short blog post for SJ Carpentry LLC, a residential carpentry and remodeling company, about this finished job. ${thin ? "The record is short, so keep it to two short paragraphs about the company's care and craftsmanship." : "Two to four short paragraphs."} End with a soft call to action.`
      : `Write a short social media post for SJ Carpentry LLC, a residential carpentry and remodeling company, about this finished job: two or three sentences, then three to five hashtags.`;
  return [
    shape,
    "",
    "JOB FACTS. These are the only things you may say about this job:",
    facts_.length ? facts_.join("\n") : "(none beyond: a home project the company finished)",
    "",
    "RULES:",
    "- Describe only work listed in JOB FACTS. Do not add rooms, features, materials, finishes, results, timelines or quotes that aren't listed. If you aren't sure something was done, leave it out.",
    thin ? "- The facts don't say which room or what work, so don't name a room or a kind of work at all." : "- You may name brands and materials exactly as they are listed.",
    "- Never write the client's name or a street address. Say \"a homeowner\" or \"this home\"" + (f.city ? `, and you may say ${f.city}.` : "."),
    "- No prices, dates or how long it took.",
    "- Warm, plain, proud of the work. No exclamation-mark pile-ups.",
    "- Return only the post text: no headline line, no JSON, no code fences.",
  ].join("\n");
}

/** A plain draft from the same facts, for when the model is unavailable or
 *  keeps getting it wrong. Says nothing the record doesn't. */
export function fallbackDraft(kind: "social" | "blog", facts: JobFacts): { title: string; body: string } {
  const f = usable(facts);
  const title = draftHeadline(facts);
  const where = f.city ? ` in ${f.city}` : "";
  const what = f.work ? `a ${f.work.toLowerCase()}` : f.scope[0] ? f.scope[0].toLowerCase() : "another home project";
  if (kind === "social") {
    return {
      title,
      body: `We just wrapped up ${what}${where}, and we're proud of how it came together. Thank you to the homeowners for trusting SJ Carpentry with their home.\n\n#SJCarpentry #carpentry #remodel #craftsmanship`,
    };
  }
  const items = f.lines.slice(0, 8).map((l) => `- ${l.text}`);
  return {
    title,
    body: [
      `We recently finished ${what}${where}.`,
      ...(items.length ? ["Here's some of what went into it:", items.join("\n")] : []),
      "Every job is a chance to build something that lasts. If you're thinking about a project of your own, we'd be glad to talk it through.",
      "— SJ Carpentry LLC",
    ].join("\n\n"),
  };
}
