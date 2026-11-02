import { describe, expect, it } from "vitest";

import { checkNumberFormat, formatNumber, parseNumber } from "../numbering/format";

import { hashPassword, verifyPassword, checkPasswordStrength, needsRehash } from "./password";
import { ACTIONS, CLIENT_ACTIONS, can, permissionMatrix } from "./permissions";
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

  it("gives admin every QA Tech action and only admin user/settings management", () => {
    for (const action of ACTIONS)
      expect(can({ role: "admin", status: "active" }, action)).toBe(
        !CLIENT_ACTIONS.includes(action),
      );
    for (const role of ROLES.filter((r) => r !== "admin")) {
      expect(can({ role, status: "active" }, "users.manage")).toBe(false);
      expect(can({ role, status: "active" }, "settings.manage")).toBe(false);
    }
  });

  it("gives client roles nothing on staff records, and only the head approves", () => {
    for (const action of ACTIONS.filter((a) => !CLIENT_ACTIONS.includes(a))) {
      expect(can({ role: "client_qa", status: "active" }, action)).toBe(false);
      expect(can({ role: "client_qa_head", status: "active" }, action)).toBe(false);
    }
    expect(can({ role: "client_qa", status: "active" }, "reports.client_review")).toBe(true);
    expect(can({ role: "client_qa", status: "active" }, "reports.client_approve")).toBe(false);
    expect(can({ role: "client_qa_head", status: "active" }, "reports.client_approve")).toBe(true);
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
          "billing.record",
          "clients.view",
          "files.view",
          "jobs.money",
          "jobs.view",
        ],
        "admin": [
          "analysis.approve",
          "analysis.run",
          "audit.view",
          "billing.record",
          "calibration.approve",
          "calibration.check",
          "calibration.perform",
          "clients.manage",
          "clients.view",
          "data.accept",
          "data.import",
          "deviation.manage",
          "field.perform",
          "files.upload",
          "files.view",
          "instruments.manage",
          "instruments.view",
          "jobs.close",
          "jobs.manage",
          "jobs.money",
          "jobs.view",
          "postcal.record",
          "ratecard.manage",
          "reports.check",
          "reports.prepare",
          "reports.release",
          "settings.manage",
          "settings.view",
          "users.manage",
          "users.view",
          "wcr.issue",
        ],
        "client_qa": [
          "reports.client_review",
        ],
        "client_qa_head": [
          "deviation.client_decide",
          "reports.client_approve",
          "reports.client_review",
          "wcr.accept",
        ],
        "field_engineer": [
          "clients.view",
          "data.import",
          "field.perform",
          "files.upload",
          "files.view",
          "instruments.view",
          "jobs.view",
          "postcal.record",
        ],
        "lab": [
          "calibration.perform",
          "clients.view",
          "files.upload",
          "files.view",
          "instruments.manage",
          "instruments.view",
          "jobs.view",
          "postcal.record",
        ],
        "manager": [
          "analysis.approve",
          "analysis.run",
          "audit.view",
          "billing.record",
          "calibration.approve",
          "calibration.check",
          "calibration.perform",
          "clients.manage",
          "clients.view",
          "data.accept",
          "data.import",
          "deviation.manage",
          "field.perform",
          "files.upload",
          "files.view",
          "instruments.manage",
          "instruments.view",
          "jobs.close",
          "jobs.manage",
          "jobs.money",
          "jobs.view",
          "postcal.record",
          "ratecard.manage",
          "reports.check",
          "reports.prepare",
          "reports.release",
          "settings.view",
          "users.view",
          "wcr.issue",
        ],
        "report_preparer": [
          "analysis.run",
          "calibration.perform",
          "clients.view",
          "data.import",
          "files.upload",
          "files.view",
          "instruments.view",
          "jobs.view",
          "reports.prepare",
        ],
        "team_leader": [
          "analysis.approve",
          "analysis.run",
          "calibration.check",
          "calibration.perform",
          "clients.manage",
          "clients.view",
          "data.accept",
          "data.import",
          "deviation.manage",
          "field.perform",
          "files.upload",
          "files.view",
          "instruments.manage",
          "instruments.view",
          "jobs.manage",
          "jobs.money",
          "jobs.view",
          "postcal.record",
          "reports.check",
          "reports.prepare",
          "reports.release",
          "wcr.issue",
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

describe("reading certificate numbers back", () => {
  const format = "QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}";
  it("splits a number into its site, month, year, kind and sequence", () => {
    expect(parseNumber(format, "QATECH/BHIWANDI/03/26/PDL-17")).toEqual({
      year: 2026,
      month: 3,
      site: "BHIWANDI",
      kind: "PDL",
      sequence: 17,
    });
  });
  it("accepts the irregular numbers QA Tech has issued", () => {
    // More digits than the format pads to, as on TC-001 and PDL-010.
    expect(parseNumber(format, "QATECH/BHIWANDI/05/26/TC-001")).toMatchObject({
      kind: "TC",
      sequence: 1,
    });
    expect(parseNumber(format, "QATECH/BHIWANDI/01/26/PDL-010")).toMatchObject({ sequence: 10 });
  });
  it("ignores numbers in another format or with an impossible month", () => {
    expect(parseNumber(format, "SAN/25/1165/TH/1")).toBeNull();
    expect(parseNumber(format, "Number not recorded (18.08.2025)")).toBeNull();
    expect(parseNumber(format, "QATECH/BHIWANDI/13/26/PDL-01")).toBeNull();
  });
});
