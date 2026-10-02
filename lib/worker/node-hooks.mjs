// Module customization hooks so a plain `node` process (the worker, the
// backup script's alert path) can import the app's server-side TypeScript:
//   • "@/x"        → <repo>/x(.ts|.tsx|.js|/index.ts)
//   • "server-only" → the package's empty react-server build (a marker, not code)
//   • extensionless relative imports inside lib/ → .ts resolution
//   • a directory import ("@/lib/providers") → its index.ts
//   • next/cache, next/navigation, next/server, next/headers → inert stand-ins:
//     outside a Next request there is no cache to revalidate and no response to
//     defer, so revalidatePath() is a no-op and after(fn) runs fn right away.
// Next.js never sees this file. Register with lib/worker/load-app.mjs.
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.js"];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveFile(base) {
  for (const e of EXTS) {
    const p = base + e;
    if (isFile(p)) return p;
  }
  return null;
}

const NEXT_STUBS = {
  "next/cache": `export const revalidatePath = () => {}; export const revalidateTag = () => {}; export const unstable_cache = (fn) => fn; export const unstable_noStore = () => {};`,
  "next/navigation": `export const unstable_rethrow = () => {}; export const redirect = (to) => { throw new Error("redirect(" + to + ") outside a Next request"); }; export const notFound = () => { throw new Error("notFound() outside a Next request"); }; export const permanentRedirect = redirect;`,
  "next/server": `export const after = (fn) => { Promise.resolve().then(() => (typeof fn === "function" ? fn() : fn)).catch((e) => console.error("[worker] after() task failed:", e?.message ?? e)); }; export const NextResponse = { json: (body, init) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } }) };`,
  "next/headers": `const none = { get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }; export const cookies = async () => none; export const headers = async () => none;`,
};
const STUB_PREFIX = "sjc-next-stub:";

export async function resolve(specifier, context, next) {
  if (Object.hasOwn(NEXT_STUBS, specifier)) return { url: STUB_PREFIX + specifier, shortCircuit: true };
  if (specifier === "server-only") {
    return { url: pathToFileURL(path.join(ROOT, "node_modules", "server-only", "empty.js")).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const f = resolveFile(path.join(ROOT, specifier.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!isFile(base)) {
      const f = resolveFile(base);
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith(STUB_PREFIX)) return { format: "module", source: NEXT_STUBS[url.slice(STUB_PREFIX.length)], shortCircuit: true };
  return next(url, context);
}
