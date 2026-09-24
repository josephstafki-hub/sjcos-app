// Register lib/worker/node-hooks.mjs once and import app modules by repo path.
//   import { importApp, loadEnvFile } from "../lib/worker/load-app.mjs";
//   const voice = await importApp("lib/voice.ts");
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let registered = false;

export function registerAppHooks() {
  if (registered) return;
  register(pathToFileURL(path.join(REPO_ROOT, "lib", "worker", "node-hooks.mjs")).href, import.meta.url);
  registered = true;
}

export async function importApp(relPath) {
  registerAppHooks();
  return import(pathToFileURL(path.join(REPO_ROOT, relPath)).href);
}

/** Load KEY=value lines from an env file into process.env (no overwrite).
 *  Next.js does this itself; standalone scripts need it. Never logs values. */
export function loadEnvFile(file = process.env.SJCOS_ENV ?? path.join(REPO_ROOT, ".env.local")) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { file, loaded: 0 };
  }
  let loaded = 0;
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    loaded++;
  }
  return { file, loaded };
}
