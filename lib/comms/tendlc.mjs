// 10DLC registration — the parts shared by scripts/register-10dlc.mjs (the
// one-shot CLI Joe runs) and the app's daily registration watch
// (lib/tendlc-watch.ts). Plain ESM like lib/triage-lanes.mjs so the script
// can import it without a TS toolchain, and the app imports it via allowJs.
//
// Nothing here talks to the network. It validates the env, builds the exact
// request bodies, asserts the campaign is internally consistent, and diffs
// registration status between polls. All the rulings live in the bodies:
// PRIVATE_PROFIT, usecase MIXED, embeddedLink true, numberPool false,
// ageGated false, the six keywords.
//
// TENDLC_LEGAL_NAME is passed through byte-for-byte. It is the IRS legal name
// and an EIN↔name mismatch is the #1 brand rejection cause — never trim,
// normalize or auto-space it.

export const TELNYX_API_BASE = "https://api.telnyx.com/v2";

/** Paths per the Telnyx OpenAPI spec (checked 2026-09-02). The build prompt
 *  wrote `phoneNumberCampaign`; the live API path is `phone_number_campaigns`
 *  and vetting is ordered via `externalVetting` with `evpId`. */
export const TENDLC_PATHS = {
  brand: "/10dlc/brand",
  brandGet: (brandId) => `/10dlc/brand/${encodeURIComponent(brandId)}`,
  vetting: (brandId) => `/10dlc/brand/${encodeURIComponent(brandId)}/externalVetting`,
  campaignBuilder: "/10dlc/campaignBuilder",
  campaignGet: (campaignId) => `/10dlc/campaign/${encodeURIComponent(campaignId)}`,
  phoneNumberCampaign: "/10dlc/phone_number_campaigns",
  phoneNumberCampaignGet: (phone) => `/10dlc/phone_number_campaigns/${encodeURIComponent(phone)}`,
  messagingProfileNumbers: (profileId) => `/messaging_profiles/${encodeURIComponent(profileId)}/phone_numbers`,
};

export const REQUIRED_VARS = [
  "TELNYX_API_KEY",
  "TENDLC_LEGAL_NAME",
  "TENDLC_DISPLAY_NAME",
  "TENDLC_EIN",
  "TENDLC_PHONE",
  "TENDLC_STREET",
  "TENDLC_CITY",
  "TENDLC_STATE",
  "TENDLC_POSTAL_CODE",
  "TENDLC_COUNTRY",
  "TENDLC_EMAIL",
  "TENDLC_WEBSITE",
  "TENDLC_VERTICAL",
];

const E164 = /^\+1[2-9]\d{9}$/;
const EIN = /^\d{2}-\d{7}$/;
const PO_BOX = /p\.?\s?o\.?\s?box/i;

/** Local validation — the documented brand-rejection causes, caught for free
 *  before a network call. Returns every problem at once. */
export function validateTendlcEnv(env) {
  const errors = [];
  const get = (k) => env[k] ?? "";
  for (const k of REQUIRED_VARS) if (!get(k).trim()) errors.push(`${k} is not set`);
  const ein = get("TENDLC_EIN").trim();
  if (ein && !EIN.test(ein)) errors.push(`TENDLC_EIN must match 12-3456789 (got "${ein}")`);
  const phone = get("TENDLC_PHONE").trim();
  if (phone && !E164.test(phone)) errors.push(`TENDLC_PHONE must be E.164 like +16125551234 (got "${phone}")`);
  const site = get("TENDLC_WEBSITE").trim();
  if (site && !/^https:\/\/\S+$/i.test(site)) errors.push(`TENDLC_WEBSITE must start with https:// (got "${site}")`);
  const street = get("TENDLC_STREET");
  if (street && PO_BOX.test(street)) errors.push(`TENDLC_STREET must be a physical address, not a P.O. box (got "${street}")`);
  const state = get("TENDLC_STATE").trim();
  if (state && !/^[A-Z]{2}$/.test(state)) errors.push(`TENDLC_STATE must be a 2-letter code (got "${state}")`);
  const zip = get("TENDLC_POSTAL_CODE").trim();
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) errors.push(`TENDLC_POSTAL_CODE must be a 5-digit ZIP (got "${zip}")`);
  const country = get("TENDLC_COUNTRY").trim();
  if (country && country.toUpperCase() !== "US") errors.push(`TENDLC_COUNTRY must be US (got "${country}")`);
  const email = get("TENDLC_EMAIL").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`TENDLC_EMAIL is not an email address (got "${email}")`);
  if (get("TENDLC_LEGAL_NAME") && get("TENDLC_LEGAL_NAME") === get("TENDLC_DISPLAY_NAME")) {
    // Not an error (they CAN coincide for some businesses) but worth a flag.
    errors.push("warning: TENDLC_LEGAL_NAME equals TENDLC_DISPLAY_NAME — for SJ Carpentry these are different strings; double-check the IRS legal name");
  }
  return { ok: errors.filter((e) => !e.startsWith("warning:")).length === 0, errors };
}

/** Stage 1 body. Legal name is byte-for-byte from the env. */
export function brandBody(env) {
  return {
    entityType: "PRIVATE_PROFIT",
    displayName: env.TENDLC_DISPLAY_NAME,
    companyName: env.TENDLC_LEGAL_NAME,
    ein: env.TENDLC_EIN.trim(),
    phone: env.TENDLC_PHONE.trim(),
    street: env.TENDLC_STREET,
    city: env.TENDLC_CITY,
    state: env.TENDLC_STATE.trim(),
    postalCode: env.TENDLC_POSTAL_CODE.trim(),
    country: "US",
    email: env.TENDLC_EMAIL.trim(),
    website: env.TENDLC_WEBSITE.trim(),
    vertical: env.TENDLC_VERTICAL.trim(),
    isReseller: false,
  };
}

/** Stage 2 body. AEGIS standard vetting sets the AT&T / T-Mobile throughput
 *  ceiling — not optional. */
export function vettingBody() {
  return { evpId: "AEGIS", vettingClass: "STANDARD" };
}

/** "612-361-6585" — the dashed US format used inside the help message. */
export function dashedUsPhone(e164) {
  const d = String(e164 ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(e164 ?? "");
}

/** The registered HELP response. The app sends exactly this on HELP/INFO. */
export function helpMessageFrom(env) {
  const phone = dashedUsPhone(env.TENDLC_PHONE);
  const email = (env.TENDLC_EMAIL ?? "").trim();
  const contact = [phone, email].filter(Boolean).join(" or ");
  return `Reply HELP for support. Contact SJ Carpentry LLC${contact ? ` at ${contact}` : ""}. Reply STOP to unsubscribe.`;
}

/** TCR requires 2–5 sub-usecases for MIXED (first submission on 2026-09-03
 *  failed with exactly that). These three are what the samples actually
 *  are: project/schedule updates to our own clients and subs (customer
 *  care + account notification) and delivery/crew-arrival notices. Valid
 *  codes: GET /v2/10dlc/enum/usecase. */
export const MIXED_SUB_USECASES = ["CUSTOMER_CARE", "ACCOUNT_NOTIFICATION", "DELIVERY_NOTIFICATION"];

export const OPTIN_KEYWORDS = "START,YES";
export const OPTOUT_KEYWORDS = "STOP,UNSUBSCRIBE";
export const HELP_KEYWORDS = "HELP,INFO";

// ─── Opt-in (consent) copy ───────────────────────────────────────────────────
// Telnyx rejected the 2026-09-03 submission (TELNYX_FAILED): the message flow
// must name the opt-in mechanism — the web form URL, its consent language, a
// screenshot, a verbal script — and the form's disclosure must carry brand,
// use case, frequency, rates, STOP, HELP and the no-sharing line. These
// strings are the single source: the website form must display
// OPTIN_DISCLOSURE next to the checkbox verbatim (docs/sms-opt-in-form.md),
// the OS sends OPTIN_CONFIRMATION as the confirmation text, and the message
// flow quotes both. Change them here and everywhere else follows.

export const BRAND = "SJ Carpentry LLC";
export const OPTIN_FORM_URL_DEFAULT = "https://www.sjcarpentryllc.com/start-a-project-conversation";
export const PRIVACY_POLICY_URL_DEFAULT = "https://www.sjcarpentryllc.com/privacy-policy";
export const OPTIN_USE_CASES = "project updates, scheduling confirmations, and document requests";
export const OPTIN_CHECKBOX_LABEL = `Yes, text me project updates from ${BRAND}`;
export const OPTIN_DISCLOSURE =
  `By checking this box and providing your phone number, you agree to receive SMS ${OPTIN_USE_CASES} from ${BRAND}. ` +
  `Message frequency may vary. Standard message and data rates may apply. Reply STOP to opt out. Reply HELP for help. ` +
  `We will not share mobile information with third parties for promotional or marketing purposes.`;
export const OPTIN_VERBAL_SCRIPT =
  `By providing your phone number, you agree to receive SMS ${OPTIN_USE_CASES} from ${BRAND}. ` +
  `Message frequency may vary. Standard message and data rates may apply. Reply STOP to opt out, HELP for help.`;
/** The confirmation text (also the campaign's optinMessage). Under 160 chars. */
export const OPTIN_CONFIRMATION =
  `${BRAND}: you're opted in to project update & scheduling texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;

export function optinFormUrl(env) {
  return (env.TENDLC_OPTIN_FORM_URL ?? "").trim() || OPTIN_FORM_URL_DEFAULT;
}
export function privacyPolicyUrl(env) {
  return (env.TENDLC_PRIVACY_POLICY_URL ?? "").trim() || PRIVACY_POLICY_URL_DEFAULT;
}

/** The message flow — Telnyx's digital-consent template, plus verbal consent
 *  for existing clients/subs. Quotes the live copy so it cannot drift. */
export function messageFlow(env) {
  const shot = (env.TENDLC_OPTIN_SCREENSHOT_URL ?? "").trim();
  const phone = dashedUsPhone(env.TENDLC_PHONE);
  return (
    `Digital consent (primary): customers opt in on the ${BRAND} website at ${optinFormUrl(env)}` +
    `${shot ? ` (screenshot: ${shot})` : ""}. The form has a phone number field and a separate SMS consent checkbox, ` +
    `unchecked by default and optional, labeled "${OPTIN_CHECKBOX_LABEL}" with this disclosure displayed beside it: "${OPTIN_DISCLOSURE}" ` +
    `The privacy policy is linked from the form: ${privacyPolicyUrl(env)}. When the form is submitted with the box checked, ` +
    `${BRAND} immediately sends this confirmation SMS: "${OPTIN_CONFIRMATION}" ` +
    `Verbal consent (existing clients and subcontractors): when a client or subcontractor gives their mobile number to Joe by phone` +
    `${phone ? ` (${phone})` : ""} or in person during project intake or contracting, he reads: "${OPTIN_VERBAL_SCRIPT}" and the same confirmation SMS ` +
    `is sent before any other message. Numbers are never purchased or shared. Reply STOP at any time to opt out; HELP returns support contact information.`
  );
}

/** Stage 3 body. Keywords are comma-separated WITHOUT spaces (TCR format). */
export function campaignBody(env, brandId) {
  const portalBase = (env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").trim().replace(/\/$/, "");
  return {
    brandId,
    usecase: "MIXED",
    subUsecases: [...MIXED_SUB_USECASES],
    description:
      "Project status updates, schedule confirmations, and document requests sent to our own residential construction clients and subcontractors.",
    messageFlow: messageFlow(env),
    helpMessage: helpMessageFrom(env),
    sample1:
      "Hi Sarah, it's Joe at SJ Carpentry. The cabinet delivery moved to Thursday morning, crew will start at 8am. Reply if that's a problem. Reply STOP to opt out.",
    sample2:
      "Morning Tony, still good for the Butler St framing walkthrough at 10? Text back to confirm. Reply STOP to opt out. SJ Carpentry",
    sample3:
      "Reminder from SJ Carpentry: we need your current insurance certificate before Tuesday's start. You can reply with a photo. Reply STOP to opt out.",
    sample4: `Hi Dave, your updated scope of work is ready to review here: ${portalBase}/p/xxxx . Questions, just reply. Reply STOP to opt out. SJ Carpentry`,
    optinKeywords: OPTIN_KEYWORDS,
    optoutKeywords: OPTOUT_KEYWORDS,
    helpKeywords: HELP_KEYWORDS,
    optinMessage: OPTIN_CONFIRMATION,
    optoutMessage: "You've been unsubscribed from SJ Carpentry LLC messages. Reply START to opt back in.",
    embeddedLink: true,
    embeddedLinkSample: `${portalBase}/p/xxxx`,
    embeddedPhone: false,
    numberPool: false,
    ageGated: false,
    directLending: false,
    affiliateMarketing: false,
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
    autoRenewal: true,
    termsAndConditions: true,
    // No terms page exists on the site; TCR treats the link as optional.
    privacyPolicyLink: privacyPolicyUrl(env),
  };
}

/** Consistency asserts on the campaign body — the documented rejection
 *  causes that are checkable offline. Returns every problem at once. */
export function assertCampaignBody(body) {
  const errors = [];
  const samples = ["sample1", "sample2", "sample3", "sample4", "sample5"].map((k) => body[k]).filter(Boolean);
  if (samples.length < 2) errors.push("at least two message samples are required");
  if (body.embeddedLink === true && !samples.some((s) => /https?:\/\//.test(s))) {
    errors.push("embeddedLink is true but no sample contains a URL — the samples contradict the declared attributes");
  }
  if (body.embeddedLink !== true && samples.some((s) => /https?:\/\//.test(s))) {
    errors.push("a sample contains a URL but embeddedLink is not true");
  }
  samples.forEach((s, i) => {
    if (!/\bstop\b/i.test(s)) errors.push(`sample${i + 1} has no opt-out language ("Reply STOP to opt out")`);
    if (s.length < 20) errors.push(`sample${i + 1} is too short (TCR minimum 20 chars)`);
    if (s.length > 1024) errors.push(`sample${i + 1} is too long (TCR maximum 1024 chars)`);
  });
  if (!body.helpMessage || !/\bstop\b/i.test(body.helpMessage)) errors.push("helpMessage must mention STOP");
  if ((body.description ?? "").length < 40) errors.push("description must be at least 40 characters");
  if ((body.messageFlow ?? "").length < 40) errors.push("messageFlow must be at least 40 characters");
  if ((body.messageFlow ?? "").length > 2048) errors.push(`messageFlow is ${body.messageFlow.length} chars; TCR limit is 2048`);
  if (!/https?:\/\/\S+/.test(body.messageFlow ?? "")) errors.push("messageFlow must include the opt-in form URL (TELNYX_FAILED 2026-09-03: no opt-in mechanism)");
  if (!/screenshot: https?:\/\//.test(body.messageFlow ?? "")) errors.push("messageFlow must include a screenshot link of the opt-in form — set TENDLC_OPTIN_SCREENSHOT_URL");
  for (const need of ["STOP", "HELP", "rates", "frequency"]) {
    if (!(body.messageFlow ?? "").includes(need)) errors.push(`messageFlow must mention ${need}`);
  }
  if (!/frequency/i.test(body.optinMessage ?? "") || !/rates/i.test(body.optinMessage ?? "") || !/STOP/.test(body.optinMessage ?? "") || !/HELP/.test(body.optinMessage ?? "")) {
    errors.push("optinMessage (the confirmation text) must state frequency, rates, STOP and HELP");
  }
  if (!/^https:\/\//.test(body.privacyPolicyLink ?? "")) errors.push("privacyPolicyLink must be an https URL");
  if (body.usecase !== "MIXED") errors.push(`usecase must be MIXED (ruling), got ${body.usecase}`);
  const subs = Array.isArray(body.subUsecases) ? body.subUsecases : [];
  if (body.usecase === "MIXED" && (subs.length < 2 || subs.length > 5)) {
    errors.push(`usecase MIXED requires 2–5 subUsecases (got ${subs.length}) — TCR rejects the campaign otherwise`);
  }
  if (subs.some((u) => u === "MIXED" || typeof u !== "string" || !/^[A-Z_0-9]+$/.test(u))) errors.push("subUsecases must be standard TCR codes (not MIXED itself)");
  if (body.numberPool !== false) errors.push("numberPool must be false (ruling)");
  if (body.ageGated !== false) errors.push("ageGated must be false (ruling)");
  if (body.optoutKeywords !== OPTOUT_KEYWORDS) errors.push(`optoutKeywords must be ${OPTOUT_KEYWORDS}`);
  if (body.helpKeywords !== HELP_KEYWORDS) errors.push(`helpKeywords must be ${HELP_KEYWORDS}`);
  if (body.optinKeywords !== OPTIN_KEYWORDS) errors.push(`optinKeywords must be ${OPTIN_KEYWORDS}`);
  if (body.subscriberOptout !== true) errors.push("subscriberOptout must be true when opt-out keywords are registered");
  if (body.subscriberHelp !== true) errors.push("subscriberHelp must be true when help keywords are registered");
  return { ok: errors.length === 0, errors };
}

/** Stage 4 body. */
export function assignBody(phoneNumber, campaignId) {
  return { phoneNumber, campaignId };
}

/** Telnyx trial accounts have no 10DLC access at all — every call fails until
 *  the account is upgraded. Recognise that case so the script says so instead
 *  of passing a raw API error through. */
export function isTrialAccountError(status, body) {
  const text = JSON.stringify(body ?? "").toLowerCase();
  if (/trial|upgrade your account|level 1|account level|not allowed for your account|verify your account/.test(text)) return true;
  return (status === 403 || status === 402) && /10dlc|brand|campaign/.test(text);
}

/** Pull a readable message out of a Telnyx error body. */
export function telnyxErrorText(body) {
  const errs = body && Array.isArray(body.errors) ? body.errors : [];
  if (!errs.length) return typeof body === "string" ? body : JSON.stringify(body ?? {});
  return errs.map((e) => `${e.code ? `[${e.code}] ` : ""}${e.title ?? ""}${e.detail ? ` — ${e.detail}` : ""}`).join("; ");
}

// ─── Status watch ────────────────────────────────────────────────────────────

/** Terminal-bad campaign states. Rejection must be LOUD: the fix is editing
 *  samples and resubmitting, and every idle day is a day off a 3-week clock. */
export const CAMPAIGN_REJECTED = new Set(["TCR_FAILED", "TELNYX_FAILED", "MNO_REJECTED", "MNO_PROVISIONING_FAILED", "TCR_SUSPENDED", "TCR_EXPIRED"]);
export const CAMPAIGN_APPROVED = new Set(["MNO_ACCEPTED", "MNO_PROVISIONED"]);

/** Snapshot the fields we watch from the brand + campaign GET responses. */
export function registrationSnapshot(brand, campaign, assignment) {
  const b = brand?.data ?? brand ?? {};
  const c = campaign?.data ?? campaign ?? {};
  const a = assignment?.data ?? assignment ?? {};
  return {
    brandStatus: b.status ?? null,
    identityStatus: b.identityStatus ?? null,
    vettingScore: b.vettingScore ?? null,
    brandFailureReasons: b.failureReasons ?? null,
    campaignStatus: c.campaignStatus ?? null,
    submissionStatus: c.submissionStatus ?? null,
    tmobileRegistered: c.isTMobileRegistered ?? null,
    campaignFailureReasons: c.failureReasons ?? null,
    assignmentStatus: a.assignmentStatus ?? null,
    assignmentFailureReasons: a.failureReasons ?? null,
  };
}

/** Diff two snapshots → human change lines + whether any is a rejection. */
export function diffRegistration(prev, next) {
  const changes = [];
  let rejected = false;
  let approved = false;
  const p = prev ?? {};
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify(p[k] ?? null) === JSON.stringify(v ?? null)) continue;
    changes.push(`${k}: ${p[k] ?? "—"} → ${v ?? "—"}`);
    if (k === "campaignStatus" && v && CAMPAIGN_REJECTED.has(v)) rejected = true;
    if (k === "campaignStatus" && v && CAMPAIGN_APPROVED.has(v)) approved = true;
    if (k === "brandStatus" && v === "REGISTRATION_FAILED") rejected = true;
    if (k === "assignmentStatus" && v === "FAILED_ASSIGNMENT") rejected = true;
  }
  return { changes, rejected, approved };
}
