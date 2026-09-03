#!/usr/bin/env node
// SJC OS — 10DLC registration on Telnyx, as a one-shot CLI (NOT a web page:
// registration happens once, spends money, and is a legal attestation about
// the business, so it does not belong behind a button).
//
//   node scripts/register-10dlc.mjs brand      [--confirm] [--force]
//   node scripts/register-10dlc.mjs vetting    [--confirm] [--force]
//   node scripts/register-10dlc.mjs campaign   [--confirm] [--force]
//   node scripts/register-10dlc.mjs assign +1XXXXXXXXXX [--confirm] [--force]
//   node scripts/register-10dlc.mjs status
//
// Rules (every stage):
//   • DRY RUN IS THE DEFAULT. Without --confirm the exact JSON body is printed
//     and nothing is called. These calls create records at The Campaign
//     Registry that cannot be casually undone.
//   • After a successful create the returned id is written to
//     .10dlc-state.json (gitignored) so later stages never need an id pasted
//     by hand. A stage whose id is already in the state file refuses to re-run
//     without --force — double-registering a brand wastes money.
//   • `status` writes nothing.
//   • Local validation runs before any network call: EIN shape, E.164 phone,
//     https website, no P.O. box (documented brand-rejection causes).
//   • Telnyx TRIAL accounts have no 10DLC access at all. That case prints
//     "account is on trial, 10DLC unavailable, upgrade first" instead of a raw
//     API error.
//
// Env: TELNYX_API_KEY + the TENDLC_* block (see docs/comms.md). Read from the
// process env first, then .env.local (SJCOS_ENV overrides the path). The
// legal name is passed through byte-for-byte — never trimmed or normalized.
//
// Exit codes: 0 ok · 2 validation · 3 state/precondition · 4 trial account ·
// 5 Telnyx API error.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TELNYX_API_BASE,
  TENDLC_PATHS,
  validateTendlcEnv,
  brandBody,
  vettingBody,
  campaignBody,
  assertCampaignBody,
  assignBody,
  isTrialAccountError,
  telnyxErrorText,
  registrationSnapshot,
} from "../lib/comms/tendlc.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ─── env ─────────────────────────────────────────────────────────────────────

function loadEnv() {
  const file = process.env.SJCOS_ENV ?? path.join(ROOT, ".env.local");
  const fromFile = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      // Strip ONE pair of surrounding quotes only. Inner whitespace is kept —
      // TENDLC_LEGAL_NAME may legitimately contain runs of spaces.
      fromFile[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
  return { ...fromFile, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")) };
}

const env = loadEnv();
const STATE_FILE = env.TENDLC_STATE_FILE || path.join(ROOT, ".10dlc-state.json");
const API_BASE = (env.TELNYX_API_BASE || TELNYX_API_BASE).replace(/\/$/, "");

// ─── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const stage = positional[0];
const CONFIRM = flags.has("--confirm");
const FORCE = flags.has("--force");

function usage(code = 2) {
  console.error(`Usage:
  node scripts/register-10dlc.mjs brand      [--confirm] [--force]
  node scripts/register-10dlc.mjs vetting    [--confirm] [--force]
  node scripts/register-10dlc.mjs campaign   [--confirm] [--force]
  node scripts/register-10dlc.mjs assign +1XXXXXXXXXX [--confirm] [--force]
  node scripts/register-10dlc.mjs status

Dry run is the default: without --confirm the exact request body is printed and nothing is sent.
State (ids) is kept in ${STATE_FILE}.`);
  process.exit(code);
}

// ─── state ───────────────────────────────────────────────────────────────────

function readState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (e) {
    console.error(`State file ${STATE_FILE} is not valid JSON: ${e.message}`);
    process.exit(3);
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

// ─── api ─────────────────────────────────────────────────────────────────────

async function api(method, p, body) {
  const key = env.TELNYX_API_KEY;
  if (!key) {
    console.error("TELNYX_API_KEY is not set.");
    process.exit(2);
  }
  let res;
  try {
    res = await fetch(`${API_BASE}${p}`, {
      method,
      headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.error(`Telnyx unreachable at ${API_BASE}: ${e.message}`);
    process.exit(5);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    if (isTrialAccountError(res.status, json)) {
      console.error("\nTelnyx: account is on trial, 10DLC unavailable, upgrade first.");
      console.error("(Trial accounts have no 10DLC access at all. Upgrade the account in Mission Control, then re-run.)");
      process.exit(4);
    }
    console.error(`\nTelnyx ${method} ${p} → HTTP ${res.status}: ${telnyxErrorText(json)}`);
    process.exit(5);
  }
  return json;
}

function printBody(label, body) {
  console.log(`\n${label}`);
  console.log(JSON.stringify(body, null, 2));
}

function dryRunExit(method, p) {
  console.log(`\nDRY RUN — nothing was sent. This would ${method} ${API_BASE}${p}.`);
  console.log("Re-run with --confirm to submit.");
  process.exit(0);
}

function refuseIfDone(state, key, label) {
  if (state[key] && !FORCE) {
    console.error(`\n${label} already exists in ${STATE_FILE} (${key} = ${state[key]}). Refusing to re-run without --force.`);
    process.exit(3);
  }
}

// ─── stages ──────────────────────────────────────────────────────────────────

async function stageBrand() {
  const v = validateTendlcEnv(env);
  for (const w of v.errors.filter((e) => e.startsWith("warning:"))) console.error(w);
  if (!v.ok) {
    console.error("\nLocal validation failed — fix these before spending money on a brand:");
    for (const e of v.errors.filter((e) => !e.startsWith("warning:"))) console.error(`  • ${e}`);
    process.exit(2);
  }
  const state = readState();
  refuseIfDone(state, "brandId", "A brand");
  const body = brandBody(env);
  printBody("Stage 1 — brand (POST /10dlc/brand):", body);
  console.log(`\nLegal name (companyName) is sent byte-for-byte: ${JSON.stringify(body.companyName)}`);
  if (!CONFIRM) dryRunExit("POST", TENDLC_PATHS.brand);
  const out = await api("POST", TENDLC_PATHS.brand, body);
  const d = out?.data ?? out ?? {};
  const brandId = d.brandId ?? d.referenceId;
  if (!brandId) {
    console.error(`\nTelnyx created something but returned no brandId: ${JSON.stringify(out)}`);
    process.exit(5);
  }
  writeState({ brandId, tcrBrandId: d.tcrBrandId ?? null, brandStatus: d.status ?? null, identityStatus: d.identityStatus ?? null, brandCreatedAt: new Date().toISOString() });
  console.log(`\nBrand created. brandId = ${brandId}${d.tcrBrandId ? ` (TCR ${d.tcrBrandId})` : ""} — saved to ${STATE_FILE}.`);
  console.log("Next: node scripts/register-10dlc.mjs vetting --confirm");
}

async function stageVetting() {
  const state = readState();
  if (!state.brandId) {
    console.error("No brandId in the state file — run the brand stage first.");
    process.exit(3);
  }
  refuseIfDone(state, "vettingRequestedAt", "A vetting request");
  const body = vettingBody();
  const p = TENDLC_PATHS.vetting(state.brandId);
  printBody(`Stage 2 — vetting (POST ${p}):`, body);
  console.log("\nAEGIS standard vetting sets the AT&T / T-Mobile throughput ceiling. Score lands in 1–7 business days.");
  if (!CONFIRM) dryRunExit("POST", p);
  const out = await api("POST", p, body);
  const d = out?.data ?? out ?? {};
  writeState({ vettingRequestedAt: new Date().toISOString(), vettingId: d.vettingId ?? d.id ?? null, vettingProvider: "AEGIS" });
  console.log(`\nVetting ordered${d.vettingId ? ` (id ${d.vettingId})` : ""}. Check with: node scripts/register-10dlc.mjs status`);
  console.log("Next: node scripts/register-10dlc.mjs campaign --confirm  (does not need to wait for the score)");
}

async function stageCampaign() {
  const state = readState();
  if (!state.brandId) {
    console.error("No brandId in the state file — run the brand stage first.");
    process.exit(3);
  }
  refuseIfDone(state, "campaignId", "A campaign");
  const body = campaignBody(env, state.brandId);
  const a = assertCampaignBody(body);
  if (!a.ok) {
    console.error("\nCampaign body is not internally consistent — fix before submitting:");
    for (const e of a.errors) console.error(`  • ${e}`);
    process.exit(2);
  }
  printBody("Stage 3 — campaign (POST /10dlc/campaignBuilder):", body);
  if (!CONFIRM) dryRunExit("POST", TENDLC_PATHS.campaignBuilder);
  const out = await api("POST", TENDLC_PATHS.campaignBuilder, body);
  const d = out?.data ?? out ?? {};
  const campaignId = d.campaignId;
  if (!campaignId) {
    console.error(`\nTelnyx returned no campaignId: ${JSON.stringify(out)}`);
    process.exit(5);
  }
  writeState({
    campaignId,
    tcrCampaignId: d.tcrCampaignId ?? null,
    campaignStatus: d.campaignStatus ?? null,
    helpMessage: body.helpMessage,
    campaignCreatedAt: new Date().toISOString(),
  });
  console.log(`\nCampaign submitted. campaignId = ${campaignId}${d.tcrCampaignId ? ` (TCR ${d.tcrCampaignId})` : ""} — saved to ${STATE_FILE}.`);
  console.log("Carrier approval takes 1–3 weeks; the daily comms-watch timer pushes you on any change.");
  console.log("Next: node scripts/register-10dlc.mjs assign +1XXXXXXXXXX --confirm");
}

async function stageAssign() {
  const number = positional[1];
  if (!number) usage();
  if (!/^\+1[2-9]\d{9}$/.test(number)) {
    console.error(`"${number}" is not an E.164 US number (+1XXXXXXXXXX).`);
    process.exit(2);
  }
  const state = readState();
  if (!state.campaignId) {
    console.error("No campaignId in the state file — run the campaign stage first.");
    process.exit(3);
  }
  const assignments = state.assignments ?? {};
  if (assignments[number] && !FORCE) {
    console.error(`\n${number} is already assigned to campaign ${assignments[number].campaignId} per ${STATE_FILE}. Refusing without --force.`);
    process.exit(3);
  }
  const body = assignBody(number, state.campaignId);
  printBody(`Stage 4 — assign number (POST ${TENDLC_PATHS.phoneNumberCampaign}):`, body);
  const profileId = env.SMS_MESSAGING_PROFILE_ID;
  if (!profileId) {
    console.error("\nSMS_MESSAGING_PROFILE_ID is not set — the number must be on the \"SJC OS\" messaging profile before assignment.");
    process.exit(2);
  }
  if (!CONFIRM) {
    console.log(`\n(With --confirm the script first checks ${number} is on messaging profile ${profileId}.)`);
    dryRunExit("POST", TENDLC_PATHS.phoneNumberCampaign);
  }
  // Precondition: the number must already be on the messaging profile.
  const nums = await api("GET", `${TENDLC_PATHS.messagingProfileNumbers(profileId)}?page%5Bsize%5D=250`);
  const onProfile = (nums?.data ?? []).some((n) => n.phone_number === number);
  if (!onProfile) {
    console.error(`\n${number} is not on messaging profile ${profileId} ("SJC OS"). Add it to that profile in Mission Control (Numbers → the number → Messaging profile), then re-run.`);
    process.exit(3);
  }
  const out = await api("POST", TENDLC_PATHS.phoneNumberCampaign, body);
  const d = out?.data ?? out ?? {};
  writeState({ assignments: { ...assignments, [number]: { campaignId: state.campaignId, assignmentStatus: d.assignmentStatus ?? null, at: new Date().toISOString() } } });
  console.log(`\n${number} assigned to campaign ${state.campaignId} (status ${d.assignmentStatus ?? "?"}) — saved.`);
  console.log("When the Google Voice number is ported later, run this stage again for that number.");
}

async function stageStatus() {
  const state = readState();
  if (!state.brandId) {
    console.log(`No brand registered yet (no brandId in ${STATE_FILE}). Start with: node scripts/register-10dlc.mjs brand`);
    return;
  }
  const brand = await api("GET", TENDLC_PATHS.brandGet(state.brandId));
  let vettings = null;
  try {
    vettings = await api("GET", TENDLC_PATHS.vetting(state.brandId));
  } catch {
    /* optional */
  }
  const campaign = state.campaignId ? await api("GET", TENDLC_PATHS.campaignGet(state.campaignId)) : null;
  const assignments = {};
  for (const num of Object.keys(state.assignments ?? {})) {
    try {
      assignments[num] = await api("GET", TENDLC_PATHS.phoneNumberCampaignGet(num));
    } catch (e) {
      assignments[num] = { error: e.message };
    }
  }
  const b = brand?.data ?? brand ?? {};
  const c = campaign?.data ?? campaign ?? {};
  const vetList = Array.isArray(vettings?.data) ? vettings.data : Array.isArray(vettings) ? vettings : [];
  const score = b.vettingScore ?? vetList.find((v) => v.vettingScore != null)?.vettingScore ?? null;
  console.log("10DLC registration status");
  console.log("─".repeat(60));
  console.log(`Brand        ${state.brandId}${b.tcrBrandId ? ` (TCR ${b.tcrBrandId})` : ""}`);
  console.log(`  status     ${b.status ?? "?"}   identity ${b.identityStatus ?? "?"}`);
  console.log(`  vetting    ${score == null ? "pending (no score yet)" : `score ${score}/100`}${vetList.length ? ` · ${vetList.map((v) => `${v.evpId ?? "?"}:${v.vettingStatus ?? v.status ?? "?"}`).join(", ")}` : ""}`);
  if (b.failureReasons) console.log(`  FAILURE    ${b.failureReasons}`);
  if (state.campaignId) {
    console.log(`Campaign     ${state.campaignId}${c.tcrCampaignId ? ` (TCR ${c.tcrCampaignId})` : ""}`);
    console.log(`  status     ${c.campaignStatus ?? "?"}   submission ${c.submissionStatus ?? "?"}   T-Mobile ${c.isTMobileRegistered ? "registered" : "not yet"}`);
    if (c.failureReasons) console.log(`  REJECTED   ${c.failureReasons}\n  → edit the samples / flow in lib/comms/tendlc.mjs and resubmit (campaign --force).`);
  } else {
    console.log("Campaign     not submitted yet");
  }
  for (const [num, a] of Object.entries(assignments)) {
    const d = a?.data ?? a ?? {};
    console.log(`Number       ${num}: ${d.assignmentStatus ?? d.error ?? "?"}${d.failureReasons ? ` — ${d.failureReasons}` : ""}`);
  }
  console.log("─".repeat(60));
  console.log("Snapshot:", JSON.stringify(registrationSnapshot(brand, campaign, Object.values(assignments)[0] ?? null)));
}

// ─── main ────────────────────────────────────────────────────────────────────

const STAGES = { brand: stageBrand, vetting: stageVetting, campaign: stageCampaign, assign: stageAssign, status: stageStatus };
if (!stage || !STAGES[stage]) usage();
if (flags.has("--help") || flags.has("-h")) usage(0);
await STAGES[stage]();
