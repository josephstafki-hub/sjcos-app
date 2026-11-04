// Recoverable directory maintenance, shared with the owner-facing actions.
import { z } from "zod";
import {
  removeAssignment,
  restoreAssignment,
} from "../lib/sub-assignment-maintenance.ts";
import { trashProjectFile, restoreProjectFile } from "../lib/file-trash.ts";
import { areaRefusal, fail, txOver } from "./tool-shared.mjs";
import {
  setDirectoryArchived,
  updateDirectoryRecord,
  updateCatalogRecord,
} from "../lib/directory-maintenance.ts";
export function registerDirectoryTools(
  server,
  { rows, json, currentPrincipal, pool },
) {
  const run = (s, p) => rows(s, p ?? []);
  for (const [area, table, key] of [
    ["sub", "subs", "sub_slug"],
    ["vendor", "vendors", "vendor_slug"],
    ["catalog_material", "catalog_items", "material_id"],
  ]) {
    server.registerTool(
      `set_${area}_archived`,
      {
        title: `Archive or restore ${area.replaceAll("_", " ")}`,
        description:
          "Reversible archive. Keeps history and links. Set archived=false to restore.",
        inputSchema: {
          [key]: table === "catalog_items" ? z.number().int() : z.string(),
          archived: z.boolean(),
        },
      },
      async (a) => {
        const refusal = await areaRefusal(
          rows,
          currentPrincipal,
          table === "catalog_items" ? "catalog" : table,
        );
        if (refusal) return json({ ok: false, error: refusal });
        try {
          return json(
            await setDirectoryArchived(run, table, a[key], a.archived),
          );
        } catch (e) {
          return fail(e);
        }
      },
    );
  }
  for (const table of ["subs", "vendors"]) {
    server.registerTool(
      `update_${table === "subs" ? "sub" : "vendor"}_record`,
      {
        title: `Edit ${table === "subs" ? "subcontractor" : "vendor"}`,
        description:
          "Correct contact and trade details without changing identity or history.",
        inputSchema: {
          slug: z.string(),
          name: z.string().min(1),
          trade: z.string(),
          email: z.string(),
          phone: z.string(),
          ...(table === "subs" ? { rate: z.string().optional() } : {}),
        },
      },
      async (a) => {
        const refusal = await areaRefusal(rows, currentPrincipal, table);
        if (refusal) return json({ ok: false, error: refusal });
        if (table === "subs") {
          const r = await areaRefusal(rows, currentPrincipal, "money");
          if (r) return json({ ok: false, error: r });
        }
        try {
          if (table === "subs" && a.rate === undefined) {
            const [r] = await rows("SELECT rate FROM subs WHERE slug=$1", [
              a.slug,
            ]);
            a.rate = r?.rate ?? "";
          }
          return json(await updateDirectoryRecord(run, table, a.slug, a));
        } catch (e) {
          return fail(e);
        }
      },
    );
  }
  server.registerTool(
    "update_catalog_material",
    {
      title: "Edit catalog material",
      description: "Correct product details. Omitted fields keep their values.",
      inputSchema: {
        material_id: z.number().int(),
        fields: z.object(
          Object.fromEntries(
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
            ].map((k) => [k, z.string().optional()]),
          ),
        ),
      },
    },
    async (a) => {
      const r = await areaRefusal(rows, currentPrincipal, "catalog");
      if (r) return json({ ok: false, error: r });
      try {
        return json(await updateCatalogRecord(run, a.material_id, a.fields));
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "list_catalog_materials",
    {
      title: "Search catalog materials",
      description:
        "Product records. Archived records are retained and restorable.",
      inputSchema: {
        archived: z.boolean().optional(),
        query: z.string().optional(),
      },
    },
    async ({ archived = false, query = "" }) => {
      const r = await areaRefusal(rows, currentPrincipal, "catalog");
      if (r) return json({ ok: false, error: r });
      return json(
        await rows(
          `SELECT id,name,supplier,sku,category,price,description,series,archived_at FROM catalog_items WHERE (archived_at IS NOT NULL)=$1 AND concat_ws(' ',name,supplier,sku,description,series) ILIKE $2 ORDER BY name LIMIT 200`,
          [archived, `%${query}%`],
        ),
      );
    },
  );
  server.registerTool(
    "set_sub_assignment_active",
    {
      title: "Remove or restore a subcontractor assignment",
      description:
        "active=false removes a mistaken assignment and keeps its scope and dates. active=true restores that saved assignment. Does not send an invite.",
      inputSchema: {
        project_slug: z.string(),
        sub_slug: z.string(),
        active: z.boolean(),
      },
    },
    async (a) => {
      const refusal = await areaRefusal(rows, currentPrincipal, "projects");
      if (refusal) return json({ ok: false, error: refusal });
      try {
        return json(
          await txOver(pool)(async (r) => {
            const [p] = await r("SELECT id FROM projects WHERE slug=$1", [
              a.project_slug,
            ]);
            if (!p) return { ok: false, error: "Project not found." };
            const result = await (
              a.active ? restoreAssignment : removeAssignment
            )(r, p.id, a.sub_slug);
            if (result.ok) {
              const [room] = await r(
                `SELECT key FROM chat_rooms WHERE entity_type IN ('project','warranty') AND entity_ref=$1 AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`,
                [a.project_slug],
              );
              if (room) {
                if (a.active)
                  await r(
                    "INSERT INTO chat_members(channel_key,sub_slug) VALUES($1,$2) ON CONFLICT DO NOTHING",
                    [room.key, a.sub_slug],
                  );
                else
                  await r(
                    "DELETE FROM chat_members WHERE channel_key=$1 AND sub_slug=$2",
                    [room.key, a.sub_slug],
                  );
              }
            }
            return result;
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "trash_file",
    {
      title: "Move an upload to Trash",
      description:
        "For any uploaded file in Files, including general uploads. Uses the shared 30-day trash; linked records are protected.",
      inputSchema: { file_id: z.string() },
    },
    async ({ file_id }) => {
      const refusal = await areaRefusal(rows, currentPrincipal, "projects");
      if (refusal) return json({ ok: false, error: refusal });
      try {
        return json(
          await txOver(pool)(async (r) => {
            const [f] = await r("SELECT project_key FROM files WHERE id=$1", [
              file_id,
            ]);
            if (!f) return { ok: false, error: "File not found." };
            return trashProjectFile(r, {
              fileId: file_id,
              projectSlug: f.project_key,
              reason: "Removed from Files",
              deletedBy: "agent",
            });
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "restore_file",
    {
      title: "Restore a file from Trash",
      description:
        "Restores an uploaded file with its original identity, including general uploads.",
      inputSchema: { file_id: z.string() },
    },
    async ({ file_id }) => {
      const refusal = await areaRefusal(rows, currentPrincipal, "projects");
      if (refusal) return json({ ok: false, error: refusal });
      try {
        return json(
          await txOver(pool)((r) =>
            restoreProjectFile(r, { fileId: file_id, restoredBy: "agent" }),
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
  server.registerTool(
    "list_deleted_files",
    {
      title: "List recoverable deleted files",
      description:
        "Files still in the 30-day Trash, including general uploads.",
      inputSchema: {},
    },
    async () => {
      const refusal = await areaRefusal(rows, currentPrincipal, "projects");
      if (refusal) return json({ ok: false, error: refusal });
      return json(
        await rows(
          "SELECT file_id,project_slug,name,deleted_at,purge_after FROM file_trash WHERE purge_after>now() ORDER BY deleted_at DESC LIMIT 200",
        ),
      );
    },
  );
}
