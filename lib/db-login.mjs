// Which Postgres login a process connects with (deploy/db-roles.md).
//
//   owner    DATABASE_URL           the website + Joe's own panel runs (sjcos, owns everything)
//   agent    DATABASE_URL_AGENT     MCP server, business-agent runs, staff panel turns
//   worker   DATABASE_URL_WORKER    scripts/sjcos-worker.mjs (dispatch, Square, Telnyx, e-sign, wakeups)
//   readonly DATABASE_URL_READONLY  the monitor
//   backup   DATABASE_URL_BACKUP    pg_dump in scripts/backup.mjs
//
// Every narrow login falls back to DATABASE_URL while its own line is missing,
// so nothing breaks before Joe applies the roles. Precedence for a narrow login:
//   1. process env <KEY>            (set explicitly, or loaded from .env.local by Next / loadEnvFile)
//   2. process env DATABASE_URL     (a caller pointing this process at a specific database:
//                                    the test harness, evals, `--url`; never the file's master)
//   3. .env.local <KEY>
//   4. .env.local DATABASE_URL      (fallback before the apply)
// A process whose env came from .env.local carries both keys, so (1) wins there;
// a process with a bare env (systemd units, business runs, Hermes / terminal
// stdio spawns) reads the file, where the narrow line beats the master one.
//
// Pure module: no db, no server-only. Plain .mjs so the MCP server, scripts and
// Next code can all import it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const LOGIN_KEYS = Object.freeze({
  owner: "DATABASE_URL",
  agent: "DATABASE_URL_AGENT",
  worker: "DATABASE_URL_WORKER",
  readonly: "DATABASE_URL_READONLY",
  backup: "DATABASE_URL_BACKUP",
});

/** Postgres role each login is expected to be (owner = whatever DATABASE_URL names). */
export const LOGIN_ROLES = Object.freeze({
  agent: "sjcos_agent",
  worker: "sjcos_worker",
  readonly: "sjcos_readonly",
  backup: "sjcos_backup",
});

function readEnvFile(file) {
  try {
    const out = {};
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
    return out;
  } catch {
    return {};
  }
}

/** The login the MCP server should use: "owner" ONLY when the launcher said so
 *  (scripts/run-claude-agent.mjs sets SJC_DB_LOGIN=owner for Joe's own
 *  operator runs). Anything else — unset, a typo, "agent" — is the narrow login. */
export function mcpLogin(env = process.env) {
  return env.SJC_DB_LOGIN === "owner" ? "owner" : "agent";
}

/**
 * Connection string for a login.
 *   login    owner | agent | worker | readonly | backup
 *   env      process env (default process.env)
 *   envFile  .env.local path (default <repo>/.env.local, or SJCOS_ENV)
 * Returns { url, key, fallback } — fallback=true when a narrow login used the
 * master URL because its own line is not set yet. Throws when nothing is set.
 */
export function resolveDatabaseUrl(login, { env = process.env, envFile } = {}) {
  const key = LOGIN_KEYS[login];
  if (!key) throw new Error(`unknown database login "${login}"`);
  const file = readEnvFile(envFile ?? env.SJCOS_ENV ?? path.join(REPO_ROOT, ".env.local"));
  const pick = (...cands) => cands.find(([, v]) => typeof v === "string" && v.trim() !== "");
  const hit =
    login === "owner"
      ? pick(["DATABASE_URL", env.DATABASE_URL], ["DATABASE_URL", file.DATABASE_URL])
      : pick([key, env[key]], ["DATABASE_URL", env.DATABASE_URL], [key, file[key]], ["DATABASE_URL", file.DATABASE_URL]);
  if (!hit) throw new Error(`${key} not found (env or .env.local)`);
  return { url: hit[1].trim(), key: hit[0], fallback: login !== "owner" && hit[0] === "DATABASE_URL" };
}

/** Just the URL. */
export function databaseUrlFor(login, opts) {
  return resolveDatabaseUrl(login, opts).url;
}
