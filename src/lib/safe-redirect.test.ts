import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/users")).toBe("/users");
    expect(safeNextPath("/audit?action=user.invited")).toBe("/audit?action=user.invited");
  });

  it("refuses anything that could leave the site or loop", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "users",
      "/login",
      "/set-password?token=x",
      "/ok\nSet-Cookie: x",
      "",
      undefined,
      42,
    ]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
