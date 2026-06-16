import "server-only";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Password hashing via Node's built-in scrypt — no external dependency.
// Stored format: "<saltHex>:<derivedKeyHex>". scrypt is deliberately slow, so
// each call is ~tens of ms; that's fine for interactive login.

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

/** Hash a plaintext password into a "<salt>:<hash>" string for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** Constant-time compare a plaintext password against a stored "<salt>:<hash>". */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
