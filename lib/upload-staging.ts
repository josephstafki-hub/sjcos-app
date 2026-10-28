// Where an agent upload's bytes wait before commit_project_upload (see
// db/migrations/0031_project_uploads.sql). Shared by the signed PUT route
// (app/api/uploads/[id]/route.ts) and mcp/upload-tools.mjs, which run in
// different processes but write the same uploads/ directory. No "@/" imports:
// the MCP server loads this file directly with node.

import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

export const UPLOAD_ID_RE = /^upl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Raw bytes per append_project_upload part (64 KB once base64'd). */
export const CHUNK_LIMIT_BYTES = 48 * 1024;
/** How long an upload (and its PUT link) stays open; each append resets it. */
export const UPLOAD_TTL_MS = 30 * 60 * 1000;

/** The body a signed PUT delivered. */
export const PUT_NAME = "put";

export function stagingDir(uploadDir: string, id: string): string {
  if (!UPLOAD_ID_RE.test(id)) throw new Error("Bad upload id.");
  return path.join(uploadDir, ".staging", id);
}

export function partName(n: number): string {
  return `part-${String(n).padStart(6, "0")}`;
}

export function partNumberOf(file: string): number | null {
  const m = /^part-(\d{6})$/.exec(file);
  return m ? Number(m[1]) : null;
}

// The PUT link's signature. Derived from SESSION_SECRET with its own purpose
// tag, so it can't be replayed as a file-download signature (lib/file-sign.ts)
// or a session cookie.
function uploadKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("sjc-upload-url-v1").digest();
}

export function uploadSignature(secret: string, id: string, exp: number): string {
  return createHmac("sha256", uploadKey(secret)).update(`${id}:${exp}`).digest("hex");
}

export function verifyUploadSignature(secret: string, id: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const want = Buffer.from(uploadSignature(secret, id, exp), "hex");
  const got = Buffer.from(String(sig ?? ""), "hex");
  return got.length === want.length && timingSafeEqual(want, got);
}
