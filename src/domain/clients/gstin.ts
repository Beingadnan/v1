/**
 * GSTIN: 2-digit state code + 10-character PAN + entity number + 'Z' (usually)
 * + a check character. The check character catches most typing mistakes, and
 * the state code tells us the state, so the app fills it in.
 *
 * Check character (as published for GSTN): over the first 14 characters with
 * the alphabet 0-9A-Z, multiply each value by 1, 2, 1, 2…, add the quotient and
 * remainder of each product by 36, and the check is (36 − sum mod 36) mod 36.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/;

/** GST state codes (Census 2011 based; 25 merged into 26 in 2020). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Dadra and Nagar Haveli and Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = ALPHABET.indexOf(first14[i] ?? "");
    if (value < 0) return "?";
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36]!;
}

export type GstinCheck =
  { ok: true; stateCode: string; state: string; pan: string } | { ok: false; message: string };

/** Checks format, state code and check character; explains what is wrong. */
export function checkGstin(raw: string): GstinCheck {
  const gstin = raw.trim().toUpperCase();
  if (gstin.length !== 15) {
    return { ok: false, message: `A GSTIN has 15 characters; this has ${gstin.length}.` };
  }
  if (!FORMAT.test(gstin)) {
    return {
      ok: false,
      message: "That doesn't look like a GSTIN: 2 digits, a 10-character PAN, then 3 characters.",
    };
  }
  const stateCode = gstin.slice(0, 2);
  const state = GST_STATES[stateCode];
  if (!state) return { ok: false, message: `${stateCode} is not a GST state code.` };
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14]) {
    return {
      ok: false,
      message: "This GSTIN's last character doesn't match — check it for a typing mistake.",
    };
  }
  return { ok: true, stateCode, state, pan: gstin.slice(2, 12) };
}
