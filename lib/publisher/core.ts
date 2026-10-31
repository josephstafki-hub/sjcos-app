// The posting browser (A17): where it lives, who may use it, and what a
// posting run left behind. Shared by the dispatcher's provider
// (lib/providers/publisher.ts), the posting run (scripts/run-publication.mjs),
// its browser tools (mcp/publisher-browser.mjs), Joe's sign-in window
// (scripts/publisher-browser.mjs) and the /marketing reads.
//
// One Chromium profile on this box, outside the repo, the uploads and the
// backups: ~/.local/share/sjcos-publisher/profile (0700). Joe signs in to
// Facebook, Instagram and Google himself, in a live view on /marketing; the
// cookies stay in that profile. No password is ever stored by SJC OS or seen
// by the agent. If the server is lost, Joe signs in again.
//
// One browser at a time: browser.lock names the holder (sign-in window or a
// posting run). A holder whose process is gone is stale and is taken over.
//
// Pure: node builtins only (no db, no "server-only", no "@/…").

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PostPlatform } from "../marketing-types.ts";

// ── Places ───────────────────────────────────────────────────────────────────

export function publisherDir(): string {
  return process.env.SJC_PUBLISHER_DIR || path.join(os.homedir(), ".local", "share", "sjcos-publisher");
}
export const profileDir = () => path.join(publisherDir(), "profile");
export const runsDir = () => path.join(publisherDir(), "runs");
export const lockPath = () => path.join(publisherDir(), "browser.lock");
export const signinSocketPath = () => path.join(publisherDir(), "signin.sock");

/** Run directories are keyed on the intent id (a uuid); anything else is refused. */
export function runDir(intentId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(intentId)) throw new Error(`not an intent id: ${intentId}`);
  return path.join(runsDir(), intentId);
}

export function ensurePublisherDirs(): void {
  for (const d of [publisherDir(), profileDir(), runsDir()]) mkdirSync(d, { recursive: true, mode: 0o700 });
}

/** systemd unit names (one browser at a time is also one unit at a time). */
export const SIGNIN_UNIT = "sjcos-publisher-signin";
export const publishUnitFor = (intentId: string) => `sjcos-publish-${intentId.replace(/[^0-9a-f]/gi, "").slice(0, 12)}`;

// ── The lock ─────────────────────────────────────────────────────────────────

export interface LockHolder {
  pid: number;
  mode: "signin" | "post";
  /** Intent id for a posting run; platform for a sign-in. */
  ref: string;
  since: string;
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readLock(): LockHolder | null {
  try {
    const h = JSON.parse(readFileSync(lockPath(), "utf8")) as LockHolder;
    return h && typeof h.pid === "number" ? h : null;
  } catch {
    return null;
  }
}

/** Who holds the browser right now (a dead holder doesn't count). */
export function browserHolder(): LockHolder | null {
  const h = readLock();
  return h && pidAlive(h.pid) ? h : null;
}

/** Take the browser. Returns a release function, or null when someone live has it. */
export function acquireBrowser(holder: Omit<LockHolder, "since" | "pid"> & { pid?: number }): (() => void) | null {
  ensurePublisherDirs();
  const me: LockHolder = { pid: holder.pid ?? process.pid, mode: holder.mode, ref: holder.ref, since: new Date().toISOString() };
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(lockPath(), "wx", 0o600);
      writeSync(fd, JSON.stringify(me));
      fsyncSync(fd);
      closeSync(fd);
      return () => {
        const cur = readLock();
        if (cur && cur.pid === me.pid && cur.since === me.since) rmSync(lockPath(), { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (browserHolder()) return null;
      rmSync(lockPath(), { force: true }); // stale: its process is gone
    }
  }
  return null;
}

// ── The sites ────────────────────────────────────────────────────────────────

export interface SiteRules {
  /** Hosts the browser may be sent to (a host or any subdomain of it). */
  hosts: string[];
  /** URLs that mean "signed out / checking it's you": stop, Joe signs in. */
  signedOut: RegExp[];
  /** What a link to the finished post looks like. */
  postUrl: RegExp;
  /** Where a run starts when Joe hasn't set his page link. */
  start: string;
}

export const SITES: Record<PostPlatform, SiteRules> = {
  facebook: {
    hosts: ["facebook.com"],
    signedOut: [/facebook\.com\/(login|checkpoint|recover|two_step_verification)/i, /facebook\.com\/.*login\.php/i],
    postUrl: /^https:\/\/(www\.|m\.|business\.)?facebook\.com\/\S+/i,
    start: "https://www.facebook.com/",
  },
  instagram: {
    hosts: ["instagram.com"],
    signedOut: [/instagram\.com\/accounts\/(login|suspended)/i, /instagram\.com\/challenge/i],
    postUrl: /^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+/i,
    start: "https://www.instagram.com/",
  },
  google_business: {
    hosts: ["business.google.com", "www.google.com", "google.com", "maps.google.com", "posts.gle", "g.page", "maps.app.goo.gl"],
    signedOut: [/accounts\.google\.com\//i],
    postUrl: /^https:\/\/((www\.)?google\.com|business\.google\.com|maps\.google\.com|posts\.gle|g\.page|maps\.app\.goo\.gl)\/\S+/i,
    start: "https://business.google.com/locations",
  },
};

/** accounts.google.com is reachable only to notice a sign-in prompt, never to act on. */
export function hostAllowed(platform: PostPlatform, rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return SITES[platform].hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

export function looksSignedOut(platform: PostPlatform, url: string): boolean {
  return SITES[platform].signedOut.some((re) => re.test(url));
}

export function validPostUrl(platform: PostPlatform, url: string): boolean {
  return SITES[platform].postUrl.test(url.trim()) && hostAllowed(platform, url.trim());
}

/** Joe's own accounts, from /marketing › Posting accounts (app_settings). */
export interface PostingAccounts {
  facebookPage: string;
  instagramHandle: string;
  googleBusinessName: string;
}

export const ACCOUNT_SETTING_KEYS: Record<keyof PostingAccounts, string> = {
  facebookPage: "marketing.post.facebook_page",
  instagramHandle: "marketing.post.instagram_handle",
  googleBusinessName: "marketing.post.google_business_name",
};

export function startUrlFor(platform: PostPlatform, accounts: PostingAccounts): string {
  if (platform === "facebook" && accounts.facebookPage && hostAllowed("facebook", accounts.facebookPage)) return accounts.facebookPage;
  if (platform === "instagram" && accounts.instagramHandle) return `https://www.instagram.com/${encodeURIComponent(accounts.instagramHandle.replace(/^@/, ""))}/`;
  return SITES[platform].start;
}

/** Plain words: whose account the post goes up as. */
export function accountLabel(platform: PostPlatform, a: PostingAccounts): string {
  if (platform === "facebook") return a.facebookPage ? `the Facebook page at ${a.facebookPage}` : "the SJ Carpentry Facebook page";
  if (platform === "instagram") return a.instagramHandle ? `the Instagram account @${a.instagramHandle.replace(/^@/, "")}` : "the SJ Carpentry Instagram account";
  return a.googleBusinessName ? `the Google Business Profile "${a.googleBusinessName}"` : "the SJ Carpentry Google Business Profile";
}

// ── The run journal ──────────────────────────────────────────────────────────
// Written by the posting run and its browser tools; read by the dispatcher's
// reconcile and by /marketing. `submittedAt` is written (and fsynced) BEFORE
// the final Post click, so a run that dies after it is never retried blindly.

export type JournalOutcome =
  | { kind: "posted"; url: string | null; at: string }
  | { kind: "not_posted"; reason: string; at: string; signIn?: boolean }
  | { kind: "unsure"; reason: string; at: string };

export interface PublicationJournal {
  intentId: string;
  platform: PostPlatform;
  draftId: number;
  startedAt: string;
  step: string;
  steps: { at: string; step: string }[];
  textFilledAt: string | null;
  photosUploadedAt: string | null;
  submittedAt: string | null;
  outcome: JournalOutcome | null;
  shots: string[];
  finishedAt: string | null;
}

export function journalPath(intentId: string): string {
  return path.join(runDir(intentId), "journal.json");
}

export function readJournal(intentId: string): PublicationJournal | null {
  try {
    return JSON.parse(readFileSync(journalPath(intentId), "utf8")) as PublicationJournal;
  } catch {
    return null;
  }
}

export function writeJournal(j: PublicationJournal): void {
  const dir = runDir(j.intentId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `journal.${process.pid}.tmp`);
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(j, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, journalPath(j.intentId));
}

export function newJournal(intentId: string, platform: PostPlatform, draftId: number): PublicationJournal {
  const at = new Date().toISOString();
  return { intentId, platform, draftId, startedAt: at, step: "starting", steps: [{ at, step: "starting" }], textFilledAt: null, photosUploadedAt: null, submittedAt: null, outcome: null, shots: [], finishedAt: null };
}

export function journalStep(j: PublicationJournal, step: string): PublicationJournal {
  const at = new Date().toISOString();
  return { ...j, step, steps: [...j.steps, { at, step }].slice(-80) };
}

export function journalExists(intentId: string): boolean {
  return existsSync(journalPath(intentId));
}

/** The final word on a run, given its journal and whether its unit is still
 *  running (null = can't tell). Mirrors the provider ReconcileOutcome.
 *  - posted                         → confirmed (the link, if one was found)
 *  - never pressed Post             → permanent_failure (nothing went up; Joe can try again)
 *  - pressed Post, no clear answer  → unknown: Joe looks and says
 */
export type RunVerdict =
  | { state: "confirmed"; providerRef: string | null; providerState: "posted" | "posted:no-link"; note: string }
  | { state: "permanent_failure"; note: string }
  | { state: "unknown"; note: string };

export function verdictFromJournal(j: PublicationJournal | null, unitActive: boolean | null): RunVerdict {
  if (!j) {
    if (unitActive === false) return { state: "permanent_failure", note: "The posting run never started. Nothing was posted." };
    return { state: "unknown", note: "The posting run is starting." };
  }
  const o = j.outcome;
  if (o?.kind === "posted") {
    return o.url
      ? { state: "confirmed", providerRef: o.url, providerState: "posted", note: `Posted: ${o.url}` }
      : { state: "confirmed", providerRef: null, providerState: "posted:no-link", note: "Posted; the agent couldn't find the link to it." };
  }
  if (o?.kind === "not_posted") {
    if (j.submittedAt) return { state: "unknown", note: `CHECK: Post was pressed, then the agent reported: ${o.reason}` };
    return { state: "permanent_failure", note: o.reason };
  }
  if (o?.kind === "unsure") return { state: "unknown", note: `CHECK: ${o.reason}` };
  if (unitActive) return { state: "unknown", note: `Still posting (${j.step}).` };
  if (unitActive === null) return { state: "unknown", note: `No answer from the posting run yet (${j.step}).` };
  if (j.submittedAt) return { state: "unknown", note: "CHECK: the posting run stopped after pressing Post, before it could confirm the post." };
  return { state: "permanent_failure", note: `The posting run stopped before posting (last step: ${j.step}). Nothing was posted.` };
}

/** Does this note mean Joe has to look at the site and say? */
export const needsOwnerCheck = (note: string | null | undefined) => /(^|reconcile: )CHECK:/.test(note ?? "");
