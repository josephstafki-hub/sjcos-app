import { Flag, Check, ImagePlus, Mic, Plus, Phone } from "lucide-react";
import { Avatar, Card, Chip, Eyebrow } from "@/components/ui";
import { getSubPortalData } from "@/lib/sub-portal";
import { requireRole } from "@/lib/dal";
import { getSub } from "@/lib/subs";

export default async function SubPortalPage() {
  const user = await requireRole("owner", "sub");
  const data = await getSubPortalData();

  // Scope the portal identity to the logged-in subcontractor (owners previewing
  // keep the showcase identity). Job content stays curated for now.
  if (user.role === "sub" && user.linkSlug) {
    const sub = await getSub(user.linkSlug);
    if (sub) {
      data.subName = sub.name;
      data.subInitials = sub.initials;
      data.trade = sub.tradeLine;
    }
  }

  return (
    <div className="flex h-screen flex-col bg-paper">
      {/* slim header */}
      <header className="flex h-[50px] flex-none items-center gap-3 border-b border-rule bg-paper-2 px-7">
        <span className="font-serif text-[15px] font-semibold text-accent-2">SJ Carpentry</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          Sub portal · {data.subName} · {data.trade}
        </span>
        <div className="flex-1" />
        <Chip kind="money">COI current</Chip>
        <Avatar initials={data.subInitials} size="sm" />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 pb-12 pt-6">
        <Eyebrow>Mon · May 25 · job 1 of 1</Eyebrow>
        <h1 className="mt-1 font-serif text-[30px] font-medium leading-none text-accent-2">
          Today: {data.job}
        </h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {data.jobChips.map((c) => (
            <Chip key={c.label} kind={c.kind} dot={c.dot}>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
          {/* left column */}
          <div className="flex flex-col gap-3">
            <Card className="p-3.5">
              <h2 className="mb-2 font-serif text-[15px] font-semibold text-ink">
                Scope today · per agreement
              </h2>
              <div className="flex flex-col gap-1.5">
                {data.scope.map((s) => (
                  <div key={s} className="flex items-start gap-2">
                    <span className="mt-0.5 size-3.5 flex-none rounded-[3px] border border-ink-4" />
                    <span className="text-[13px] text-ink">{s}</span>
                  </div>
                ))}
              </div>
              <div className="my-3 border-t border-dashed border-rule" />
              <Eyebrow muted>Materials on site</Eyebrow>
              <div className="mt-2 flex flex-col gap-1.5">
                {data.materials.map((m) => (
                  <div key={m.label} className="flex items-center gap-2">
                    <span className="flex-1 text-[12px] text-ink-2">{m.label}</span>
                    {m.verified && <Chip kind="money">verified</Chip>}
                  </div>
                ))}
              </div>
            </Card>

            <Card kind="flag" className="p-3">
              <div className="flex items-start gap-2">
                <Flag className="mt-0.5 size-3.5 flex-none text-flag" strokeWidth={1.5} />
                <div className="flex-1">
                  <div className="font-serif text-[13px] font-semibold text-flag">
                    {data.watchout.title}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-2">{data.watchout.detail}</div>
                </div>
                <button className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-paper-2">
                  Photo from Joe
                </button>
              </div>
            </Card>

            <Card className="p-3.5">
              <h2 className="mb-2 font-serif text-[15px] font-semibold text-ink">Log your day</h2>
              <Card kind="soft" className="p-2.5">
                <span className="text-[12px] text-ink-4">What did you get done? Anything to flag?</span>
              </Card>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-paper-2">
                  <ImagePlus className="size-3" strokeWidth={1.5} />
                  Add photos
                </button>
                <button className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-paper-2">
                  <Mic className="size-3" strokeWidth={1.5} />
                  Record voice note
                </button>
                <div className="flex-1" />
                <Chip kind="ai">AI will draft daily log + push to Joe</Chip>
              </div>
            </Card>
          </div>

          {/* right column */}
          <div className="flex flex-col gap-3">
            <Card className="p-3">
              <Eyebrow muted>Money</Eyebrow>
              <div className="mt-2 flex flex-col gap-1.5">
                {data.money.map((m) => (
                  <div key={m.label} className="flex items-center">
                    <span className="flex-1 text-[12px] text-ink-2">{m.label}</span>
                    <span className={`font-mono text-[11px] ${m.good ? "text-money" : "text-ink-3"}`}>
                      {m.value}
                    </span>
                  </div>
                ))}
              </div>
              <button className="mt-3 flex w-full items-center justify-center gap-1 rounded-md bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]">
                <Plus className="size-3" strokeWidth={1.75} />
                Submit final invoice
              </button>
            </Card>

            <Card className="p-3">
              <Eyebrow muted>Paperwork</Eyebrow>
              <div className="mt-2 flex flex-col gap-1.5">
                {data.paperwork.map((p) => (
                  <div key={p} className="flex items-center gap-1.5">
                    <Check className="size-3 flex-none text-money" strokeWidth={2} />
                    <span className="text-[12px] text-ink-2">{p}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-3">
              <Eyebrow muted>Talk to Joe</Eyebrow>
              <Card kind="soft" className="mt-2 p-2.5">
                <span className="text-[12px] text-ink-4">Message Joe about today…</span>
              </Card>
              <div className="mt-2 flex items-center gap-1.5 text-ink-3">
                <Phone className="size-3" strokeWidth={1.5} />
                <span className="font-mono text-[11px]">{data.joePhone}</span>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
