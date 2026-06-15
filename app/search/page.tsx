import { Fragment } from "react";
import Link from "next/link";
import {
  Search,
  FolderKanban,
  FileText,
  Image as ImageIcon,
  ArrowRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, Avatar, Card, Eyebrow } from "@/components/ui";
import { getSearchData } from "@/lib/search";

const ICON: Record<string, LucideIcon> = {
  project: FolderKanban,
  doc: FileText,
  img: ImageIcon,
};

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <b key={i} className="font-semibold">
            {p.slice(2, -2)}
          </b>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export default async function SearchPage() {
  const data = await getSearchData();

  return (
    <Shell breadcrumb="SEARCH RESULTS" hideCmd>
      <div className="flex justify-center overflow-y-auto px-7 pb-16 pt-6">
        <div className="w-[720px] max-w-full">
          {/* Search box */}
          <Card className="flex items-center gap-2 px-3 py-2">
            <Search className="size-3.5 text-ink-3" strokeWidth={1.5} />
            <span className="flex-1 font-serif text-[15px] font-semibold text-ink">{data.query}</span>
            <span className="font-mono text-[11px] text-ink-3">⌘K</span>
          </Card>
          <div className="mt-2.5 text-[11px] text-ink-3">{data.meta}</div>

          <div className="mt-4 flex flex-col gap-2">
            {/* AI direct answer */}
            <AiBubble
              actions={
                <Link
                  href={data.answerHref}
                  className="inline-flex items-center gap-1 rounded-md bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2"
                >
                  <Sparkles className="size-3" strokeWidth={1.5} />
                  Open Henderson project
                </Link>
              }
            >
              <div className="mb-1 font-serif text-[13px] font-semibold text-ai-2">Direct answer</div>
              <div>
                <RichText text={data.answer} />
              </div>
            </AiBubble>

            {/* Grouped results */}
            {data.groups.map((g) => (
              <div key={g.label} className="mt-2 flex flex-col gap-2">
                <Eyebrow>{g.label}</Eyebrow>
                {g.results.map((r) => {
                  const Icon = ICON[r.icon] ?? FileText;
                  const inner = (
                    <Card className="p-3 transition-colors hover:bg-paper-2">
                      <div className="flex items-center gap-2.5">
                        {r.avatar ? (
                          <Avatar initials={r.avatar} size="sm" />
                        ) : (
                          <Icon className="size-3.5 flex-none text-ink-2" strokeWidth={1.5} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-serif text-[13.5px] font-semibold text-ink">
                            {r.title}
                          </div>
                          <div className="text-[11px] text-ink-3">{r.sub}</div>
                        </div>
                        {r.href && (
                          <ArrowRight className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                        )}
                      </div>
                    </Card>
                  );
                  return r.href ? (
                    <Link key={r.title} href={r.href} className="block">
                      {inner}
                    </Link>
                  ) : (
                    <div key={r.title}>{inner}</div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
