// SJC OS — MCP binary uploads into a project's Files (AI-agnostic).
//
// save_project_file only takes text, and file_email_document files a cost
// document (Unsorted › Filed). This is the plain "put this PDF / photo /
// spreadsheet on the job" path:
//
//   create_project_upload  → upload_id + a signed PUT URL (30 min) on the app
//   PUT <upload_url>       → raw bytes, served by app/api/uploads/[id]/route.ts
//   append_project_upload  → or the same bytes in base64 parts over MCP, for
//                            agents whose network can't reach the app domain
//   commit_project_upload  → checks size + sha256, lands the files row
//
// Bytes wait under uploads/.staging/<id>/ (lib/upload-staging.ts) until the
// commit. A commit never logs a cost, never touches Unsorted, and the file is
// never client-visible. Same name on the same project replaces the older copy
// in place (keeps its file_id), like save_project_file.
//
// delete_project_file moves a file to the trash for 30 days (lib/file-trash.ts;
// the Files tab shows it with Restore, and restore_project_file undoes it).
// Agents may delete only files an agent made, unless the call runs for the
// owner's own login (Joe's in-app Claude).

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CHUNK_LIMIT_BYTES,
  MAX_UPLOAD_BYTES,
  PUT_NAME,
  UPLOAD_ID_RE,
  UPLOAD_TTL_MS,
  partName,
  partNumberOf,
  stagingDir,
  uploadSignature,
} from "../lib/upload-staging.ts";
import { clearThumbnails, listFileTrash, purgeFileTrash, restoreProjectFile, trashProjectFile } from "../lib/file-trash.ts";
import { agentNameOf, areaRefusal, txOver } from "./tool-shared.mjs";

const t = (v, max = 300) => String(v ?? "").trim().slice(0, max);

/** The types an agent may upload, with the extension a bare name gets. */
export const UPLOAD_TYPES = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/csv": ".csv",
};

const sizeLabel = (n) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** Same display-name rule as save_project_file. */
export function uploadName(filename, mime) {
  let name = path.basename(t(filename, 160)).replace(/[^\w.\- —·()&,']+/g, "_").trim();
  if (!name || /^\.+$/.test(name)) return "";
  if (!path.extname(name)) name += UPLOAD_TYPES[mime] ?? "";
  return name;
}

/** Strict base64 (or base64url) → Buffer; null when it isn't base64. */
function decodeBase64(s) {
  const clean = String(s ?? "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return null;
  return Buffer.from(clean, "base64");
}

const sha256Of = (buf) => createHash("sha256").update(buf).digest("hex");

export function registerUploadTools(server, { rows, json, pool, uploadDir, envValue, currentPrincipal }) {
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
  const createdBy = () => `agent:${agentNameOf(server)}`;
  const refuse = async () => (currentPrincipal ? areaRefusal(rows, currentPrincipal, "projects") : null);

  const projectBySlug = async (slug) => {
    const r = await rows(`SELECT id, slug, name FROM projects WHERE slug = $1`, [t(slug, 80)]);
    if (!r.length) throw new Error(`Project '${slug}' not found. Use list_projects to find the slug.`);
    return r[0];
  };

  const uploadById = async (id) => {
    const uid = t(id, 80);
    if (!UPLOAD_ID_RE.test(uid)) throw new Error("Unknown upload_id. Call create_project_upload first.");
    const r = await rows(
      `SELECT *, size_bytes::bigint::text AS size_text, expires_at < now() AS expired,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_iso
         FROM project_uploads WHERE id = $1`,
      [uid],
    );
    if (!r.length) throw new Error("Unknown upload_id. Call create_project_upload first.");
    return { ...r[0], size: Number(r[0].size_text) };
  };

  const assertOpen = (up) => {
    if (up.status === "committed") throw new Error(`Upload already committed as file ${up.file_id}.`);
    if (up.status === "expired" || up.expired)
      throw new Error("This upload expired (30 min without activity). Call create_project_upload again.");
  };

  const touch = (id) =>
    rows(
      `UPDATE project_uploads SET expires_at = now() + make_interval(secs => $2), updated_at = now()
        WHERE id = $1
        RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`,
      [id, UPLOAD_TTL_MS / 1000],
    );

  /** Housekeeping on the way through: drop staging bytes of uploads left
   *  open an hour past expiry, and trash past its 30 days. */
  const sweep = async () => {
    const stale = await rows(
      `UPDATE project_uploads SET status = 'expired', updated_at = now()
        WHERE status IN ('open','committing') AND expires_at < now() - interval '1 hour'
        RETURNING id`,
    );
    for (const s of stale) await rm(stagingDir(uploadDir, s.id), { recursive: true, force: true });
    await purgeFileTrash(rows, uploadDir);
  };

  /** What's in staging: the PUT body and the parts, by number. */
  const staged = async (id) => {
    const dir = stagingDir(uploadDir, id);
    const names = await readdir(dir).catch(() => []);
    const parts = [];
    for (const n of names) {
      const num = partNumberOf(n);
      if (num !== null) parts.push({ num, file: path.join(dir, n), size: (await stat(path.join(dir, n))).size });
    }
    parts.sort((a, b) => a.num - b.num);
    return { dir, hasPut: names.includes(PUT_NAME), put: path.join(dir, PUT_NAME), parts };
  };

  /** The committed bytes: the PUT body if it checks out, else the parts in
   *  order. Throws a message saying exactly what arrived vs what was declared. */
  const pickBytes = async (up) => {
    const s = await staged(up.id);
    const want = `${up.size} bytes, sha256 ${up.sha256}`;
    const problems = [];
    if (s.hasPut) {
      const buf = await readFile(s.put);
      const sha = sha256Of(buf);
      if (buf.length === up.size && sha === up.sha256) return { buf, source: "put" };
      problems.push(`the PUT body is ${buf.length} bytes, sha256 ${sha}`);
    }
    if (s.parts.length) {
      const missing = [];
      for (let i = 1, j = 0; j < s.parts.length; i++) {
        if (s.parts[j].num === i) j++;
        else missing.push(i);
      }
      if (missing.length) problems.push(`parts ${missing.slice(0, 20).join(", ")} are missing (have ${s.parts.map((p) => p.num).join(", ").slice(0, 200)})`);
      else {
        const buf = Buffer.concat(await Promise.all(s.parts.map((p) => readFile(p.file))));
        const sha = sha256Of(buf);
        if (buf.length === up.size && sha === up.sha256) return { buf, source: "parts" };
        problems.push(`parts 1–${s.parts.length} join to ${buf.length} bytes, sha256 ${sha}`);
      }
    }
    if (!problems.length) throw new Error("Nothing received yet: PUT the bytes to upload_url or send them with append_project_upload.");
    throw new Error(`Doesn't match what was declared (${want}): ${problems.join("; ")}. The upload is still open — resend and commit again.`);
  };

  // ── create ────────────────────────────────────────────────────────────────

  server.registerTool(
    "create_project_upload",
    {
      title: "Start a file upload to a project",
      description:
        "Start uploading a binary file (PDF plan set, photo, xlsx/docx, csv) into a project's Files. " +
        "Returns upload_id and upload_url: PUT the raw bytes there (Content-Type = mime_type, no auth " +
        "header; the URL is signed and lasts 30 min), e.g. `curl -T file.pdf -H 'Content-Type: " +
        "application/pdf' \"$upload_url\"`. If your network can't reach the app domain, send the " +
        "bytes with append_project_upload instead (base64 parts of at most chunk_limit_bytes raw). " +
        "Then call commit_project_upload. Internal only: never client-visible, no cost logged, " +
        "nothing in Unsorted. For text you wrote, use save_project_file.",
      inputSchema: {
        project_slug: z.string(),
        filename: z.string().describe('Display name, e.g. "NKH Eden Prairie TI - Plan Set (Bid).pdf".'),
        mime_type: z.enum(Object.keys(UPLOAD_TYPES)),
        size_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES).describe("Exact size in bytes. Max 25 MB."),
        sha256: z.string().describe("Hex SHA-256 of the whole file (e.g. `sha256sum file.pdf`); checked on commit."),
        tag: z.string().optional().describe('Files tag, e.g. "PLAN · Drawings", "SCOPE · Sub". Default "DOC · Agent".'),
        subtitle: z.string().optional().describe("One line shown under the name."),
        replace_existing: z.boolean().optional()
          .describe("Default true: a file with the same name on this project is replaced in place (keeps its file_id), so one current copy remains. false keeps both."),
      },
    },
    async ({ project_slug, filename, mime_type, size_bytes, sha256, tag, subtitle, replace_existing }) => {
      try {
        const refusal = await refuse();
        if (refusal) throw new Error(refusal);
        const project = await projectBySlug(project_slug);
        if (!UPLOAD_TYPES[mime_type]) throw new Error(`mime_type must be one of ${Object.keys(UPLOAD_TYPES).join(", ")}.`);
        const name = uploadName(filename, mime_type);
        if (!name) throw new Error("filename is required.");
        const digest = t(sha256, 100).toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("sha256 must be the 64-character hex digest of the file.");
        const secret = envValue("SESSION_SECRET");
        if (!secret) throw new Error("SESSION_SECRET not set — cannot sign upload URLs.");
        await sweep();

        const id = `upl-${randomUUID()}`;
        const [up] = await rows(
          `INSERT INTO project_uploads
             (id, project_id, project_slug, filename, mime_type, size_bytes, sha256, tag, subtitle,
              replace_existing, created_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() + make_interval(secs => $12))
           RETURNING extract(epoch FROM expires_at)::bigint::text AS exp,
                     to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`,
          [
            id, project.id, project.slug, name, mime_type, size_bytes, digest,
            t(tag, 80) || "DOC · Agent", t(subtitle, 200) || null, replace_existing !== false,
            createdBy(), UPLOAD_TTL_MS / 1000,
          ],
        );
        const exp = Number(up.exp);
        const base = (envValue("NEXT_PUBLIC_APP_URL") || "https://os.sjcarpentryllc.com").replace(/\/$/, "");
        const existing = await rows(
          `SELECT id FROM files WHERE project_key = $1 AND name = $2 AND storage_path IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`,
          [project.slug, name],
        );
        return json({
          ok: true,
          upload_id: id,
          name,
          upload_url: `${base}/api/uploads/${id}?exp=${exp}&sig=${uploadSignature(secret, id, exp)}`,
          method: "PUT",
          headers: { "Content-Type": mime_type },
          chunk_limit_bytes: CHUNK_LIMIT_BYTES,
          parts_needed_if_appending: Math.ceil(size_bytes / CHUNK_LIMIT_BYTES),
          expires_at: up.expires_at,
          will_replace_file_id: replace_existing !== false && existing.length ? existing[0].id : null,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── append (fallback) ─────────────────────────────────────────────────────

  server.registerTool(
    "append_project_upload",
    {
      title: "Send one part of an upload",
      description:
        "Fallback when you can't PUT to upload_url: send the file as base64 parts, part_number 1, 2, 3… " +
        "each at most chunk_limit_bytes raw (48 KB raw = 64 KB base64). Resending a part_number " +
        "overwrites it; order doesn't matter. Each part keeps the upload open another 30 min. " +
        "Then commit_project_upload.",
      inputSchema: {
        upload_id: z.string(),
        part_number: z.number().int().min(1),
        data_base64: z.string().describe("This part's bytes, base64."),
      },
    },
    async ({ upload_id, part_number, data_base64 }) => {
      try {
        const up = await uploadById(upload_id);
        assertOpen(up);
        const maxParts = Math.ceil(up.size / CHUNK_LIMIT_BYTES);
        if (part_number > maxParts)
          throw new Error(`part_number ${part_number} is past the end: a ${up.size}-byte file has at most ${maxParts} parts of ${CHUNK_LIMIT_BYTES} bytes.`);
        const buf = decodeBase64(data_base64);
        if (!buf) throw new Error("data_base64 isn't valid base64.");
        if (!buf.length) throw new Error("data_base64 is empty.");
        if (buf.length > CHUNK_LIMIT_BYTES)
          throw new Error(`Part is ${buf.length} bytes decoded; the limit is ${CHUNK_LIMIT_BYTES}. Split it.`);

        const dir = stagingDir(uploadDir, up.id);
        await mkdir(dir, { recursive: true });
        const tmp = path.join(dir, `${partName(part_number)}.${randomUUID()}.tmp`);
        await writeFile(tmp, buf);
        await rename(tmp, path.join(dir, partName(part_number)));
        const [{ expires_at }] = await touch(up.id);
        const s = await staged(up.id);
        const total = s.parts.reduce((n, p) => n + p.size, 0);
        return json({
          ok: true,
          upload_id: up.id,
          part_number,
          part_bytes: buf.length,
          received_bytes_total: total,
          expected_bytes: up.size,
          parts_received: s.parts.length,
          expires_at,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── commit ────────────────────────────────────────────────────────────────

  server.registerTool(
    "commit_project_upload",
    {
      title: "Finish an upload",
      description:
        "Check the bytes (from the PUT, or the appended parts) against the size and sha256 given to " +
        "create_project_upload and file them in the project's Files with that name, tag and subtitle. " +
        "On a mismatch it fails and the upload stays open: resend and commit again. Committing twice " +
        "returns the same file. Returns file_id, name, size_label, mime_type, sha256, replaced.",
      inputSchema: { upload_id: z.string() },
    },
    async ({ upload_id }) => {
      try {
        const refusal = await refuse();
        if (refusal) throw new Error(refusal);
        let up = await uploadById(upload_id);
        if (up.status === "committed") {
          const [f] = await rows(`SELECT id, name, size_label, mime_type, sha256 FROM files WHERE id = $1`, [up.file_id]);
          if (!f) throw new Error("This upload was committed, but its file has since been deleted.");
          return json({ ok: true, file_id: f.id, name: f.name, size_label: f.size_label, mime_type: f.mime_type, sha256: f.sha256, replaced: !!up.replaced, already_committed: true });
        }
        assertOpen(up);
        const claimed = await rows(
          `UPDATE project_uploads SET status = 'committing', updated_at = now()
            WHERE id = $1 AND (status = 'open' OR (status = 'committing' AND updated_at < now() - interval '5 minutes'))
            RETURNING id`,
          [up.id],
        );
        if (!claimed.length) throw new Error("Another commit of this upload is running; try again in a moment.");

        let picked;
        try {
          picked = await pickBytes(up);
        } catch (e) {
          await rows(
            `UPDATE project_uploads SET status = 'open', last_error = $2, updated_at = now(),
                    expires_at = greatest(expires_at, now() + make_interval(secs => $3))
              WHERE id = $1`,
            [up.id, e.message.slice(0, 1000), UPLOAD_TTL_MS / 1000],
          );
          throw e;
        }

        try {
          const { buf } = picked;
          const isImage = up.mime_type.startsWith("image/");
          const size = sizeLabel(buf.length);
          const sub = up.subtitle || `Uploaded by agent ${new Date().toISOString().slice(0, 10)}`;
          await mkdir(uploadDir, { recursive: true });
          const existing = up.replace_existing
            ? await rows(
                `SELECT id, storage_path FROM files WHERE project_key = $1 AND name = $2 AND storage_path IS NOT NULL
                  ORDER BY created_at DESC LIMIT 1`,
                [up.project_slug, up.filename],
              )
            : [];

          let fileId;
          if (existing.length) {
            const f = existing[0];
            const target = path.join(uploadDir, path.basename(f.storage_path));
            const tmp = `${target}.${randomUUID()}.tmp`;
            await writeFile(tmp, buf);
            await rename(tmp, target);
            await clearThumbnails(uploadDir, f.id);
            await rows(
              `UPDATE files SET type = $2, tag = $3, subtitle = $4, size_label = $5, mime_type = $6, sha256 = $7,
                      modified_label = 'just now', created_at = now(), updated_at = now()
                WHERE id = $1`,
              [f.id, isImage ? "img" : "doc", up.tag, sub, size, up.mime_type, up.sha256],
            );
            fileId = f.id;
          } else {
            fileId = `agent-${randomUUID()}`;
            const stored = `${fileId}__${up.filename}`;
            await writeFile(path.join(uploadDir, stored), buf);
            await rows(
              `INSERT INTO files (id, project_key, type, name, tag, ai_origin, modified_label, size_label,
                                  subtitle, ai_tags, sort, storage_path, mime_type, client_visible,
                                  sha256, created_by, updated_at)
               VALUES ($1, $2, $3, $4, $5, true, 'just now', $6, $7, '{}', -1, $8, $9, false, $10, $11, now())`,
              [fileId, up.project_slug, isImage ? "img" : "doc", up.filename, up.tag, size, sub, stored, up.mime_type, up.sha256, up.created_by],
            );
          }
          await rows(
            `UPDATE project_uploads SET status = 'committed', file_id = $2, replaced = $3, last_error = NULL,
                    committed_at = now(), updated_at = now()
              WHERE id = $1`,
            [up.id, fileId, existing.length > 0],
          );
          await rm(stagingDir(uploadDir, up.id), { recursive: true, force: true });
          return json({
            ok: true,
            file_id: fileId,
            name: up.filename,
            size_label: size,
            mime_type: up.mime_type,
            sha256: up.sha256,
            replaced: existing.length > 0,
            received_via: picked.source,
          });
        } catch (e) {
          await rows(
            `UPDATE project_uploads SET status = 'open', last_error = $2, updated_at = now() WHERE id = $1 AND status = 'committing'`,
            [up.id, String(e.message).slice(0, 1000)],
          );
          throw e;
        }
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── delete / restore ──────────────────────────────────────────────────────

  server.registerTool(
    "delete_project_file",
    {
      title: "Delete a project file",
      description:
        "Remove a file from a project's Files, e.g. a superseded copy of a plan set. It goes to the " +
        "trash for 30 days: Joe sees it on the Files tab with Restore, and restore_project_file undoes " +
        "it. `reason` is recorded in the project history. Only files an agent made (uploaded or " +
        "saved) unless you're running on Joe's own login. A file still used elsewhere (bid packet, " +
        "document, signature) is refused — detach it first.",
      inputSchema: {
        project_slug: z.string(),
        file_id: z.string().describe("A file id from list_project_files."),
        reason: z.string().describe('Why, e.g. "Superseded by the 10/27 bid set".'),
      },
    },
    async ({ project_slug, file_id, reason }) => {
      try {
        const refusal = await refuse();
        if (refusal) throw new Error(refusal);
        const project = await projectBySlug(project_slug);
        const why = t(reason, 500);
        if (!why) throw new Error("reason is required (it goes in the project history).");
        const [f] = await rows(
          `SELECT id, name, created_by FROM files WHERE id = $1 AND project_key = $2 AND storage_path IS NOT NULL`,
          [t(file_id, 80), project.slug],
        );
        if (!f) throw new Error(`No file ${file_id} on ${project.slug}. Use list_project_files for ids.`);
        const agentMade = String(f.created_by ?? "").startsWith("agent") || f.id.startsWith("agent-");
        if (!agentMade) {
          const p = currentPrincipal ? await currentPrincipal() : null;
          if (p?.role !== "owner")
            throw new Error(`'${f.name}' was put there by a person, not an agent — only Joe can delete it. Nothing was deleted.`);
        }
        await sweep();
        const res = await txOver(pool)((run) =>
          trashProjectFile(run, { projectSlug: project.slug, fileId: f.id, reason: why, deletedBy: createdBy() }),
        );
        if (!res.ok) throw new Error(res.error);
        return json({
          ok: true,
          file_id: f.id,
          name: f.name,
          deleted: true,
          restorable_until: res.trashed.purge_after,
          undo: "restore_project_file with this file_id, or Restore on the project's Files tab.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "restore_project_file",
    {
      title: "Restore a deleted project file",
      description:
        "Undo delete_project_file (within 30 days): the file comes back with the same id. Without " +
        "file_id, lists the project's deleted files (name, reason, who, when). Refused while a newer " +
        "file with the same name is on the project.",
      inputSchema: {
        project_slug: z.string(),
        file_id: z.string().optional().describe("Omit to list what can be restored."),
      },
    },
    async ({ project_slug, file_id }) => {
      try {
        const project = await projectBySlug(project_slug);
        if (!file_id) return json({ ok: true, deleted_files: await listFileTrash(rows, project.slug) });
        const refusal = await refuse();
        if (refusal) throw new Error(refusal);
        const [trashed] = await rows(`SELECT project_slug FROM file_trash WHERE file_id = $1`, [t(file_id, 80)]);
        if (trashed && trashed.project_slug !== project.slug) throw new Error(`That file was deleted from ${trashed.project_slug}, not ${project.slug}.`);
        const res = await txOver(pool)((run) => restoreProjectFile(run, { fileId: t(file_id, 80), restoredBy: createdBy() }));
        if (!res.ok) throw new Error(res.error);
        return json({ ok: true, file_id: res.file_id, name: res.name, restored: true });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
