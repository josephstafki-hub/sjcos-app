// Square source-event processor (A20). The webhook processes each event
// inline; one it couldn't finish is stored 'failed' and this is the retry
// (the worker claims failed events again until max_attempts). Processing is
// idempotent per payment / refund / dispute id, so a retry or a late
// duplicate never records money twice. App-side module, loaded by
// scripts/sjcos-worker.mjs through lib/worker/node-hooks.mjs.

import { processStoredSquareEvent } from "@/lib/payments/server";
import type { SourceEventProcessor } from "./types";

export const squareProcessor: SourceEventProcessor = {
  provider: "square",
  async process(event) {
    if (!event.verified) return { ok: true, note: "unverified; ignored" };
    return processStoredSquareEvent(event);
  },
};
