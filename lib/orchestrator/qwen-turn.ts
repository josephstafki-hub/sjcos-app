import "server-only";

import { agentGrounding } from "@/lib/agent-context";
import { isVisionModel, qwenChat } from "@/lib/ai";
import { steerTicker, takePendingSteers } from "@/lib/run-steers";
import { qwenProgress, type RunLog } from "./activity";
import { composeQwenTurns } from "./thread";

/**
 * Qwen's answer for a panel run, restarted on every steer. Qwen is one
 * streamed completion with no tool loop to inject into, so a steer aborts the
 * stream and Qwen starts over from the thread — which now ends with the
 * steer (its transcript line commits with its row, lib/run-steers.ts).
 */
export async function qwenSteerable(
  runId: string,
  conversationId: string,
  pageContext: string | undefined,
  log: RunLog,
): Promise<string> {
  for (;;) {
    const ctl = new AbortController();
    let steered = false;
    const ticker = steerTicker(async () => {
      if ((await takePendingSteers(runId, "restart")).length) {
        steered = true;
        ctl.abort();
      }
    });
    let raw = "";
    try {
      const turns = await composeQwenTurns(conversationId, { vision: isVisionModel() });
      raw = await qwenChat(turns, agentGrounding(pageContext), qwenProgress(log), ctl.signal);
    } catch (err) {
      if (!steered) throw err;
    } finally {
      await ticker.stop();
    }
    // A steer claimed in the last tick, after the stream had already ended,
    // still restarts — the answer we have never saw it.
    if (!steered) return raw;
    log.push("↪ Got your steer — Qwen is starting over with it…");
  }
}
