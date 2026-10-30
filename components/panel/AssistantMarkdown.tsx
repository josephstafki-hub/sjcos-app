import { Fragment, type ReactNode } from "react";

/** Deliberately small Markdown renderer. React escapes all text; no raw HTML,
 * images, embedded content, or model-provided attributes are evaluated. */
export function safeChatHref(value: string): string | undefined {
  if (/[\u0000-\u0020\u007f]/.test(value)) return undefined;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
function inline(text: string): ReactNode[] {
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  const out: ReactNode[] = [];
  let start = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(start, m.index));
    const token = m[0];
    const key = m.index;
    if (token.startsWith("`")) out.push(<code key={key} className="rounded bg-paper px-1 font-mono text-label">{token.slice(1,-1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2,-2)}</strong>);
    else if (token.startsWith("*")) out.push(<em key={key}>{token.slice(1,-1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      const href = safeChatHref(link[2]);
      out.push(href ? <a key={key} href={href} className="break-words text-accent underline underline-offset-2" target={href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer">{link[1]}</a> : <Fragment key={key}>{link[1]}</Fragment>);
    }
    start = m.index! + token.length;
  }
  out.push(text.slice(start));
  return out;
}
export function AssistantMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={i} className="overflow-x-auto rounded-md bg-paper p-3 font-mono text-label"><code>{code.join("\n")}</code></pre>);
    } else if (/^\s*(?:[-*+] |\d+\. )/.test(line)) {
      const ordered = /^\s*\d+\. /.test(line); const items: ReactNode[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\. / : /^\s*[-*+] /).test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i++].replace(/^\s*(?:[-*+] |\d+\. )/, ""))}</li>);
      }
      blocks.push(ordered ? <ol key={i} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={i} className="list-disc space-y-1 pl-5">{items}</ul>);
    } else if (/^#{1,6} /.test(line)) {
      blocks.push(<p key={i++} className="text-subheading font-semibold">{inline(line.replace(/^#{1,6} /,""))}</p>);
    } else {
      const paragraph = [line]; i++;
      while (i < lines.length && lines[i].trim() && !/^(?:```|#{1,6} |\s*[-*+] |\s*\d+\. )/.test(lines[i])) paragraph.push(lines[i++]);
      blocks.push(<p key={i} className="whitespace-pre-wrap">{inline(paragraph.join("\n"))}</p>);
    }
  }
  return <div className="max-w-prose space-y-3 break-words text-body leading-relaxed">{blocks}</div>;
}
