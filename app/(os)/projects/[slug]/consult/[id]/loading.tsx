import { Shell } from "@/components/shell/Shell";

/** Visit page loading state (plan §6.8): skeleton rows, no spinner text that guesses. */
export default function Loading() {
  return (
    <Shell breadcrumb="PROJECTS › IN-HOME CONSULTATION">
      <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-6" role="status" aria-label="Loading the visit">
        <div className="mb-6 h-8 w-72 animate-pulse rounded-md bg-paper-3 motion-reduce:animate-none" />
        <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)_320px]">
          {[0, 1, 2].map((c) => (
            <div key={c} className="grid content-start gap-2">
              {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-md bg-paper-3 motion-reduce:animate-none" />)}
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
