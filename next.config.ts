import type { NextConfig } from "next";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true, // proxy preserves /consult/ for its scoped offline worker
  async headers(){return [{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/consult/'}]},{source:'/api/consult/:path*',headers:[{key:'Cache-Control',value:'no-store'}]}];},
  // The live server (systemd `sjcos.service`) serves the prebuilt `.next`, and
  // a dev/build run that shares that directory clobbers it mid-flight — the
  // classic "half-built .next → dead hydration" failure. Setting SJC_DIST_DIR
  // lets a throwaway preview server build into its own directory instead, so
  // production stays untouched:
  //   SJC_DIST_DIR=.next-preview npx next dev --port 3018
  distDir: process.env.SJC_DIST_DIR || ".next",
  // A staged build (SJC_DIST_DIR=.next-staged, deploy/promote-staged-build.sh)
  // must not type-check the RUNNING build's generated route types in .next/
  // or a stale preview's: they still list any page the new code removed, and
  // the build fails on "Cannot find module app/…/page.js" (removing /automate,
  // 2026-10-17). tsconfig.staged.json reads only its own dist's types.
  typescript: process.env.SJC_DIST_DIR === ".next-staged" ? { tsconfigPath: "tsconfig.staged.json" } : undefined,
  // Joe previews remotely through an ephemeral cloudflared tunnel, which is a
  // different origin than localhost. Next 16 dev otherwise blocks the browser
  // from loading /_next/* dev resources (the client JS chunks) cross-origin,
  // which silently breaks hydration. Allow the tunnel host(s). Only affects
  // `next dev`; production (`next start`) has no such restriction.
  allowedDevOrigins: [
    "sophisticated-soundtrack-welfare-cape.trycloudflare.com",
    "*.trycloudflare.com",
    // Local portal-demo runs: the browser may land on 127.0.0.1 or the LAN IP
    // instead of localhost; without these, dev hydration breaks and every
    // server action (login included) fails with "Failed to fetch".
    "127.0.0.1",
    "10.0.0.174",
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

/**
 * The in-home consultation offline shell (public/consult/assets/capture.{js,css} +
 * public/consult/precache.json) is generated at the start of every production build,
 * so "Ready offline" always matches the code being deployed. Once per build (Next
 * re-evaluates this file in worker processes); SJC_SKIP_CONSULT_CAPTURE=1 skips it.
 * Details: scripts/build-consult-capture.mjs.
 */
export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.SJC_SKIP_CONSULT_CAPTURE && !process.env.__SJC_CONSULT_CAPTURE_BUILT) {
    // Run as its own Node process: Next compiles this file to CommonJS, where a
    // dynamic import() of an .mjs file URL becomes a failing require().
    execFileSync(process.execPath, [path.join(process.cwd(), "scripts/build-consult-capture.mjs")], { stdio: "inherit" });
    process.env.__SJC_CONSULT_CAPTURE_BUILT = "1";
  }
  return nextConfig;
}
