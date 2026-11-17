import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { ReportLayout } from "./types";

/** One signature as it prints (21 CFR 11.50: name, date and time, meaning). */
export type PrintedSignature = {
  id: string;
  meaning: "done_by" | "checked_by" | "reviewed_by" | "approved_by";
  name: string;
  role: string;
  organisation: string;
  signedAt: Date;
};

export const MEANING_LABELS: Record<PrintedSignature["meaning"], string> = {
  done_by: "Done By (prepared)",
  checked_by: "For QA Tech",
  reviewed_by: "Reviewed By",
  approved_by: "For the client",
};

/** "02.11.2026 07:45 IST", as QA Tech writes dates. */
export function istStamp(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute} IST`;
}

/** The standard fonts print Latin-1 only. */
const latin = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, "?");

function fit(font: PDFFont, text: string, size: number, width: number) {
  const full = latin(text);
  if (font.widthOfTextAtSize(full, size) <= width) return full;
  let t = full;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

function centred(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  box: { x: number; w: number },
  y: number,
  colour = rgb(0, 0, 0),
) {
  const t = fit(font, text, size, box.w - 6);
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, { x: box.x + (box.w - w) / 2, y, size, font, color: colour });
}

/** What the client's signature means, by the report's verdict: never "qualified" on a failed study. */
export const APPROVAL_LINE: Record<NonNullable<ReportLayout["outcome"]>, string> = {
  qualified: "APPROVED - ACCEPTED - QUALIFIED",
  qualified_with_deviations: "APPROVED - ACCEPTED - QUALIFIED WITH DEVIATIONS",
  not_qualified: "REVIEWED - ACCEPTED - NOT QUALIFIED",
  not_judged: "APPROVED - ACCEPTED",
};

/**
 * The signed copy of a frozen report: the frozen PDF, untouched, with each
 * signature stamped into the signature block and a last page listing every
 * signature with the frozen PDF's SHA-256. The same signatures always give
 * the same bytes (fixed dates), so the issued copy can be checked again.
 */
export async function signedCopy(input: {
  frozen: Uint8Array;
  frozenSha256: string;
  layout: ReportLayout | null;
  reportNumber: string;
  revision: string;
  frozenPages: number;
  signatures: PrintedSignature[];
  /** The time the copy stands for (the last signature, or the freeze). */
  at: Date;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.frozen, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0.1, 0.23, 0.47);

  const boxes = input.layout?.signBoxes;
  const green = rgb(0.06, 0.45, 0.25);
  if (boxes) {
    for (const s of input.signatures) {
      const b = boxes[s.meaning];
      if (!b) continue;
      const page = pdf.getPages()[b.signature.page - 1];
      if (!page) continue;
      const mid = b.signature.y + b.signature.h / 2;
      centred(page, bold, "Signed electronically", 8, b.signature, mid + 4, blue);
      centred(page, font, istStamp(s.signedAt), 7.5, b.signature, mid - 8, blue);
      centred(page, bold, s.name.toUpperCase(), 9, b.name, b.name.y + b.name.h / 2 - 3);
      if (b.role) {
        // The role, and a line that says what the signature means (QA Tech's reference).
        centred(page, font, s.role, 8, b.role, b.role.y + b.role.h - 9);
        centred(
          page,
          bold,
          s.meaning === "approved_by"
            ? APPROVAL_LINE[input.layout?.outcome ?? "qualified"]
            : "VERIFIED AND ISSUED - 21 CFR PART 11",
          6.5,
          b.role,
          b.role.y + 3,
          green,
        );
      }
      for (const f of b.footer ?? []) {
        const p = pdf.getPages()[f.page - 1];
        if (!p) continue;
        centred(p, bold, s.name.toUpperCase(), 7, f, f.y + f.h / 2, blue);
        centred(p, font, istStamp(s.signedAt), 6, f, f.y + f.h / 2 - 9, blue);
      }
    }
  }

  // The signature page.
  const page = pdf.addPage([595.28, 841.89]);
  const M = 40;
  let y = 841.89 - 60;
  const text = (t: string, size: number, f = font, x = M, colour = rgb(0, 0, 0)) => {
    page.drawText(latin(t), { x, y, size, font: f, color: colour });
  };
  text("Electronic signatures", 16, bold, M, blue);
  y -= 26;
  const facts: [string, string][] = [
    ["Report", `${input.reportNumber} ${input.revision}`],
    ["Frozen PDF", `pages 1 to ${input.frozenPages} of this file`],
    ["Its SHA-256", input.frozenSha256],
  ];
  for (const [k, v] of facts) {
    text(k, 9, bold);
    page.drawText(latin(v), { x: M + 90, y, size: k === "Its SHA-256" ? 7.5 : 9, font });
    y -= 15;
  }
  y -= 10;
  const cols: [string, number][] = [
    ["Meaning", 95],
    ["Name", 115],
    ["Role and organisation", 165],
    ["Signed (IST)", 140],
  ];
  const row = (cells: string[], f: PDFFont, h: number, shade = false) => {
    let x = M;
    for (let i = 0; i < cols.length; i += 1) {
      const w = cols[i]![1];
      page.drawRectangle({
        x,
        y: y - h,
        width: w,
        height: h,
        borderColor: rgb(0.27, 0.27, 0.27),
        borderWidth: 0.5,
        color: shade ? rgb(0.85, 0.85, 0.85) : undefined,
      });
      const lines = (cells[i] ?? "").split("\n");
      lines.forEach((line, k) => {
        page.drawText(fit(f, line, 8, w - 8), {
          x: x + 4,
          y: y - h / 2 - 3 + ((lines.length - 1) / 2 - k) * 10,
          size: 8,
          font: f,
        });
      });
      x += w;
    }
    y -= h;
  };
  row(
    cols.map((c) => c[0]),
    bold,
    18,
    true,
  );
  const order = ["done_by", "checked_by", "reviewed_by", "approved_by"];
  const sorted = [...input.signatures].sort(
    (a, b) =>
      order.indexOf(a.meaning) - order.indexOf(b.meaning) ||
      a.signedAt.getTime() - b.signedAt.getTime(),
  );
  for (const s of sorted) {
    row(
      [MEANING_LABELS[s.meaning], s.name, `${s.role}\n${s.organisation}`, istStamp(s.signedAt)],
      font,
      28,
    );
  }
  if (sorted.length === 0) row(["No signatures yet", "", "", ""], font, 20);
  y -= 24;
  const note = [
    "Each signature was made in the QTech platform by the person named, who entered their",
    `password at the moment of signing. It applies to the frozen PDF with the SHA-256 above`,
    `(pages 1 to ${input.frozenPages} of this file), is kept with that hash and can't be moved`,
    "to another record. The names and times in the signature block are stamped from these",
    "records. This page is not part of the frozen PDF.",
  ];
  for (const l of note) {
    text(l, 8.5);
    y -= 13;
  }
  y -= 8;
  for (const s of sorted) {
    text(`${MEANING_LABELS[s.meaning]}: signature ${s.id}`, 7, font, M, rgb(0.33, 0.33, 0.33));
    y -= 10;
  }

  pdf.setModificationDate(input.at);
  pdf.setProducer("QTech platform");
  return pdf.save({ useObjectStreams: false });
}
