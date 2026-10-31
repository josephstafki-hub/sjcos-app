// Publisher provider — hands an approved marketing post to the posting agent
// (A17). The "provider call" is starting ONE memory-capped systemd unit that
// runs scripts/run-publication.mjs for this intent; the run re-checks the
// approval and the photo rights, drives the browser, and writes its journal
// (lib/publisher/core.ts). So:
//
//   send       accepted   the run started (providerRef = its unit name)
//              retryable  the browser is busy, or the unit couldn't start — nothing left the box
//              unknown    a journal already exists for this intent (never start a second run)
//   reconcile  reads the journal: posted → confirmed; never pressed Post →
//              permanent_failure; pressed Post without a clear answer →
//              unknown, and Joe looks and says on /marketing.
//
// Fake mode (SJC_OUTBOUND_DISABLED=1): nothing is started; the would-be run
// goes to the fake outbox like every other provider.
//
// Pure: node builtins + lib/publisher/core.ts only.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { isPostPlatform } from "../marketing-types.ts";
import { browserHolder, journalExists, publishUnitFor, readJournal, verdictFromJournal } from "../publisher/core.ts";
import { outboundDisabled, recordFakeSend, type Provider, type ProviderResult, type ReconcileOutcome } from "./types.ts";

export interface PublicationPayload {
  draft_id: number;
  platform: string;
  body: string;
  media: string[];
  [k: string]: unknown;
}

export interface PublisherLauncher {
  /** Start the posting run for this intent. */
  start(intentId: string, unit: string): { ok: true } | { ok: false; error: string };
  /** Is that unit still running? null = can't tell. */
  active(unit: string): boolean | null;
}

/** Memory and time limits on one posting run (box rules: 24 GB for everything Joe runs). */
export const RUN_LIMITS = { memoryMax: "3G", runtimeMaxSec: 25 * 60 };

function userBusEnv(): NodeJS.ProcessEnv {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  return { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}` };
}

export const systemdLauncher: PublisherLauncher = {
  start(intentId, unit) {
    const repo = process.env.SJC_REPO_DIR || process.cwd();
    const r = spawnSync(
      "systemd-run",
      [
        "--user",
        `--unit=${unit}`,
        "--collect",
        "--quiet",
        "-p", `MemoryMax=${RUN_LIMITS.memoryMax}`,
        "-p", "MemorySwapMax=0",
        "-p", `RuntimeMaxSec=${RUN_LIMITS.runtimeMaxSec}`,
        "-p", "Restart=no",
        `--working-directory=${repo}`,
        process.execPath,
        path.join(repo, "scripts", "run-publication.mjs"),
        "--intent",
        intentId,
      ],
      { encoding: "utf8", env: userBusEnv(), timeout: 20_000 },
    );
    if (r.status === 0) return { ok: true };
    return { ok: false, error: (r.stderr || r.error?.message || `systemd-run exited ${r.status}`).trim().slice(0, 400) };
  },
  active(unit) {
    const r = spawnSync("systemctl", ["--user", "is-active", `${unit}.service`], { encoding: "utf8", env: userBusEnv(), timeout: 10_000 });
    const s = (r.stdout || "").trim();
    if (s === "active" || s === "activating" || s === "deactivating") return true;
    if (s === "inactive" || s === "failed" || s === "unknown") return false;
    return null;
  },
};

export function makePublisherProvider(launcher: PublisherLauncher = systemdLauncher): Provider<PublicationPayload> {
  return {
    name: "publisher",
    async send(payload, ctx): Promise<ProviderResult> {
      if (outboundDisabled()) return recordFakeSend("publisher", payload, ctx);
      if (!isPostPlatform(payload.platform)) return { responseClass: "permanent", error: `"${payload.platform}" isn't a place the posting agent posts to.`, transmitted: false };
      const unit = publishUnitFor(ctx.intentId);
      if (journalExists(ctx.intentId)) {
        // A run for this intent already began: starting another could post twice.
        return { responseClass: "unknown", providerRef: unit, error: "A posting run for this post already started; waiting on its answer.", transmitted: true };
      }
      const holder = browserHolder();
      if (holder) {
        const who = holder.mode === "signin" ? "Joe is signing in to a site" : "another post is going up";
        return { responseClass: "retryable", error: `The posting browser is in use (${who}). It tries again in a few minutes.`, transmitted: false, retryInSeconds: 300 };
      }
      const started = launcher.start(ctx.intentId, unit);
      if (!started.ok) return { responseClass: "retryable", error: `Couldn't start the posting run: ${started.error}`, transmitted: false, retryInSeconds: 300 };
      return { responseClass: "accepted", providerRef: unit, providerState: "posting", transmitted: true };
    },
    async reconcile(intent): Promise<ReconcileOutcome> {
      const v = verdictFromJournal(readJournal(intent.id), launcher.active(publishUnitFor(intent.id)));
      if (v.state === "confirmed") return { state: "confirmed", providerRef: v.providerRef, providerState: v.providerState, note: v.note };
      return v;
    },
  };
}
