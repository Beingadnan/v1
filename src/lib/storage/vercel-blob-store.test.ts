import { beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "./blob-store";

// An in-memory stand-in for the Vercel Blob API: the store is never reached from tests.
const stored = new Map<string, { bytes: Buffer; access: string }>();
const calls: { op: string; token: string | undefined }[] = [];

vi.mock("@vercel/blob", () => {
  class BlobNotFoundError extends Error {}
  return {
    BlobNotFoundError,
    head: async (key: string, o: { token?: string }) => {
      calls.push({ op: "head", token: o.token });
      if (!stored.has(key)) throw new BlobNotFoundError("not found");
      return { pathname: key };
    },
    put: async (
      key: string,
      body: Buffer,
      o: { access: string; allowOverwrite?: boolean; addRandomSuffix?: boolean; token?: string },
    ) => {
      calls.push({ op: "put", token: o.token });
      if (stored.has(key) && !o.allowOverwrite) throw new Error("This blob already exists");
      expect(o.addRandomSuffix).toBe(false);
      stored.set(key, { bytes: Buffer.from(body), access: o.access });
      return { pathname: key };
    },
    get: async (key: string, o: { access: string; token?: string }) => {
      calls.push({ op: "get", token: o.token });
      const b = stored.get(key);
      if (!b) return null;
      expect(o.access).toBe(b.access);
      return { statusCode: 200, stream: new Response(new Uint8Array(b.bytes)).body };
    },
  };
});

const { VercelBlobStore } = await import("./vercel-blob-store");

const content = new TextEncoder().encode("Date,Time,62281257\n22.05.2026,22:30:00,-22.2\n");

describe("VercelBlobStore", () => {
  beforeEach(() => {
    stored.clear();
    calls.length = 0;
  });

  it("stores private, under the same content-hash key as on disk, and reads it back", async () => {
    const store = new VercelBlobStore("tok");
    const hash = sha256Hex(content);
    const { key, created } = await store.put(hash, content);
    expect(created).toBe(true);
    expect(key).toBe(`sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`);
    expect(stored.get(key)!.access).toBe("private");
    expect(new Uint8Array(await store.get(key))).toEqual(content);
    expect(calls.every((c) => c.token === "tok")).toBe(true);
  });

  it("doesn't upload the same bytes twice", async () => {
    const store = new VercelBlobStore("tok");
    const hash = sha256Hex(content);
    await store.put(hash, content);
    expect((await store.put(hash, content)).created).toBe(false);
    expect(calls.filter((c) => c.op === "put")).toHaveLength(1);
  });

  it("refuses bytes that don't match their hash, and keys outside the pattern", async () => {
    const store = new VercelBlobStore("tok");
    await expect(store.put("0".repeat(64), content)).rejects.toThrow("does not match");
    await expect(store.get("../etc/passwd")).rejects.toThrow("Invalid storage key");
    expect(await store.exists(`sha256/aa/bb/${"a".repeat(64)}`)).toBe(false);
  });
});
