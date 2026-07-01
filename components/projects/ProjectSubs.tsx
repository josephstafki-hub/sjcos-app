"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Mail, X, UserPlus, CalendarDays, Pencil } from "lucide-react";
import { Avatar, Card, Chip } from "@/components/ui";
import { assignSubToProject, removeSubFromProject, updateSubAssignment } from "@/lib/actions/projects";

interface AssignedSub {
  slug: string;
  name: string;
  trade: string;
  role: string;
  coiStatus: "current" | "expiring" | "expired" | "missing";
  coiLabel: string;
  email: string | null;
  phone: string | null;
  scope: string;
  startDate: string;
  endDate: string;
}

/** "May 6 – May 20" style label from two YYYY-MM-DD strings (either may be ""). */
function dateRange(start: string, end: string): string {
  const fmt = (s: string) =>
    s
      ? new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "";
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a} – ${b}`;
  return a || b || "";
}
interface RosterSub {
  slug: string;
  name: string;
  trade: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const COI_CHIP: Record<string, "money" | "ai" | "flag"> = {
  current: "money",
  expiring: "ai",
  expired: "flag",
  missing: "flag",
};

/** Project Subs tab — real assignments. Owner assigns subs from the roster and
 *  removes them; each row shows trade, COI status, and contact. */
export function ProjectSubs({
  slug,
  assigned,
  roster,
}: {
  slug: string;
  assigned: AssignedSub[];
  roster: RosterSub[];
}) {
  const [rows, setRows] = useState(assigned);
  const [pool, setPool] = useState(roster);
  const [pick, setPick] = useState("");
  const [role, setRole] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function saveScope(subSlug: string, scope: string, start: string, end: string) {
    setRows((r) => r.map((x) => (x.slug === subSlug ? { ...x, scope, startDate: start, endDate: end } : x)));
    setEditing(null);
    startTransition(async () => {
      await updateSubAssignment(slug, subSlug, { scope, start, end });
      router.refresh();
    });
  }

  function remove(subSlug: string) {
    const prevRows = rows;
    const removed = rows.find((r) => r.slug === subSlug);
    setRows((r) => r.filter((x) => x.slug !== subSlug));
    if (removed) setPool((p) => [...p, { slug: removed.slug, name: removed.name, trade: removed.trade }]);
    startTransition(async () => {
      try {
        await removeSubFromProject(slug, subSlug);
      } catch {
        setRows(prevRows);
      }
    });
  }

  function assign() {
    if (!pick) return;
    const sub = pool.find((s) => s.slug === pick);
    if (!sub) return;
    const roleLabel = role.trim() || sub.trade;
    startTransition(async () => {
      await assignSubToProject(slug, pick, roleLabel);
      router.refresh();
    });
    // Optimistic.
    setRows((r) => [
      ...r,
      {
        slug: sub.slug,
        name: sub.name,
        trade: sub.trade,
        role: roleLabel,
        coiStatus: "missing",
        coiLabel: "COI —",
        email: null,
        phone: null,
        scope: "",
        startDate: "",
        endDate: "",
      },
    ]);
    setPool((p) => p.filter((s) => s.slug !== pick));
    setPick("");
    setRole("");
  }

  return (
    <Card className="max-w-[680px] overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        {rows.length} sub{rows.length === 1 ? "" : "s"} on this job
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-ink-3">
          No subs assigned to this project yet.
        </div>
      ) : (
        rows.map((s, i) => (
          <div key={s.slug} className={`group px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}>
            <div className="flex items-center gap-2.5">
              <Avatar initials={initials(s.name)} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-serif text-[13.5px] font-semibold text-ink">{s.name}</div>
                <div className="text-[11px] text-ink-3">{s.role || s.trade}</div>
              </div>
              {s.phone && (
                <a href={`tel:${s.phone}`} className="flex-none rounded p-0.5 text-ink-3 hover:text-ink" aria-label={`Call ${s.name}`}>
                  <Phone className="size-3.5" strokeWidth={1.5} />
                </a>
              )}
              {s.email && (
                <a href={`mailto:${s.email}`} className="flex-none rounded p-0.5 text-ink-3 hover:text-ink" aria-label={`Email ${s.name}`}>
                  <Mail className="size-3.5" strokeWidth={1.5} />
                </a>
              )}
              <Chip kind={COI_CHIP[s.coiStatus] ?? "ghost"} dot>
                {s.coiLabel}
              </Chip>
              <button
                type="button"
                onClick={() => setEditing((e) => (e === s.slug ? null : s.slug))}
                aria-label="Edit scope & dates"
                className="flex-none rounded p-0.5 text-ink-4 hover:text-ink"
              >
                <Pencil className="size-3.5" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => remove(s.slug)}
                aria-label="Remove sub"
                className="flex-none rounded p-0.5 text-ink-4 opacity-0 transition-opacity hover:text-flag group-hover:opacity-100"
              >
                <X className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>

            {/* Scope + dates summary (read state) */}
            {editing !== s.slug && (s.scope || s.startDate || s.endDate) && (
              <div className="mt-1.5 pl-[34px]">
                {dateRange(s.startDate, s.endDate) && (
                  <div className="flex items-center gap-1 text-[11px] text-ink-3">
                    <CalendarDays className="size-3" strokeWidth={1.5} />
                    {dateRange(s.startDate, s.endDate)}
                  </div>
                )}
                {s.scope && <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{s.scope}</p>}
              </div>
            )}

            {/* Inline edit form */}
            {editing === s.slug && (
              <ScopeEditor
                initial={{ scope: s.scope, start: s.startDate, end: s.endDate }}
                onCancel={() => setEditing(null)}
                onSave={(v) => saveScope(s.slug, v.scope, v.start, v.end)}
              />
            )}
          </div>
        ))
      )}

      {/* Assign picker */}
      {pool.length > 0 && (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            assign();
          }}
          className="flex flex-wrap items-center gap-2 border-t border-rule bg-paper-2 px-4 py-2.5"
        >
          <UserPlus className="size-3.5 flex-none text-ink-3" strokeWidth={1.75} />
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="rounded border border-rule bg-card px-1.5 py-1 text-[12px] text-ink-2 outline-none"
          >
            <option value="">Assign a sub…</option>
            {pool.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} · {s.trade}
              </option>
            ))}
          </select>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role (optional)"
            className="min-w-[120px] flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
          />
          <button
            type="submit"
            disabled={!pick}
            className="flex-none rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
          >
            Assign
          </button>
        </form>
      )}
    </Card>
  );
}

/** Inline editor for a sub assignment's scope of work + scheduled dates. */
function ScopeEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: { scope: string; start: string; end: string };
  onCancel: () => void;
  onSave: (v: { scope: string; start: string; end: string }) => void;
}) {
  const [scope, setScope] = useState(initial.scope);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const dateCls = "rounded border border-rule bg-card px-1.5 py-1 text-[12px] text-ink-2 outline-none focus:border-accent";

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-rule bg-paper-2 p-2.5">
      <textarea
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        rows={2}
        placeholder="Scope of work for this sub…"
        className="resize-y rounded border border-rule bg-card px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-ink-3">
          Start
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={dateCls} />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-ink-3">
          End
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={dateCls} />
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-rule px-2.5 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-3"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave({ scope, start, end })}
          className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          Save
        </button>
      </div>
    </div>
  );
}
