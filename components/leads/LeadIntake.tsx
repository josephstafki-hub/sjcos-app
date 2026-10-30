"use client";

import { useState, useTransition } from "react";
import { Check, Pencil } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { saveIntakeAnswer } from "@/lib/actions/leads";
import { runAction } from "@/lib/run-action";

type Item = { label: string; value: string };
export function LeadIntake({ slug, items }: { slug: string; items: Item[] }) {
  return (
    <Card className="p-4">
      <h3 className="mb-4 font-serif text-heading font-semibold">
        5-Question intake
      </h3>
      <div className="grid gap-4 @4xl/page:grid-cols-2">
        {items.map((it) => (
          <IntakeField key={it.label} slug={slug} {...it} />
        ))}
      </div>
    </Card>
  );
}
function IntakeField({
  slug,
  label,
  value,
}: {
  slug: string;
  label: string;
  value: string;
}) {
  const [val, setVal] = useState(value);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  function commit() {
    if (val === value) {
      setEditing(false);
      return;
    }
    start(async () => {
      const r = await runAction(() => saveIntakeAnswer(slug, label, val), {
        fallback: "Could not save that answer.",
      });
      if (r.ok) {
        setEditing(false);
        setSaved(true);
        setError("");
      } else setError("error" in r ? r.error : "Could not save that answer.");
    });
  }
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2 text-label text-ink-3">
        {label}
        {saved && <Check className="size-3 text-ok" />}
      </div>
      {editing ? (
        <>
          <textarea
            aria-label={label}
            autoFocus
            value={val}
            rows={3}
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setVal(value);
                setEditing(false);
              } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                e.currentTarget.blur();
            }}
            className="w-full rounded-md border border-rule bg-paper p-2 text-body outline-focus"
          />
          <div className="mt-1 flex gap-2">
            <Button
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commit}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setVal(value);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex w-full items-start justify-between gap-2 rounded-md py-1 text-left text-body text-ink-2 hover:bg-hover focus-visible:outline-focus"
        >
          <span className="min-w-0 whitespace-pre-wrap break-words">
            {val || "Add answer"}
          </span>
          <Pencil className="mt-1 size-3 shrink-0 text-ink-3 opacity-0 group-hover:opacity-100 group-focus:opacity-100 [@media(hover:none)]:opacity-100" />
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 text-meta text-flag">
          {error}
        </p>
      )}
    </div>
  );
}
