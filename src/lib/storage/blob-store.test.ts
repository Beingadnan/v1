import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { keyForHash, LocalBlobStore, sha256Hex } from "./blob-store";

let root: string;
let store: LocalBlobStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "qtech-blobs-"));
  store = new LocalBlobStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const content = new TextEncoder().encode("Date,Time,62281257\n22.05.2026,22:30:00,-22.2\n");

describe("LocalBlobStore", () => {
  it("stores content under its SHA-256 and reads it back unchanged", async () => {
    const hash = sha256Hex(content);
    const { key, created } = await store.put(hash, content);
    expect(created).toBe(true);
    expect(key).toBe(`sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`);
    expect(new Uint8Array(await store.get(key))).toEqual(content);
  });

  it("never overwrites: storing identical content again is a no-op", async () => {
    const hash = sha256Hex(content);
    await store.put(hash, content);
    const second = await store.put(hash, content);
    expect(second.created).toBe(false);
  });

  it("refuses content that does not match the claimed hash", async () => {
    const wrongHash = sha256Hex(new TextEncoder().encode("something else"));
    await expect(store.put(wrongHash, content)).rejects.toThrow(/does not match/);
  });

  it("rejects keys that could escape the storage folder", async () => {
    await expect(store.get("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(store.exists("sha256/../../x")).rejects.toThrow(/Invalid storage key/);
    expect(() => keyForHash("../abc")).toThrow(/Invalid SHA-256/);
  });

  it("handles concurrent writes of the same content and leaves no temp files", async () => {
    const hash = sha256Hex(content);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.put(hash, content)));
    expect(results.some((r) => r.created)).toBe(true);
    const dir = path.join(root, "sha256", hash.slice(0, 2), hash.slice(2, 4));
    expect(await readdir(dir)).toEqual([hash]);
  });
});
