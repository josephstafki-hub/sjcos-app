// The inbox's Gmail load: never shows the demo mailbox when Gmail fails, and
// re-uses one load for a short while instead of re-fetching the whole mailbox
// on every page refresh (which ran Joe's account into Google's rate limit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

globalThis.__gmail = { pageCalls: 0, fail: null };
const stubs = {
  "./ai": "export const ai = {};",
  "./db": "export const query = async () => ({ rows: [] });",
  "./dal": 'export const getCurrentUser = async () => ({ id: "u", role: "owner", name: "Joe" });',
  "./mailbox":
    'export const activeMailbox = () => ({ refreshToken: "r", email: "joe@example.test", linked: false }); export const mailboxFor = async () => ({ refreshToken: "r", email: "joe@example.test", linked: false }); export const runWithMailbox = (mb, fn) => fn();',
  "./dev-agents": "export const askHermes = async () => ({});",
  "./gmail": `
    export const gmailOAuthAppConfigured = () => true;
    export const fetchThreads = async () => [];
    export const fetchLabels = async () => [];
    export const fetchLabelCounts = async () => [];
    export const fetchThreadPage = async () => {
      globalThis.__gmail.pageCalls++;
      if (globalThis.__gmail.fail) throw new Error(globalThis.__gmail.fail);
      return { threads: [], nextPageToken: null };
    };`,
};
registerHooks({
  resolve(s, c, n) {
    if (s in stubs && c.parentURL?.endsWith("/lib/inbox.ts")) return { url: `stub:${s}`, shortCircuit: true };
    return n(s, c);
  },
  load(u, c, n) {
    if (u.startsWith("stub:")) return { format: "module", source: stubs[u.slice(5)], shortCircuit: true };
    return n(u, c);
  },
});
const { getInboxData, invalidateInboxCache } = await import("../lib/inbox.ts");

test("a Gmail failure shows an empty mailbox and says why — never the demo conversations", async () => {
  invalidateInboxCache();
  globalThis.__gmail.fail = "Gmail rate limit hit (threads.get) after 3 attempts: Quota exceeded";
  const data = await getInboxData();
  assert.equal(data.threads.length, 0, "no made-up threads");
  assert.match(data.loadError ?? "", /too many requests/i);
  assert.equal(data.mailbox.connected, true);
});

test("one Gmail load serves page refreshes for a short while; a failure or an inbox action re-fetches", async () => {
  invalidateInboxCache();
  globalThis.__gmail.fail = "Gmail didn't answer";
  globalThis.__gmail.pageCalls = 0;
  await getInboxData();
  globalThis.__gmail.fail = null;
  const ok = await getInboxData();
  assert.equal(globalThis.__gmail.pageCalls, 2, "a failed load is not kept");
  assert.equal(ok.loadError, undefined);
  await getInboxData();
  await getInboxData();
  assert.equal(globalThis.__gmail.pageCalls, 2, "refreshes re-use the load");
  invalidateInboxCache();
  await getInboxData();
  assert.equal(globalThis.__gmail.pageCalls, 3, "an inbox action clears it");
});
