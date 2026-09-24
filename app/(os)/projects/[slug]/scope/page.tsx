import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { can, requireAccess } from "@/lib/dal";
import { runDirect } from "@/lib/commands/db";
import { getScopeRegister } from "@/lib/estimating/scope";
import { getDesignDecisions } from "@/lib/estimating/design";
import { projectWorkflowView } from "@/lib/workflow/engine";

export const dynamic = "force-dynamic";

/** Scope register (WORKFLOW W02–W04, A15): work packages with who does what,
 *  supply/install split, exclusions, quantities and unverified assumptions;
 *  the site-visit plan; source-linked findings; design path per scope. The
 *  agent maintains it (allocate_scope / record_site_findings / set_design_path);
 *  Joe's dedicated prices show only to viewers with the estimates area. */
export default async function ScopeRegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const viewer = await requireAccess("projects");
  const { slug } = await params;
  const [project] = await runDirect<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE slug = $1`, [slug]);
  if (!project) notFound();
  const showPrices = can(viewer, "estimates");
  const [reg, design, workflow] = await Promise.all([getScopeRegister(runDirect, project.id), getDesignDecisions(runDirect, project.id), projectWorkflowView(runDirect, project.id).catch(() => null)]);
  const live = reg.items.filter((i) => i.status !== "superseded");
  const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  const designFor = (key: string) => design.find((d) => d.scope_key === key);
  return (
    <Shell breadcrumb={`PROJECTS › ${project.name.toUpperCase()} › SCOPE`}>
      <div className="mx-auto max-w-[1120px] px-7 pb-16 pt-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <Eyebrow>
              {reg.register ? `register rev ${reg.register.revision} · ${reg.register.status}` : "no scope register yet"} · {live.length} work packages · {reg.findings.length} site findings
              {workflow ? ` · stage ${workflow.stage}` : ""}
            </Eyebrow>
            <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">Scope register</h1>
            <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-ink-3">
              Prepared from the lead facts when the pre-con agreement was signed and kept current from Joe&apos;s allocations and site
              findings. Work Joe retains leaves the sub solicitation; its materials still get sourced. Unverified items are
              assumptions until a site finding or a quote answers them.
            </p>
          </div>
          <Link href={`/projects/${slug}`} className="text-[12px] text-ink-3 underline-offset-2 hover:underline">← project</Link>
        </div>

        {!reg.register && (
          <Card kind="soft" className="px-4 py-3 text-[13px] text-ink-3">
            The register is created automatically when a signed pre-construction agreement is recorded (W02). Nothing to review yet.
          </Card>
        )}

        {reg.register && (
          <section className="mb-8">
            <Eyebrow>Work packages</Eyebrow>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="py-2 pr-3">Room · key</th><th className="py-2 pr-3">Package</th><th className="py-2 pr-3">Trade</th><th className="py-2 pr-3">Install</th><th className="py-2 pr-3">Supply</th><th className="py-2 pr-3">Quantities</th><th className="py-2 pr-3">Design path</th>{showPrices && <th className="py-2 pr-3">Joe&apos;s price</th>}<th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {live.map((i) => {
                    const d = designFor(i.key);
                    const qty = i.quantities ?? [];
                    const unverifiedAssumptions = (i.assumptions ?? []).filter((a) => a.unverified).map((a) => a.text);
                    const assumptions = (i.assumptions ?? []).filter((a) => !a.unverified).map((a) => a.text);
                    return (
                      <tr key={i.id} className="border-b border-rule/60 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-ink-3">{i.room || "—"}<div className="font-mono text-[11px]">{i.key}</div></td>
                        <td className="py-2 pr-3">
                          <div className="font-medium text-ink">{i.title}</div>
                          {i.exclusions?.length ? <div className="text-[11px] text-ink-3">excl: {i.exclusions.join("; ")}</div> : null}
                          {assumptions.length ? <div className="text-[11px] text-ink-3">assumes: {assumptions.join("; ")}</div> : null}
                          {unverifiedAssumptions.length ? <div className="text-[11px] text-flag">unverified: {unverifiedAssumptions.join("; ")}</div> : null}
                          {i.unverified && !unverifiedAssumptions.length ? <div className="text-[11px] text-flag">unverified until the site visit</div> : null}
                        </td>
                        <td className="py-2 pr-3">{i.trade}</td>
                        <td className="py-2 pr-3"><Chip kind={i.install_by === "joe" ? "money" : "ghost"}>{i.install_by}</Chip></td>
                        <td className="py-2 pr-3"><Chip kind="ghost">{i.supply_by}</Chip>{i.supplier_categories?.length ? <div className="text-[11px] text-ink-3">{i.supplier_categories.join(", ")}</div> : null}</td>
                        <td className="py-2 pr-3 text-[12px]">{qty.length ? qty.map((q, n) => <div key={n}>{q.label}: {q.qty ?? "?"} {q.unit ?? ""}{q.basis === "site_measurement" || q.basis === "plan" ? "" : ` (${q.basis})`}</div>) : <span className="text-ink-3">—</span>}</td>
                        <td className="py-2 pr-3 text-[12px]">{d ? `${d.direction_sufficiency} → ${d.path}${d.status ? ` (${d.status})` : ""}` : <span className="text-ink-3">—</span>}</td>
                        {showPrices && <td className="py-2 pr-3 whitespace-nowrap">{money(i.dedicated_price_cents)}{i.price_basis ? <div className="text-[11px] text-ink-3">{i.price_basis}</div> : i.dedicated_price_cents != null ? <div className="text-[11px] text-flag">basis unknown</div> : null}</td>}
                        <td className="py-2 pr-3"><Chip kind="ghost">{i.status}</Chip></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[12px] text-ink-3">
              Still to solicit — labor: {reg.solicitation.labor.length ? reg.solicitation.labor.join(", ") : "none"} · materials: {reg.solicitation.materials.length ? reg.solicitation.materials.map((m) => `${m.key} (${m.categories.join("/")})`).join(", ") : "none"}
            </div>
          </section>
        )}

        {reg.plan && (
          <section className="mb-8">
            <Eyebrow>Site-visit plan · rev {reg.plan.revision} · {reg.plan.status}</Eyebrow>
            <ul className="mt-2 grid gap-1 text-[13px] md:grid-cols-2">
              {reg.plan.items.map((it) => (
                <li key={it.id} className="rounded-md border border-rule px-3 py-2">
                  <span className="mr-2 font-mono text-[11px] text-ink-3">{it.kind}</span>
                  {it.prompt} <Chip kind="ghost">{it.status}</Chip>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <Eyebrow>Site findings ({reg.findings.length})</Eyebrow>
          {reg.findings.length === 0 ? (
            <Card kind="soft" className="mt-2 px-4 py-3 text-[13px] text-ink-3">No findings recorded. Upload site notes or photos and the agent extracts source-linked facts here.</Card>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3"><th className="py-2 pr-3">Scope</th><th className="py-2 pr-3">Kind</th><th className="py-2 pr-3">Statement</th><th className="py-2 pr-3">Measure</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Status</th></tr>
                </thead>
                <tbody>
                  {reg.findings.map((f) => (
                    <tr key={String(f.id)} className="border-b border-rule/60 align-top">
                      <td className="py-2 pr-3 font-mono text-[11px]">{String(f.scope_key ?? "—")}</td>
                      <td className="py-2 pr-3">{String(f.kind)}</td>
                      <td className="py-2 pr-3">{String(f.statement)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{f.measurement != null ? `${String(f.measurement)} ${String(f.unit ?? "")}` : "—"}</td>
                      <td className="py-2 pr-3 text-[12px] text-ink-3">{String(f.source_note ?? "")}{f.media_ref ? ` · ${String(f.media_ref)}` : ""}</td>
                      <td className="py-2 pr-3"><Chip kind="ghost">{String(f.status)}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
