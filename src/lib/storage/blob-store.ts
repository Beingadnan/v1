import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Where file bytes live. Files are content-addressed: the key is derived from
 * the SHA-256 of the content, so the same bytes always get the same key and an
 * existing file is never overwritten.
 *
 * Local disk is used for development and single-server setups; Vercel Blob
 * when its token is set (vercel-blob-store.ts, ADR 0019).
 */
export interface BlobStore {
  /** Store bytes under their hash. Returns false when identical content was already stored. */
  put(sha256: string, bytes: Uint8Array): Promise<{ key: string; created: boolean }>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function keyForHash(sha256: string): string {
  if (!SHA256_HEX.test(sha256)) throw new Error("Invalid SHA-256 hex digest");
  return `sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export class LocalBlobStore implements BlobStore {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** Keys are validated against a strict pattern, so no path can escape the root. */
  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
    return path.join(this.root, ...key.split("/"));
  }

  async put(sha256: string, bytes: Uint8Array): Promise<{ key: string; created: boolean }> {
    if (sha256Hex(bytes) !== sha256) {
      throw new Error("Content does not match the provided SHA-256; refusing to store");
    }
    const key = keyForHash(sha256);
    const finalPath = this.pathFor(key);
    if (await this.exists(key)) return { key, created: false };

    await mkdir(path.dirname(finalPath), { recursive: true });
    // Write to a unique temp file, flush it, then rename into place, so a crash
    // never leaves a half-written file under a real key.
    const tempPath = `${finalPath}.${randomUUID()}.tmp`;
    const handle = await open(tempPath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (await this.exists(key)) return { key, created: false }; // lost a race to identical bytes
      await rename(tempPath, finalPath);
      return { key, created: true };
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
