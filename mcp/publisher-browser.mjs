#!/usr/bin/env node
// Browser tools for ONE posting run (A17): the only tools the posting agent
// has. Started by scripts/run-publication.mjs as the run's single MCP server:
//
//   node mcp/publisher-browser.mjs --job <run dir>/job.json
//
// What the agent can and can't do is set here, not in its prompt:
//   • look: snapshot (the page's accessibility tree with element refs), screenshot
//   • move: click, scroll, a few navigation keys, go to a page ON THIS SITE only
//   • write: ONLY the approved text (fill_approved_text) and ONLY the approved
//     photos (upload_photos). There is no free typing, so it can't type a
//     password, a comment or anything else, whatever a page says.
//   • post: submit_post, once. The run's journal records "pressed Post"
//     (fsynced) before the click, so a run that dies afterwards is never
//     retried blindly; Joe looks and says.
//   • finish: report_result (posted + the post's link, or not posted + why).
// Clicks on Post / Publish / Share go through submit_post only; clicks on
// delete / remove / log out / block are refused outright.
//
// The page is untrusted input. A sign-in or "confirm it's you" page ends the
// run as not posted (needs sign-in): Joe signs in himself on /marketing.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { hostAllowed, journalStep, looksSignedOut, readJournal, validPostUrl, writeJournal } from "../lib/publisher/core.ts";
import { activePage, launchPublisherBrowser } from "../lib/publisher/browser.mjs";

const jobPath = process.argv[process.argv.indexOf("--job") + 1];
if (!jobPath || process.argv.indexOf("--job") < 0) {
  console.error("usage: publisher-browser.mjs --job <job.json>");
  process.exit(2);
}
/** @type {{ intentId: string; platform: "facebook"|"instagram"|"google_business"; platformLabel: string; startUrl: string; text: string; photos: string[]; runDir: string }} */
const job = JSON.parse(readFileSync(jobPath, "utf8"));

const FINAL_BUTTON = /^\s*(post|publish|share|post now|publish now|share now|post update)\s*$/i;
const SUBMIT_NAME = /\b(post|publish|share)\b/i;
const FORBIDDEN = /\b(delete|remove|log ?out|sign ?out|switch account|block|report|unfollow|deactivate|leave|archive|discard)\b/i;
const KEYS = new Set(["Escape", "Tab", "Shift+Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"]);
const MAX_SNAPSHOT = 30_000;
const MAX_SHOTS = 40;

let context = null;
let reported = false;
let shotCount = 0;

// ── journal ─────────────────────────────────────────────────────────────────

function journal(update) {
  const j = readJournal(job.intentId);
  if (!j) return;
  writeJournal(update(j));
}
const step = (s) => journal((j) => journalStep(j, s));

// ── browser ─────────────────────────────────────────────────────────────────

async function page() {
  if (!context) {
    context = await launchPublisherBrowser();
    const p = activePage(context) ?? (await context.newPage());
    await p.goto(job.startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    step(`opened ${job.platformLabel}`);
  }
  const p = activePage(context);
  if (!p) throw new Error("The browser has no open page.");
  return p;
}

async function settle(p, ms = 1500) {
  await p.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await p.waitForTimeout(ms);
}

/** After any action: stay on this site, and notice a sign-in prompt. */
async function guard(p) {
  const url = p.url();
  if (url && url !== "about:blank" && !hostAllowed(job.platform, url) && !looksSignedOut(job.platform, url)) {
    await p.goBack({ timeout: 15_000 }).catch(() => undefined);
    return `That led off ${job.platformLabel} (${new URL(url).hostname}), so the browser went back. Stay on ${job.platformLabel}.`;
  }
  if (looksSignedOut(job.platform, url)) {
    return `SIGNED OUT: ${job.platformLabel} is asking to sign in or confirm it's you. Do not try to sign in. Call report_result with outcome "not_posted" and reason "needs sign-in".`;
  }
  return null;
}

async function header(p) {
  const title = await p.title().catch(() => "");
  return `Page: ${title} — ${p.url()}`;
}

function text(s) {
  return { content: [{ type: "text", text: s }] };
}
function refuse(s) {
  return { content: [{ type: "text", text: s }], isError: true };
}

/** One tool body: refuse after the result is in, report errors as text. */
function tool(fn) {
  return async (args) => {
    if (reported) return refuse("The result is already reported. The run is over; stop.");
    try {
      return await fn(args ?? {});
    } catch (err) {
      return refuse(`Error: ${err?.message ?? err}`);
    }
  };
}

async function describe(loc) {
  return loc.evaluate((el) => {
    const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("value") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 120);
    return { name, tag: el.tagName.toLowerCase(), type: (el.getAttribute("type") || "").toLowerCase(), editable: el.isContentEditable };
  });
}

function refLocator(p, ref) {
  if (!/^[a-z]?\d+$/i.test(ref)) throw new Error(`"${ref}" isn't an element ref from the snapshot (like e12).`);
  return p.locator(`aria-ref=${ref}`);
}

async function saveShot(p, label) {
  if (shotCount >= MAX_SHOTS) return null;
  shotCount++;
  const name = `${String(shotCount).padStart(2, "0")}-${label.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40)}.jpg`;
  const buf = await p.screenshot({ type: "jpeg", quality: 70 });
  writeFileSync(path.join(job.runDir, name), buf, { mode: 0o600 });
  journal((j) => ({ ...j, shots: [...j.shots, name] }));
  return buf;
}

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// ── tools ───────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "publisher", version: "1.0.0" });

server.registerTool(
  "snapshot",
  { title: "Read the page", description: "The current page as an accessibility tree. Each element has a ref like [ref=e12] to pass to the other tools. Take a fresh snapshot after anything changes the page.", inputSchema: {} },
  tool(async () => {
    const p = await page();
    const warn = await guard(p);
    let snap = await p.ariaSnapshot({ mode: "ai" });
    if (snap.length > MAX_SNAPSHOT) snap = `${snap.slice(0, MAX_SNAPSHOT)}\n… (cut; scroll or open the part you need)`;
    return text([await header(p), warn, snap].filter(Boolean).join("\n\n"));
  }),
);

server.registerTool(
  "screenshot",
  { title: "Look at the page", description: "A picture of what the browser shows now. Use it to check the post looks right before submit_post, and to see the result after.", inputSchema: {} },
  tool(async () => {
    const p = await page();
    const buf = await saveShot(p, "look");
    if (!buf) return text("Screenshot limit reached for this run; use snapshot.");
    return { content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" }, { type: "text", text: await header(p) }] };
  }),
);

server.registerTool(
  "click",
  { title: "Click an element", description: "Click the element with this ref. Not for the final Post / Publish / Share button: use submit_post for that.", inputSchema: { ref: z.string(), why: z.string().describe("What this click is for, in a few words.") } },
  tool(async ({ ref, why }) => {
    const p = await page();
    const loc = refLocator(p, ref);
    const el = await describe(loc);
    if (FORBIDDEN.test(el.name)) return refuse(`Refused: "${el.name}" isn't something a posting run may click.`);
    if (FINAL_BUTTON.test(el.name)) return refuse(`"${el.name}" puts the post up. Check the text and photos first, then use submit_post with this ref.`);
    await loc.click({ timeout: 15_000 });
    await settle(p);
    step(`click: ${why}`.slice(0, 120));
    const warn = await guard(p);
    return text([`Clicked "${el.name || el.tag}".`, await header(p), warn].filter(Boolean).join("\n"));
  }),
);

server.registerTool(
  "press_key",
  { title: "Press a key", description: `One navigation key: ${[...KEYS].join(", ")}. (No typing: the post text goes in with fill_approved_text.)`, inputSchema: { key: z.string() } },
  tool(async ({ key }) => {
    if (!KEYS.has(key)) return refuse(`Only these keys: ${[...KEYS].join(", ")}.`);
    const p = await page();
    await p.keyboard.press(key);
    await settle(p, 600);
    return text([`Pressed ${key}.`, await guard(p)].filter(Boolean).join("\n"));
  }),
);

server.registerTool(
  "scroll",
  { title: "Scroll", description: "Scroll the page (or the dialog under the mouse) down (positive) or up (negative), in screens.", inputSchema: { screens: z.number().min(-5).max(5) } },
  tool(async ({ screens }) => {
    const p = await page();
    await p.mouse.move(640, 450);
    await p.mouse.wheel(0, Math.round(screens * 800));
    await settle(p, 700);
    return text(`Scrolled ${screens} screen(s).`);
  }),
);

server.registerTool(
  "go_to",
  { title: "Open a page on this site", description: `Open a page on ${job.platformLabel} only (https). Other sites are refused.`, inputSchema: { url: z.string().url() } },
  tool(async ({ url }) => {
    if (!hostAllowed(job.platform, url)) return refuse(`Only ${job.platformLabel} pages.`);
    const p = await page();
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(p);
    step(`opened ${new URL(url).pathname}`.slice(0, 120));
    return text([await header(p), await guard(p)].filter(Boolean).join("\n"));
  }),
);

server.registerTool(
  "go_back",
  { title: "Back", description: "The browser's Back button.", inputSchema: {} },
  tool(async () => {
    const p = await page();
    await p.goBack({ timeout: 15_000 }).catch(() => undefined);
    await settle(p);
    return text([await header(p), await guard(p)].filter(Boolean).join("\n"));
  }),
);

server.registerTool(
  "wait",
  { title: "Wait", description: "Wait up to 10 seconds for the page (an upload finishing, a dialog opening).", inputSchema: { seconds: z.number().min(1).max(10) } },
  tool(async ({ seconds }) => {
    const p = await page();
    await p.waitForTimeout(seconds * 1000);
    return text(`Waited ${seconds}s.`);
  }),
);

server.registerTool(
  "fill_approved_text",
  { title: "Put the approved text in a box", description: "Types EXACTLY the text Joe approved into the text box with this ref (replacing anything in it). The only way to enter text.", inputSchema: { ref: z.string() } },
  tool(async ({ ref }) => {
    const p = await page();
    const loc = refLocator(p, ref);
    const el = await describe(loc);
    await loc.click({ timeout: 15_000 });
    if (el.tag === "textarea" || (el.tag === "input" && !["file", "checkbox", "radio", "submit", "button"].includes(el.type))) {
      await loc.fill(job.text, { timeout: 15_000 });
    } else {
      await p.keyboard.press("Control+A");
      await p.keyboard.press("Backspace");
      const lines = job.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) await p.keyboard.insertText(lines[i]);
        if (i < lines.length - 1) await p.keyboard.press("Shift+Enter");
      }
    }
    await p.waitForTimeout(800);
    const now = await loc.evaluate((e) => ("value" in e && typeof e.value === "string" ? e.value : e.innerText)).catch(() => "");
    if (norm(now) !== norm(job.text)) {
      return refuse(`The box doesn't hold the approved text exactly. It reads: "${norm(now).slice(0, 300)}". Make sure the ref is the post's text box, then try again.`);
    }
    journal((j) => journalStep({ ...j, textFilledAt: new Date().toISOString() }, "text in"));
    return text("The approved text is in the box, exactly as approved.");
  }),
);

server.registerTool(
  "upload_photos",
  {
    title: "Add the approved photos",
    description: `Adds the ${job.photos.length} photo(s) Joe approved, in order. Pass the ref of the file input, or of the button that opens the "choose files" window (Photo/video, Add photos, Select from computer).`,
    inputSchema: { ref: z.string() },
  },
  tool(async ({ ref }) => {
    if (!job.photos.length) return refuse("This post has no photos. Don't add any.");
    const p = await page();
    const loc = refLocator(p, ref);
    const el = await describe(loc);
    if (el.tag === "input" && el.type === "file") {
      await loc.setInputFiles(job.photos, { timeout: 20_000 });
    } else {
      const [chooser] = await Promise.all([p.waitForEvent("filechooser", { timeout: 15_000 }), loc.click({ timeout: 15_000 })]);
      await chooser.setFiles(job.photos, { timeout: 20_000 });
    }
    await settle(p, 3000);
    journal((j) => journalStep({ ...j, photosUploadedAt: new Date().toISOString() }, `photos in (${job.photos.length})`));
    return text(`Added ${job.photos.length} photo(s). Wait for them to finish uploading, then check with a screenshot.`);
  }),
);

server.registerTool(
  "submit_post",
  {
    title: "Press Post (once)",
    description: "Press the final Post / Publish / Share button with this ref. Only after the approved text is in and the photos are added, and you have checked with a screenshot. Works once per run.",
    inputSchema: { ref: z.string() },
  },
  tool(async ({ ref }) => {
    const j = readJournal(job.intentId);
    if (j?.submittedAt) return refuse("Post was already pressed in this run. Never press it again; report what you see.");
    if (!j?.textFilledAt) return refuse("Put the approved text in first (fill_approved_text).");
    if (job.photos.length && !j.photosUploadedAt) return refuse("Add the approved photos first (upload_photos).");
    const p = await page();
    const loc = refLocator(p, ref);
    const el = await describe(loc);
    if (!SUBMIT_NAME.test(el.name)) return refuse(`"${el.name}" isn't a Post / Publish / Share button.`);
    await saveShot(p, "before-post");
    journal((jj) => journalStep({ ...jj, submittedAt: new Date().toISOString() }, `pressed ${el.name}`));
    await loc.click({ timeout: 15_000 });
    await settle(p, 5000);
    await saveShot(p, "after-post");
    return text(`Pressed "${el.name}". Now confirm it posted: find the post and its link (its own page), then call report_result. Don't press Post again.\n${await header(p)}`);
  }),
);

server.registerTool(
  "report_result",
  {
    title: "Report the result (ends the run)",
    description:
      "posted: the post is up; pass `url` = the link to the post itself if you found it. not_posted: it didn't go up (say why; use 'needs sign-in' for a sign-in or verification page). unsure: Post was pressed but you can't tell whether it went up.",
    inputSchema: { outcome: z.enum(["posted", "not_posted", "unsure"]), url: z.string().optional(), reason: z.string().optional() },
  },
  async ({ outcome, url, reason }) => {
    if (reported) return refuse("Already reported.");
    const j = readJournal(job.intentId);
    const at = new Date().toISOString();
    if (outcome === "posted") {
      if (!j?.submittedAt) return refuse("Post was never pressed in this run, so it can't have posted from here. Report not_posted or unsure.");
      if (url && !validPostUrl(job.platform, url)) return refuse(`"${url}" isn't a link to a ${job.platformLabel} post. Find the post's own link, or report posted without a url.`);
      journal((jj) => journalStep({ ...jj, outcome: { kind: "posted", url: url?.trim() || null, at } }, "posted"));
    } else if (outcome === "not_posted") {
      const why = (reason || "").trim() || "The agent stopped without saying why.";
      const signIn = /sign.?in|log.?in|verif|confirm.*you|checkpoint/i.test(why) || (context ? looksSignedOut(job.platform, activePage(context)?.url() ?? "") : false);
      journal((jj) => journalStep({ ...jj, outcome: { kind: "not_posted", reason: signIn ? `${job.platformLabel} needs you to sign in again (Posting accounts on /marketing). ${why}` : why, at, signIn } }, "not posted"));
    } else {
      journal((jj) => journalStep({ ...jj, outcome: { kind: "unsure", reason: (reason || "").trim() || "Post was pressed; whether it went up isn't clear.", at } }, "unsure"));
    }
    reported = true;
    return text("Recorded. You're done; stop now.");
  },
);

async function shutdown() {
  try {
    await context?.close();
  } catch {
    /* already gone */
  }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
