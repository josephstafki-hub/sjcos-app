"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Archive, ArrowUpRight, Check, Clock, FileText, MoreHorizontal, Plus, Sparkles } from "lucide-react";
import {
  AiBubble, Avatar, Button, Card, CardBody, CardHeader, Chip, EmptyState, Eyebrow,
  Field, KpiTile, PageHeader, Segmented, SubmitButton, Tabs, Table, TableActions,
  TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TablePrimaryCell,
  TableRow, TableWrapper,
  type ButtonSize, type ButtonVariant, type CardKind, type ChipKind,
} from "@/components/ui";

const BUTTONS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "ai"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];
const BADGES: [ChipKind, string][] = [
  ["default", "Draft"], ["neutral", "Intake"], ["ok", "On track"], ["money", "Paid"],
  ["warn", "Waiting on client"], ["flag", "Overdue"], ["info", "Scheduled"],
  ["ai", "AI draft"], ["accent", "In progress"], ["ghost", "Archived"], ["solid", "Selected"],
];
const CARDS: CardKind[] = ["default", "soft", "filled", "tan", "ai", "accent", "flag", "money", "ink", "dashed"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mt-10"><h2 className="mb-3 font-serif text-heading font-semibold text-ink">{title}</h2>{children}</section>;
}

export function UiGallery() {
  const [filter, setFilter] = useState("open");
  const [tab, setTab] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-12 pt-6 @2xl/page:px-5 @5xl/page:px-8">
      <PageHeader eyebrow="Design system" title="UI foundation" badge={<Chip kind="neutral">Internal</Chip>}
        meta="Tokens, primitives and copyable recipes. All examples use local sample content."
        actions={<><Button href="/engine" variant="secondary">Engine</Button><Button href="#buttons" icon={ArrowUpRight}>Explore primitives</Button></>} />

      <Section title="Tokens and type">
        <div className="flex flex-wrap gap-2">
          {[
            ["Paper", "bg-paper"], ["Card", "bg-card"], ["Selected", "bg-selected"], ["Neutral", "bg-neutral-soft"],
            ["On track", "bg-ok-soft"], ["Attention", "bg-warn-soft"], ["Overdue", "bg-flag-soft"], ["Info", "bg-info-soft"], ["AI", "bg-ai-soft"],
          ].map(([label, color]) => <div key={label} className={`rounded-md border border-rule-soft px-3 py-2 text-label text-ink-2 ${color}`}>{label}</div>)}
        </div>
        <div className="mt-3 grid gap-3 @3xl/page:grid-cols-2">
          <Card className="space-y-2 p-4">
            <div className="font-serif text-display font-medium">Display · 30 / 36</div>
            <div className="font-serif text-title font-medium">Title · 24 / 30</div>
            <div className="font-serif text-kpi font-medium tabular-nums">$26,000 · KPI</div>
            <div className="font-serif text-heading font-semibold">Heading · 17 / 24</div>
          </Card>
          <Card className="space-y-2 p-4">
            <div className="text-subheading font-semibold">Subheading · 14 / 20</div>
            <div className="text-body">Body · 13 / 20</div>
            <div className="text-label font-semibold">Label · 12 / 16</div>
            <div className="text-meta text-ink-3">Meta · 12 / 16</div>
            <Eyebrow>Micro · 10.5 / 14</Eyebrow>
            <Eyebrow muted>Muted section label</Eyebrow>
          </Card>
        </div>
      </Section>

      <section id="buttons" className="mt-10 scroll-mt-6">
        <h2 className="mb-3 font-serif text-heading font-semibold">Buttons</h2>
        <div className="space-y-3">
          {SIZES.map((size) => <div key={size} className="flex flex-wrap items-center gap-2">
            <span className="w-8 text-meta text-ink-3">{size}</span>
            {BUTTONS.map((variant) => <Button key={variant} variant={variant} size={size} icon={variant === "ai" ? Sparkles : Plus}>{variant === "ai" ? "AI" : variant.charAt(0).toUpperCase() + variant.slice(1)}</Button>)}
            <Button size={size} icon={MoreHorizontal} iconOnly aria-label={`${size} more actions`} title="More actions" />
          </div>)}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled>Disabled</Button><Button href="/engine" variant="secondary" icon={ArrowUpRight}>Link button</Button>
            <Button href="/engine" disabled variant="secondary">Disabled link</Button>
            <form action={async () => { await new Promise((resolve) => setTimeout(resolve, 900)); setSubmitted(true); }}>
              <SubmitButton variant="secondary" pendingLabel="Saving example…" icon={Check}>Submit example</SubmitButton>
            </form>
            {submitted && <span role="status" className="text-meta text-ink-3">Example saved locally.</span>}
          </div>
        </div>
      </section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">{BADGES.map(([kind, label]) => <Chip key={kind} kind={kind}>{label}</Chip>)}</div>
        <div className="mt-3 flex flex-wrap gap-2">{BADGES.map(([kind, label]) => <Chip key={kind} kind={kind} dot>{label}</Chip>)}<Chip mono>INV-0007</Chip></div>
      </Section>

      <Section title="Filters and tabs">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented aria-label="Project status" value={filter} onChange={setFilter} options={[
            { value: "open", label: "All open", count: 13 }, { value: "site", label: "On site", count: 8 },
            { value: "precon", label: "Pre-con", count: 5 }, { value: "closed", label: "Closeout", count: 0, disabled: true },
          ]} />
          <Button variant="secondary" size="sm">Stage ▾</Button>
          <input aria-label="Search examples" placeholder="Search…" className="h-9 min-w-0 rounded-md border border-rule bg-card px-3 text-body placeholder:text-ink-4 hover:border-ink-4 focus:outline-2 focus:outline-offset-1 focus:outline-focus max-sm:h-11" />
        </div>
        <div className="mt-3"><Segmented aria-label="Engine navigation example" value="ui" options={[{ value: "engine", label: "Engine", href: "/engine" }, { value: "ui", label: "UI foundation", href: "/engine/ui" }]} /></div>
        <Tabs className="mt-3" tabs={["Overview", "Activity", "Documents", "Schedule", "Money", "Selections"]} active={tab} onSelect={setTab} counts={[undefined, 4, 3]} />
        <div role="tabpanel" className="py-3 text-body text-ink-2">{["Overview", "Activity", "Documents", "Schedule", "Money", "Selections"][tab]} example content</div>
        <Tabs tabs={["Engine", "UI foundation"]} routes={["/engine", "/engine/ui"]} active={1} aria-label="Linked tabs" />
      </Section>

      <Section title="Record header">
        <Card className="p-4">
          <PageHeader variant="record" title="Sample kitchen remodel" badge={<Chip kind="warn">Waiting on client</Chip>}
            meta={<span>Client · PM Joe · <a href="#forms" className="text-accent underline">View properties</a></span>}
            actions={<><Button variant="secondary" size="sm">Log update</Button><Button size="sm">Send invoice</Button><Button iconOnly icon={MoreHorizontal} size="sm" aria-label="Record actions" title="Record actions" /></>}
            tabs={<Tabs tabs={["Overview", "Money", "Documents"]} active={0} />} />
        </Card>
      </Section>

      <Section title="KPI tiles">
        <div className="grid grid-cols-2 gap-3 @3xl/page:grid-cols-4">
          <KpiTile label="Contracted" value="$28,897" meta="Current job total" hint="Formal estimate plus approved changes." />
          <KpiTile label="Collected" value="$17,949" meta="62% paid" tone="ok" />
          <KpiTile label="Due soon" value="$4,000" meta="Due in 3 days" tone="warn" />
          <KpiTile label="Overdue" value="$1,200" meta="1 unpaid invoice" tone="flag" />
        </div>
        <div className="mt-3 max-w-[360px]"><KpiTile label="Paid (legacy money alias)" value="$17,949" tone="money" /></div>
      </Section>

      <Section title="Tables">
        <ExampleTable />
        <p className="mb-3 mt-3 text-meta text-ink-3">Compact density · hover or focus a row to reveal actions</p>
        <ExampleTable compact />
        <p className="mb-3 mt-3 text-meta text-ink-3">Bare table on paper</p>
        <TableWrapper bare><Table><TableBody><TableRow><TablePrimaryCell meta="Secondary line">Sample project</TablePrimaryCell><TableCell numeric>$28,897</TableCell></TableRow></TableBody></Table></TableWrapper>
      </Section>

      <Section title="List rows">
        <div className="divide-y divide-rule-soft">
          {["Confirm countertop selection", "Review invoice draft"].map((title) => <div key={title} className="group flex items-start gap-3 rounded-md px-3 py-2.5 hover:bg-hover">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
            <div className="min-w-0 flex-1"><div className="truncate text-subheading font-semibold">{title}</div><div className="truncate text-meta text-ink-3">Sample kitchen · due today · from Joe</div></div>
            <TableActions><Button iconOnly icon={Check} size="sm" aria-label={`Complete ${title}`} title="Mark done" /><Button iconOnly icon={Clock} size="sm" aria-label={`Snooze ${title}`} title="Snooze" /></TableActions>
          </div>)}
        </div>
      </Section>

      <Section title="Cards">
        <Card><CardHeader title="Card header" action={<Button variant="ghost" size="sm" href="/engine">View ›</Button>} /><CardBody><p className="text-body text-ink-2">Default surface, soft border and hairline shadow.</p></CardBody></Card>
        <div className="mt-3 grid grid-cols-2 gap-3 @3xl/page:grid-cols-3">
          {CARDS.map((kind) => <Card key={kind} kind={kind} className="p-4"><div className="text-subheading font-semibold">{kind.charAt(0).toUpperCase() + kind.slice(1)}</div><p className={`mt-1 text-meta ${kind === "ink" ? "text-paper" : "text-ink-2"}`}>{kind === "flag" ? "Blocking alerts only" : kind === "default" || kind === "soft" ? "Routine surface" : "Legacy kind preserved"}</p></Card>)}
        </div>
      </Section>

      <Section title="AI surface">
        <AiBubble actions={<Button variant="ai" size="sm" icon={Sparkles}>Open agenda</Button>}>A sample draft summary. AI content keeps the restrained teal treatment.</AiBubble>
      </Section>

      <section id="forms" className="mt-10 scroll-mt-6">
        <h2 className="mb-3 font-serif text-heading font-semibold">Fields and forms</h2>
        <Card className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-4"><Field label="Client" value="Sample client" /><Field label="Missing value" /></div>
          <div><label htmlFor="sample-title" className="mb-1.5 block text-label font-semibold text-ink-2">Project name</label>
            <input id="sample-title" defaultValue="Sample kitchen remodel" className="h-9 w-full rounded-md border border-rule bg-card px-3 text-body placeholder:text-ink-4 hover:border-ink-4 focus:outline-2 focus:outline-offset-1 focus:outline-focus max-sm:h-11" aria-describedby="sample-help" />
            <p id="sample-help" className="mt-1.5 text-meta text-ink-3">Use the name the client recognizes.</p></div>
          <div><label htmlFor="sample-note" className="mb-1.5 block text-label font-semibold text-ink-2">Note</label>
            <textarea id="sample-note" rows={3} aria-invalid="true" aria-describedby="sample-error" className="w-full rounded-md border border-rule bg-card px-3 py-2 text-body hover:border-ink-4 focus:outline-2 focus:outline-offset-1 focus:outline-focus" />
            <p id="sample-error" className="mt-1.5 text-meta text-flag">Example error: add a note before saving.</p></div>
        </Card>
      </section>

      <Section title="Empty states">
        <EmptyState icon={Archive} title="No archived projects" description="Completed projects appear here when you archive them." />
        <Card><EmptyState compact icon={FileText} title="No invoices yet" description="Invoices show up here once a milestone is billed." action={{ children: "View projects", href: "/projects" }} /></Card>
      </Section>

      <Section title="Elevation and avatars">
        <div className="flex flex-wrap gap-3">
          <Card className="p-4">Card shadow</Card>
          <div className="rounded-lg border border-rule-soft bg-card p-4 shadow-pop">Popover shadow</div>
          <div className="rounded-xl border border-rule-soft bg-card p-4 shadow-modal">Modal shadow</div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {(["default", "accent", "ai", "gray"] as const).map((kind) => <div key={kind} className="flex items-center gap-2">
            {(["sm", "md", "lg"] as const).map((size) => <Avatar key={size} initials={kind === "ai" ? "AI" : "JS"} kind={kind} size={size} />)}
          </div>)}
        </div>
      </Section>
    </div>
  );
}

function ExampleTable({ compact = false }: { compact?: boolean }) {
  return <TableWrapper><Table density={compact ? "compact" : "comfortable"}>
    <caption className="sr-only">Sample project payments, {compact ? "compact" : "comfortable"} density</caption>
    <TableHead><tr><TableHeader>Project</TableHeader><TableHeader className="@max-4xl/page:hidden">Next step</TableHeader><TableHeader>Status</TableHeader><TableHeader numeric>Paid / Total</TableHeader><TableHeader><span className="sr-only">Actions</span></TableHeader></tr></TableHead>
    <TableBody>
      <TableGroupRow colSpan={5} count={2}>Construction · on site</TableGroupRow>
      {[false, true].map((selected, index) => <TableRow key={index} selected={selected}>
        <TablePrimaryCell meta={index ? "208 Oak Avenue" : "124 Sample Street"}><Link href="/projects" className="rounded hover:text-accent focus-visible:outline-2 focus-visible:outline-focus">{index ? "Sample addition" : "Sample kitchen"}</Link></TablePrimaryCell>
        <TableCell className="max-w-[240px] @max-4xl/page:hidden"><div className="truncate text-ink-2">Confirm the cabinet delivery date</div></TableCell>
        <TableCell><Chip kind={index ? "warn" : "ok"}>{index ? "Waiting" : "On track"}</Chip></TableCell>
        <TableCell numeric>$17,949 / $28,897</TableCell>
        <TableCell><TableActions><Button size="sm" iconOnly icon={ArrowUpRight} href="/projects" aria-label={`Open sample project ${index + 1}`} title="Open project" /></TableActions></TableCell>
      </TableRow>)}
    </TableBody>
  </Table></TableWrapper>;
}
