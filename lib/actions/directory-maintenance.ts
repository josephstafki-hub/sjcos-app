"use server";
import { requireAccess } from "@/lib/dal";
import { runDirect as run } from "@/lib/commands/db";
import { revalidatePath } from "next/cache";
import {
  setDirectoryArchived,
  updateDirectoryRecord,
  updateCatalogRecord,
} from "@/lib/directory-maintenance";
export async function archiveDirectoryRecord(
  table: "subs" | "vendors" | "catalog_items",
  key: string | number,
  archived: boolean,
) {
  const area = table === "catalog_items" ? "catalog" : table;
  if (!["subs", "vendors", "catalog_items"].includes(table))
    throw new Error("Unknown directory.");
  await requireAccess(area);
  const result = await setDirectoryArchived(run, table, key, archived);
  revalidatePath(`/${area}`);
  if (table !== "catalog_items") revalidatePath(`/${area}/${key}`);
  revalidatePath("/floor");
  return result;
}
export async function saveDirectoryRecord(
  table: "subs" | "vendors",
  slug: string,
  fd: FormData,
) {
  if (table !== "subs" && table !== "vendors")
    throw new Error("Unknown directory.");
  await requireAccess(table);
  const fields = Object.fromEntries(
    ["name", "trade", "email", "phone", "rate"].map((k) => [
      k,
      String(fd.get(k) ?? ""),
    ]),
  );
  // Rates remain fenced behind the money area on every write.
  if (table === "subs" && fd.has("rate")) await requireAccess("money");
  if (table === "subs" && !fd.has("rate"))
    fields.rate =
      (
        await run<{ rate: string }>(`SELECT rate FROM subs WHERE slug=$1`, [
          slug,
        ])
      )[0]?.rate ?? "";
  const result = await updateDirectoryRecord(
    run,
    table,
    slug,
    fields as {
      name: string;
      trade: string;
      email: string;
      phone: string;
      rate: string;
    },
  );
  revalidatePath(`/${table}`);
  revalidatePath(`/${table}/${slug}`);
  return result;
}
export async function saveCatalogRecord(id: number, fd: FormData) {
  await requireAccess("catalog");
  const fields = Object.fromEntries(
    [
      "name",
      "supplier",
      "sku",
      "category",
      "price",
      "use_label",
      "description",
      "msrp",
      "series",
      "source_url",
    ]
      .filter((k) => fd.has(k))
      .map((k) => [k, String(fd.get(k))]),
  );
  const image = fd.get("image");
  if (image instanceof File && image.size > 0) {
    const { storeUpload } = await import("@/lib/upload-store");
    const stored = await storeUpload(image, {
      idPrefix: "cat",
      imagesOnly: true,
      tag: "CATALOG",
      subtitle: `Catalog · ${fields.name ?? "Product"}`,
    });
    if (!stored.ok) return stored;
    await run(`UPDATE catalog_items SET image_file_id=$2 WHERE id=$1`, [
      id,
      stored.id,
    ]);
  }
  const result = await updateCatalogRecord(run, id, fields);
  revalidatePath("/catalog");
  revalidatePath("/floor");
  return result;
}

export async function restoreSubAssignment(
  projectSlug: string,
  subSlug: string,
) {
  await requireAccess("projects");
  const { withTransaction } = await import("@/lib/commands/db");
  const { restoreAssignment } =
    await import("@/lib/sub-assignment-maintenance");
  const [project] = await run<{ id: string }>(
    `SELECT id FROM projects WHERE slug=$1`,
    [projectSlug],
  );
  if (!project) return { ok: false, error: "Project not found." };
  const result = await withTransaction((r) =>
    restoreAssignment(r, project.id, subSlug),
  );
  if (result.ok) {
    const { addSubToEntityRoom } = await import("@/lib/rooms");
    await addSubToEntityRoom(projectSlug, subSlug).catch(() => {});
  }
  revalidatePath(`/projects/${projectSlug}`);
  revalidatePath(`/subs/${subSlug}`);
  revalidatePath("/subs");
  return result;
}
