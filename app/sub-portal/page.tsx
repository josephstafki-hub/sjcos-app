import Link from "next/link";
import { Flag, Image as ImageIcon, Phone, ArrowLeft } from "lucide-react";
import { AckButton, Avatar, Card, Chip, Eyebrow } from "@/components/ui";
import { getSubPortalData, getSubLogs, getSubInvoices, getSubAssignment, getSubDocuments } from "@/lib/sub-portal";
import { SubDocs } from "@/components/sub-portal/SubDocs";
import { whisperAvailable } from "@/lib/transcribe";
import { requireRole } from "@/lib/dal";
import { getSub } from "@/lib/subs";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { PortalMessenger } from "@/components/portal/PortalMessenger";
import { SubLogComposer } from "@/components/sub-portal/SubLogComposer";
import { SubInvoiceSubmit } from "@/components/sub-portal/SubInvoiceSubmit";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const SUB_INVOICE_CHIP = { submitted: "info", approved: "accent", paid: "money" } as const;

export default async function SubPortalPage() {
  const user = await requireRole("owner", "sub");
  const data = await getSubPortalData();

  // Scope the portal identity to the logged-in subcontractor (owners previewing
  // keep the showcase identity). Job content stays curated for now.
  const slug = user.role === "sub" ? user.linkSlug : "marco";
  if (user.role === "sub" && user.linkSlug) {
    const sub = await getSub(user.linkSlug);
    if (sub) {
      data.subName = sub.name;
      data.subInitials = sub.initials;
      data.trade = sub.tradeLine;
    }
  }

  // Real "Talk to Joe" thread — persists to the sub's DM channel (Joe reads/
  // replies in /chat).
  const thread = slug ? await getPortalThread(portalChannel("sub", slug)) : [];

  // Real, DB-backed sub records: their daily logs + submitted invoices + the
  // owner-set scope & scheduled dates for their current assignment (6-scope).
  const [logs, subInvoices, assignment, subDocs] = slug
    ? await Promise.all([getSubLogs(slug), getSubInvoices(slug), getSubAssignment(slug), getSubDocuments(slug)])
    : [[], [], null, []];

  return (
    <div className="flex h-screen flex-col bg-paper">
      {/* slim header */}
      <header className="flex h-[50px] flex-none items-center gap-3 border-b border-rule bg-paper-2 px-7">
        <span className="font-serif text-[15px] font-semibold text-accent-2">SJ Carpentry</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          Sub portal · {data.subName} · {data.trade}
        </span>
        <div className="flex-1" />
        {user.role === "owner" && (
          <Link
            href="/today"
            className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-paper-3"
          >
            <ArrowLeft className="size-3" strokeWidth={1.75} />
            Return to SJC OS
          </Link>
        )}
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
            {assignment && (assignment.scope || assignment.dateLabel) && (
              <Card className="border-accent/40 p-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-[15px] font-semibold text-ink">
                    Your scope · {assignment.projectName}
                  </h2>
                  {assignment.dateLabel && (
                    <Chip kind="accent" dot>
                      {assignment.dateLabel}
                    </Chip>
                  )}
                </div>
                {assignment.role && (
                  <div className="mt-0.5 text-[11px] text-ink-3">{assignment.role}</div>
                )}
                {assignment.scope && (
                  <p className="mt-2 whitespace-pre-line text-[13px] leading-snug text-ink">
                    {assignment.scope}
                  </p>
                )}
              </Card>
            )}

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
                <AckButton variant="outline" label="Photo from Joe" ackLabel="Requested" />
              </div>
            </Card>

            <Card className="p-3.5">
              <h2 className="mb-2 font-serif text-[15px] font-semibold text-ink">Log your day</h2>
              <SubLogComposer slug={slug ?? ""} voiceEnabled={whisperAvailable()} />

              {logs.length > 0 && (
                <div className="mt-3 border-t border-rule pt-2.5">
                  <Eyebrow muted>Recent logs</Eyebrow>
                  <div className="mt-2 flex flex-col gap-2">
                    {logs.map((l) => (
                      <div key={l.id} className="border-l-2 border-rule pl-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                            {l.when}
                          </span>
                          {l.hasPhoto && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-ink-3">
                              <ImageIcon className="size-2.5" strokeWidth={1.75} />
                              photo
                            </span>
                          )}
                        </div>
                        {l.body && <p className="mt-0.5 text-[12.5px] leading-snug text-ink">{l.body}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
              {subInvoices.length > 0 && (
                <div className="mt-3 border-t border-rule pt-2.5">
                  <Eyebrow muted>Your invoices</Eyebrow>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {subInvoices.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-2">
                        <span className="font-mono text-[12px] text-ink-2">{usd(inv.amount)}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">
                          {inv.note || inv.projectName || "Final invoice"}
                        </span>
                        <Chip kind={SUB_INVOICE_CHIP[inv.status]} dot>
                          {inv.status}
                        </Chip>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <SubInvoiceSubmit slug={slug ?? ""} />
            </Card>

            <Card className="p-3">
              <SubDocs slug={slug ?? ""} docs={subDocs} />
            </Card>

            <Card className="p-3">
              <Eyebrow muted>Talk to Joe</Eyebrow>
              <PortalMessenger
                surface="sub"
                thread={thread}
                placeholder="Message Joe about today…"
              />
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
