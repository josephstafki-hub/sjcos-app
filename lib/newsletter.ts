// Newsletter data builder. Mock-backed today; in Phase 7 it reads sent issues
// + audience counts from the mailing backend. The 2-pane shape (issues rail +
// email preview) stays stable.

export type IssueStatus = "DRAFT" | "SENT";

export interface NewsletterIssue {
  slug: string;
  name: string;
  status: IssueStatus;
}

export interface NewsletterContent {
  masthead: string;
  headline: string;
  byline: string;
  body: string[];
  alsoThisMonth: string[];
}

export interface NewsletterData {
  issues: NewsletterIssue[];
  audience: { label: string; value: string }[];
  performance: { label: string; value: string; good?: boolean }[];
  selectedSlug: string;
  content: NewsletterContent;
}

const ISSUES: NewsletterIssue[] = [
  { slug: "may-2026", name: "May 2026 · Draft", status: "DRAFT" },
  { slug: "apr-2026", name: "Apr 2026", status: "SENT" },
  { slug: "mar-2026", name: "Mar 2026", status: "SENT" },
  { slug: "feb-2026", name: "Feb 2026", status: "SENT" },
];

export async function getNewsletterData(): Promise<NewsletterData> {
  return {
    issues: ISSUES,
    audience: [
      { label: "Past clients", value: "214" },
      { label: "Active clients", value: "5" },
      { label: "Site subscribers", value: "88" },
    ],
    performance: [
      { label: "Apr open rate", value: "54%", good: true },
      { label: "Apr click rate", value: "11%" },
      { label: "Apr replies", value: "7" },
    ],
    selectedSlug: "may-2026",
    content: {
      masthead: "MAY · FROM THE WORKSHOP",
      headline: "The Olson porch, and what we learned.",
      byline: "Joe Schroeder · 6 min read",
      body: [
        "This month we wrapped the Olson porch in Edina — a stripped-back craftsman build that came down to one decision: how do you make a rebuild feel like it was always there?",
        "The answer was in the trim. We milled the brackets to match the existing roof line — and the proportion came from Asher Benjamin, who's been dead 180 years but still has opinions worth listening to…",
      ],
      alsoThisMonth: [
        "3 spots open in late summer · scheduling now",
        "Welcoming Jen Doyle Plumbing to the SJC bench",
      ],
    },
  };
}
