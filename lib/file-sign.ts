import { createHmac, timingSafeEqual } from "node:crypto";

// Short-lived signed URLs for /api/files/[id]: lets an MCP agent hand out a
// working link to a file blob (plan PDF, site photo) without a session cookie.
// The key is derived from SESSION_SECRET with a purpose tag so file signatures
// and session cookies can never be replayed against each other.
//
// mcp/bidding-tools.mjs mints the same signature from the same env var — if
// the derivation here changes, change it there too.

function key(): Buffer {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me")
    .update("sjc-file-url-v1")
    .digest();
}

/** Hex signature over one file id + unix-seconds expiry. */
export function fileSignature(id: string, exp: number): string {
  return createHmac("sha256", key()).update(`${id}:${exp}`).digest("hex");
}

export function verifyFileSignature(id: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const want = Buffer.from(fileSignature(id, exp), "hex");
  const got = Buffer.from(String(sig ?? ""), "hex");
  return got.length === want.length && timingSafeEqual(want, got);
}
