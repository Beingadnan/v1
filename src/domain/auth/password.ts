import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Password hashing with scrypt (Node's built-in implementation).
 * Parameters follow OWASP's recommendation: N=2^17, r=8, p=1 (128 MiB, ~0.3 s).
 * The parameters are stored with each hash, so they can be raised later and
 * old hashes still verify.
 *
 * Stored format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 */
const DEFAULT_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

function scrypt(password: string, salt: Buffer, params: { N: number; r: number; p: number }) {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    // scrypt needs 128 * N * r bytes; allow that plus headroom.
    maxmem: 128 * params.N * params.r + 16 * 1024 * 1024,
  };
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(
  password: string,
  params: { N: number; r: number; p: number } = DEFAULT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, params);
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(hashB64 ?? "", "base64");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(saltB64 ?? "", "base64"), params);
  return timingSafeEqual(actual, expected);
}

/** True when a stored hash uses weaker parameters than today's default and should be re-hashed. */
export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split("$");
  return (
    Number(n) < DEFAULT_PARAMS.N || Number(r) < DEFAULT_PARAMS.r || Number(p) < DEFAULT_PARAMS.p
  );
}

// A short list of the most common choices; length rules do most of the work.
const COMMON_PASSWORDS = new Set([
  "password1234",
  "123456789012",
  "qwertyuiop12",
  "qatech123456",
  "welcome12345",
  "adminadmin12",
  "passwordpassword",
]);

/**
 * Rules follow NIST SP 800-63B: length over complexity, no forced symbols,
 * refuse obvious choices. Returns a plain message, or null when acceptable.
 */
export function checkPasswordStrength(password: string, context: { email: string; name: string }) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters. A short sentence works well.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) {
    return "This password is too easy to guess. Choose something less common.";
  }
  const emailName = context.email.split("@")[0]?.toLowerCase() ?? "";
  if (emailName.length >= 4 && lower.includes(emailName)) {
    return "Don't include your email address in your password.";
  }
  const nameParts = context.name
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 4);
  if (nameParts.some((part) => lower.includes(part))) {
    return "Don't include your name in your password.";
  }
  return null;
}
