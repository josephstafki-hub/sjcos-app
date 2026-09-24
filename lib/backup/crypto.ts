// Artifact encryption for backups. Prefers `age` with a recipient
// (BACKUP_AGE_RECIPIENT / BACKUP_AGE_IDENTITY for restore) when the binary is
// present, otherwise OpenSSL AES-256-CBC with PBKDF2 from BACKUP_PASSPHRASE.
// The passphrase is read from the environment only (never argv, never git).
// Pure module over child_process; no app imports.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export type Cipher = { kind: "age"; recipient: string; identityFile?: string } | { kind: "openssl"; passphraseEnv: string };

export function hasBinary(name: string): boolean {
  const r = spawnSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" });
  return r.status === 0;
}

/** Choose a cipher from the environment. Throws with a plain reason when
 *  nothing usable is configured (the backup then records a failed run). */
export function cipherFromEnv(env: NodeJS.ProcessEnv = process.env): Cipher {
  const recipient = (env.BACKUP_AGE_RECIPIENT ?? "").trim();
  if (recipient && hasBinary("age")) return { kind: "age", recipient, identityFile: env.BACKUP_AGE_IDENTITY?.trim() || undefined };
  if ((env.BACKUP_PASSPHRASE ?? "").length >= 16) return { kind: "openssl", passphraseEnv: "BACKUP_PASSPHRASE" };
  throw new Error("no backup encryption configured: set BACKUP_PASSPHRASE (16+ chars) or BACKUP_AGE_RECIPIENT (+ age binary)");
}

export function encryptFile(c: Cipher, input: string, output: string): void {
  if (c.kind === "age") execFileSync("age", ["-r", c.recipient, "-o", output, input], { stdio: "pipe" });
  else execFileSync("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-in", input, "-out", output, "-pass", `env:${c.passphraseEnv}`], { stdio: "pipe" });
}

export function decryptFile(c: Cipher, input: string, output: string): void {
  if (c.kind === "age") {
    if (!c.identityFile) throw new Error("BACKUP_AGE_IDENTITY is required to decrypt an age-encrypted backup");
    execFileSync("age", ["-d", "-i", c.identityFile, "-o", output, input], { stdio: "pipe" });
  } else execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", input, "-out", output, "-pass", `env:${c.passphraseEnv}`], { stdio: "pipe" });
}

export function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

export function fileSize(p: string): number {
  return statSync(p).size;
}

export const ARTIFACT_EXT = { age: ".age", openssl: ".enc" } as const;
