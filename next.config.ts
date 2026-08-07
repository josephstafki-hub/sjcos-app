import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The live server (systemd `sjcos.service`) serves the prebuilt `.next`, and
  // a dev/build run that shares that directory clobbers it mid-flight — the
  // classic "half-built .next → dead hydration" failure. Setting SJC_DIST_DIR
  // lets a throwaway preview server build into its own directory instead, so
  // production stays untouched:
  //   SJC_DIST_DIR=.next-preview npx next dev --port 3018
  distDir: process.env.SJC_DIST_DIR || ".next",
  // Joe previews remotely through an ephemeral cloudflared tunnel, which is a
  // different origin than localhost. Next 16 dev otherwise blocks the browser
  // from loading /_next/* dev resources (the client JS chunks) cross-origin,
  // which silently breaks hydration. Allow the tunnel host(s). Only affects
  // `next dev`; production (`next start`) has no such restriction.
  allowedDevOrigins: [
    "sophisticated-soundtrack-welfare-cape.trycloudflare.com",
    "*.trycloudflare.com",
  ],
  // /files uploads go through a Server Action; the default request body cap is
  // 1MB, too small for job photos / scanned PDFs. Raise it for real uploads.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
    // `proxy.ts` runs on nearly every route, and Next buffers a *clone* of the
    // request body so both proxy and the route can read it — capped separately
    // at 10MB by default. That cap bites first: a 10MB+ upload gets silently
    // truncated mid-multipart, the Server Action's form parser dies on
    // "Unexpected end of form", and the page throws before storeUpload's own
    // friendly size check ever runs. Keep this in step with bodySizeLimit
    // above, with MAX_BYTES in lib/upload-store.ts, and under nginx's
    // `client_max_body_size 30M` (/etc/nginx/sites-available/sjcos).
    proxyClientMaxBodySize: "25mb",
  },
  // pdfkit reads its standard-14 .afm font metrics from its own package dir at
  // runtime; bundling it breaks that fs lookup. Keep it external so contract/SOW
  // PDF generation (lib/documents.ts) works under `next start`.
  // sharp is a native (libvips) binding — bundling it breaks the .node lookup.
  // Used by lib/newsletter-image.ts to downscale newsletter photos.
  serverExternalPackages: ["pdfkit", "sharp"],
};

export default nextConfig;
