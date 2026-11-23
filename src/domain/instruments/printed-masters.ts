/**
 * Reference standards printed on an imported FT-05 workbook that aren't in the
 * register. The import keeps them in the certificate's remarks, one line each;
 * the report lists them under "Above Data Logger Was Calibrated by Using" from
 * the same lines (QA Tech's PR-04, Nov 2026: the table was empty).
 */

export type PrintedMaster = {
  name: string;
  make: string;
  serial: string;
  certificate: string;
  validUntil: string | null;
};

const PREFIX = "Reference standard as printed: ";

/** The remarks line for a master printed on a workbook. */
export function printedMasterLine(m: {
  label: string;
  certificateNo: string;
  validUntil: string | null;
}): string {
  return `${PREFIX}${m.label}, certificate ${m.certificateNo}${m.validUntil ? `, due ${m.validUntil}` : ""}.`;
}

/** The masters in a certificate's remarks, in order. */
export function printedMasters(remarks: string | null | undefined): PrintedMaster[] {
  const out: PrintedMaster[] = [];
  for (const raw of (remarks ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(PREFIX)) continue;
    const m = /^(.*), certificate (.+?)(?:, due (\d{4}-\d{2}-\d{2}))?\.$/.exec(
      line.slice(PREFIX.length),
    );
    if (!m) continue;
    const [, label, certificate, due] = m as unknown as [string, string, string, string?];
    // "Name (Make Model, S/N serial)": the last bracket at the end holds make and serial.
    let name = label.trim();
    let inner = "";
    if (name.endsWith(")")) {
      let depth = 0;
      for (let i = name.length - 1; i >= 0; i -= 1) {
        if (name[i] === ")") depth += 1;
        else if (name[i] === "(") depth -= 1;
        if (depth === 0) {
          inner = name.slice(i + 1, -1);
          name = name.slice(0, i).trim();
          break;
        }
      }
    }
    const sn = inner.lastIndexOf(", S/N ");
    out.push({
      name,
      make: (sn >= 0 ? inner.slice(0, sn) : inner).trim(),
      serial: sn >= 0 ? inner.slice(sn + 6).trim() : "",
      certificate: certificate.trim(),
      validUntil: due ?? null,
    });
  }
  return out;
}
