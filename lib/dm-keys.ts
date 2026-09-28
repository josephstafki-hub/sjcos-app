// CHANNEL-KEY CONVENTIONS for team chat, and who is on either end of a DM.
//
// Deliberately dependency-free (no db, no React): these keys decide which
// conversation two people land in, and the owner↔person form has to stay
// byte-identical to the keys that already carry transcripts — worth pinning on
// its own (tests/staff-separation.test.mjs). lib/chat.ts re-exports all of it,
// so nothing else had to move.
//
// Every DM key starts with "dm:" (which turns the membership UI off) and
// contains ":" (which keeps all AI models implicit rather than per-channel
// members). Three namespaces:
//
//   dm:<sub-slug>        a sub — and this IS that sub's live portal thread
//   dm:client:<slug>     a client — delivers through the gated portal outbox
//   dm:team:<slug>       owner ↔ that person (the original, pre-staff form)
//   dm:team:<a>+<b>      two staff members, slugs sorted
//
// Room keys (`room:…`) live in lib/chat.ts next to the code that builds them.

export const dmKey = (subSlug: string) => `dm:${subSlug}`;
export const dmTeamKey = (slug: string) => `dm:team:${slug}`;
export const dmClientKey = (slug: string) => `dm:client:${slug}`;

/** Whose chat this is. `teamSlug` is their team_members row (the migration links
 *  one to every owner/staff login); null for a login with no roster entry, who
 *  then has no DM identity and sees channels only. */
export interface ChatViewer {
  id: string;
  name: string;
  role: string;
  initials: string;
  teamSlug: string | null;
}

/** DM key between two INTERNAL people (owner or staff).
 *
 *  Owner↔person keeps the original `dm:team:<their-slug>` shape, because those
 *  keys already carry real transcripts and the sub portal/outbox code reads
 *  them. Two staff members get `dm:team:<a>+<b>` with the slugs sorted, so the
 *  same pair always lands on the same key whoever opens it first. Slugs are
 *  `[a-z0-9-]` only, so "+" can never be part of one and the two forms can't
 *  collide. */
export function internalDmKey(
  x: { slug: string; isOwner: boolean },
  y: { slug: string; isOwner: boolean },
): string {
  if (x.isOwner) return dmTeamKey(y.slug);
  if (y.isOwner) return dmTeamKey(x.slug);
  return dmTeamKey([x.slug, y.slug].toSorted().join("+"));
}

/** The team slugs on either end of a `dm:team:…` key. The single-slug form is
 *  implicitly owner + that person, which is why the owner's slug is needed to
 *  answer it. */
export function teamDmParties(key: string, ownerSlug: string | null): string[] {
  if (!key.startsWith("dm:team:")) return [];
  const rest = key.slice("dm:team:".length);
  if (rest.includes("+")) return rest.split("+").filter(Boolean);
  return ownerSlug ? [ownerSlug, rest] : [rest];
}

/** Slugify a name/label into a key: lowercase, non-alphanumerics → hyphens.
 *  Must match `channelKeyFromName` in lib/actions/chat.ts so the client roster's
 *  derived slug and the DM the action opens produce the same `dm:client:<slug>`
 *  key. */
export function dmSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
