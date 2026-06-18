import { Suspense, type ReactNode } from "react";

/** Streams AI-generated text into a Suspense boundary so the page shell paints
 *  immediately instead of blocking on slow (CPU Qwen, ~10–20s) inference.
 *
 *  `load` runs server-side (pass a server function / closure over server-only
 *  helpers — never serialized). Drop this inside an <AiBubble> in place of an
 *  awaited string. Safe to pass as `children` into a client component slot. */
export function AiStream({
  load,
  fallback,
}: {
  load: () => Promise<string>;
  fallback?: ReactNode;
}) {
  return (
    <Suspense fallback={fallback ?? <AiStreamSkeleton />}>
      <Resolved load={load} />
    </Suspense>
  );
}

async function Resolved({ load }: { load: () => Promise<string> }) {
  const text = await load();
  return <>{text}</>;
}

/** Shimmer placeholder shown while the AI text is being composed. */
export function AiStreamSkeleton() {
  return (
    <div className="space-y-1.5" aria-hidden>
      <div className="h-3 w-[92%] animate-pulse rounded bg-ai/15" />
      <div className="h-3 w-[72%] animate-pulse rounded bg-ai/15" />
      <div className="h-3 w-[45%] animate-pulse rounded bg-ai/15" />
    </div>
  );
}
