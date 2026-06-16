import { Bell, FileText } from "lucide-react";
import { Avatar, Card, Chip, Eyebrow } from "@/components/ui";
import { getClientPortalData } from "@/lib/client-portal";
import { requireRole } from "@/lib/dal";
import { getProject } from "@/lib/projects";

export default async function ClientPortalPage() {
  const user = await requireRole("owner", "client");
  const data = await getClientPortalData();

  // Scope the portal to the logged-in client's project (owners previewing keep
  // the showcase project). Journal content stays curated for now.
  if (user.role === "client" && user.linkSlug) {
    const project = await getProject(user.linkSlug);
    if (project) {
      data.project = project.name;
      data.clientInitials = user.initials || data.clientInitials;
    }
  }

  return (
    <div className="flex h-screen flex-col bg-paper">
      {/* slim header */}
      <header className="flex h-[50px] flex-none items-center gap-3 border-b border-rule bg-paper-2 px-7">
        <span className="font-serif text-[15px] font-semibold text-accent-2">SJ Carpentry</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          Client portal · {data.project}
        </span>
        <div className="flex-1" />
        <Chip kind="ghost">
          <Bell className="mr-0.5 inline size-2.5" strokeWidth={1.75} />2
        </Chip>
        <Avatar initials={data.clientInitials} size="sm" />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_360px]">
        {/* journal */}
        <main className="overflow-y-auto px-9 py-7">
          <Eyebrow>Project journal · {data.project}</Eyebrow>
          <h1 className="mt-1 font-serif text-[30px] font-medium leading-tight text-accent-2">
            {data.greeting}
          </h1>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {data.statusChips.map((c) => (
              <Chip key={c.label} kind={c.kind} dot={c.dot}>
                {c.label}
              </Chip>
            ))}
          </div>

          <div className="my-5 border-t border-rule" />

          <div className="flex flex-col gap-5">
            {data.entries.map((e, i) => (
              <div key={e.date}>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className={`size-2 rounded-full ${i === 0 ? "bg-accent" : "bg-ink-4"}`} />
                  <span className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
                    {e.date}
                  </span>
                </div>
                <h2 className="mb-1 font-serif text-[15px] font-semibold text-ink">{e.title}</h2>
                <p className="text-[13.5px] leading-relaxed text-ink">{e.body}</p>
                {e.photos > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {Array.from({ length: e.photos }).map((_, k) => (
                      <div
                        key={k}
                        className="aspect-[4/3] w-[100px] rounded border border-rule bg-paper-3"
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </main>

        {/* sidebar */}
        <aside className="overflow-y-auto border-l border-rule bg-paper-2 p-6">
          <Eyebrow muted>What I need from you</Eyebrow>
          <Card kind="accent" className="mt-2 p-2.5">
            <div className="font-serif text-[13px] font-semibold text-ink">{data.decision.title}</div>
            <div className="mt-1 text-[11px] text-ink-2">{data.decision.detail}</div>
            <button className="mt-2 rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]">
              Decide
            </button>
          </Card>

          <div className="my-4 border-t border-rule" />
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

          <div className="my-4 border-t border-rule" />
          <Eyebrow muted>Message Joe</Eyebrow>
          <Card kind="soft" className="mt-2 p-2.5">
            <span className="text-[12px] text-ink-4">Reply about the project…</span>
          </Card>

          <div className="my-4 border-t border-rule" />
          <Eyebrow muted>Files shared with you</Eyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            {data.files.map((f) => (
              <div key={f} className="flex items-center gap-1.5">
                <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                <span className="text-[12px] text-ink-2">{f}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
