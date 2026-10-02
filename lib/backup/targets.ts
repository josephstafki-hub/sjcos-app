// Pluggable off-host destinations for backup sets (A09a). Exactly one is
// chosen from the environment, in this order:
//   BACKUP_RCLONE_REMOTE  "remote:bucket/path"        → rclone copy / lsjson / purge
//   BACKUP_SSH_TARGET     "user@host:/path"           → rsync (or scp) / ssh ls / ssh rm
//   BACKUP_DIR            "/mnt/backup-drive/sjcos"   → mounted path (a USB drive or
//                                                        network mount counts as off-box
//                                                        only if it really is one)
// None configured → targetFromEnv() returns null and the backup FAILS loudly.
// Pure over child_process/fs; no app imports.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export interface BackupTarget {
  /** Human label stored on backup_runs.destination. */
  label: string;
  kind: "rclone" | "ssh" | "dir";
  /** Copy a whole set directory (named by its stamp) to the destination. */
  upload(setDir: string, setName: string): void;
  /** Names of sets present at the destination (null = listing unsupported). */
  list(): string[] | null;
  /** Remove one set at the destination. */
  remove(setName: string): void;
  /** Fetch a set back into `into/<setName>` (restore path). */
  download(setName: string, into: string): string;
}

export function targetFromEnv(env: NodeJS.ProcessEnv = process.env): BackupTarget | null {
  const rc = (env.BACKUP_RCLONE_REMOTE ?? "").trim();
  if (rc) return rcloneTarget(rc);
  const ssh = (env.BACKUP_SSH_TARGET ?? "").trim();
  if (ssh) return sshTarget(ssh);
  const dir = (env.BACKUP_DIR ?? "").trim();
  if (dir) return dirTarget(dir);
  return null;
}

export function dirTarget(root: string): BackupTarget {
  return {
    label: `dir:${root}`,
    kind: "dir",
    upload(setDir, setName) {
      if (!existsSync(root)) throw new Error(`BACKUP_DIR ${root} does not exist (drive not mounted?)`);
      const dest = path.join(root, setName);
      mkdirSync(dest, { recursive: true });
      cpSync(setDir, dest, { recursive: true });
    },
    list() {
      if (!existsSync(root)) return [];
      return readdirSync(root).filter((n) => statSync(path.join(root, n)).isDirectory());
    },
    remove(setName) {
      rmSync(path.join(root, setName), { recursive: true, force: true });
    },
    download(setName, into) {
      const dest = path.join(into, setName);
      cpSync(path.join(root, setName), dest, { recursive: true });
      return dest;
    },
  };
}

export function rcloneTarget(remote: string): BackupTarget {
  const base = remote.replace(/\/$/, "");
  return {
    label: `rclone:${base}`,
    kind: "rclone",
    upload(setDir, setName) {
      execFileSync("rclone", ["copy", "--checksum", setDir, `${base}/${setName}`], { stdio: "pipe" });
    },
    list() {
      const r = spawnSync("rclone", ["lsjson", "--dirs-only", base], { encoding: "utf8" });
      if (r.status !== 0) return null;
      try {
        return (JSON.parse(r.stdout) as { Name: string; IsDir: boolean }[]).filter((e) => e.IsDir).map((e) => e.Name);
      } catch {
        return null;
      }
    },
    remove(setName) {
      execFileSync("rclone", ["purge", `${base}/${setName}`], { stdio: "pipe" });
    },
    download(setName, into) {
      const dest = path.join(into, setName);
      execFileSync("rclone", ["copy", `${base}/${setName}`, dest], { stdio: "pipe" });
      return dest;
    },
  };
}

export function sshTarget(spec: string): BackupTarget {
  const m = /^([^:]+):(.+)$/.exec(spec);
  if (!m) throw new Error(`BACKUP_SSH_TARGET must look like user@host:/path (got ${spec})`);
  const host = m[1];
  const root = m[2].replace(/\/$/, "");
  const hasRsync = spawnSync("sh", ["-c", "command -v rsync"], { stdio: "ignore" }).status === 0;
  return {
    label: `ssh:${host}:${root}`,
    kind: "ssh",
    upload(setDir, setName) {
      execFileSync("ssh", ["-o", "BatchMode=yes", host, "mkdir", "-p", `${root}/${setName}`], { stdio: "pipe" });
      if (hasRsync) execFileSync("rsync", ["-a", "--checksum", `${setDir}/`, `${host}:${root}/${setName}/`], { stdio: "pipe" });
      else execFileSync("scp", ["-o", "BatchMode=yes", "-r", `${setDir}/.`, `${host}:${root}/${setName}/`], { stdio: "pipe" });
    },
    list() {
      const r = spawnSync("ssh", ["-o", "BatchMode=yes", host, "ls", "-1", root], { encoding: "utf8" });
      if (r.status !== 0) return null;
      return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    },
    remove(setName) {
      if (!/^[0-9TZ-]+(-db)?$/.test(setName)) throw new Error(`refusing to delete non-set name ${setName}`);
      execFileSync("ssh", ["-o", "BatchMode=yes", host, "rm", "-rf", `${root}/${setName}`], { stdio: "pipe" });
    },
    download(setName, into) {
      const dest = path.join(into, setName);
      mkdirSync(dest, { recursive: true });
      if (hasRsync) execFileSync("rsync", ["-a", `${host}:${root}/${setName}/`, `${dest}/`], { stdio: "pipe" });
      else execFileSync("scp", ["-o", "BatchMode=yes", "-r", `${host}:${root}/${setName}/.`, `${dest}/`], { stdio: "pipe" });
      return dest;
    },
  };
}
