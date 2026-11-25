import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for Vercel Blob: tests never reach the real store.
const blobs = new Map<string, Uint8Array>();
const deleted: string[] = [];

vi.mock("@vercel/blob", () => {
  class BlobNotFoundError extends Error {}
  return {
    BlobNotFoundError,
    head: async (p: string) => {
      const b = blobs.get(p);
      if (!b) throw new BlobNotFoundError("not found");
      return { size: b.byteLength, uploadedAt: new Date() };
    },
    get: async (p: string, o: { access: string }) => {
      expect(o.access).toBe("private");
      const b = blobs.get(p);
      return b ? { statusCode: 200, stream: new Response(new Uint8Array(b)).body } : null;
    },
    del: async (p: string | string[]) => {
      for (const x of [p].flat()) {
        deleted.push(x);
        blobs.delete(x);
      }
    },
    list: async () => ({ blobs: [], hasMore: false }),
  };
});

const { incomingPrefix, isOwnIncoming, takeIncoming } = await import("./incoming");

const me = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";

describe("isOwnIncoming", () => {
  it("accepts only one random name in the person's own folder", () => {
    expect(isOwnIncoming(`${incomingPrefix(me)}${id}`, me)).toBe(true);
    expect(isOwnIncoming(`${incomingPrefix(other)}${id}`, me)).toBe(false);
    expect(isOwnIncoming(`${incomingPrefix(me)}${id}/../x`, me)).toBe(false);
    expect(isOwnIncoming(`sha256/ab/cd/${"a".repeat(64)}`, me)).toBe(false);
    expect(isOwnIncoming(`${incomingPrefix(me)}report.pdf`, me)).toBe(false);
    expect(isOwnIncoming(42, me)).toBe(false);
  });
});

describe("takeIncoming", () => {
  beforeEach(() => {
    blobs.clear();
    deleted.length = 0;
  });

  it("returns the bytes and deletes the incoming copy", async () => {
    const p = `${incomingPrefix(me)}${id}`;
    blobs.set(p, new Uint8Array([1, 2, 3]));
    const got = await takeIncoming("t", p, 10);
    expect(got).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    expect(deleted).toEqual([p]);
  });

  it("refuses a file over the limit without reading it, and still deletes it", async () => {
    const p = `${incomingPrefix(me)}${id}`;
    blobs.set(p, new Uint8Array(11));
    expect(await takeIncoming("t", p, 10)).toEqual({ ok: false, reason: "too_large" });
    expect(deleted).toEqual([p]);
  });

  it("says when nothing arrived", async () => {
    expect(await takeIncoming("t", `${incomingPrefix(me)}${id}`, 10)).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});
