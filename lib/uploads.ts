import "server-only";
import path from "node:path";

/** Where uploaded /files blobs live on disk (gitignored, outside the bundle).
 *  Lives in its own module so both the upload Server Action and the download
 *  route handler can import it (a "use server" file may only export functions). */
export const UPLOAD_DIR = path.join(process.cwd(), "uploads");
