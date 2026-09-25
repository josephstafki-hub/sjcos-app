import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Where uploaded /files blobs live on disk (gitignored, outside the bundle).
 *  Lives in its own module so both the upload Server Action and the download
 *  route handler can import it (a "use server" file may only export functions). */
export const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** Read a stored blob by its files.storage_path — the same file the download
 *  route serves (lib/file-serve.ts). storage_path is DB-controlled, but
 *  basename-guard against traversal anyway. Throws when the blob is gone. */
export function readUpload(storagePath: string): Promise<Buffer> {
  return readFile(path.join(UPLOAD_DIR, path.basename(storagePath)));
}
