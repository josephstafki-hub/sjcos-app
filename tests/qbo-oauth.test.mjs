import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorizeUrl, exchangeCode, qboAppBase, qboRedirectUri, revokeToken, statesMatch, newOAuthState, INTUIT_AUTHORIZE_URL } from "../lib/accounting/qbo/oauth.ts";
import {
  fileTokenStore,
  getQboAdapter,
  qboConnectionSource,
  qboEnvironment,
  qboOAuthConfigured,
  readConnectionRecord,
  resetQboAdapter,
  writeConnectionRecord,
  QBO_DISCONNECTED_MESSAGE,
  QBO_NEVER_CONNECTED_MESSAGE,
  QboNotConnectedError,
} from "../lib/accounting/qbo/index.ts";

// "Connect to QuickBooks": the authorization-code flow that replaces the
// OAuth Playground, the CSRF state check, and how the adapter picks the
// company (button connection first, env fallback, explicit disconnect wins).

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => {
    globalThis.fetch = real;
  });
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

function sandboxEnv(extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "sjc-qbo-oauth-"));
  return {
    QBO_ENV: "sandbox",
    INTUIT_CLIENT_ID: "cid",
    INTUIT_CLIENT_SECRET: "csecret",
    QBO_TOKEN_FILE: path.join(dir, "token"),
    QBO_CONNECTION_FILE: path.join(dir, "conn.json"),
    ...extra,
  };
}

test("authorize URL carries the client, scope, redirect and state; redirect URI follows NEXT_PUBLIC_APP_URL", () => {
  const redirectUri = qboRedirectUri({ NEXT_PUBLIC_APP_URL: "https://os.example.com/" });
  assert.equal(redirectUri, "https://os.example.com/api/qbo/oauth/callback");
  assert.equal(qboRedirectUri({}), "https://os.sjcarpentryllc.com/api/qbo/oauth/callback");
  // Every bounce back to the app uses the public base, never the internal
  // listener that request.url reports behind nginx (https://localhost:3017).
  assert.equal(qboAppBase({}), "https://os.sjcarpentryllc.com");
  assert.equal(qboAppBase({ NEXT_PUBLIC_APP_URL: " https://os.example.com/ " }), "https://os.example.com");
  const u = new URL(authorizeUrl({ clientId: "cid", redirectUri, state: "st-1" }));
  assert.equal(`${u.origin}${u.pathname}`, INTUIT_AUTHORIZE_URL);
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.equal(u.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(u.searchParams.get("state"), "st-1");
});

test("CSRF state: random, and only an exact match passes", () => {
  const a = newOAuthState();
  const b = newOAuthState();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  assert.equal(statesMatch(a, a), true);
  assert.equal(statesMatch(a, b), false);
  assert.equal(statesMatch(a, a.slice(0, -1)), false);
  assert.equal(statesMatch(a, null), false);
  assert.equal(statesMatch(undefined, a), false);
  assert.equal(statesMatch("", ""), false);
});

test("code exchange posts an authorization_code grant with Basic auth; failures throw with Intuit's text", async () => {
  const seen = [];
  await withFetch(
    async (url, init) => {
      seen.push({ url: String(url), init });
      const body = new URLSearchParams(init.body);
      if (body.get("code") === "good") return json(200, { access_token: "acc", refresh_token: "rt-new", expires_in: 3600 });
      return json(400, { error: "invalid_grant" });
    },
    async () => {
      const r = await exchangeCode({ clientId: "cid", clientSecret: "csecret", code: "good", redirectUri: "https://os.example.com/api/qbo/oauth/callback" });
      assert.deepEqual(r, { refreshToken: "rt-new", accessToken: "acc", expiresIn: 3600 });
      const body = new URLSearchParams(seen[0].init.body);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("redirect_uri"), "https://os.example.com/api/qbo/oauth/callback");
      assert.equal(seen[0].init.headers.Authorization, `Basic ${Buffer.from("cid:csecret").toString("base64")}`);
      await assert.rejects(exchangeCode({ clientId: "cid", clientSecret: "csecret", code: "bad", redirectUri: "x" }), /token exchange failed \(400\).*invalid_grant/);
    },
  );
});

test("revoke treats 200 and 400 (already dead) as done, anything else as not", async () => {
  const codes = [200, 400, 500];
  await withFetch(
    async () => json(codes.shift(), {}),
    async () => {
      assert.deepEqual(await revokeToken({ clientId: "c", clientSecret: "s", token: "t" }), { ok: true, status: 200 });
      assert.deepEqual(await revokeToken({ clientId: "c", clientSecret: "s", token: "t" }), { ok: true, status: 400 });
      assert.deepEqual(await revokeToken({ clientId: "c", clientSecret: "s", token: "t" }), { ok: false, status: 500 });
    },
  );
});

test("app keys alone make the environment real (not fake); tests stay fake", () => {
  assert.equal(qboOAuthConfigured(sandboxEnv()), true);
  assert.equal(qboEnvironment(sandboxEnv()), "sandbox");
  assert.equal(qboEnvironment(sandboxEnv({ SJC_OUTBOUND_DISABLED: "1" })), "fake");
  assert.equal(qboEnvironment(sandboxEnv({ INTUIT_CLIENT_SECRET: "" })), "fake");
  assert.equal(qboEnvironment(sandboxEnv({ QBO_ENV: "" })), "fake");
});

test("connection source: env fallback, button record wins, other-environment record ignored, disconnect wins over env", () => {
  const env = sandboxEnv({ QBO_REALM_ID: "111", QBO_REFRESH_TOKEN: "seed" });
  assert.deepEqual(qboConnectionSource(env), { realmId: "111", refreshSeed: "seed", disconnected: false, via: "env" });

  writeConnectionRecord(env.QBO_CONNECTION_FILE, { environment: "sandbox", realmId: "222", at: "now" });
  assert.equal(statSync(env.QBO_CONNECTION_FILE).mode & 0o777, 0o600);
  assert.deepEqual(qboConnectionSource(env), { realmId: "222", refreshSeed: "", disconnected: false, via: "button" });

  // A record written for production must not steer a sandbox run (or vice versa).
  assert.equal(qboConnectionSource({ ...env, QBO_ENV: "production" }).via, "env");

  writeConnectionRecord(env.QBO_CONNECTION_FILE, { environment: "sandbox", realmId: "222", disconnected: true, at: "now" });
  assert.deepEqual(qboConnectionSource(env), { realmId: "222", refreshSeed: "", disconnected: true, via: "button" });
  assert.equal(readConnectionRecord(env.QBO_CONNECTION_FILE).disconnected, true);

  // Garbage in the file reads as "no record", never as a crash.
  writeFileSync(env.QBO_CONNECTION_FILE, "{not json");
  assert.equal(readConnectionRecord(env.QBO_CONNECTION_FILE), null);
  assert.equal(qboConnectionSource(env).via, "env");
});

test("adapter: disconnected and never-connected refuse every call with the reconnect text; no request leaves", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls++;
      return json(500, {});
    },
    async () => {
      resetQboAdapter();
      const never = sandboxEnv();
      await assert.rejects(getQboAdapter(never).companyInfo(), (e) => e instanceof QboNotConnectedError && e.message === QBO_NEVER_CONNECTED_MESSAGE);
      const off = sandboxEnv({ QBO_REALM_ID: "111", QBO_REFRESH_TOKEN: "seed" });
      writeConnectionRecord(off.QBO_CONNECTION_FILE, { environment: "sandbox", realmId: "111", disconnected: true, at: "now" });
      const a = getQboAdapter(off);
      for (const call of [a.companyInfo(), a.listChanges("Invoice", null), a.get("Invoice", "1"), a.create("Invoice", {})]) {
        await assert.rejects(call, (e) => e instanceof QboNotConnectedError && e.message === QBO_DISCONNECTED_MESSAGE);
      }
      assert.equal(calls, 0);
    },
  );
});

test("adapter: a button connection uses its own company and stored token, never the env seed; reconnect takes effect without a restart", async () => {
  const tried = [];
  const realms = [];
  await withFetch(
    async (url, init) => {
      if (String(url).includes("/oauth2/v1/tokens/bearer")) {
        const rt = new URLSearchParams(init.body).get("refresh_token");
        tried.push(rt);
        if (rt === "button-rt" || rt === "button-rt-2") return json(200, { access_token: `acc-${rt}`, expires_in: 3600, refresh_token: rt });
        return json(400, { error: "invalid_grant" });
      }
      realms.push(String(url).split("/v3/company/")[1].split("/")[0]);
      return json(200, { CompanyInfo: { CompanyName: "ZZ Co" } });
    },
    async () => {
      resetQboAdapter();
      const env = sandboxEnv({ QBO_REALM_ID: "111", QBO_REFRESH_TOKEN: "old-seed" });
      fileTokenStore(env.QBO_TOKEN_FILE).save("button-rt");
      writeConnectionRecord(env.QBO_CONNECTION_FILE, { environment: "sandbox", realmId: "222", at: "now" });
      assert.equal((await getQboAdapter(env).companyInfo()).realmId, "222");
      assert.deepEqual(realms, ["222"]);
      assert.deepEqual(tried, ["button-rt"]);

      // Stored token dies: reconnect error, and the env seed (another company) is NOT tried.
      fileTokenStore(env.QBO_TOKEN_FILE).save("dead");
      writeConnectionRecord(env.QBO_CONNECTION_FILE, { environment: "sandbox", realmId: "333", at: "later" });
      await assert.rejects(getQboAdapter(env).companyInfo(), /reconnect QuickBooks/);
      assert.deepEqual(tried.slice(1), ["dead"]);

      // Connect again (new company + token written by the callback): picked up on the next call.
      fileTokenStore(env.QBO_TOKEN_FILE).save("button-rt-2");
      writeConnectionRecord(env.QBO_CONNECTION_FILE, { environment: "sandbox", realmId: "444", at: "again" });
      assert.equal((await getQboAdapter(env).companyInfo()).realmId, "444");
      assert.equal(readFileSync(env.QBO_TOKEN_FILE, "utf8").trim(), "button-rt-2");
    },
  );
});
