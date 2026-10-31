"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import {
  Button,
  Chip,
  Segmented,
  EmptyState,
  TableWrapper,
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TablePrimaryCell,
  TableCell,
} from "@/components/ui";
import { unitLabel, fmtUsd } from "@/lib/cost-book-units";
import type { CostBookData, CostItem } from "@/lib/cost-book";
import {
  setCostItemArchived,
  deleteCostItem,
  setDefaultMarkup,
} from "@/lib/actions/cost-book";
import { runAction, type ActionLike } from "@/lib/run-action";
import { toast } from "@/components/ui/Toast";
import { CostItemModal } from "./CostItemModal";
export function CostBookClient({ data }: { data: CostBookData }) {
  const router = useRouter();
  const [pending, start] = useTransition(),
    [cat, setCat] = useState("All"),
    [view, setView] = useState("active"),
    [editing, setEditing] = useState<CostItem | null>(null),
    [markup, setMarkup] = useState(String(data.defaultMarkup));
  const [feedback,setFeedback] = useState("");
  const cats = ["All", ...new Set(data.items.map((i) => i.category))].sort(
    (a, b) => (a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b)),
  );
  const visible = data.items.filter(
    (i) =>
      i.archived === (view === "archived") &&
      (cat === "All" || i.category === cat),
  );
  const change = (fn: () => Promise<ActionLike>) =>
    start(async () => {
      await runAction(async () => {
        const result = await fn();
        return result ?? { ok: true };
      }, {onSuccess:(result)=>{
        const notice = "notice" in result ? String(result.notice ?? "") : "";
        setFeedback(notice || "Saved");
        if (notice) toast({ kind: "info", message: notice });
        router.refresh();
      },onError:setFeedback});
    });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="Cost item status"
          value={view}
          onChange={setView}
          options={[
            { value: "active", label: "Active" },
            {
              value: "archived",
              label: "Archived",
              count: data.items.filter((i) => i.archived).length,
            },
          ]}
        />
        <label className="flex items-center gap-2 text-label text-ink-3">
          Category
          <select
            aria-label="Cost category"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="h-9 max-w-48 rounded-md border border-rule bg-card px-2 text-body text-ink"
          >
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-y border-rule-soft py-3">
        <label className="text-label text-ink-3" htmlFor="default-markup">
          Default markup
        </label>
        <input
          id="default-markup"
          value={markup}
          onChange={(e) => setMarkup(e.target.value)}
          type="number"
          min="0"
          max="1000"
          inputMode="decimal"
          className="h-8 w-20 rounded-md border border-rule bg-card px-2 text-right text-body"
        />
        <span className="text-body text-ink-3">%</span>
        {markup !== String(data.defaultMarkup) && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !Number.isFinite(Number(markup))}
            onClick={() => change(() => setDefaultMarkup(Number(markup)))}
          >
            Save markup
          </Button>
        )}
        <span role="status" className="text-meta text-ink-2">{pending ? "Saving…" : feedback}</span>
        <span className="ml-auto text-meta text-ink-3">
          {visible.length} items
        </span>
      </div>
      <TableWrapper className="overflow-visible!">
        <Table density="compact">
          <TableHead>
            <TableRow>
              <TableHeader>Item</TableHeader>
              <TableHeader className="@max-3xl/page:hidden">
                Category
              </TableHeader>
              <TableHeader numeric>Unit cost</TableHeader>
              <TableHeader numeric className="@max-2xl/page:hidden">
                Markup
              </TableHeader>
              <TableHeader>
                <span className="sr-only">Actions</span>
              </TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((i) => (
              <TableRow key={i.id}>
                <TablePrimaryCell
                  meta={
                    <>
                      {i.notes || i.category}
                      <span className="ml-2 @2xl/page:hidden">
                        · {i.markup ?? data.defaultMarkup}% markup
                      </span>
                    </>
                  }
                >
                  {i.name}
                </TablePrimaryCell>
                <TableCell className="@max-3xl/page:hidden">
                  {i.category}
                </TableCell>
                <TableCell numeric className="whitespace-nowrap">
                  <div>{fmtUsd(i.unitCost)}</div>
                  <div className="text-meta text-ink-3">
                    / {unitLabel(i.unit)}
                  </div>
                </TableCell>
                <TableCell numeric className="@max-2xl/page:hidden">
                  {i.markup != null ? (
                    <Chip kind="accent">{i.markup}%</Chip>
                  ) : (
                    <span className="text-meta text-ink-3">
                      Default · {data.defaultMarkup}%
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <details className="relative">
                    <summary
                      aria-label={`Actions for ${i.name}`}
                      className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md hover:bg-hover max-sm:size-11"
                    >
                      <MoreHorizontal className="size-4" />
                    </summary>
                    <div className="absolute right-0 z-20 w-40 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
                      <button
                        className="h-9 w-full rounded px-2 text-left text-body hover:bg-hover"
                        onClick={(e) => {
                          e.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                          setEditing(i);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        disabled={pending}
                        className="h-9 w-full rounded px-2 text-left text-body hover:bg-hover"
                        onClick={() =>
                          change(() => setCostItemArchived(i.id, !i.archived))
                        }
                      >
                        {i.archived ? "Restore" : "Archive"}
                      </button>
                      <button
                        disabled={pending}
                        className="h-9 w-full rounded px-2 text-left text-body text-flag hover:bg-hover"
                        onClick={() => {
                          if (
                            confirm(
                              "Permanently delete this cost item? Archive it to keep a restorable copy.",
                            )
                          )
                            change(() => deleteCostItem(i.id));
                        }}
                      >
                        Delete permanently
                      </button>
                    </div>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!visible.length && (
          <EmptyState
            title="No cost items in this view"
            description="Add reusable labor and material costs, choose another category, or restore an archived item."
          />
        )}
      </TableWrapper>
      {editing && (
        <CostItemModal
          mode="edit"
          item={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
