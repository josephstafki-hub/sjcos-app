import "server-only";

// Next-side glue for the posting agent (A17):
//   • what an approved / declined publish_marketing card does,
//   • Joe's "Try again" and "it's up / it isn't" on /marketing,
//   • his posting accounts (app_settings),
//   • the sign-in window: one browser on this box (scripts/publisher-browser.mjs,
//     a memory-capped systemd unit) that Joe drives from /marketing through a
//     live picture, so he types his own passwords and codes. The app only
//     relays his clicks and keys over a private socket; nothing is stored.

import http from "node:http";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runDirect, withTransaction } from "@/lib/commands/db";
import type { Decision } from "@/lib/commands/decisions";
import type { ActionIntent } from "@/lib/commands/intents";
import type { Principal } from "@/lib/commands/principal";
import { queueApprovedPublication, retryPublication, settlePublicationByOwner } from "@/lib/closeout/marketing";
import { describeOutcome, dispatchIntentsNow } from "@/lib/dispatch/db";
import { EFFECTS } from "@/lib/dispatch/effects";
import { isPostPlatform, POST_PLATFORM_LABEL, type PostPlatform } from "@/lib/marketing-types";
import { ACCOUNT_SETTING_KEYS, browserHolder, SIGNIN_UNIT, signinSocketPath, type PostingAccounts } from "@/lib/publisher/core";

const words = (p: string) => (isPostPlatform(p) ? POST_PLATFORM_LABEL[p] : p);

// ── Cards ────────────────────────────────────────────────────────────────────

/** Approved card → queue the post and hand it to the posting agent now. */
export async function postApprovedPublication(decision: Decision): Promise<string> {
  const draftId = Number(decision.target_id);
  const principal: Principal = { kind: "service", name: `publication-card:${decision.id}` };
  const q = await withTransaction((run) => queueApprovedPublication(run, principal, draftId));
  if (!q.ok) return `Approved, but nothing was posted: ${q.reason}`;
  const where = words(decision.recipient ?? "");
  const [o] = await dispatchIntentsNow([q.intentId]);
  const v = describeOutcome(o, `Post to ${where}`);
  if (v.ok) return `The posting agent is putting it up on ${where} now. /marketing shows the link when it's up.`;
  return v.error;
}

/** Declined card → the draft is a draft again. */
export async function publicationDeclined(decision: Decision): Promise<void> {
  await runDirect(`UPDATE marketing_drafts SET status = 'draft' WHERE id = $1 AND status = 'pending_decision' AND publication_decision_id = $2`, [Number(decision.target_id), decision.id]);
}

// ── Joe's buttons ────────────────────────────────────────────────────────────

export async function retryPost(principal: Principal, draftId: number): Promise<{ ok: boolean; message: string }> {
  const q = await withTransaction((run) => retryPublication(run, principal, draftId));
  if (!q.ok) return { ok: false, message: q.reason };
  const [o] = await dispatchIntentsNow([q.intentId]);
  const v = describeOutcome(o, "Post");
  return v.ok ? { ok: true, message: "Trying again now." } : { ok: false, message: v.error };
}

/** Joe looked: it's up (with its link) or it isn't. Settles the open send and
 *  runs the same status flip the dispatcher would. */
export async function settlePost(principal: Principal, draftId: number, answer: { posted: true; url: string | null } | { posted: false }): Promise<{ ok: boolean; message: string }> {
  return withTransaction(async (run) => {
    const r = await settlePublicationByOwner(run, principal, draftId, answer);
    if (!r.ok) return { ok: false, message: r.reason };
    if (r.intent) await runEffect(run, r.intent);
    return { ok: true, message: answer.posted ? "Marked as posted." : "Marked as not posted. You can try again." };
  });
}

async function runEffect(run: Parameters<typeof settlePublicationByOwner>[0], intent: ActionIntent): Promise<void> {
  const fx = EFFECTS.publication;
  if (intent.state === "confirmed") {
    await fx(run, intent, { responseClass: "confirmed", providerRef: intent.provider_ref, providerState: intent.provider_state, transmitted: true }, "confirmed");
  } else if (intent.state === "permanent_failure") {
    await fx(run, intent, { responseClass: "permanent", error: "Joe checked: it isn't up.", transmitted: true }, "permanent_failure");
  }
}

// ── Posting accounts ─────────────────────────────────────────────────────────

export async function getPostingAccounts(): Promise<PostingAccounts> {
  const rows = await runDirect<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key = ANY($1::text[])`, [Object.values(ACCOUNT_SETTING_KEYS)]);
  const v = (k: keyof PostingAccounts) => rows.find((r) => r.key === ACCOUNT_SETTING_KEYS[k])?.value ?? "";
  return { facebookPage: v("facebookPage"), instagramHandle: v("instagramHandle"), googleBusinessName: v("googleBusinessName") };
}

export async function savePostingAccounts(a: PostingAccounts): Promise<void> {
  for (const [k, key] of Object.entries(ACCOUNT_SETTING_KEYS) as [keyof PostingAccounts, string][]) {
    await runDirect(`INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, (a[k] ?? "").trim().slice(0, 300)]);
  }
}

// ── Sign-in window ───────────────────────────────────────────────────────────

const SIGNIN_LIMITS = { memoryMax: "2G", runtimeMaxSec: 30 * 60 };

function userEnv(): NodeJS.ProcessEnv {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  return { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}` };
}

export type SigninStatus =
  | { open: true; platform: string; url: string; title: string; width: number; height: number }
  | { open: false; busy: string | null };

export async function signinStatus(): Promise<SigninStatus> {
  const s = await socketCall<{ platform: string; url: string; title: string; width: number; height: number }>("GET", "/status").catch(() => null);
  if (s) return { open: true, ...s };
  const h = browserHolder();
  return { open: false, busy: h ? (h.mode === "post" ? "A post is going up right now; try again in a few minutes." : "The sign-in window is starting.") : null };
}

/** Open the sign-in window on one site. One browser at a time: refused while
 *  a post is going up. */
export async function startSignin(platform: PostPlatform): Promise<{ ok: boolean; message: string }> {
  const live = await socketCall("GET", "/status").catch(() => null);
  if (live) {
    await socketCall("POST", "/goto", { platform }).catch(() => null);
    return { ok: true, message: "Switched." };
  }
  const h = browserHolder();
  if (h) return { ok: false, message: h.mode === "post" ? "A post is going up right now; try again in a few minutes." : "The sign-in window is already starting." };
  const repo = process.env.SJC_REPO_DIR || process.cwd();
  const r = spawnSync(
    "systemd-run",
    [
      "--user",
      `--unit=${SIGNIN_UNIT}`,
      "--collect",
      "--quiet",
      "-p", `MemoryMax=${SIGNIN_LIMITS.memoryMax}`,
      "-p", "MemorySwapMax=0",
      "-p", `RuntimeMaxSec=${SIGNIN_LIMITS.runtimeMaxSec}`,
      "-p", "Restart=no",
      `--working-directory=${repo}`,
      process.execPath,
      path.join(repo, "scripts", "publisher-browser.mjs"),
      "--platform",
      platform,
    ],
    { encoding: "utf8", env: userEnv(), timeout: 20_000 },
  );
  if (r.status !== 0) return { ok: false, message: `Couldn't open the sign-in window: ${(r.stderr || r.error?.message || "").trim().slice(0, 300)}` };
  return { ok: true, message: "Opening…" };
}

export async function stopSignin(): Promise<void> {
  await socketCall("POST", "/close").catch(() => null);
  spawnSync("systemctl", ["--user", "stop", `${SIGNIN_UNIT}.service`], { env: userEnv(), timeout: 15_000 });
}

/** One JPEG of the sign-in window. */
export async function signinFrame(): Promise<Buffer | null> {
  return socketRaw("GET", "/frame").catch(() => null);
}

export type SigninInput =
  | { type: "click"; x: number; y: number }
  | { type: "scroll"; dy: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string }
  | { type: "back" };

export async function signinInput(input: SigninInput): Promise<boolean> {
  return socketCall("POST", "/input", input).then(() => true).catch(() => false);
}

// ── Socket plumbing (the sign-in window listens on a 0600 unix socket) ──────

function socketRaw(method: string, route: string, body?: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { socketPath: signinSocketPath(), path: route, method, timeout: 8_000, headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => ((res.statusCode ?? 500) < 300 ? resolve(Buffer.concat(chunks)) : reject(new Error(`sign-in window answered ${res.statusCode}`))));
      },
    );
    req.on("timeout", () => req.destroy(new Error("sign-in window timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function socketCall<T = unknown>(method: string, route: string, body?: unknown): Promise<T> {
  const buf = await socketRaw(method, route, body);
  return (buf.length ? JSON.parse(buf.toString("utf8")) : null) as T;
}
