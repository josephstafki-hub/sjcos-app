"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import { restoreDeletedFile } from "@/lib/actions/files";
import { runAction } from "@/lib/run-action";
import type { TrashedFile } from "@/lib/file-trash";

/** "agent:claude-code" → "claude-code", "user:Joe" → "Joe". */
const who = (by: string) => (by === "agent:agent" ? "an agent" : by.replace(/^(agent|user):/, ""));

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

/** Files deleted from the project in the last 30 days (an agent's
 *  delete_project_file), each with the reason and a Restore button. Hidden
 *  when there are none. */
export function DeletedFiles({ files }: { files: TrashedFile[] }) {
  const [busy, start] = useTransition();
  const router = useRouter();
  if (!files.length) return null;

  function restore(f: TrashedFile) {
    start(async () => {
      const res = await runAction(() => restoreDeletedFile(f.file_id), { fallback: `Couldn't restore "${f.name}".` });
      if (res.ok) router.refresh();
    });
  }

  return (
    <Card className="mt-3.5 max-w-[680px] overflow-hidden p-0">
      <div className="flex items-center gap-1.5 border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        <Trash2 className="size-3" strokeWidth={1.5} />
        Recently deleted · {files.length}
      </div>
      {files.map((f, i) => (
        <div key={f.file_id} className={`flex items-center gap-2.5 px-4 py-2 ${i ? "border-t border-rule-soft" : ""}`}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-ink-3 line-through decoration-ink-4">{f.name}</div>
            <div className="truncate font-mono text-[10px] text-ink-4">
              {day(f.deleted_at)} · by {who(f.deleted_by)} · {f.reason}
            </div>
          </div>
          <span className="flex-none font-mono text-[10px] text-ink-4">until {day(f.purge_after)}</span>
          <button
            type="button"
            onClick={() => restore(f)}
            disabled={busy}
            className="flex flex-none items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"
          >
            <RotateCcw className="size-3" strokeWidth={1.5} />
            Restore
          </button>
        </div>
      ))}
    </Card>
  );
}
