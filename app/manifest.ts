import type { MetadataRoute } from "next";

/**
 * PWA manifest — lets Joe install SJC OS to the phone home screen ("Add to
 * Home Screen") so it launches fullscreen with the SJ Carpentry mark instead
 * of as a browser tab. No app store, no build step: the installed shell just
 * loads the live site, so deploys reach the phone immediately.
 *
 * Note: `proxy.ts` must keep /manifest.webmanifest public — the browser
 * requests it without cookies.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SJC OS — SJ Carpentry",
    short_name: "SJC OS",
    description:
      "Business operating system for SJ Carpentry LLC — jobs, leads, schedule, inbox, and money in one place.",
    // Launch straight into the operator console rather than "/", which only
    // redirects. Signed-out installs still land on /login via the proxy.
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#F1ECE1", // paper — matches the app shell on cold start
    theme_color: "#283021", // forest — tints the status/title bar
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
