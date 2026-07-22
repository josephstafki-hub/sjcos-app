// Newsletter HTML renderer (P7-N). PURE — no db, no server-only, no node builtins.
// That is the point: the editor's Preview tab renders the exact same markup the
// recipient will receive, so what Joe approves is what actually ships. Both
// callers pass their own baseUrl.
//
// WHY TABLES AND INLINE STYLES: Outlook desktop renders through Word's HTML
// engine — no flexbox, no grid, no <style> blocks worth trusting, and it drops
// margins on block elements. Nested tables with inline attributes are the only
// layout primitive that survives Gmail + Outlook + Apple Mail together. This
// file looks like 2004 on purpose.

import type { NewsletterBlock } from "./newsletter";
import { getFont, type IssueSettings } from "./newsletter-design";

export interface RenderableIssue {
  title: string;
  intro: string;
  blocks: NewsletterBlock[];
  settings: IssueSettings;
}

export interface RenderOpts {
  /** Absolute origin, no trailing slash — images and links must be absolute. */
  baseUrl: string;
  /** newsletter_outbox.track_token → appends the 1×1 open pixel. Omit in preview. */
  trackToken?: string;
  /** newsletter_recipients.unsub_token → real one-click opt-out. */
  unsubToken?: string;
}

// ─── escaping ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Resolve a block URL to something safe to put behind a click, or "" to drop it.
 *  Only http(s)/mailto/tel survive; javascript:, data: and vbscript: do not. Block
 *  URLs are typed by the owner, but they render into other people's inboxes, so
 *  validate anyway.
 *
 *  Both renderers share this. They must agree: an earlier version re-implemented
 *  the "assume https" shortcut in the text path only, which turned a rejected
 *  `javascript:` URL into the nonsense `https://javascript:alert(1)` — dropped
 *  from the HTML but still printed in the plain-text alternative. */
function normalizeUrl(raw: string | undefined): string {
  const u = (raw ?? "").trim();
  if (!u) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(u)) return u;
  // Bare domain typed without a scheme is the common case — assume https.
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return `https://${u}`;
  return "";
}

/** normalizeUrl + HTML-escaped, for use in an href. */
function safeUrl(raw: string | undefined): string {
  const u = normalizeUrl(raw);
  return u ? esc(u) : "";
}

/** Paragraph-ize plain text: blank line → new <p>, single newline → <br>. */
function paragraphs(text: string, style: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${style}">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ─── HTML ────────────────────────────────────────────────────────────────────

export function renderIssueHtml(issue: RenderableIssue, opts: RenderOpts): string {
  const s = issue.settings;
  const font = getFont(s.font).stack;
  const base = opts.baseUrl.replace(/\/$/, "");

  const bodyStyle = `margin:0 0 14px;font-family:${font};font-size:${s.bodySize}px;line-height:1.65;color:#1c1c1c`;
  const headingStyle = `margin:0 0 8px;font-family:${font};font-size:${s.bodySize + 5}px;line-height:1.3;font-weight:bold;color:${s.accent}`;

  const rows: string[] = [];

  // Masthead — logo lives in public/, so it is already publicly fetchable.
  if (s.showLogo) {
    rows.push(
      `<tr><td align="center" style="padding:28px 32px 8px">` +
        `<img src="${base}/brand/sjc-logo.png" alt="SJ Carpentry LLC" width="140" ` +
        `style="display:block;border:0;width:140px;max-width:60%;height:auto"></td></tr>`,
    );
  }

  // Title.
  rows.push(
    `<tr><td style="padding:${s.showLogo ? "12px" : "32px"} 32px 0">` +
      `<h1 style="margin:0;font-family:${font};font-size:${s.bodySize + 10}px;line-height:1.25;font-weight:bold;color:#1c1c1c">${esc(issue.title)}</h1>` +
      `<div style="height:3px;width:44px;background:${s.accent};margin:14px 0 0;font-size:0;line-height:0">&nbsp;</div>` +
      `</td></tr>`,
  );

  if (issue.intro.trim()) {
    rows.push(`<tr><td style="padding:22px 32px 0">${paragraphs(issue.intro, bodyStyle)}</td></tr>`);
  }

  for (const b of issue.blocks) {
    const html = renderBlock(b, { base, font, accent: s.accent, bodyStyle, headingStyle });
    if (html) rows.push(html);
  }

  // Footer + unsubscribe.
  const unsub = opts.unsubToken
    ? `<a href="${base}/api/newsletter/unsubscribe/${esc(opts.unsubToken)}" style="color:#8a8a8a;text-decoration:underline">Unsubscribe</a>`
    : "";
  rows.push(
    `<tr><td style="padding:30px 32px 32px">` +
      `<div style="border-top:1px solid #e2e0da;padding-top:14px;font-family:${font};font-size:12px;line-height:1.6;color:#8a8a8a">` +
      esc(s.footer).replace(/\n/g, "<br>") +
      (unsub ? `<br>${unsub}` : "") +
      `</div></td></tr>`,
  );

  const pixel = opts.trackToken
    ? `<img src="${base}/api/newsletter/open/${esc(opts.trackToken)}" width="1" height="1" alt="" style="border:0;width:1px;height:1px">`
    : "";

  // Outer table centers the card in clients that ignore margin:auto (Outlook).
  return (
    `<div style="background:#f4f2ed;padding:24px 0;width:100%">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f2ed">` +
    `<tr><td align="center">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ` +
    `style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e2e0da;border-radius:6px">` +
    rows.join("") +
    `</table>${pixel}</td></tr></table></div>`
  );
}

interface BlockCtx {
  base: string;
  font: string;
  accent: string;
  bodyStyle: string;
  headingStyle: string;
}

function renderBlock(b: NewsletterBlock, ctx: BlockCtx): string {
  const kind = b.kind ?? "text";
  const pad = "padding:22px 32px 0";

  if (kind === "divider") {
    return (
      `<tr><td style="padding:26px 32px 4px">` +
      `<div style="border-top:1px solid #e2e0da;font-size:0;line-height:0">&nbsp;</div></td></tr>`
    );
  }

  if (kind === "image") {
    if (!b.imageToken) return "";
    const src = `${ctx.base}/api/newsletter/img/${esc(b.imageToken)}`;
    const alt = esc(b.imageAlt ?? b.heading ?? "");
    // width/height omitted deliberately: the asset route doesn't know the intrinsic
    // size, and a wrong width attribute is worse than none. max-width keeps it in
    // the card; Outlook honors the width style on img.
    let img =
      `<img src="${src}" alt="${alt}" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:4px">`;
    // A linked image (e.g. pulled from a blog post) — the whole photo becomes
    // the click target, same URL rule as a button block.
    const linkHref = safeUrl(b.buttonUrl);
    if (linkHref) img = `<a href="${linkHref}" style="border:0;text-decoration:none">${img}</a>`;
    const caption = b.caption?.trim()
      ? `<div style="margin:8px 0 0;font-family:${ctx.font};font-size:12px;line-height:1.5;color:#8a8a8a">${esc(b.caption.trim())}</div>`
      : "";
    return `<tr><td style="${pad}">${img}${caption}</td></tr>`;
  }

  if (kind === "button") {
    const href = safeUrl(b.buttonUrl);
    const label = (b.buttonLabel ?? "").trim();
    if (!href || !label) return "";
    const align = b.align === "left" ? "left" : "center";
    // Bulletproof-ish button: a padded <a> inside a bgcolor table cell, which is
    // the combination Outlook renders without collapsing the padding.
    return (
      `<tr><td align="${align}" style="padding:24px 32px 0">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}"><tr>` +
      `<td bgcolor="${ctx.accent}" style="border-radius:4px">` +
      `<a href="${href}" style="display:inline-block;padding:12px 26px;font-family:${ctx.font};font-size:15px;` +
      `font-weight:bold;color:#ffffff;text-decoration:none;border-radius:4px">${esc(label)}</a>` +
      `</td></tr></table></td></tr>`
    );
  }

  if (kind === "quote") {
    if (!b.body.trim()) return "";
    const attrib = b.heading?.trim()
      ? `<div style="margin:10px 0 0;font-family:${ctx.font};font-size:13px;color:#8a8a8a">— ${esc(b.heading.trim())}</div>`
      : "";
    return (
      `<tr><td style="${pad}">` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
      `<td style="border-left:3px solid ${ctx.accent};padding:2px 0 2px 16px">` +
      `<div style="margin:0;font-family:${ctx.font};font-size:17px;line-height:1.55;font-style:italic;color:#3a3a3a">${esc(b.body.trim()).replace(/\n/g, "<br>")}</div>` +
      attrib +
      `</td></tr></table></td></tr>`
    );
  }

  // text
  if (!b.heading?.trim() && !b.body?.trim()) return "";
  const h = b.heading?.trim() ? `<h2 style="${ctx.headingStyle}">${esc(b.heading.trim())}</h2>` : "";
  const body = b.body?.trim() ? paragraphs(b.body, ctx.bodyStyle) : "";
  return `<tr><td style="${pad}">${h}${body}</td></tr>`;
}

// ─── plain text ──────────────────────────────────────────────────────────────

/** The text/plain alternative. Every message ships both — some clients prefer
 *  text, and a text part measurably helps deliverability. */
export function renderIssueText(issue: RenderableIssue, opts: RenderOpts): string {
  const base = opts.baseUrl.replace(/\/$/, "");
  const parts: string[] = [issue.title.trim().toUpperCase()];
  if (issue.intro.trim()) parts.push(issue.intro.trim());

  for (const b of issue.blocks) {
    const kind = b.kind ?? "text";
    if (kind === "divider") {
      parts.push("—".repeat(20));
    } else if (kind === "image") {
      // An image is not nothing in the text part — describe it so the message
      // still reads coherently rather than jumping between paragraphs.
      const label = b.caption?.trim() || b.imageAlt?.trim() || b.heading?.trim();
      const href = normalizeUrl(b.buttonUrl);
      if (label && href) parts.push(`[photo: ${label}] ${href}`);
      else if (label) parts.push(`[photo: ${label}]`);
      else if (href) parts.push(href);
    } else if (kind === "button") {
      const href = normalizeUrl(b.buttonUrl);
      const label = (b.buttonLabel ?? "").trim();
      if (href && label) parts.push(`${label}: ${href}`);
    } else if (kind === "quote") {
      if (b.body.trim()) {
        parts.push(
          b.body.trim().split("\n").map((l) => `  "${l}"`).join("\n") +
            (b.heading?.trim() ? `\n  — ${b.heading.trim()}` : ""),
        );
      }
    } else {
      if (!b.heading?.trim() && !b.body?.trim()) continue;
      parts.push([b.heading?.trim().toUpperCase(), b.body?.trim()].filter(Boolean).join("\n"));
    }
  }

  parts.push("—\n" + issue.settings.footer);
  if (opts.unsubToken) parts.push(`Unsubscribe: ${base}/api/newsletter/unsubscribe/${opts.unsubToken}`);
  return parts.join("\n\n");
}
