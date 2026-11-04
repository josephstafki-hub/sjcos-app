import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./consult.css";

// Full-screen field tool outside the (os) shell (plan §4). The service worker is
// registered by Get ready with scope /consult/ (lib/consult/service-worker.ts),
// never here, so opening a visit never caches anything by itself.
export const metadata: Metadata = { title: "In-home consultation · SJC OS" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#283021" };

export default function ConsultLayout({ children }: { children: ReactNode }) {
  return children;
}
