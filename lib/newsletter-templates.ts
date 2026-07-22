// Newsletter templates (P2-5). Pure data + copy — no db import, so this is safe
// to pull into the client editor AND the server actions. A template is just a
// starter layout: it seeds intro/block scaffolding on "new issue", drives the
// Preview styling (via `key`), and composes the plain-text email at send time.
// The greeting copy lives here too so all outbound email copy is in one place.

import type { NewsletterBlock } from "@/lib/newsletter";

export type TemplateKey = "classic" | "jobsite" | "seasonal";

export interface NewsletterTemplate {
  key: TemplateKey;
  label: string;
  description: string;
  /** Seed content dropped into a fresh issue. */
  starterIntro: string;
  starterBlocks: NewsletterBlock[];
}

export const NEWSLETTER_TEMPLATES: NewsletterTemplate[] = [
  {
    key: "classic",
    label: "Monthly letter",
    description: "A clean, simple note — intro plus whatever sections you add.",
    starterIntro: "",
    starterBlocks: [],
  },
  {
    key: "jobsite",
    label: "Project spotlight",
    description: "Lead with a finished job, close with a soft call to book.",
    starterIntro:
      "Here's what we've been building lately — and a little of what's on the horizon.",
    starterBlocks: [
      { heading: "From the jobsite", body: "Tell the story of a recent project — what the client wanted, what you built, how it turned out." },
      { heading: "Now booking", body: "Let readers know what you have room for next season and how to reach you." },
    ],
  },
  {
    key: "seasonal",
    label: "Seasonal checklist",
    description: "A friendly seasonal note with a short home-maintenance checklist.",
    starterIntro: "A few things worth checking around the house this time of year.",
    starterBlocks: [
      {
        heading: "This season's home checklist",
        body: "• Check exterior trim and caulking\n• Clear gutters and downspouts\n• Look for drafts around doors and windows",
      },
    ],
  },
];

export function getTemplate(key: string | null | undefined): NewsletterTemplate {
  return NEWSLETTER_TEMPLATES.find((t) => t.key === key) ?? NEWSLETTER_TEMPLATES[0];
}

/** Compose the plain-text email body for an issue, styled by its template. */
export function composeIssueEmail(
  templateKey: string,
  title: string,
  intro: string,
  blocks: NewsletterBlock[],
): { subject: string; body: string } {
  const tpl = getTemplate(templateKey).key;
  const parts: string[] = [];
  if (intro.trim()) parts.push(intro.trim());
  for (const b of blocks) {
    if (!b.heading && !b.body) continue;
    let head = b.heading ?? "";
    if (head) {
      if (tpl === "jobsite") head = `== ${head.toUpperCase()} ==`;
      else if (tpl === "seasonal") head = `> ${head}`;
      else head = head.toUpperCase();
    }
    parts.push([head, b.body].filter(Boolean).join("\n"));
  }
  parts.push("—\nSJ Carpentry LLC\nReply to this email any time.");
  return { subject: title.trim() || "SJ Carpentry LLC", body: parts.join("\n\n") };
}

