// Launching the posting browser (A17). Plain JS so the posting run's browser
// tools (mcp/publisher-browser.mjs) and Joe's sign-in window
// (scripts/publisher-browser.mjs) open the SAME profile the same way: the
// sites see one ordinary desktop Chrome, signed in once by Joe.
//
// playwright-core drives the Chromium build already on this box
// (~/.cache/ms-playwright, matching playwright-core 1.61.1). SJC_PLAYWRIGHT_CORE
// can point at another copy of playwright-core (a checkout without it).

import { spawnSync } from "node:child_process";
import { ensurePublisherDirs, profileDir } from "./core.ts";

export async function loadPlaywright() {
  const mod = await import(process.env.SJC_PLAYWRIGHT_CORE || "playwright-core");
  return mod.chromium ? mod : mod.default;
}

export const VIEWPORT = { width: 1280, height: 900 };

/** A desktop Chrome user agent for the installed build ("HeadlessChrome"
 *  would get sign-ins refused). Chrome's reduced UA: major version only. */
function desktopUserAgent(executablePath) {
  const r = spawnSync(executablePath, ["--version"], { encoding: "utf8", timeout: 10_000 });
  const major = /(\d+)\.\d+\.\d+\.\d+/.exec(r.stdout || "")?.[1] ?? "149";
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** Open the one persistent profile. The caller holds the browser lock. */
export async function launchPublisherBrowser() {
  ensurePublisherDirs();
  const { chromium } = await loadPlaywright();
  const context = await chromium.launchPersistentContext(profileDir(), {
    channel: "chromium", // new headless on the full browser, not the headless shell
    headless: true,
    viewport: VIEWPORT,
    userAgent: desktopUserAgent(chromium.executablePath()),
    locale: "en-US",
    timezoneId: "America/Chicago",
    acceptDownloads: false,
    args: ["--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled", "--password-store=basic"],
  });
  return context;
}

/** The page the browser is on now (the newest open tab). */
export function activePage(context) {
  const pages = context.pages().filter((p) => !p.isClosed());
  return pages[pages.length - 1] ?? null;
}
