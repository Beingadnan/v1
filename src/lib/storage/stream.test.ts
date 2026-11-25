import { describe, expect, it } from "vitest";

import { streamBytes } from "./stream";

describe("streamBytes", () => {
  it("sends every byte, in order, in pieces", async () => {
    const bytes = new Uint8Array(600 * 1024).map((_, i) => i % 251);
    const out = new Uint8Array(await new Response(streamBytes(bytes)).arrayBuffer());
    expect(out).toEqual(bytes);
  });

  it("handles an empty file", async () => {
    const out = await new Response(streamBytes(new Uint8Array())).arrayBuffer();
    expect(out.byteLength).toBe(0);
  });
});
