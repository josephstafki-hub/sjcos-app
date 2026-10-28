import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/uploads";
import { PUT_NAME, UPLOAD_ID_RE, stagingDir, verifyUploadSignature } from "@/lib/upload-staging";

// PUT /api/uploads/<id>?exp=&sig= — the bytes of an agent upload started with
// the MCP create_project_upload tool. No session: the signature (minted by
// that tool, 30 min) is the whole credential, and it only ever writes the
// staging copy of this one upload. Nothing lands in the project's Files until
// commit_project_upload checks size + sha256. A second PUT replaces the first.
// /api is outside proxy.ts, so the body streams straight here (nginx caps it
// at 30M; the declared size caps it tighter).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
  if (!UPLOAD_ID_RE.test(id)) return fail(404, "No such upload.");

  const q = new URL(req.url).searchParams;
  const secret = process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";
  if (!verifyUploadSignature(secret, id, Number(q.get("exp")), q.get("sig") ?? ""))
    return fail(403, "Upload link expired or invalid. Call create_project_upload again for a fresh one.");

  const up = await queryOne<{ size_bytes: string; sha256: string; status: string; expired: boolean }>(
    `SELECT size_bytes::text AS size_bytes, sha256, status, expires_at < now() AS expired
       FROM project_uploads WHERE id = $1`,
    [id],
  );
  if (!up) return fail(404, "No such upload.");
  if (up.status === "committed") return fail(409, "This upload is already committed.");
  if (up.status !== "open" || up.expired) return fail(410, "This upload expired. Call create_project_upload again.");
  if (!req.body) return fail(400, "Empty body. PUT the raw file bytes.");

  const declared = Number(up.size_bytes);
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(length) && length > declared)
    return fail(413, `Body is ${length} bytes; the upload was declared as ${declared}.`);

  const dir = stagingDir(UPLOAD_DIR, id);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `put.${randomUUID()}.tmp`);
  const out = createWriteStream(tmp);
  const hash = createHash("sha256");
  let received = 0;
  try {
    for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > declared) {
        out.destroy();
        await unlink(tmp).catch(() => {});
        return fail(413, `Body is over the declared ${declared} bytes.`);
      }
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
    await rename(tmp, path.join(dir, PUT_NAME));
  } catch (e) {
    out.destroy();
    await unlink(tmp).catch(() => {});
    return fail(400, `Upload interrupted: ${(e as Error).message}`);
  }

  const sha256 = hash.digest("hex");
  await query(`UPDATE project_uploads SET put_received_at = now(), updated_at = now() WHERE id = $1`, [id]);
  const matches = received === declared && sha256 === up.sha256;
  return NextResponse.json({
    ok: true,
    received_bytes: received,
    sha256,
    matches,
    next: matches
      ? "Call commit_project_upload with this upload_id."
      : `Doesn't match what create_project_upload declared (${declared} bytes, sha256 ${up.sha256}). PUT again or send parts.`,
  });
}
