import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCallIdentity, callIdentityLabel } from "../lib/comms/call-identity.ts";
test("old calls resolve known contacts and links without writing history", async () => {
  const call = { contact_name: null, counterparty_number: "+16125551234", link_type: null, link_slug: null };
  const resolved = await resolveCallIdentity(call, async () => ({ contactName: "Jane Client", linkType: "project", linkSlug: "jane" }));
  assert.equal(callIdentityLabel(resolved), "Jane Client");
  assert.equal(resolved.link_slug, "jane");
  assert.equal(call.contact_name, null);
});
test("unknown callers use the shared phone format; recorded names survive", async () => {
  assert.equal(callIdentityLabel({ contact_name: null, counterparty_number: "+16125551234" }), "(612) 555-1234");
  const call = { contact_name: "Joe's contact", counterparty_number: "+16125551234", link_type: "sub", link_slug: "sub" };
  assert.deepEqual(await resolveCallIdentity(call, async () => { throw Error("unnecessary lookup"); }), call);
});
