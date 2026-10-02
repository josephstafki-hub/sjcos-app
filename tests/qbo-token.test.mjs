import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HttpsQbo } from "../lib/accounting/qbo/https.ts";
import { fileTokenStore } from "../lib/accounting/qbo/index.ts";

// A14: Intuit rotates the refresh token. The newest one must survive between
// runs (0600 file), a stale stored token must fall back to the env seed, and
// a dead seed must say "reconnect" rather than loop.

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = real;
  });
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test("rotated refresh token is saved 0600 and used on the next start; stale stored token falls back to the env seed", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sjc-qbo-"));
  const file = path.join(dir, "nested", "qbo-refresh-token");
  const store = fileTokenStore(file);
  const used = [];
  const handler = async (url, init) => {
    if (String(url).includes("/oauth2/v1/tokens/bearer")) {
      const rt = new URLSearchParams(init.body).get("refresh_token");
      used.push(rt);
      if (rt === "seed-1") return json(200, { access_token: "acc-1", expires_in: 3600, refresh_token: "rotated-2" });
      if (rt === "rotated-2") return json(200, { access_token: "acc-2", expires_in: 3600, refresh_token: "rotated-2" });
      if (rt === "seed-9") return json(200, { access_token: "acc-9", expires_in: 3600, refresh_token: "rotated-10" });
      return json(400, { error: "invalid_grant" });
    }
    return json(200, { CompanyInfo: { CompanyName: "ZZ Co" } });
  };
  await withFetch(handler, async () => {
    const creds = { clientId: "id", clientSecret: "secret", realmId: "123", refreshToken: "seed-1", environment: "sandbox", tokenStore: store };
    assert.equal((await new HttpsQbo(creds).companyInfo()).companyName, "ZZ Co");
    assert.equal(readFileSync(file, "utf8").trim(), "rotated-2");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    // A fresh process: the stored token is tried first.
    await new HttpsQbo(creds).companyInfo();
    assert.deepEqual(used, ["seed-1", "rotated-2"]);
    // Stored token went stale; Joe pasted a fresh seed → it is used and the store is replaced.
    store.save("stale-x");
    await new HttpsQbo({ ...creds, refreshToken: "seed-9" }).companyInfo();
    assert.deepEqual(used.slice(2), ["stale-x", "seed-9"]);
    assert.equal(readFileSync(file, "utf8").trim(), "rotated-10");
    // Everything dead → a reconnect error, two attempts, no loop.
    store.save("dead-1");
    await assert.rejects(new HttpsQbo({ ...creds, refreshToken: "dead-2" }).companyInfo(), /reconnect QuickBooks/);
    assert.deepEqual(used.slice(4), ["dead-1", "dead-2"]);
  });
});
