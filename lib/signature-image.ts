// Drawn-signature image handling shared by the portal sign action and the
// in-person sign action. Plain TS on purpose (no server-only import) so the
// node test runner can exercise the parser directly.
//
// The browser pad (components/esign/SignaturePad.tsx) exports a PNG data URL.
// The server never trusts it blindly: it must be a real PNG (magic bytes), a
// sane size, and decode cleanly — otherwise the sign is refused with a clear
// message rather than storing junk against a legal record.

export const SIGNATURE_PNG_MAX_BYTES = 600 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL_PREFIX = /^data:image\/png;base64,/i;

export type SignatureImageResult =
  | { ok: true; png: Buffer }
  | { ok: false; error: string };

/** Turn the pad's data URL into PNG bytes, or say precisely why not. An empty
 *  / missing value is `{ ok: true, png }`-less — callers decide whether a
 *  drawn signature is required (in person: yes; portal: optional). */
export function parseSignatureDataUrl(raw: unknown): SignatureImageResult | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (!DATA_URL_PREFIX.test(s)) return { ok: false, error: "The signature image isn't a PNG." };
  const b64 = s.replace(DATA_URL_PREFIX, "");
  // 4 base64 chars → 3 bytes; refuse before decoding something huge.
  if (b64.length > Math.ceil((SIGNATURE_PNG_MAX_BYTES * 4) / 3) + 4) {
    return { ok: false, error: "The signature image is too large — clear the pad and sign again." };
  }
  let png: Buffer;
  try {
    png = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, error: "The signature image couldn't be read." };
  }
  if (png.length < PNG_MAGIC.length + 16 || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return { ok: false, error: "The signature image isn't a valid PNG." };
  }
  if (png.length > SIGNATURE_PNG_MAX_BYTES) {
    return { ok: false, error: "The signature image is too large — clear the pad and sign again." };
  }
  return { ok: true, png };
}

/** Pixel size from the IHDR chunk (first chunk after the 8-byte signature). */
export function pngDimensions(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24) return null;
  if (png.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
