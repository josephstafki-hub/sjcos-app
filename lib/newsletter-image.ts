import "server-only";

// Newsletter photo preparation (P7-N). Downscales and re-encodes an uploaded
// image before it is stored and published.
//
// WHY THIS EXISTS: a newsletter image is fetched once per recipient, by mail
// clients and image proxies on phones and metered connections. A straight-from-
// the-camera photo is 2–6 MB and displays in a 536px-wide column, so ~95% of
// those bytes are shipped for nothing, every time, to every reader. Nothing else
// in the app re-encodes uploads (a job photo in /files is stored as-is, which is
// right — that's the archive copy); this applies only on the newsletter path.
//
// It also STRIPS METADATA, which matters more than the file size: photos taken
// on a phone at a job site carry EXIF GPS coordinates of a client's home. sharp
// drops all metadata unless explicitly asked to keep it, so re-encoding here
// means those coordinates never leave the building. The one EXIF field worth
// honoring is orientation, applied via .rotate() before it's discarded —
// otherwise phone photos arrive sideways.

import sharp from "sharp";

/** The email card's content column is 536px. Cap at ~2× for retina; anything
 *  larger is invisible detail. Images smaller than this are never upscaled. */
const MAX_WIDTH = 1200;
const JPEG_QUALITY = 82;

export interface PreparedImage {
  bytes: Buffer;
  mime: string;
  /** Extension-corrected filename (a re-encoded .png becomes .jpg). */
  filename: string;
  originalBytes: number;
  width: number;
  height: number;
}

function swapExt(name: string, ext: string): string {
  return `${name.replace(/\.[^.]+$/, "")}.${ext}`;
}

/** Downscale, auto-orient and strip metadata. Returns null if the bytes aren't a
 *  decodable image, so the caller can reject with a clear message. */
export async function prepareNewsletterImage(
  input: Buffer,
  filename: string,
): Promise<PreparedImage | null> {
  let img = sharp(input, { failOn: "none" });

  let meta;
  try {
    meta = await img.metadata();
  } catch {
    return null; // not a decodable image
  }
  if (!meta.width || !meta.height) return null;

  // .rotate() with no argument applies the EXIF orientation, then the tag is
  // dropped with the rest of the metadata on re-encode.
  img = img.rotate();
  if (meta.width > MAX_WIDTH) {
    img = img.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }

  // Transparency has to survive: a logo or a cutout re-encoded as JPEG gets a
  // black background. Those keep PNG; photographs become JPEG, which is far
  // smaller for the same visual result.
  const hasAlpha = Boolean(meta.hasAlpha);
  const out = hasAlpha
    ? await img.png({ compressionLevel: 9, palette: true }).toBuffer({ resolveWithObject: true })
    : await img.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  return {
    bytes: out.data,
    mime: hasAlpha ? "image/png" : "image/jpeg",
    filename: swapExt(filename, hasAlpha ? "png" : "jpg"),
    originalBytes: input.length,
    width: out.info.width,
    height: out.info.height,
  };
}
