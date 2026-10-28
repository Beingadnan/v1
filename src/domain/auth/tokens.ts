import { createHash, randomBytes } from "node:crypto";

/**
 * Random, unguessable tokens for session cookies and one-time account links.
 * 32 bytes = 256 bits of entropy. Only the SHA-256 of a token is stored, so a
 * copy of the database cannot be used to sign in.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before touching the database with an attacker-supplied value. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
