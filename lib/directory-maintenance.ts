// Shared by owner server actions and MCP. Authorization belongs to each entrypoint.
import type { Run } from "./commands/core.ts";
type Directory = "subs" | "vendors" | "catalog_items";
const tables = new Set(["subs", "vendors", "catalog_items"]);
export async function setDirectoryArchived(
  run: Run,
  table: Directory,
  key: string | number,
  archived: boolean,
) {
  if (!tables.has(table)) throw new Error("Unknown directory.");
  const result = await run(
    `UPDATE ${table} SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, now()) ELSE NULL END WHERE ${table === "catalog_items" ? "id" : "slug"} = $1 RETURNING *`,
    [key, archived],
  );
  return result.length
    ? { ok: true }
    : { ok: false, error: "Record not found. Refresh the page and try again." };
}
export async function updateDirectoryRecord(
  run: Run,
  table: "subs" | "vendors",
  slug: string,
  input: {
    name: string;
    trade: string;
    email: string;
    phone: string;
    rate?: string;
  },
) {
  if (table !== "subs" && table !== "vendors")
    throw new Error("Unknown directory.");
  const name = input.name.trim();
  if (!name) return { ok: false, error: "A name is required." };
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    return { ok: false, error: "Enter a valid email address." };
  const result = await run(
    `UPDATE ${table} SET name=$2, trade=$3, email=NULLIF($4,''), phone=NULLIF($5,''), updated_at=now() ${table === "subs" ? ", rate = $6" : ""} WHERE slug=$1 RETURNING slug`,
    [
      slug,
      name,
      input.trade.trim(),
      input.email.trim(),
      input.phone.trim(),
      ...(table === "subs" ? [input.rate?.trim() ?? ""] : []),
    ],
  );
  return result.length
    ? { ok: true }
    : { ok: false, error: "Record not found." };
}
export async function updateCatalogRecord(
  run: Run,
  id: number,
  fields: Record<string, string>,
) {
  const allowed = [
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
  ];
  if (fields.name !== undefined && !fields.name.trim())
    return { ok: false, error: "A material name is required." };
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!entries.length) return { ok: false, error: "Choose a field to edit." };
  const result = await run(
    `UPDATE catalog_items SET ${entries.map(([k], i) => `${k}=$${i + 2}`).join(", ")} WHERE id=$1 RETURNING id`,
    [id, ...entries.map(([, v]) => v.trim())],
  );
  return result.length
    ? { ok: true }
    : { ok: false, error: "Material not found." };
}
