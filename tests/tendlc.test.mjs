import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateTendlcEnv,
  brandBody,
  vettingBody,
  campaignBody,
  assertCampaignBody,
  helpMessageFrom,
  diffRegistration,
  registrationSnapshot,
  isTrialAccountError,
  TENDLC_PATHS,
} from "../lib/comms/tendlc.mjs";

export const GOOD = {
  TELNYX_API_KEY: "KEY",
  TENDLC_LEGAL_NAME: "S J CARPENTRY L L C",
  TENDLC_DISPLAY_NAME: "SJ Carpentry",
  TENDLC_EIN: "12-3456789",
  TENDLC_PHONE: "+16125551234",
  TENDLC_STREET: "123 Main St",
  TENDLC_CITY: "Minneapolis",
  TENDLC_STATE: "MN",
  TENDLC_POSTAL_CODE: "55401",
  TENDLC_COUNTRY: "US",
  TENDLC_EMAIL: "joe@example.com",
  TENDLC_WEBSITE: "https://example.com",
  TENDLC_VERTICAL: "CONSTRUCTION",
  TENDLC_OPTIN_SCREENSHOT_URL: "https://os.example.com/compliance/sms-opt-in-form.png",
};

test("valid env passes", () => {
  const r = validateTendlcEnv(GOOD);
  assert.equal(r.ok, true, r.errors.join("; "));
});

test("the documented brand-rejection causes are caught locally, all at once", () => {
  const r = validateTendlcEnv({ ...GOOD, TENDLC_EIN: "123456789", TENDLC_PHONE: "6125551234", TENDLC_WEBSITE: "http://example.com", TENDLC_STREET: "PO Box 9" });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4);
  assert.ok(r.errors.some((e) => /EIN/.test(e)));
  assert.ok(r.errors.some((e) => /E\.164/.test(e)));
  assert.ok(r.errors.some((e) => /https/.test(e)));
  assert.ok(r.errors.some((e) => /P\.O\. box/.test(e)));
  const missing = validateTendlcEnv({});
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.length >= 13);
});

test("legal name passes through byte-for-byte, display name is separate", () => {
  const b = brandBody({ ...GOOD, TENDLC_LEGAL_NAME: "  S J CARPENTRY   L L C " });
  assert.equal(b.companyName, "  S J CARPENTRY   L L C ");
  assert.equal(b.displayName, "SJ Carpentry");
  assert.equal(b.entityType, "PRIVATE_PROFIT");
  assert.equal(b.country, "US");
  assert.equal(b.ein, "12-3456789");
});

test("vetting body is AEGIS / STANDARD", () => {
  assert.deepEqual(vettingBody(), { evpId: "AEGIS", vettingClass: "STANDARD" });
});

test("campaign body honours the rulings and passes its own asserts", () => {
  const c = campaignBody(GOOD, "BRAND1");
  assert.equal(c.usecase, "MIXED");
  assert.deepEqual(c.subUsecases, ["CUSTOMER_CARE", "ACCOUNT_NOTIFICATION", "DELIVERY_NOTIFICATION"]);
  assert.equal(c.embeddedLink, true);
  assert.equal(c.numberPool, false);
  assert.equal(c.ageGated, false);
  assert.equal(c.optoutKeywords, "STOP,UNSUBSCRIBE");
  assert.equal(c.helpKeywords, "HELP,INFO");
  assert.equal(c.optinKeywords, "START,YES");
  assert.match(c.sample4, /https:\/\//);
  const r = assertCampaignBody(c);
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(c.helpMessage, helpMessageFrom(GOOD));
  assert.match(c.helpMessage, /612-555-1234/);
  assert.match(c.helpMessage, /STOP/);
  // TELNYX_FAILED 2026-09-03: the flow must name the opt-in mechanism.
  assert.match(c.messageFlow, /start-a-project-conversation/);
  assert.match(c.messageFlow, /screenshot: https:\/\/os\.example\.com/);
  assert.match(c.messageFlow, /unchecked by default/);
  assert.match(c.messageFlow, /Message frequency may vary/);
  assert.match(c.messageFlow, /Reply STOP/);
  assert.match(c.messageFlow, /Reply HELP/);
  assert.match(c.messageFlow, /confirmation SMS/);
  assert.ok(c.messageFlow.length <= 2048, `messageFlow ${c.messageFlow.length} chars`);
  assert.equal(c.privacyPolicyLink, "https://www.sjcarpentryllc.com/privacy-policy");
  assert.equal(c.termsAndConditionsLink, undefined);
  assert.ok(c.optinMessage.length <= 160);
  for (const need of [/frequency/i, /rates/i, /STOP/, /HELP/, /SJ Carpentry LLC/]) assert.match(c.optinMessage, need);
});

test("campaign asserts refuse a flow without the form URL or screenshot", () => {
  const noShot = campaignBody({ ...GOOD, TENDLC_OPTIN_SCREENSHOT_URL: "" }, "BRAND1");
  assert.ok(assertCampaignBody(noShot).errors.some((e) => /screenshot/.test(e)));
  const vague = { ...campaignBody(GOOD, "BRAND1"), messageFlow: "Customers give us their numbers during intake and consent to project texts. Opt out via STOP at any time, HELP for help; rates and frequency vary." };
  assert.ok(assertCampaignBody(vague).errors.some((e) => /opt-in form URL/.test(e)));
});

test("campaign asserts catch contradicting samples", () => {
  const c = campaignBody(GOOD, "BRAND1");
  const noLink = { ...c, sample4: "Hi Dave, your scope is ready. Reply STOP to opt out." };
  assert.ok(assertCampaignBody(noLink).errors.some((e) => /embeddedLink/.test(e)));
  const noStop = { ...c, sample1: "Hi Sarah, delivery moved to Thursday morning." };
  assert.ok(assertCampaignBody(noStop).errors.some((e) => /sample1 has no opt-out/.test(e)));
  const noSubs = { ...c, subUsecases: [] };
  assert.ok(assertCampaignBody(noSubs).errors.some((e) => /2–5 subUsecases/.test(e)), "empty subUsecases must be rejected (TCR_FAILED 2026-09-03)");
  const oneSub = { ...c, subUsecases: ["CUSTOMER_CARE"] };
  assert.ok(assertCampaignBody(oneSub).errors.some((e) => /2–5 subUsecases/.test(e)));
  const wrongCase = { ...c, usecase: "LOW_VOLUME" };
  assert.ok(assertCampaignBody(wrongCase).errors.some((e) => /MIXED/.test(e)));
});

test("registration diff is loud on rejection and flags approval", () => {
  const prev = registrationSnapshot({ data: { status: "OK", vettingScore: null } }, { data: { campaignStatus: "TCR_PENDING" } }, null);
  const scored = registrationSnapshot({ data: { status: "OK", vettingScore: 82 } }, { data: { campaignStatus: "TCR_PENDING" } }, null);
  const d1 = diffRegistration(prev, scored);
  assert.deepEqual(d1.changes, ["vettingScore: — → 82"]);
  assert.equal(d1.rejected, false);
  const rejected = registrationSnapshot({ data: { status: "OK", vettingScore: 82 } }, { data: { campaignStatus: "MNO_REJECTED", failureReasons: "sample missing opt-out" } }, null);
  const d2 = diffRegistration(scored, rejected);
  assert.equal(d2.rejected, true);
  assert.ok(d2.changes.some((c) => /campaignStatus/.test(c)));
  const approved = registrationSnapshot({ data: { status: "OK", vettingScore: 82 } }, { data: { campaignStatus: "MNO_ACCEPTED" } }, null);
  assert.equal(diffRegistration(scored, approved).approved, true);
  assert.deepEqual(diffRegistration(scored, scored).changes, []);
});

test("trial-account errors are recognised", () => {
  assert.equal(isTrialAccountError(403, { errors: [{ title: "Forbidden", detail: "10DLC is not available for trial accounts. Upgrade your account." }] }), true);
  assert.equal(isTrialAccountError(422, { errors: [{ title: "Unprocessable", detail: "ein invalid" }] }), false);
});

test("API paths match the live OpenAPI spec, not the prompt's guesses", () => {
  assert.equal(TENDLC_PATHS.phoneNumberCampaign, "/10dlc/phone_number_campaigns");
  assert.equal(TENDLC_PATHS.vetting("B1"), "/10dlc/brand/B1/externalVetting");
});
