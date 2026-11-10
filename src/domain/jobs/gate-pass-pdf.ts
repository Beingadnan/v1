import "server-only";

import PDFDocument from "pdfkit";

/** What the gate pass list prints. */
export type GatePassData = {
  organisation: string;
  jobNumber: string;
  gatePass: string;
  client: string;
  site: string;
  from: string;
  to: string;
  team: string[];
  instruments: {
    code: string;
    serialNo: string;
    model: string;
    kind: string;
    validUntil: string | null;
  }[];
  printedOn: string;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 36;
const ascii = (s: string) =>
  s
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ]/g, "?");
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "-");

/**
 * The list of instruments QA Tech brings onto the client's site, for the
 * client's security to check against the gate pass (QA Tech, Nov 2026): every
 * booked logger and master with its serial, model and calibration due date.
 */
export async function renderGatePassList(d: GatePassData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: M, left: M, right: M, bottom: M },
    bufferPages: true,
    info: {
      Title: `Instruments for gate pass ${d.gatePass || d.jobNumber}`,
      Author: d.organisation,
      CreationDate: new Date(`${d.printedOn}T00:00:00Z`),
      ModDate: new Date(`${d.printedOn}T00:00:00Z`),
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const W = A4.w - M * 2;
  const cols = [
    { label: "Sr.", w: 28 },
    { label: "Instrument ID", w: 100 },
    { label: "Serial no.", w: 100 },
    { label: "Make / model", w: 140 },
    { label: "Kind", w: 70 },
    { label: "Calibration due", w: W - 438 },
  ];
  const rowH = 18;
  let y = M;

  doc.font("Helvetica-Bold").fontSize(14).fillColor("#1f3a68").text(ascii(d.organisation), M, y);
  y += 22;
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#000000")
    .text("Instruments brought in for the work (gate pass list)", M, y);
  y += 20;
  const facts: [string, string][] = [
    ["Client", `${d.client}, ${d.site}`],
    ["Gate pass no.", d.gatePass || "Not needed at this site"],
    ["QA Tech job", d.jobNumber],
    ["Dates", `${dmy(d.from)} to ${dmy(d.to)}`],
    ["Team", d.team.join(", ") || "-"],
  ];
  for (const [k, v] of facts) {
    doc.font("Helvetica-Bold").fontSize(9).text(ascii(k), M, y, { width: 90 });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(ascii(v), M + 95, y, { width: W - 95 });
    y += 14;
  }
  y += 8;

  const header = () => {
    let x = M;
    for (const c of cols) {
      doc.rect(x, y, c.w, rowH).fill("#d9d9d9");
      doc.lineWidth(0.5).strokeColor("#444444").rect(x, y, c.w, rowH).stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#000000")
        .text(c.label, x + 3, y + 5, { width: c.w - 6 });
      x += c.w;
    }
    y += rowH;
  };
  header();
  d.instruments.forEach((i, n) => {
    const values = [
      String(n + 1),
      i.code,
      i.serialNo || "-",
      i.model || "-",
      i.kind,
      dmy(i.validUntil),
    ].map(ascii);
    // A row as tall as its longest cell: a master's serial can name the sensor and the
    // indicator ("61442336 (Indicator), 60257729 (Sensor)").
    doc.font("Helvetica").fontSize(8);
    const h = Math.max(
      rowH,
      ...cols.map((c, k) => doc.heightOfString(values[k]!, { width: c.w - 6 }) + 10),
    );
    if (y + h > A4.h - M - 70) {
      doc.addPage();
      y = M;
      header();
    }
    let x = M;
    cols.forEach((c, k) => {
      doc.lineWidth(0.5).strokeColor("#444444").rect(x, y, c.w, h).stroke();
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#000000")
        .text(values[k]!, x + 3, y + 5, { width: c.w - 6 });
      x += c.w;
    });
    y += h;
  });
  y += 10;
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(
      `${d.instruments.length} instrument${d.instruments.length === 1 ? "" : "s"} in all.`,
      M,
      y,
    );

  // Signatures: QA Tech's engineer and the client's security, in and out.
  y = Math.max(y + 40, A4.h - M - 60);
  const half = W / 2;
  for (const [k, label] of [
    [0, "For QA Tech (name, signature, date)"],
    [1, "Client security: checked in / checked out"],
  ] as const) {
    const x = M + k * half;
    doc
      .lineWidth(0.5)
      .strokeColor("#444444")
      .moveTo(x, y)
      .lineTo(x + half - 20, y)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(8)
      .text(label, x, y + 4, { width: half - 20 });
  }
  doc.end();
  return done;
}
