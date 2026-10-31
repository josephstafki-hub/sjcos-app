"use client";

/** Plain text and common Markdown blocks rendered as React nodes: draft HTML
 * is never injected into the page. */
export function PostPreview({title, body}: {title: string; body: string}) {
  return <details className="rounded-lg border border-rule-soft bg-card p-4" open>
    <summary className="cursor-pointer text-label font-semibold text-accent-2">Rendered preview</summary>
    <article className="mt-4 space-y-3 break-words text-body leading-relaxed text-ink">
      <h2 className="font-serif text-title">{title}</h2>
      {body.split(/\n\s*\n/).filter(Boolean).map((block,i) => {
        if (/^#{1,6} /.test(block)) return <h3 key={i} className="font-serif text-heading">{block.replace(/^#{1,6} /, "")}</h3>;
        if (/^[-*] /m.test(block) && block.split("\n").every(line => /^[-*] /.test(line))) return <ul key={i} className="list-disc space-y-1 pl-5">{block.split("\n").map((line,j) => <li key={j}>{line.slice(2)}</li>)}</ul>;
        return <p key={i} className="whitespace-pre-wrap">{block}</p>;
      })}
      {!body.trim() && <p className="text-ink-3">Add post copy to preview it here.</p>}
    </article>
  </details>;
}
