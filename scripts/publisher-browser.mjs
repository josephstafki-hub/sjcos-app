#!/usr/bin/env node
// Joe's sign-in window for the posting browser (A17). Started from /marketing
// › Posting accounts as a memory-capped systemd unit (lib/publisher/server.ts
// startSignin); never left running:
//
//   node scripts/publisher-browser.mjs --platform facebook|instagram|google_business
//
// Opens the one posting profile (lib/publisher/browser.mjs) on the site's
// sign-in page and serves it to the app over a private unix socket (0600, in
// the 0700 publisher dir): a JPEG picture of the page, and Joe's clicks, keys
// and typing. Joe signs in himself, codes and all; the cookies stay in the
// profile for the posting runs. Nothing he types is logged or stored here.
//
// Holds the browser lock (one browser at a time). Closes itself after 5 idle
// minutes (Joe closed the page) and the unit's 30-minute cap is the backstop.

import { chmodSync, rmSync } from "node:fs";
import http from "node:http";
import { acquireBrowser, signinSocketPath } from "../lib/publisher/core.ts";
import { activePage, launchPublisherBrowser, VIEWPORT } from "../lib/publisher/browser.mjs";

const SIGN_IN = {
  facebook: "https://www.facebook.com/login/",
  instagram: "https://www.instagram.com/accounts/login/",
  google_business: "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fbusiness.google.com%2Flocations",
};
const IDLE_MS = 5 * 60 * 1000;
const KEY = /^(Enter|Backspace|Delete|Tab|Shift\+Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Space)$/;

const i = process.argv.indexOf("--platform");
let platform = i >= 0 ? process.argv[i + 1] : "facebook";
if (!SIGN_IN[platform]) platform = "facebook";

const release = acquireBrowser({ mode: "signin", ref: platform });
if (!release) {
  console.error("The posting browser is in use; not opening a sign-in window.");
  process.exit(1);
}

let context = null;
let server = null;
let lastUse = Date.now();
let shooting = null;
let closing = false;

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    server?.close();
  } catch {
    /* closing */
  }
  try {
    await context?.close(); // flushes the cookies to the profile
  } catch {
    /* already gone */
  }
  rmSync(signinSocketPath(), { force: true });
  release();
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

function page() {
  const p = context && activePage(context);
  if (!p) throw new Error("no page");
  return p;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 20_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body ?? null) : body);
}

async function handle(req, res) {
  lastUse = Date.now();
  const route = req.url ?? "/";
  if (req.method === "GET" && route === "/status") {
    const p = page();
    return send(res, 200, { platform, url: p.url(), title: await p.title().catch(() => ""), width: VIEWPORT.width, height: VIEWPORT.height });
  }
  if (req.method === "GET" && route === "/frame") {
    // One screenshot at a time; concurrent asks share it.
    shooting ??= page()
      .screenshot({ type: "jpeg", quality: 60 })
      .finally(() => {
        shooting = null;
      });
    return send(res, 200, await shooting, "image/jpeg");
  }
  if (req.method === "POST" && route === "/input") {
    const b = await readBody(req);
    const p = page();
    if (b.type === "click" && Number.isFinite(b.x) && Number.isFinite(b.y)) {
      await p.mouse.click(Math.max(0, Math.min(VIEWPORT.width, b.x)), Math.max(0, Math.min(VIEWPORT.height, b.y)));
    } else if (b.type === "scroll" && Number.isFinite(b.dy)) {
      await p.mouse.wheel(0, Math.max(-3000, Math.min(3000, b.dy)));
    } else if (b.type === "key" && typeof b.key === "string" && KEY.test(b.key)) {
      await p.keyboard.press(b.key === "Space" ? " " : b.key);
    } else if (b.type === "text" && typeof b.text === "string" && b.text.length <= 500) {
      await p.keyboard.insertText(b.text);
    } else if (b.type === "back") {
      await p.goBack({ timeout: 15_000 }).catch(() => undefined);
    } else {
      return send(res, 400, { error: "bad input" });
    }
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && route === "/goto") {
    const b = await readBody(req);
    if (SIGN_IN[b.platform]) {
      platform = b.platform;
      await page().goto(SIGN_IN[platform], { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    }
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && route === "/close") {
    send(res, 200, { ok: true });
    setTimeout(() => shutdown(0), 50);
    return;
  }
  send(res, 404, { error: "not found" });
}

try {
  context = await launchPublisherBrowser();
  const p = activePage(context) ?? (await context.newPage());
  await p.goto(SIGN_IN[platform], { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  rmSync(signinSocketPath(), { force: true });
  server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      try {
        send(res, 500, { error: String(err?.message ?? err).slice(0, 200) });
      } catch {
        /* response already gone */
      }
    });
  });
  await new Promise((resolve) => server.listen(signinSocketPath(), resolve));
  chmodSync(signinSocketPath(), 0o600);
  setInterval(() => {
    if (Date.now() - lastUse > IDLE_MS) shutdown(0);
  }, 15_000).unref();
} catch (err) {
  console.error(`[publisher-browser] ${err?.stack ?? err}`);
  await shutdown(1);
}
