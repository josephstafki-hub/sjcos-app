// E-sign source-event processor: the retry for the steps a signature sets
// off (lib/esign-hooks.ts) when one of them failed inline. All the steps are
// idempotent, so running the whole set again is safe. App-side module, loaded
// by scripts/sjcos-worker.mjs through lib/worker/node-hooks.mjs.

import { runSignatureHooks } from "@/lib/esign-hooks";
import type { SourceEventProcessor } from "./types";

export const esignProcessor: SourceEventProcessor = {
  provider: "esign",
  async process(event) {
    const id = Number((event.payload as { signature_request_id?: unknown }).signature_request_id);
    if (!Number.isInteger(id) || id <= 0) return { ok: true, note: "no signature request id; ignored" };
    const failed = await runSignatureHooks(id);
    return failed.length ? { ok: false, error: failed.join(" · "), retryInSeconds: 300 } : { ok: true, note: `signature ${id}: steps done` };
  },
};
