// Site / CMS data builder. Mock-backed today; in Phase 7 this reads the live
// sjcarpentryllc.com page set + the AI auto-publish queue. The 2-pane shape
// (pages rail + editor preview) stays stable.

/** Publish state for a page row. */
export type PageStatus = "PUBLISHED" | "AUTO-SYNC" | "LIVE";

export interface SitePage {
  slug: string;
  name: string;
  status: PageStatus;
}

export interface QueueItem {
  title: string;
  /** AI-generated draft (sage card) vs. a manual placeholder. */
  ai: boolean;
  status: string;
}

export interface HomeContent {
  eyebrow: string;
  /** Editable hero headline (may contain a newline). */
  headline: string;
  sub: string;
  recentWork: string[];
}

export interface SiteData {
  domain: string;
  pages: SitePage[];
  queue: QueueItem[];
  syncNote: string;
  selectedSlug: string;
  /** Curated showcase content for the Home page editor. */
  home: HomeContent;
}

const PAGES: SitePage[] = [
  { slug: "home", name: "Home", status: "PUBLISHED" },
  { slug: "about", name: "About", status: "PUBLISHED" },
  { slug: "services", name: "Services", status: "PUBLISHED" },
  { slug: "portfolio", name: "Portfolio", status: "AUTO-SYNC" },
  { slug: "blog", name: "Blog", status: "PUBLISHED" },
  { slug: "contact", name: "Contact", status: "PUBLISHED" },
  { slug: "admin", name: "/admin", status: "LIVE" },
];

const QUEUE: QueueItem[] = [
  { title: "Olson porch · post", ai: true, status: "Ready" },
  { title: "Olson porch · gallery", ai: true, status: "Ready" },
  { title: "New: Pham bath (draft)", ai: false, status: "Job in progress" },
];

export async function getSiteData(): Promise<SiteData> {
  return {
    domain: "sjcarpentryllc.com",
    pages: PAGES,
    queue: QUEUE,
    syncNote: "Synced · last push 2h ago",
    selectedSlug: "home",
    home: {
      eyebrow: "MINNEAPOLIS · ST PAUL",
      headline: "Built thoughtfully.\nBuilt to last.",
      sub: "Custom carpentry, kitchen and bath renovation, and additions across the Twin Cities since 2017.",
      recentWork: ["Olson porch · Edina", "Bauer mudroom · Mpls", "Mendez kitchen · St Paul"],
    },
  };
}
