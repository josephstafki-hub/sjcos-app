import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Invoice pay links (lib/client-invites.ts). The emailed link lands on
// /client-portal/enter?token=…&to=pay&inv=<id>; the redirect target must stay
// an allowlist — only digits are ever appended — so a crafted `inv` can never
// bounce a client off the portal. A claimed portal refuses bearer links, so it
// gets the bare page URL instead.

const root = new URL("../", import.meta.url);
globalThis.__invites = { claimed: false, issued: 0 };

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only" || specifier === "./db") return { url: `stub:${specifier}`, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "stub:server-only") return { format: "module", source: "", shortCircuit: true };
    if (url === "stub:./db")
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export const queryOne = async (sql) => {
            if (/portal_claimed_at IS NOT NULL/.test(sql))
              return globalThis.__invites.claimed ? { email: "a@b.com", portal_claimed_at: new Date() } : null;
            if (/FROM client_portal_invites/.test(sql))
              return { token: "tok123", to_email: null, to_name: "C", expires_at: null, used_at: null, status: "active" };
            return null;
          };
          export const query = async () => ({ rows: [] });`,
      };
    return next(url, context);
  },
});

process.env.SJC_PUBLIC_URL = "https://os.example.com";
const { portalEnterPath, invoicePayLink } = await import(new URL("lib/client-invites.ts", root).href);

test("to=pay with a numeric inv lands on that invoice's pay page", () => {
  assert.equal(portalEnterPath("pay", "13"), "/client-portal/pay/13");
});

test("anything but digits falls back to the allowlist", () => {
  for (const inv of [null, "", "13/../../x", "//evil.com", "13?x=1", "1e3", "-1", "9".repeat(13)]) {
    assert.equal(portalEnterPath("pay", inv), "/client-portal", `inv=${inv}`);
  }
  assert.equal(portalEnterPath("money", "13"), "/client-portal/money");
  assert.equal(portalEnterPath("https://evil.com", null), "/client-portal");
});

test("unclaimed portal gets a sign-in link straight to the pay page", async () => {
  globalThis.__invites.claimed = false;
  assert.equal(await invoicePayLink("alcantara-closet", 13), "https://os.example.com/client-portal/enter?token=tok123&to=pay&inv=13");
});

test("claimed portal gets the plain page URL (bearer links are refused there)", async () => {
  globalThis.__invites.claimed = true;
  assert.equal(await invoicePayLink("alcantara-closet", 13), "https://os.example.com/client-portal/pay/13");
});
