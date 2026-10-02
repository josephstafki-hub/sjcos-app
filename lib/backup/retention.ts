// Retention plan: daily 14 / weekly 8 / monthly 6 (DECISIONS: nightly plus a
// more frequent DB path; a nightly option is not permission to lose a day).
// Pure: takes named sets with timestamps, returns which to keep/delete. The
// same plan is applied to the local staging dir and to the remote target.

export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { daily: 14, weekly: 8, monthly: 6 };

export interface BackupSetRef {
  name: string;
  at: Date;
}

/** Parse the set stamp "YYYYMMDDTHHMMSSZ" (optionally suffixed "-db") to a Date. */
export function parseSetStamp(name: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(name);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

export function setStamp(d: Date, suffix = ""): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z") + suffix;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
function weekKey(d: Date): string {
  // ISO week: Thursday of the same week identifies the year-week.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Keep the newest set of each of the last N days / ISO weeks / months; every
 *  set not covered by a bucket is deleted. Always keeps the newest set. */
export function planRetention(sets: BackupSetRef[], policy: RetentionPolicy = DEFAULT_RETENTION): { keep: BackupSetRef[]; remove: BackupSetRef[] } {
  const sorted = [...sets].sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set<string>();
  const pick = (key: (d: Date) => string, n: number) => {
    const seen = new Set<string>();
    for (const s of sorted) {
      const k = key(s.at);
      if (seen.has(k)) continue;
      seen.add(k);
      keep.add(s.name);
      if (seen.size >= n) break;
    }
  };
  // Monthly keeps the FIRST set of each of the last N months (the archival
  // convention), so a month's anchor never drifts as the month fills up.
  const pickOldest = (key: (d: Date) => string, n: number) => {
    const byKey = new Map<string, BackupSetRef>();
    for (const s of sorted) {
      const k = key(s.at);
      if (!byKey.has(k) && byKey.size >= n) continue;
      byKey.set(k, s); // sorted newest-first → the last write per key is the oldest set
    }
    for (const s of byKey.values()) keep.add(s.name);
  };
  if (sorted[0]) keep.add(sorted[0].name);
  pick(dayKey, policy.daily);
  pick(weekKey, policy.weekly);
  pickOldest(monthKey, policy.monthly);
  return { keep: sorted.filter((s) => keep.has(s.name)), remove: sorted.filter((s) => !keep.has(s.name)) };
}
