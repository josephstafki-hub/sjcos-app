// Module customization hooks so a plain `node` process (the worker, the
// backup script's alert path) can import the app's server-side TypeScript:
//   • "@/x"        → <repo>/x(.ts|.tsx|.js|/index.ts)
//   • "server-only" → the package's empty react-server build (a marker, not code)
//   • extensionless relative imports inside lib/ → .ts resolution
// Next.js never sees this file. Register with lib/worker/load-app.mjs.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.js"];

function resolveFile(base) {
  for (const e of EXTS) {
    const p = base + e;
    if (existsSync(p) && !p.endsWith(path.sep)) return p;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: pathToFileURL(path.join(ROOT, "node_modules", "server-only", "empty.js")).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const f = resolveFile(path.join(ROOT, specifier.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!existsSync(base) || !path.extname(base)) {
      const f = resolveFile(base);
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
