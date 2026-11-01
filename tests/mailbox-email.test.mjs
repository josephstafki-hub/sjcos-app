// The owner's env mailbox often has no GMAIL_ACCOUNT_EMAIL. Preferences, synced
// drafts and AI suggestions are keyed by the address, so it must be resolved —
// and a known address must never load the Gmail connector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

globalThis.__mbx = { mailbox: null, profileCalls: 0, gmailLoaded: 0, fail: false };
const stubs = {
  "./mailbox": "export const activeMailbox=()=>globalThis.__mbx.mailbox;",
  "./gmail": "globalThis.__mbx.gmailLoaded++; export const fetchProfileEmail=async()=>{globalThis.__mbx.profileCalls++; if(globalThis.__mbx.fail) throw new Error('quota'); return 'joe@sjcarpentry.test';};",
};
registerHooks({
  resolve(s, c, n) { if (s in stubs && c.parentURL?.endsWith("/lib/mailbox-email.ts")) return { url: "stub:mbx:" + s, shortCircuit: true }; return n(s, c); },
  load(u, c, n) { return u.startsWith("stub:mbx:") ? { format: "module", source: stubs[u.slice(9)], shortCircuit: true } : n(u, c); },
});
const { ensureMailboxEmail } = await import("../lib/mailbox-email.ts");

test("a configured address is returned lower-case without loading Gmail", async () => {
  globalThis.__mbx.mailbox = { email: "Joe@Example.test", refreshToken: "r" };
  assert.equal(await ensureMailboxEmail(), "joe@example.test");
  assert.equal(globalThis.__mbx.gmailLoaded, 0);
});
test("an env mailbox with no address asks Gmail's profile and fills the active scope", async () => {
  const mb = { email: null, refreshToken: "r" };
  globalThis.__mbx.mailbox = mb;
  assert.equal(await ensureMailboxEmail(), "joe@sjcarpentry.test");
  assert.equal(mb.email, "joe@sjcarpentry.test");
  assert.equal(globalThis.__mbx.profileCalls, 1);
});
test("no token or a Gmail failure gives an empty address, never a throw", async () => {
  globalThis.__mbx.mailbox = { email: null, refreshToken: null };
  assert.equal(await ensureMailboxEmail(), "");
  globalThis.__mbx.mailbox = { email: null, refreshToken: "r" };
  globalThis.__mbx.fail = true;
  assert.equal(await ensureMailboxEmail(), "");
});
