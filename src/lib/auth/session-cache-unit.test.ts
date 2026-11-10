import { describe, expect, it, vi } from "vitest";

import { TTL_MS, forgetSessions, rememberedSession } from "./session-cache";

describe("rememberedSession", () => {
  it("checks the database once per token within a few seconds", async () => {
    forgetSessions();
    const load = vi.fn(async () => ({ user: "u1" }));
    const t = 1_000_000;
    expect(await rememberedSession("tok-a", load, t)).toEqual({ user: "u1" });
    expect(await rememberedSession("tok-a", load, t + TTL_MS - 1)).toEqual({ user: "u1" });
    expect(load).toHaveBeenCalledTimes(1);
    await rememberedSession("tok-a", load, t + TTL_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never remembers a missing or invalid session, and forgets on sign-out", async () => {
    forgetSessions();
    const none = vi.fn(async () => null);
    expect(await rememberedSession("tok-b", none, 1)).toBeNull();
    expect(await rememberedSession("tok-b", none, 2)).toBeNull();
    expect(none).toHaveBeenCalledTimes(2);
    expect(await rememberedSession(undefined, none, 3)).toBeNull();

    const load = vi.fn(async () => ({ user: "u2" }));
    await rememberedSession("tok-c", load, 10);
    forgetSessions();
    await rememberedSession("tok-c", load, 11);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
