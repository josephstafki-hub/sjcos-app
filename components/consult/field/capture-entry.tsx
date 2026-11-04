/**
 * Offline capture bundle entry (built to public/consult/assets/capture.js by
 * scripts/build-consult-capture.mjs). Mounted by the data-free shell
 * public/consult/offline.html on #consult-root when a /consult/ navigation has no
 * signal. Holds no client data: everything is read after the visitor's PIN unlocks
 * the encrypted IndexedDB partition. Online, the Next page renders the same
 * ConsultApp with a server boot instead.
 */
import { createRoot } from "react-dom/client";
import { ConsultApp } from "./ConsultApp";
import { VisitList } from "./VisitList";

const root = document.getElementById("consult-root");
if (root) {
  const match = /^\/consult\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
  root.className = "";
  createRoot(root).render(match ? <ConsultApp boot={null} consultId={match[1].toLowerCase()} /> : <div className="consult-root min-h-dvh bg-paper text-ink"><VisitList visits={null} /></div>);
}
