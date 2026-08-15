import "server-only";

import { query } from "@/lib/db";

// Live "what the agent is doing" log for a run — the dev_agent_runs.activity
// column as an append-only, capped, throttled log rather than a single line
// that keeps getting replaced. Everything the panel shows while a turn runs
// (Hermes tool calls, Qwen's answer taking shape, ladder stages, Claude's
// interim narration) flows through here. In-memory buffer per run in this
// long-lived process; flushed to the row at most every FLUSH_MS and on
// finish, so a chatty Hermes turn doesn't turn into hundreds of UPDATEs.

const MAX_LINES = 60;
const FLUSH_MS = 700;

export interface RunLog {
  /** Append a line (consecutive duplicates collapse). */
  push: (line: string) => void;
  /** Replace the LAST line — for a value that keeps growing (partial text). */
  tail: (line: string) => void;
  /** Force a write now (call when the run finishes). */
  flush: () => Promise<void>;
  lines: () => string[];
}

const logs = new Map<string, { lines: string[]; timer: NodeJS.Timeout | null; dirty: boolean; live: boolean }>();

export function runLog(runId: string, seed?: string[]): RunLog {
  let st = logs.get(runId);
  if (!st) {
    st = { lines: seed ? [...seed] : [], timer: null, dirty: false, live: false };
    logs.set(runId, st);
  }
  const state = st;

  const write = async () => {
    state.dirty = false;
    await query(`UPDATE dev_agent_runs SET activity = $2, updated_at = now() WHERE id = $1`, [
      runId,
      state.lines.join("\n"),
    ]).catch(() => {});
  };
  const schedule = () => {
    state.dirty = true;
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.dirty) void write();
    }, FLUSH_MS);
  };

  return {
    push(line) {
      const l = line.replace(/\s+/g, " ").trim().slice(0, 240);
      if (!l) return;
      if (state.lines[state.lines.length - 1] === l) return;
      state.lines.push(l);
      state.live = false;
      if (state.lines.length > MAX_LINES) state.lines.splice(0, state.lines.length - MAX_LINES);
      schedule();
    },
    tail(line) {
      const l = line.replace(/\s+/g, " ").trim().slice(0, 240);
      if (!l) return;
      if (state.live) state.lines[state.lines.length - 1] = l;
      else {
        state.lines.push(l);
        state.live = true;
        if (state.lines.length > MAX_LINES) state.lines.splice(0, state.lines.length - MAX_LINES);
      }
      schedule();
    },
    async flush() {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      await write();
      logs.delete(runId);
    },
    lines: () => [...state.lines],
  };
}

// ─── Progress adapters ───────────────────────────────────────────────────────

/** Hermes progress → log lines: each tool call as it starts ("💻 terminal:
 *  node …"), then the answer taking shape as a growing tail line. */
export function hermesProgress(log: RunLog) {
  return {
    onTool(evt: { tool: string; label?: string; emoji?: string; status: string }) {
      if (evt.status !== "running") return;
      const what = evt.label ? `${evt.tool}: ${evt.label}` : evt.tool;
      log.push(`${evt.emoji ? `${evt.emoji} ` : ""}${what}`);
    },
    onPartial(text: string) {
      log.tail(`Hermes: ${text.slice(-200)}`);
    },
  };
}

/** Qwen progress → the answer taking shape as a growing tail line. */
export function qwenProgress(log: RunLog) {
  return (text: string) => log.tail(`Qwen: ${text.slice(-200)}`);
}
