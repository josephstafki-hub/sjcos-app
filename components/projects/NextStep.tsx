/** A scan-friendly line with the original context available on demand. */
export function NextStep({ text }: { text: string }) {
  if (!text) return null;
  const concise = text.split(/(?<=[.!?])\s+|\n/)[0];
  return (
    <details className="group min-w-0 text-meta font-normal text-ink-2">
      <summary className="flex min-h-11 cursor-pointer @xl/page:min-h-7 items-center gap-1 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
        <span aria-hidden="true" className="shrink-0 group-open:rotate-90">▸</span>
        <span className="min-w-0 flex-1 truncate">{concise}</span>
        <span className="sr-only"> — expand full details</span>
      </summary>
      <p className="pb-2 whitespace-pre-line break-words">{text}</p>
    </details>
  );
}
