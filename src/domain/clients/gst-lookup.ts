import "server-only";

import { constants, publicEncrypt } from "node:crypto";

import { z } from "zod";

import { checkGstin, GST_STATES } from "./gstin";

/**
 * Looks up a GSTIN with Cashfree's Verify GSTIN API
 * (POST {base}/verification/gstin, body {"GSTIN": "..."}; docs:
 * cashfree.com/docs/api-reference/vrs/v2/gstin/verify-gstin).
 *
 * Only server code calls this; the keys never reach the browser.
 */
export type GstLookupConfig = {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
  /** PEM, only for accounts using "Public Key" two-factor authentication. */
  publicKey?: string;
};

export type GstDetails = {
  gstin: string;
  legalName: string;
  tradeName: string;
  status: string;
  constitution: string;
  taxpayerType: string;
  registeredOn: string;
  address: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
};

export type GstLookupResult =
  | { ok: true; details: GstDetails }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "setup" | "balance" | "busy" | "unavailable";
      message: string;
    };

const BASE_URL = {
  sandbox: "https://sandbox.cashfree.com/verification",
  production: "https://api.cashfree.com/verification",
};

const text = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim());

/** Only the fields we use; anything else Cashfree adds is ignored. */
const responseSchema = z.object({
  GSTIN: text,
  legal_name_of_business: text,
  trade_name_of_business: text,
  gst_in_status: text,
  constitution_of_business: text,
  taxpayer_type: text,
  date_of_registration: text,
  principal_place_address: text,
  principal_place_split_address: z
    .object({
      city: text,
      district: text,
      location: text,
      state: text,
      pincode: z
        .union([z.string(), z.number()])
        .nullish()
        .transform((v) => (v == null ? "" : String(v))),
    })
    .partial()
    .nullish(),
  valid: z.boolean().nullish(),
  message: text,
});

/** Sandbox test GSTINs don't all follow the real format; production ones must. */
export function gstinAcceptable(gstin: string, environment: GstLookupConfig["environment"]) {
  if (environment === "sandbox") {
    return /^[0-9A-Z]{15}$/.test(gstin)
      ? { ok: true as const }
      : { ok: false as const, message: "A GSTIN has 15 letters and digits." };
  }
  const check = checkGstin(gstin);
  return check.ok ? { ok: true as const } : { ok: false as const, message: check.message };
}

/**
 * Cashfree's optional request signature: RSA-OAEP (SHA-1) encryption of
 * "<clientId>.<unix seconds>" with the account's public key, base64.
 */
export function cashfreeSignature(clientId: string, publicKey: string, now = Date.now()): string {
  const payload = Buffer.from(`${clientId}.${Math.floor(now / 1000)}`);
  return publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    payload,
  ).toString("base64");
}

const title = (s: string) =>
  s.length > 0 && s === s.toUpperCase()
    ? s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
    : s;

export async function fetchGstinDetails(
  rawGstin: string,
  config: GstLookupConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GstLookupResult> {
  const gstin = rawGstin.trim().toUpperCase();
  const acceptable = gstinAcceptable(gstin, config.environment);
  if (!acceptable.ok) return { ok: false, reason: "invalid", message: acceptable.message };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-client-id": config.clientId,
    "x-client-secret": config.clientSecret,
  };
  if (config.publicKey)
    headers["x-cf-signature"] = cashfreeSignature(config.clientId, config.publicKey);

  let response: Response;
  try {
    response = await fetchImpl(`${BASE_URL[config.environment]}/gstin`, {
      method: "POST",
      headers,
      body: JSON.stringify({ GSTIN: gstin }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message:
        "Couldn't reach the GST lookup service. Type the details in, or try again in a minute.",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: "setup",
      message:
        response.status === 401
          ? "The GST lookup keys are wrong. An admin needs to check CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET."
          : "Cashfree refused this server. Whitelist its IP address in the Cashfree dashboard, or set CASHFREE_PUBLIC_KEY.",
    };
  }
  if (response.status === 422) {
    return {
      ok: false,
      reason: "balance",
      message: "The GST lookup balance has run out. Top up in the Cashfree dashboard.",
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      reason: "busy",
      message: "Too many GST lookups just now. Wait a minute and try again.",
    };
  }
  if (response.status === 400) {
    return {
      ok: false,
      reason: "invalid",
      message: "The GST service says this GSTIN is not valid.",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: "unavailable",
      message: "The GST lookup service had a problem. Try again later.",
    };
  }

  const parsed = responseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    return {
      ok: false,
      reason: "unavailable",
      message: "The GST lookup service sent an answer we couldn't read.",
    };
  }
  const data = parsed.data;
  if (data.valid === false || !data.legal_name_of_business) {
    return {
      ok: false,
      reason: "not_found",
      message: "No business is registered under this GSTIN.",
    };
  }
  const split = data.principal_place_split_address ?? {};
  return {
    ok: true,
    details: {
      gstin: data.GSTIN || gstin,
      legalName: title(data.legal_name_of_business),
      tradeName: title(data.trade_name_of_business),
      status: data.gst_in_status,
      constitution: data.constitution_of_business,
      taxpayerType: data.taxpayer_type,
      registeredOn: data.date_of_registration,
      address: data.principal_place_address,
      city: title(split.city || split.location || split.district || ""),
      district: title(split.district ?? ""),
      state: title(split.state || GST_STATES[gstin.slice(0, 2)] || ""),
      pincode: split.pincode ?? "",
    },
  };
}

/**
 * A short name for report numbers from the trade or legal name:
 * "WATSON PHARMA PVT LIMITED" → "Watson".
 */
export function suggestShortName(details: Pick<GstDetails, "tradeName" | "legalName">): string {
  const source = details.tradeName || details.legalName;
  const word = source
    .replace(/^m\/?s\.?\s+/i, "")
    .split(/[^A-Za-z0-9&]+/)
    .find((w) => w.length >= 2);
  return word ? title(word.toUpperCase()).slice(0, 40) : "";
}
