"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import {
  AiBubble,
  Button,
  PageHeader,
  Segmented,
  Card,
  EmptyState,
  TableWrapper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TablePrimaryCell,
  TableCell,
  Chip,
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
  const [summary, setSummary] = useState("");
  const [view, setView] = useState(data.claims.some(c => !c.resolved) ? "Active claims" : data.projects.some(p => p.status === "unconfirmed") ? "Needs details" : "Under warranty");
  const active = data.claims.filter((c) => !c.resolved),
    resolved = data.claims.filter((c) => c.resolved);
  const shown = data.projects.filter(
    (p) =>
      p.status ===
      (view === "Expired"
        ? "expired"
        : view === "Needs details"
          ? "unconfirmed"
          : "active"),
  );
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
            onChange={setView}
            options={data.filters.map((f) => ({
              value: f,
              label: f,
              count: counts[f],
            }))}
          />
        }
      />
      <p className="mt-4 text-body text-ink-2">Review coverage and claims for completed jobs. Historical jobs without a recorded closeout or written terms stay in Needs details until the records are repaired.</p>
      {summary && <AiBubble className="mt-4">{summary}</AiBubble>}
      <div id="claims" className="mt-6 scroll-mt-4">
        {view.includes("claims") ? (
          <WarrantyClaims
            key={view}
            resolved={view === "Resolved claims"}
            claims={view === "Resolved claims" ? resolved : active}
          />
        ) : shown.length ? (
          <TableWrapper>
            <Table>
              <TableHead>
                <tr>
                  <TableHeader>Project & coverage</TableHeader>
                  <TableHeader className="@max-3xl/page:hidden">
                    Closeout / sign-off
                  </TableHeader>
                </tr>
              </TableHead>
              <TableBody>
                {shown.map((p) => (
                  <TableRow key={p.project}>
                    <TablePrimaryCell meta={p.client}>
                      <div className="flex flex-wrap items-center gap-2">
                        {p.project}
                        <Chip
                          kind={
                            p.status === "expired"
                              ? "neutral"
                              : p.status === "active"
                                ? "ok"
                                : "warn"
                          }
                        >
                          {p.status === "active"
                            ? "Recorded terms"
                            : p.status === "expired"
                              ? "Expired"
                              : "Unconfirmed"}
                        </Chip>
                      </div>
                      {projects.find(project => project.name === p.project) && <Link href={`/projects/${projects.find(project => project.name === p.project)!.slug}?tab=Closeout`} className="mt-2 block text-label font-normal text-accent-2 hover:underline">{p.status === "unconfirmed" ? "Record closeout & coverage" : "Review project closeout"} →</Link>}
                      <p className="mt-2 whitespace-pre-line text-body font-normal text-ink-2">
                        {p.warranty}
                      </p>
                      <p className="mt-1 text-meta font-normal text-ink-3">
                        {p.coverageNote}
                      </p>
                      <p className="mt-1 text-meta font-normal text-ink-3 @3xl/page:hidden">
                        Closeout / sign-off: {p.closed}
                      </p>
                    </TablePrimaryCell>
                    <TableCell className="@max-3xl/page:hidden">
                      {p.closed}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        ) : (
          <Card>
            <EmptyState
              icon={ShieldCheck}
              title={`No projects ${view === "Expired" ? "with expired coverage" : view === "Needs details" ? "needing coverage details" : "with confirmed coverage"}`}
              description="Coverage appears from recorded closeout or written sign-off and configured warranty terms. Record details on the project to confirm coverage."
            />
          </Card>
        )}
      </div>
    </>
  );
}
