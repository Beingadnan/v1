import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  cashfreeSignature,
  fetchGstinDetails,
  suggestShortName,
  type GstLookupConfig,
} from "./gst-lookup";

const sandbox: GstLookupConfig = {
  clientId: "cid",
  clientSecret: "secret",
  environment: "sandbox",
};

/** The documented success body of Cashfree's Verify GSTIN API. */
const ujjivan = {
  reference_id: 12345,
  GSTIN: "29AAICP2912R1ZR",
  legal_name_of_business: "UJJIVAN SMALL FINANCE BANK LIMITED",
  trade_name_of_business: "UJJIVAN SMALL FINANCE BANK",
  center_jurisdiction: "I-A RANGE",
  state_jurisdiction: "GUWAHATI - A - 1",
  date_of_registration: "2017-09-30",
  constitution_of_business: "Public Limited Company",
  taxpayer_type: "Regular",
  gst_in_status: "Active",
  last_update_date: "2022-03-01",
  nature_of_business_activities: ["Supplier of Services"],
  principal_place_address:
    "First Floor 3512-DISPUR Prithivi Mansion opp. KFC building G.S. Road, Lachit Nagar Assam 781007",
  principal_place_split_address: {
    city: "",
    district: "Kamrup Metro",
    state: "Assam",
    pincode: "781007",
    location: "Lachit Nagar",
  },
  valid: true,
  message: "GSTIN Exists",
};

const reply = (status: number, body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

describe("Cashfree GSTIN lookup", () => {
  it("sends the GSTIN with the keys and reads the details", async () => {
    const fetchImpl = reply(200, ujjivan);
    const result = await fetchGstinDetails(
      "29aaicp2912r1zr",
      sandbox,
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox.cashfree.com/verification/gstin");
    expect(JSON.parse(String(init.body))).toEqual({ GSTIN: "29AAICP2912R1ZR" });
    expect(init.headers).toMatchObject({ "x-client-id": "cid", "x-client-secret": "secret" });
    expect(result).toEqual({
      ok: true,
      details: {
        gstin: "29AAICP2912R1ZR",
        legalName: "Ujjivan Small Finance Bank Limited",
        tradeName: "Ujjivan Small Finance Bank",
        status: "Active",
        constitution: "Public Limited Company",
        taxpayerType: "Regular",
        registeredOn: "2017-09-30",
        address: ujjivan.principal_place_address,
        city: "Lachit Nagar",
        district: "Kamrup Metro",
        state: "Assam",
        pincode: "781007",
      },
    });
  });

  it("uses the production address in production, and refuses a mistyped GSTIN without calling", async () => {
    const fetchImpl = reply(200, ujjivan);
    await fetchGstinDetails(
      "29AAICP2912R1ZR",
      { ...sandbox, environment: "production" },
      fetchImpl as unknown as typeof fetch,
    );
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.cashfree.com/verification/gstin",
    );
    const bad = await fetchGstinDetails(
      "29AAICP2912R1ZX",
      { ...sandbox, environment: "production" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(bad).toMatchObject({ ok: false, reason: "invalid" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    [401, "setup", "keys are wrong"],
    [403, "setup", "Whitelist"],
    [422, "balance", "balance has run out"],
    [429, "busy", "Too many"],
    [400, "invalid", "not valid"],
    [500, "unavailable", "had a problem"],
  ])("explains HTTP %i", async (status, reason, text) => {
    const result = await fetchGstinDetails(
      "29AAICP2912R1ZR",
      sandbox,
      reply(status, { type: "x" }) as unknown as typeof fetch,
    );
    expect(result).toMatchObject({ ok: false, reason, message: expect.stringContaining(text) });
  });

  it("reports an unregistered GSTIN and a network failure", async () => {
    expect(
      await fetchGstinDetails(
        "29AAIZP2912R1ZR",
        sandbox,
        reply(200, { valid: false, message: "GSTIN Doesn't Exist" }) as unknown as typeof fetch,
      ),
    ).toMatchObject({ ok: false, reason: "not_found" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(
      await fetchGstinDetails("29AAICP2912R1ZR", sandbox, down as unknown as typeof fetch),
    ).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });

  it("signs requests when a public key is configured", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const signature = cashfreeSignature("cid", pem, 1_761_700_000_000);
    const plain = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
      Buffer.from(signature, "base64"),
    ).toString();
    expect(plain).toBe("cid.1761700000");
  });

  it("suggests a short name for report numbers", () => {
    expect(suggestShortName({ tradeName: "", legalName: "M/S. WATSON PHARMA PVT LIMITED" })).toBe(
      "Watson",
    );
    expect(suggestShortName({ tradeName: "Ujjivan Small Finance Bank", legalName: "x" })).toBe(
      "Ujjivan",
    );
  });
});
