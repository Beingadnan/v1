/**
 * Is an instrument fit to use on a given day? Pure functions over the
 * instrument's certificates, shared by lists, pickers and the traceability view.
 */

export type CertificateDates = {
  id: string;
  number: string;
  status: string;
  calibratedOn: string;
  validUntil: string | null;
};

/** Only certificates that are in force count; drafts and cancelled ones never do. */
const inForce = (c: CertificateDates) => c.status === "issued";

/**
 * The certificate that covers `date`: calibrated on or before it and not yet
 * due. With several, the most recent calibration wins. A certificate without
 * a due date ("NA") covers every later day.
 */
export function certificateCovering<T extends CertificateDates>(
  certs: T[],
  date: string,
): T | null {
  return (
    certs
      .filter(
        (c) =>
          inForce(c) && c.calibratedOn <= date && (c.validUntil === null || c.validUntil >= date),
      )
      .sort((a, b) => b.calibratedOn.localeCompare(a.calibratedOn))[0] ?? null
  );
}

/** The latest certificate in force, whatever its due date. */
export function latestCertificate<T extends CertificateDates>(certs: T[]): T | null {
  return (
    certs.filter(inForce).sort((a, b) => b.calibratedOn.localeCompare(a.calibratedOn))[0] ?? null
  );
}

/** Alert levels used across the app (30, 15 and 7 days before expiry). */
export type ValidityState = "never" | "expired" | "due_7" | "due_15" | "due_30" | "valid";

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function validityState(
  validUntil: string | null | undefined,
  hasCertificate: boolean,
  today: string,
): ValidityState {
  if (!hasCertificate) return "never";
  if (validUntil === null || validUntil === undefined) return "valid";
  const days = daysBetween(today, validUntil);
  if (days < 0) return "expired";
  if (days <= 7) return "due_7";
  if (days <= 15) return "due_15";
  if (days <= 30) return "due_30";
  return "valid";
}

export const VALIDITY_LABELS: Record<ValidityState, string> = {
  never: "Not calibrated",
  expired: "Expired",
  due_7: "Due within 7 days",
  due_15: "Due within 15 days",
  due_30: "Due within 30 days",
  valid: "Valid",
};

const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");

/** Can this instrument be picked for work on `date`? Says why not, in plain words. */
export function usableOn(
  instrument: { code: string; status: string },
  certs: CertificateDates[],
  date: string,
): { ok: true; certificate: CertificateDates } | { ok: false; message: string } {
  if (instrument.status !== "active") {
    return {
      ok: false,
      message: `${instrument.code} is not in use (out of service, retired or lost).`,
    };
  }
  const cover = certificateCovering(certs, date);
  if (cover) return { ok: true, certificate: cover };
  const latest = latestCertificate(certs);
  if (!latest) return { ok: false, message: `${instrument.code} has no calibration certificate.` };
  if (latest.calibratedOn > date) {
    return { ok: false, message: `${instrument.code} was first calibrated after ${dmy(date)}.` };
  }
  return {
    ok: false,
    message: `${instrument.code}'s calibration (${latest.number}) expired on ${dmy(latest.validUntil)}.`,
  };
}
