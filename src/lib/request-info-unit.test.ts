import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { TRUST_PROXY: false } }));

const { clientInfo } = await import("./request-info");

const h = (values: Record<string, string>) => new Headers(values);

describe("clientInfo", () => {
  it("ignores forwarded headers unless told to trust a proxy", () => {
    const info = clientInfo(h({ "x-forwarded-for": "1.2.3.4", "user-agent": "UA" }), {
      onVercel: false,
      trustProxy: false,
    });
    expect(info).toEqual({ ipAddress: undefined, userAgent: "UA" });
  });

  it("uses the address Vercel sets", () => {
    expect(
      clientInfo(h({ "x-real-ip": "49.36.1.2", "x-forwarded-for": "49.36.1.2" }), {
        onVercel: true,
        trustProxy: false,
      }).ipAddress,
    ).toBe("49.36.1.2");
  });

  it("behind another proxy, takes the entry that proxy appended, not the client's", () => {
    expect(
      clientInfo(h({ "x-forwarded-for": "6.6.6.6, 49.36.1.2" }), {
        onVercel: false,
        trustProxy: true,
      }).ipAddress,
    ).toBe("49.36.1.2");
  });

  it("drops anything that isn't an IP address", () => {
    expect(
      clientInfo(h({ "x-real-ip": "not-an-ip" }), { onVercel: true, trustProxy: false }).ipAddress,
    ).toBeUndefined();
  });
});
