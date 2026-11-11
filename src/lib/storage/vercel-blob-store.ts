import { BlobNotFoundError, get, head, put } from "@vercel/blob";

import { type BlobStore, keyForHash, sha256Hex } from "./blob-store";

const KEY_PATTERN = /^sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

/**
 * Files in a Vercel Blob store (ADR 0019). Same keys as on local disk
 * (`sha256/ab/cd/<hash>`), stored private: nothing is reachable by URL, the
 * app reads each file with the store's token and serves it after its own
 * permission checks. Content-addressed keys never change, so a cached read is
 * always the right bytes.
 */
export class VercelBlobStore implements BlobStore {
  constructor(private readonly token: string) {}

  private check(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
  }

  async put(sha256: string, bytes: Uint8Array): Promise<{ key: string; created: boolean }> {
    if (sha256Hex(bytes) !== sha256) {
      throw new Error("Content does not match the provided SHA-256; refusing to store");
    }
    const key = keyForHash(sha256);
    if (await this.exists(key)) return { key, created: false };
    try {
      await put(key, Buffer.from(bytes), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/octet-stream",
        token: this.token,
      });
      return { key, created: true };
    } catch (error) {
      // Someone stored the same bytes a moment earlier: that's the same file.
      if (await this.exists(key)) return { key, created: false };
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    this.check(key);
    const r = await get(key, { access: "private", token: this.token });
    if (!r || r.statusCode !== 200) throw new Error(`Stored file not found: ${key}`);
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    this.check(key);
    try {
      await head(key, { token: this.token });
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw error;
    }
  }
}
