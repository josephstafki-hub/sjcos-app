import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  },
};

export default nextConfig;
