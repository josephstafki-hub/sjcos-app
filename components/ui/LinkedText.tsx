import type { ReactNode } from "react";

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** Sentence punctuation that trails a pasted URL belongs to the sentence, not
 *  the link. A closing paren stays only when the URL opened one. */
function trimUrl(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (".,;:!?".includes(last)) url = url.slice(0, -1);
    else if (last === ")" && !url.includes("(")) url = url.slice(0, -1);
    else break;
  }
  return url;
}

/** Plain message text with its http(s) URLs made clickable. The parent still
 *  needs `break-words` — a long URL is one unbreakable token without it. */
export function LinkedText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = trimUrl(match[0]);
    if (!url) continue;
    const start = match.index;
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <a
        key={start}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:opacity-80"
      >
        {url}
      </a>,
    );
    cursor = start + url.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}
