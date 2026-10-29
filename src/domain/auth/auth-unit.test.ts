import { describe, expect, it } from "vitest";

import { checkNumberFormat, formatNumber } from "../numbering/format";

import { hashPassword, verifyPassword, checkPasswordStrength, needsRehash } from "./password";
import { ACTIONS, can, permissionMatrix } from "./permissions";
import { ROLES } from "./roles";
import { generateToken, hashToken, isWellFormedToken } from "./tokens";

// Low-cost parameters keep unit tests fast; production uses the defaults.
const FAST = { N: 2 ** 10, r: 8, p: 1 };

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery", FAST);
    expect(stored).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
  });

  it("salts every hash, so equal passwords give different hashes", async () => {
    const a = await hashPassword("same password here", FAST);
    const b = await hashPassword("same password here", FAST);
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$0$8$1$AAAA$AAAA")).toBe(false);
  });

  it("flags hashes made with weaker parameters for re-hashing", async () => {
    expect(needsRehash(await hashPassword("some password!", FAST))).toBe(true);
  });

  it("uses OWASP-strength parameters by default", async () => {
    const stored = await hashPassword("default strength check");
    expect(stored.startsWith("scrypt$131072$8$1$")).toBe(true);
    expect(needsRehash(stored)).toBe(false);
  });
});

describe("password rules", () => {
  const who = { email: "ashraf.khan@qatech.co.in", name: "Ashraf Khan" };
  it("accepts a long passphrase", () => {
    expect(checkPasswordStrength("cold room mapping at -24", who)).toBeNull();
  });
  it("explains what to change", () => {
    expect(checkPasswordStrength("short", who)).toMatch(/at least 12/);
    expect(checkPasswordStrength("aaaaaaaaaaaaaa", who)).toMatch(/too easy/);
    expect(checkPasswordStrength("ashraf.khan-secret", who)).toMatch(/email/);
    expect(checkPasswordStrength("my name is ashraf ok", who)).toMatch(/name/);
  });
});

describe("tokens", () => {
  it("are 256-bit, url-safe and stored only as a hash", () => {
    const token = generateToken();
    expect(isWellFormedToken(token)).toBe(true);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(token);
    expect(isWellFormedToken("../../etc")).toBe(false);
  });
});

describe("permission matrix", () => {
  it("covers every role", () => {
    expect(Object.keys(permissionMatrix()).sort()).toEqual([...ROLES].sort());
  });

  it("gives admin every action and only admin user/settings management", () => {
    for (const action of ACTIONS)
      expect(can({ role: "admin", status: "active" }, action)).toBe(true);
    for (const role of ROLES.filter((r) => r !== "admin")) {
      expect(can({ role, status: "active" }, "users.manage")).toBe(false);
      expect(can({ role, status: "active" }, "settings.manage")).toBe(false);
    }
  });

  it("gives client roles nothing on staff records", () => {
    for (const action of ACTIONS) {
      expect(can({ role: "client_qa", status: "active" }, action)).toBe(false);
      expect(can({ role: "client_qa_head", status: "active" }, action)).toBe(false);
    }
  });

  it("denies everything to users who are not active", () => {
    for (const status of ["invited", "deactivated"]) {
      for (const action of ACTIONS) expect(can({ role: "admin", status }, action)).toBe(false);
    }
  });

  it("matches the agreed matrix exactly", () => {
    expect(permissionMatrix()).toMatchInlineSnapshot(`
      {
        "accounts": [
          "clients.view",
          "files.view",
        ],
        "admin": [
          "audit.view",
          "calibration.approve",
          "calibration.check",
          "calibration.perform",
          "clients.manage",
          "clients.view",
          "files.upload",
          "files.view",
          "instruments.manage",
          "instruments.view",
          "settings.manage",
          "settings.view",
          "users.manage",
          "users.view",
        ],
        "client_qa": [],
        "client_qa_head": [],
        "field_engineer": [
          "clients.view",
          "files.upload",
          "files.view",
          "instruments.view",
        ],
        "lab": [
          "calibration.perform",
          "clients.view",
          "files.upload",
          "files.view",
          "instruments.manage",
          "instruments.view",
        ],
        "manager": [
          "audit.view",
          "calibration.approve",
          "calibration.check",
          "calibration.perform",
          "clients.manage",
          "clients.view",
          "files.upload",
          "files.view",
          "instruments.manage",
          "instruments.view",
          "settings.view",
          "users.view",
        ],
        "report_preparer": [
          "calibration.perform",
          "clients.view",
          "files.upload",
          "files.view",
          "instruments.view",
        ],
        "team_leader": [
          "calibration.check",
          "calibration.perform",
          "clients.manage",
          "clients.view",
          "files.upload",
          "files.view",
          "instruments.manage",
          "instruments.view",
        ],
      }
    `);
  });
});

describe("number formats", () => {
  it("formats job and certificate numbers", () => {
    expect(formatNumber("QT/J/{YYYY}/{SEQ:4}", { year: 2026, sequence: 142 })).toBe(
      "QT/J/2026/0142",
    );
    expect(
      formatNumber("CERT-{SITE}-{YYYY}-{SEQ:4}", { year: 2026, sequence: 31, siteCode: "IND" }),
    ).toBe("CERT-IND-2026-0031");
    expect(formatNumber("QT{YY}-{SEQ:3}", { year: 2026, sequence: 7 })).toBe("QT26-007");
  });

  it("refuses to silently overflow the padding", () => {
    expect(() => formatNumber("J{YYYY}{SEQ:2}", { year: 2026, sequence: 100 })).toThrow(/widen/);
  });

  it("validates formats with plain messages", () => {
    expect(checkNumberFormat("QT/J/{YYYY}/{SEQ:4}", { needsSite: false })).toEqual({ ok: true });
    expect(checkNumberFormat("QT/J/{YYYY}", { needsSite: false })).toMatchObject({ ok: false });
    expect(checkNumberFormat("QT/{SEQ:4}", { needsSite: false })).toMatchObject({ ok: false });
    expect(
      checkNumberFormat("QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}", {
        needsSite: true,
        needsKind: true,
      }),
    ).toEqual({ ok: true });
    expect(
      checkNumberFormat("QATECH/{SITE}/{YY}/{SEQ:2}", { needsSite: true, needsKind: true }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("{KIND}") });
    expect(
      formatNumber("QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}", {
        year: 2026,
        month: 3,
        sequence: 17,
        siteName: "Bhiwandi",
        kind: "PDL",
      }),
    ).toBe("QATECH/BHIWANDI/03/26/PDL-17");
    expect(checkNumberFormat("CERT-{YYYY}-{SEQ:4}", { needsSite: true })).toMatchObject({
      ok: false,
    });
    expect(checkNumberFormat("<script>{YYYY}{SEQ:4}", { needsSite: false })).toMatchObject({
      ok: false,
    });
  });
});
