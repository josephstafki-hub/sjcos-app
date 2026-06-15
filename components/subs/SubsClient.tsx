"use client";

import { useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { Avatar, Card, Chip } from "@/components/ui";
import type { SubCard, SubsData, TradeFilter } from "@/lib/subs";

export function SubsClient({ data }: { data: SubsData }) {
  const [trade, setTrade] = useState<TradeFilter>("All");

  const visible =
    trade === "All" ? data.subs : data.subs.filter((s) => s.tradeKey === trade);

  return (
    <>
      {/* Trade filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {data.trades.map((t) => (
          <button key={t} onClick={() => setTrade(t)}>
            <Chip kind={trade === t ? "solid" : "ghost"}>{t}</Chip>
          </button>
        ))}
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <SubGridCard key={s.slug} sub={s} />
        ))}
        {visible.length === 0 && (
          <Card kind="dashed" className="col-span-full p-8 text-center">
            <div className="text-[13px] text-ink-3">No subs in this trade yet.</div>
          </Card>
        )}
      </div>
    </>
  );
}

function SubGridCard({ sub: s }: { sub: SubCard }) {
  const expiring = s.coiStatus === "expiring";
  return (
    <Link href={`/subs/${s.slug}`} className="block">
      <Card
        className={["p-3.5 transition-colors hover:bg-paper-2", expiring ? "border-flag" : ""].join(" ")}
      >
        <div className="flex items-start gap-2.5">
          <Avatar initials={s.initials} kind={s.fav ? "accent" : "gray"} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="flex-1 truncate font-serif text-[14px] font-semibold text-ink">
                {s.name}
              </span>
              {s.fav && <Star className="size-3 flex-none fill-accent text-accent" strokeWidth={1.5} />}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-3">{s.trade}</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={[
                      "size-3",
                      n <= s.rating ? "fill-accent text-accent" : "text-ink-4",
                    ].join(" ")}
                    strokeWidth={1.5}
                  />
                ))}
              </div>
              <span className="text-[11px] text-ink-3">{s.jobsCount} jobs</span>
            </div>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-rule" />

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip kind="ghost">{s.rate}</Chip>
          {s.openJobs > 0 ? (
            <Chip kind="accent" dot>
              {s.openJobs} open job{s.openJobs > 1 ? "s" : ""}
            </Chip>
          ) : (
            <Chip kind="ghost">no open jobs</Chip>
          )}
          {expiring ? (
            <Chip kind="flag" dot>
              COI expires {s.coiLabel}
            </Chip>
          ) : (
            <Chip kind="money">COI · {s.coiLabel}</Chip>
          )}
        </div>
      </Card>
    </Link>
  );
}
