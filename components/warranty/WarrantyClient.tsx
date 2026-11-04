"use client";
import { useState, useTransition } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import {
  AiBubble,
  Button,
  PageHeader,
  Segmented,
  Card,
  EmptyState,
} from "@/components/ui";
import type { WarrantyData } from "@/lib/warranty";
import { AddClaimButton } from "./AddClaimButton";
import { summarizeWarrantyClaims } from "@/lib/actions/warranty";
import { runAction } from "@/lib/run-action";
import { WarrantyClaims } from "./WarrantyClaims";
export function WarrantyClient({
  data,
  projects,
}: {
  data: WarrantyData;
  projects: { slug: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState("");
  const [view, setView] = useState(data.claims.some(c => !c.resolved) ? "Active claims" : data.projects.some(p => p.status === "unconfirmed") ? "Needs details" : "Under warranty");
  const active = data.claims.filter((c) => !c.resolved),
    resolved = data.claims.filter((c) => c.resolved);
  const matching = data.projects.filter(
    (p) =>
      p.status ===
      (view === "Expired"
        ? "expired"
        : view === "Needs details"
          ? "unconfirmed"
          : "active"),
  );
  const shown = matching.filter(p => !query.trim() || `${p.project} ${p.client}`.toLowerCase().includes(query.trim().toLowerCase()));
  const counts: Record<string, number> = {
    "Active claims": active.length,
    "Resolved claims": resolved.length,
    "Under warranty": data.underWarrantyTotal,
    Expired: data.projects.filter((p) => p.status === "expired").length,
    "Needs details": data.projects.filter((p) => p.status === "unconfirmed")
      .length,
  };
  return (
    <>
      <PageHeader
        title="Warranty"
        meta={`${data.underWarrantyTotal} under warranty · ${counts["Needs details"]} need coverage details · ${active.length} active claims`}
        actions={
          <>
            <Button
              variant="ghost"
              className="text-ai-2"
              icon={Sparkles}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await runAction(() => summarizeWarrantyClaims());
                  if (r.ok) setSummary(r.summary);
                })
              }
            >
              Summarize
            </Button>
            <AddClaimButton projects={projects} />
          </>
        }
        filters={
          <Segmented
            aria-label="Warranty views"
            value={view}
            onChange={value => { setView(value); setQuery(""); }}
            options={data.filters.map((f) => ({
              value: f,
              label: f,
              count: counts[f],
            }))}
          />
        }
      />
      <p className="mt-4 text-body text-ink-2">Review coverage and claims for completed jobs. Historical jobs without a recorded closeout or written terms stay in Needs details until the records are repaired.</p>
      {view === "Needs details" && <label className="mt-4 block max-w-lg text-label text-ink-2">Search jobs needing details
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Project or client name" className="mt-1 block h-11 w-full rounded-md border border-rule bg-card px-3 text-body" />
      </label>}
      {summary && <AiBubble className="mt-4">{summary}</AiBubble>}
      <div id="claims" className="mt-6 scroll-mt-4">
        {view.includes("claims") ? (
          <WarrantyClaims
            key={view}
            resolved={view === "Resolved claims"}
            claims={view === "Resolved claims" ? resolved : active}
          />
        ) : shown.length ? (
          <ul className="divide-y divide-rule-soft rounded-lg border border-rule bg-card">
            {shown.map(p => {
              const project = projects.find(project => project.name === p.project);
              return <li key={p.project} className="flex flex-wrap items-start gap-3 px-3 py-2">
                <details className="min-w-0 flex-1 basis-48 text-body">
                  <summary className="cursor-pointer rounded-md py-2 focus-visible:outline-2 focus-visible:outline-focus">
                    <span className="font-semibold">{p.project}</span>{" · "}
                    <span className="text-meta text-ink-3">{p.status === "active" ? "Recorded terms" : p.status === "expired" ? "Expired" : "Unconfirmed"}</span>
                    <span className="ml-2 text-meta text-accent-2">Details</span>
                  </summary>
                  <div className="pb-2 text-meta text-ink-2">
                    <p>{p.client}</p>
                    <p className="mt-1 whitespace-pre-line">{p.warranty}</p>
                    <p className="mt-1">{p.coverageNote}</p>
                    <p className="mt-1">Closeout / sign-off: {p.closed}</p>
                  </div>
                </details>
                <Button href={project ? `/projects/${project.slug}?tab=Closeout` : "/projects"} variant="secondary" className="max-sm:h-11">{project ? "Review closeout" : "Find project"}</Button>
              </li>;
            })}
          </ul>
        ) : (
          <Card>
            <EmptyState
              icon={ShieldCheck}
              title={query ? "No matching jobs" : `No projects ${view === "Expired" ? "with expired coverage" : view === "Needs details" ? "needing coverage details" : "with confirmed coverage"}`}
              description={query ? "Try another project or client name, or clear the search." : "Coverage appears from recorded closeout or written sign-off and configured warranty terms. Record details on the project to confirm coverage."}
            />
          </Card>
        )}
      </div>
    </>
  );
}
