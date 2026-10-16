import "server-only";

// Start the filing agent NOW instead of waiting for the worker timer (every 3
// minutes, and possibly busy with a long run). When Joe sorts a document on
// /unsorted the 'filing' trigger is already queued in the same transaction;
// this spawns one detached worker pass that claims only 'filing' triggers and
// drains them (scripts/run-business-agent.mjs --kinds filing --drain), on the
// cheap model (SJC_FILING_AGENT_MODEL, default haiku).
//
// Best effort by design: if the spawn fails, the regular worker timer still
// picks the trigger up. The 'agents' lane pause is honored by the worker pass.
// At most two of these run at once; a running one drains anything queued
// while it works.
//
// On by default in production; elsewhere only with SJC_FILING_AGENT_KICK=1
// (a dev box usually has no logged-in claude CLI). SJC_FILING_AGENT_KICK=0
// turns it off everywhere.

import { spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const live = new Set<ChildProcess>();
const MAX_LIVE = 2;

function enabled(): boolean {
  const flag = process.env.SJC_FILING_AGENT_KICK;
  if (flag === "0") return false;
  if (flag === "1") return true;
  return process.env.NODE_ENV === "production";
}

export function kickFilingAgent(): void {
  if (!enabled() || live.size >= MAX_LIVE) return;
  try {
    const log = openSync(path.join(os.tmpdir(), "sjcos-filing-agent.log"), "a");
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), "scripts/run-business-agent.mjs"), "--once", "--kinds", "filing", "--drain", "--limit", "1"],
      { cwd: process.cwd(), detached: true, stdio: ["ignore", log, log], env: process.env },
    );
    live.add(child);
    const done = () => live.delete(child);
    child.on("exit", done);
    child.on("error", done);
    child.unref();
  } catch {
    /* the worker timer still runs it */
  }
}
