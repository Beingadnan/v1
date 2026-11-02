import "server-only";

import PDFDocument from "pdfkit";

import type { SignBox } from "@/domain/reports/types";

/** What the work completion report prints. */
export type WcrData = {
  organisation: {
    legalName: string;
    shortName: string;
    address: string;
    phone: string;
    email: string;
    gstin: string;
  };
  letterhead: Buffer | null;
  number: string;
  issuedOn: string; // ISO date
  jobNumber: string;
  customer: { name: string; address: string; gstin: string; site: string };
  po: { number: string; date: string | null };
  period: { from: string | null; to: string | null };
  studies: {
    code: string;
    name: string;
    work: string;
    reportNumber: string;
    reportStatus: string;
  }[];
  team: string[];
  issuedBy: string;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 36;
const BORDER = "#444444";
const SHADE = "#d9d9d9";

const ascii = (s: string) =>
  s
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ]/g, "?");
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "-");

/**
 * The work completion report (WCR), on QA Tech's letterhead: the job, PO and
 * work period, every piece of equipment with its report, and two signature
 * boxes. QA Tech's box carries the issuer's name; the client's box is left
 * empty, and its position is returned so an acceptance can be stamped in.
 * Laid out like QA Tech's other forms until their blank WCR arrives.
 */
export async function renderWcr(d: WcrData): Promise<{ pdf: Buffer; signBox: SignBox }> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: M, left: M, right: M, bottom: 0 },
    autoFirstPage: false,
    bufferPages: true,
    info: {
      Title: `Work completion report ${d.number}`,
      Author: d.organisation.legalName,
      // Fixed dates, so the same job gives the same file.
      CreationDate: new Date(`${d.issuedOn}T00:00:00Z`),
      ModDate: new Date(`${d.issuedOn}T00:00:00Z`),
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const W = A4.w - M * 2;
  const bottom = A4.h - 70;
  let y = 0;
  let page = 0;

  const newPage = () => {
    doc.addPage({ size: "A4", margins: { top: M, left: M, right: M, bottom: 0 } });
    page += 1;
    y = 20;
    let drawn = false;
    if (d.letterhead) {
      try {
        doc.image(d.letterhead, M, y, { fit: [W, 62], align: "center" });
        y += 70;
        drawn = true;
      } catch {
        // Unreadable image: the text letterhead below.
      }
    }
    if (!drawn) {
      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor("#1f3a68")
        .text(ascii(d.organisation.shortName || d.organisation.legalName), M, y + 4);
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#333333")
        .text(
          ascii([d.organisation.legalName, d.organisation.address].filter(Boolean).join("\n")),
          M + W / 2,
          y + 4,
          { width: W / 2, align: "right" },
        );
      y += 52;
    }
    doc
      .lineWidth(0.8)
      .strokeColor("#1f3a68")
      .moveTo(M, y)
      .lineTo(M + W, y)
      .stroke();
    y += 10;
  };

  const cell = (
    x: number,
    w: number,
    h: number,
    text: string,
    o: { bold?: boolean; fill?: string; align?: "left" | "center"; size?: number } = {},
  ) => {
    if (o.fill) doc.rect(x, y, w, h).fill(o.fill);
    doc.lineWidth(0.5).strokeColor(BORDER).rect(x, y, w, h).stroke();
    const size = o.size ?? 8;
    doc
      .font(o.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(size)
      .fillColor("#000000");
    const t = ascii(text);
    const th = doc.heightOfString(t, { width: w - 6 });
    doc.text(t, x + 3, y + Math.max(2, (h - th) / 2), {
      width: w - 6,
      height: h - 2,
      align: o.align ?? "left",
      ellipsis: true,
    });
  };
  const row = (h: number, cells: [string, number, Parameters<typeof cell>[4]?][]) => {
    let x = M;
    for (const [t, w, o] of cells) {
      cell(x, w, h, t, o);
      x += w;
    }
    y += h;
  };

  newPage();
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#000000")
    .text("WORK COMPLETION REPORT", M, y, { width: W, align: "center" });
  y += 24;

  const half = W / 2;
  const kv = (k: string, v: string, k2: string, v2: string) =>
    row(18, [
      [k, half * 0.36, { bold: true, fill: SHADE }],
      [v, half * 0.64],
      [k2, half * 0.36, { bold: true, fill: SHADE }],
      [v2, half * 0.64],
    ]);
  kv("WCR No.", d.number, "Date", dmy(d.issuedOn));
  kv("Job No.", d.jobNumber, "PO No.", d.po.number || "-");
  kv("Customer", d.customer.name, "PO date", dmy(d.po.date));
  kv("Site", d.customer.site, "Work period", `${dmy(d.period.from)} to ${dmy(d.period.to)}`);
  if (d.customer.gstin || d.organisation.gstin) {
    kv("Customer GSTIN", d.customer.gstin || "-", "Our GSTIN", d.organisation.gstin || "-");
  }
  y += 12;

  doc
    .font("Helvetica")
    .fontSize(9)
    .text(
      ascii(
        `This is to certify that ${d.organisation.shortName || d.organisation.legalName} has completed the following work for ${d.customer.name} at ${d.customer.site}, as per the purchase order above.`,
      ),
      M,
      y,
      { width: W },
    );
  y = doc.y + 8;

  const cols: [string, number][] = [
    ["Sr.", 26],
    ["Equipment ID", 74],
    ["Equipment", 140],
    ["Work", 84],
    ["Report No.", W - 26 - 74 - 140 - 84 - 76],
    ["Report", 76],
  ];
  const header = () =>
    row(
      18,
      cols.map(([t, w]) => [t, w, { bold: true, fill: SHADE, align: "center" as const }]),
    );
  header();
  d.studies.forEach((s, i) => {
    if (y + 36 > bottom) {
      newPage();
      header();
    }
    row(
      36,
      [String(i + 1), s.code, s.name, s.work, s.reportNumber, s.reportStatus].map((t, k) => [
        t,
        cols[k]![1],
        { size: k === 4 ? 7 : 8, align: k === 0 ? ("center" as const) : ("left" as const) },
      ]),
    );
  });
  y += 10;
  if (d.team.length) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(ascii(`Carried out by: ${d.team.join(", ")}.`), M, y, { width: W });
    y = doc.y + 10;
  }

  // The signature block: QA Tech on the left, the client on the right.
  if (y + 110 > bottom) newPage();
  row(18, [
    [
      `For ${d.organisation.shortName || d.organisation.legalName}`,
      half,
      { bold: true, fill: SHADE, align: "center" },
    ],
    [`For ${d.customer.name} (accepted by)`, half, { bold: true, fill: SHADE, align: "center" }],
  ]);
  const boxTop = y;
  row(60, [
    ["", half],
    ["", half],
  ]);
  row(18, [
    [`Issued by: ${d.issuedBy}`, half, { align: "center" }],
    ["Name, designation, date", half, { align: "center", size: 7 }],
  ]);
  const signBox: SignBox = { page, x: M + half, y: A4.h - boxTop - 60, w: half, h: 60 };

  // Footers, once the page count is known.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const fy = A4.h - 50;
    doc.font("Helvetica").fontSize(7).fillColor("#333333");
    doc.text(ascii(`${d.number}  |  ${d.jobNumber}`), M, fy, { width: 300, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M + W - 120, fy, {
      width: 120,
      align: "right",
      lineBreak: false,
    });
    doc
      .font("Helvetica")
      .fontSize(6)
      .text(
        ascii(
          [
            d.organisation.legalName,
            d.organisation.address,
            d.organisation.phone,
            d.organisation.email,
          ]
            .filter(Boolean)
            .join("  |  "),
        ),
        M,
        fy + 12,
        { width: W, lineBreak: false, ellipsis: true },
      );
  }
  doc.end();
  return { pdf: await done, signBox };
}
