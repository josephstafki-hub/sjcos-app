import { query } from "@/lib/db";

// GET /api/newsletter/open/[token] — the 1×1 open-tracking pixel embedded in a
// released newsletter/greeting email (P2-5). Deliberately unauthenticated: the
// recipient's mail client fetches it. Records a best-effort open on the outbox
// row, then always returns the transparent GIF (a token miss never 404-leaks).
// Opens are approximate — image-proxy prefetch (e.g. Apple Mail) can inflate them.
export const dynamic = "force-dynamic";

// Transparent 1×1 GIF (GIF89a).
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token) {
    try {
      await query(
        `UPDATE newsletter_outbox
            SET open_count = open_count + 1, opened_at = COALESCE(opened_at, now())
          WHERE track_token = $1`,
        [token.slice(0, 80)],
      );
    } catch {
      /* never fail the pixel on a tracking hiccup */
    }
  }
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
