/** A list row's next step: its first sentence, with a More/Less disclosure only
 *  when there is more to read. */
export function NextStep({ text }: { text: string }) {
  if (!text) return null;
  const concise = text.split(/(?<=[.!?])\s+|\n/)[0];
  if (concise.trim() === text.trim()) {
    return <p className="line-clamp-2 break-words text-meta font-normal text-ink-2">{text}</p>;
  }
  return (
    <details className="group min-w-0 text-meta font-normal text-ink-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-baseline gap-1.5 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus @xl/page:min-h-7 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 line-clamp-2 break-words group-open:hidden">{concise}</span>
        <span className="min-w-0 flex-1 hidden group-open:inline">Next step</span>
        <span className="shrink-0 font-semibold text-accent-2 underline-offset-2 group-hover:underline">
          <span className="group-open:hidden">More</span>
          <span className="hidden group-open:inline">Less</span>
        </span>
      </summary>
      <p className="pb-2 whitespace-pre-line break-words">{text}</p>
    </details>
  );
}
