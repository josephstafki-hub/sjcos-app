"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createMaterial } from "@/lib/actions/catalog";
import { MATERIAL_CATEGORIES } from "@/lib/catalog-categories";
import { PLACE_KINDS } from "@/lib/plan-doc";
import { saveCatalogRecord } from "@/lib/actions/directory-maintenance";
import { useDialogDismiss } from "@/lib/use-dialog-dismiss";
import { runAction } from "@/lib/run-action";
import type { Material } from "@/lib/catalog";
import { SubmitButton, Button } from "@/components/ui";

/** "Add material" button + modal. Submits createMaterial, then closes (the
 *  action revalidates /catalog so the new card appears). */
export function AddMaterialButton({ material }: { material?: Material }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useDialogDismiss(open, () => setOpen(false));

  return (
    <>
      <Button
        icon={material ? undefined : Plus}
        variant={material ? "ghost" : "primary"}
        className={material ? "justify-start" : ""}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {material ? "Edit material" : "Add material"}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-8"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={material ? "Edit material" : "Add material"}
            className="w-full max-w-[460px] rounded-lg border border-rule bg-card shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-heading font-semibold text-ink">
                {material ? "Edit material" : "Add material"}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-3 hover:text-ink"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>

            <form
              action={async (fd) => {
                const result = await runAction(async () => {
                  if (material) {
                    fd.set("use_label", String(fd.get("use") ?? ""));
                    return saveCatalogRecord(material.id, fd);
                  }
                  await createMaterial(fd);
                  return { ok: true };
                });
                if (result.ok) setOpen(false);
                else setError(result.error ?? "Couldn't save the material.");
              }}
              className="flex flex-col gap-3 p-4"
            >
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink-3">Name</span>
                <input
                  name="name"
                  defaultValue={material?.name ?? ""}
                  required
                  autoFocus
                  placeholder="Calacatta marble · slab"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-label font-medium text-ink-3">
                    Supplier
                  </span>
                  <input
                    name="supplier"
                    defaultValue={material?.supplier ?? ""}
                    placeholder="Cambria stoneyards"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="flex w-[150px] flex-col gap-1">
                  <span className="text-label font-medium text-ink-3">
                    Category
                  </span>
                  <select
                    name="category"
                    defaultValue={material?.category ?? "Cabinets"}
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  >
                    {MATERIAL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-label font-medium text-ink-3">SKU</span>
                  <input
                    name="sku"
                    defaultValue={material?.sku ?? ""}
                    placeholder="CAL-SLB-3CM"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="flex w-[150px] flex-col gap-1">
                  <span className="text-label font-medium text-ink-3">
                    Price
                  </span>
                  <input
                    name="price"
                    defaultValue={material?.price ?? ""}
                    placeholder="$185 / sq ft"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-label font-medium text-ink-3">
                    Series
                  </span>
                  <input
                    name="series"
                    defaultValue={material?.series ?? ""}
                    placeholder="Venus Ivory"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="flex w-[150px] flex-col gap-1">
                  <span className="text-label font-medium text-ink-3">
                    MSRP
                  </span>
                  <input
                    name="msrp"
                    defaultValue={material?.msrp ?? ""}
                    placeholder="$126.83"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink-3">
                  Description
                </span>
                <textarea
                  name="description"
                  defaultValue={material?.description ?? ""}
                  rows={2}
                  placeholder="Wall cabinet, 30in, soft-close doors…"
                  className="resize-none rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink-3">
                  Usage note
                </span>
                <input
                  name="use"
                  defaultValue={material?.use ?? ""}
                  placeholder="4 projects"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                />
              </label>
              {/* Placement — lets the floor-plan designer drop this product as a sized box. */}
              {!material && (
                <div className="rounded-md border border-rule-soft bg-paper-2 p-2.5">
                  <div className="mb-1.5 text-label font-medium text-ink-3">
                    Placeable in the floor-plan designer (optional)
                  </div>
                  <div className="flex gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-meta text-ink-3">Width in</span>
                      <input
                        name="width_in"
                        inputMode="decimal"
                        placeholder="36"
                        className="rounded-md border border-rule bg-paper px-2 py-1 text-label text-ink outline-none focus:border-accent"
                      />
                    </label>
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-meta text-ink-3">Depth in</span>
                      <input
                        name="depth_in"
                        inputMode="decimal"
                        placeholder="24"
                        className="rounded-md border border-rule bg-paper px-2 py-1 text-label text-ink outline-none focus:border-accent"
                      />
                    </label>
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-meta text-ink-3">Height in</span>
                      <input
                        name="height_in"
                        inputMode="decimal"
                        placeholder="34.5"
                        className="rounded-md border border-rule bg-paper px-2 py-1 text-label text-ink outline-none focus:border-accent"
                      />
                    </label>
                    <label className="flex w-[130px] flex-col gap-1">
                      <span className="text-meta text-ink-3">Kind</span>
                      <select
                        name="place_kind"
                        defaultValue=""
                        className="rounded-md border border-rule bg-paper px-2 py-1 text-label text-ink outline-none focus:border-accent"
                      >
                        <option value="">Not placeable</option>
                        {PLACE_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink-3">
                  Product image (optional)
                </span>
                <input
                  name="image"
                  type="file"
                  accept="image/*"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-label text-ink-2 outline-none file:mr-2 file:rounded file:border-0 file:bg-paper-3 file:px-2 file:py-1 file:text-meta file:text-ink-2"
                />
              </label>

              {error && (
                <p role="alert" className="text-meta text-flag">
                  {error}
                </p>
              )}
              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-rule px-3 py-1.5 text-label font-semibold text-ink-3 hover:bg-paper-2"
                >
                  Cancel
                </button>
                <SubmitButton
                  pendingLabel="Adding…"
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink/90"
                >
                  {material ? "Save changes" : "Add material"}
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
