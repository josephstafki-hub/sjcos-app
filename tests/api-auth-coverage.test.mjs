// Every API route must check who is calling. proxy.ts skips /api/*, so a route
// handler with no check of its own is readable by anyone on the internet — that
// is how 14 mock-era JSON endpoints (/api/projects, /api/leads, …) served client
// names, emails, addresses and contract values to anonymous callers.
//
// A route passes if it calls a known auth/verification helper, or is listed in
// PUBLIC with the reason it is safe to serve without a session.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const AUTH = /\b(getUserFromRequest|requireRole|requireOwner|requireAccess|requireUser|getCurrentUser|getSessionUser|readSession|verifySession|requirePortal|CRON_SECRET|verifyCron|cronAuth|cronAuthorized|timingSafeEqual|verifyWebhook|verifySignature|webhookSecret|Bearer)\b/;

const PUBLIC = {
  "app/api/inbox/oauth/callback/route.ts": "OAuth redirect target; validates state",
  "app/api/qbo/oauth/callback/route.ts": "OAuth redirect target; validates state",
  "app/api/newsletter/open/[token]/route.ts": "tracking pixel keyed by an unguessable token",
  "app/api/newsletter/unsubscribe/[token]/route.ts": "unsubscribe link keyed by an unguessable token",
  "app/api/voice/audio/[name]/route.ts": "static ringback/beep audio for the phone carrier",
  "app/api/newsletter/img/[token]/route.ts": "newsletter image keyed by an unguessable token",
  "app/api/sms/webhook/route.ts": "carrier webhook; verifyTelnyxSignature",
  "app/api/voice/webhook/route.ts": "carrier webhook; verifyTelnyxSignature",
  "app/api/telegram/webhook/route.ts": "bot webhook; verifyTelegramSecret",
  "app/api/uploads/[id]/route.ts": "signed upload URL; verifyUploadSignature",
  "app/api/webhooks/square/route.ts": "payment webhook; handleSquareWebhook checks the Square signature",
};

function routes(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routes(p));
    else if (e.name === "route.ts") out.push(path.relative(ROOT, p));
  }
  return out;
}

test("every API route authenticates its caller or is a documented public endpoint", () => {
  const open = routes(path.join(ROOT, "app/api"))
    .filter((f) => !PUBLIC[f])
    .filter((f) => !AUTH.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(open, [], `API routes with no auth check:\n  ${open.join("\n  ")}`);
});

test("the public allowlist only names routes that exist", () => {
  for (const f of Object.keys(PUBLIC)) assert.ok(fs.existsSync(path.join(ROOT, f)), `stale PUBLIC entry: ${f}`);
});
