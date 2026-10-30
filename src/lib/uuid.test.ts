import { describe, expect, it, vi } from "vitest";

import { newId } from "./uuid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("makes v4 UUIDs, also without crypto.randomUUID", () => {
    expect(newId()).toMatch(UUID);
    const spy = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("insecure context");
    });
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    spy.mockRestore();
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});
