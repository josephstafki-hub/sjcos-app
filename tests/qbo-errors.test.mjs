import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpsQbo } from "../lib/accounting/qbo/https.ts";
import { QboApiError, QboNotConnectedError, qboFaults } from "../lib/accounting/qbo/types.ts";
import { exportEach } from "../lib/accounting/qbo/sync.ts";

// Intuit's production checklist: API errors (syntax and validation) are
// handled, the intuit_tid response header is captured, and error details are
// kept in a shareable log. One rejected record must not stop the others.

const quiet = async (fn) => {
  const real = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  try {
    return await fn(lines);
  } finally {
    console.error = real;
  }
};
const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const validationFault = { Fault: { Error: [{ Message: "Required param missing, need to supply the required value for the API", Detail: "Required parameter Line.Amount is missing in the request", code: "2020" }], type: "ValidationFault" } };

test("Fault bodies read as 'Message: Detail (code N)'; non-JSON reads as nothing", () => {
  assert.deepEqual(qboFaults(JSON.stringify(validationFault)), ["Required param missing, need to supply the required value for the API: Required parameter Line.Amount is missing in the request (code 2020)"]);
  assert.deepEqual(qboFaults(JSON.stringify({ Fault: { Error: [{ Message: "Invalid query", Detail: "Invalid query", code: "4000" }] } })), ["Invalid query (code 4000)"]);
  assert.deepEqual(qboFaults("<html>bad gateway</html>"), []);
});

test("a rejected API call throws QboApiError carrying the status, the intuit_tid and Intuit's own error text, and logs one line", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/oauth2/v1/tokens/bearer")) return res(200, { access_token: "acc", expires_in: 3600, refresh_token: "rt" });
    if (String(url).includes("/query")) return res(400, { Fault: { Error: [{ Message: "Invalid query", Detail: "QueryParserError: Encountered \"FROM\"", code: "4000" }] } }, { intuit_tid: "1-6a1b2c3d-query" });
    return res(400, validationFault, { intuit_tid: "1-6a1b2c3d-create" });
  };
  try {
    await quiet(async (lines) => {
      const qbo = new HttpsQbo({ clientId: "c", clientSecret: "s", realmId: "123", refreshToken: "rt", environment: "sandbox" });
      const err = await qbo.create("Invoice", { TotalAmt: 1 }).catch((e) => e);
      assert.ok(err instanceof QboApiError);
      assert.equal(err.status, 400);
      assert.equal(err.intuitTid, "1-6a1b2c3d-create");
      assert.match(err.message, /QuickBooks POST \/invoice → 400 \[intuit_tid 1-6a1b2c3d-create\]: Required param missing.*Line\.Amount.*\(code 2020\)/);
      const qerr = await qbo.listChanges("Invoice", null).catch((e) => e);
      assert.match(qerr.message, /GET \/query → 400 \[intuit_tid 1-6a1b2c3d-query\]: Invalid query: QueryParserError/);
      assert.ok(!qerr.message.includes("SELECT"), "the query string is not echoed into the log");
      assert.equal(lines.filter((l) => l.startsWith("[qbo]")).length, 2, "each failed call leaves one log line");
    });
  } finally {
    globalThis.fetch = real;
  }
});

test("a failed token refresh keeps the intuit_tid in the reconnect error", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => res(400, { error: "invalid_grant" }, { intuit_tid: "1-tok-tid" });
  try {
    await quiet(async () => {
      const qbo = new HttpsQbo({ clientId: "c", clientSecret: "s", realmId: "123", refreshToken: "dead", environment: "sandbox" });
      const err = await qbo.companyInfo().catch((e) => e);
      assert.ok(err instanceof QboNotConnectedError);
      assert.match(err.message, /refresh failed \(400\) \[intuit_tid 1-tok-tid\]; reconnect QuickBooks/);
    });
  } finally {
    globalThis.fetch = real;
  }
});

test("exports: one record QuickBooks rejects is recorded and the rest still go; not connected stops the run", async () => {
  await quiet(async (lines) => {
    const r = await exportEach([1, 2, 3], "invoice", async (id) => {
      if (id === 2) throw new QboApiError({ method: "POST", path: "/invoice", status: 400, intuitTid: "1-tid-2", faults: ["Duplicate Document Number Error (code 6140)"], raw: "" });
      if (id === 3) return { ok: false, reason: "export_invoices is off", code: "switch_off" };
      return { ok: true, mappingId: "m", qboId: "q", created: true };
    });
    assert.equal(r.created, 1);
    assert.deepEqual(r.skipped, ["invoice 3: export_invoices is off"]);
    assert.equal(r.failed.length, 1);
    assert.match(r.failed[0], /^invoice 2: QuickBooks POST \/invoice → 400 \[intuit_tid 1-tid-2\]: Duplicate Document Number/);
    assert.ok(lines.some((l) => l.includes("export failed, invoice 2") && l.includes("1-tid-2")));

    let after = 0;
    await assert.rejects(
      exportEach([1, 2], "payment", async (id) => {
        if (id === 1) throw new QboNotConnectedError("reconnect QuickBooks");
        after++;
        return { ok: true, mappingId: "m", qboId: "q", created: true };
      }),
      /reconnect QuickBooks/,
    );
    assert.equal(after, 0, "nothing more is attempted once the connection is gone");
  });
});
