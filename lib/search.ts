// Search results data builder. Mock-backed today; in Phase 7 it runs a real
// index across projects/files/comms/contacts and the direct answer streams
// from the model. The grouped-results shape stays stable.

import { ai } from "./ai";

export interface SearchResult {
  icon: string;
  title: string;
  sub: string;
  href?: string;
  /** Avatar initials instead of an icon (people results). */
  avatar?: string;
}

export interface SearchGroup {
  label: string;
  results: SearchResult[];
}

export interface SearchData {
  query: string;
  meta: string;
  /** AI direct answer (may contain **bold** markdown). */
  answer: string;
  answerHref: string;
  groups: SearchGroup[];
}

export async function getSearchData(): Promise<SearchData> {
  const query = "henderson tile";

  const { summary: answer } = await ai.summarize({
    focus: "search-answer",
    text:
      "Henderson tile install starts **Mon May 25, 1pm**. Marco is the sub. " +
      "Materials verified on site Friday. Watch-out: soft spot at the pantry threshold.",
  });

  return {
    query,
    meta: "14 results · in 240 ms · across projects, files, comms, contacts",
    answer,
    answerHref: "/projects/henderson-kitchen",
    groups: [
      {
        label: "Projects · 1",
        results: [
          {
            icon: "project",
            title: "Henderson kitchen",
            sub: "Active · Tile phase · today",
            href: "/projects/henderson-kitchen",
          },
        ],
      },
      {
        label: "Files · 4",
        results: [
          { icon: "doc", title: "Henderson tile selections.xlsx", sub: "88 KB", href: "/files" },
          { icon: "doc", title: "Tile install QC checklist.docx", sub: "12 KB · auto", href: "/files" },
          { icon: "doc", title: "Marco · tile invoice CO-001.pdf", sub: "64 KB", href: "/files" },
          { icon: "img", title: "Friday flatness photo.jpg", sub: "2.1 MB", href: "/files" },
        ],
      },
      {
        label: "People · 1",
        results: [
          {
            icon: "person",
            avatar: "MR",
            title: "Marco Rivas · tile",
            sub: "14 jobs · COI thru Aug 14",
            href: "/subs/marco",
          },
        ],
      },
    ],
  };
}
