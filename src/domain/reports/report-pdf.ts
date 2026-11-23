import "server-only";

import PDFDocument from "pdfkit";

import type { CycleResult, EngineResult, Stats } from "@/domain/analysis/engine";
import {
  BOX_EDGES,
  describe,
  describeRoom,
  mm,
  projector,
  spreadLabels,
  type Dimensions,
  type Point,
} from "@/domain/field/layout";
import { drawPlan } from "@/domain/field/plan-pdf";
import type { PlanFeature } from "@/domain/field/types";
import { brandMark } from "@/lib/pdf/brand-logo";

import { underShortName, withShortName } from "./org-name";
import type { Assessed } from "./templates";
import { FT09_FORM, type ReportLayout, type ReportSection, type SignBox } from "./types";

/**
 * QA Tech's mapping report (form QATM/PVAL/FT-09) as a PDF, laid out like the
 * issued BE-WF-02 report: cover, index, equipment and mapping details, sensor
 * diagram (hot red, cold yellow), graph and summary per cycle, observation,
 * conclusion, annexure and signature block; then the raw data in landscape,
 * the post-calibration sheet and the deviations. Certificates are joined on
 * afterwards (report-service). Pure: everything comes in as `ReportData`.
 */

export type ReportData = {
  organisation: {
    legalName: string;
    shortName: string;
    address: string;
    phone: string;
    email: string;
    website: string;
  };
  letterhead: Buffer | null;
  watermark: string | null;
  reportNumber: string;
  revision: string;
  customer: { name: string; address: string };
  equipment: {
    name: string;
    code: string;
    location: string;
    make: string;
    model: string;
    serialNo: string;
    department: string;
    dims: Dimensions;
    /** "Room" (QA Tech's WH013) or "Area" for a store; "Equipment" when left out. */
    noun?: "Room" | "Area" | "Equipment";
    /** A room: drawn as a floor plan with a table of locations, not as a box. */
    plan?: boolean;
  };
  study: {
    typeLabel: string;
    setPoint: number | null;
    limits: {
      tempMin: number | null;
      tempMax: number | null;
      rhMin: number | null;
      rhMax: number | null;
    };
    intervalMinutes: number | null;
    channels: number;
    durationHours: number | null;
    start: number;
    end: number;
    nextDue: string | null;
  };
  positions: {
    id: string;
    label: string;
    x: number;
    y: number;
    z: number;
    ambient: boolean;
    serial: string;
    /** Where it sits, as written on site ("Working height on wall-1 near pass box"). */
    note?: string;
  }[];
  /** Doors, pass boxes, LAFs… marked on a room's plan. */
  planFeatures?: PlanFeature[];
  loggers: {
    label: string;
    serial: string;
    name: string;
    range: string;
    accuracy: string;
    calibratedOn: string | null;
    validUntil: string | null;
  }[];
  masters: { name: string; make: string; serial: string; certificate: string }[];
  result: EngineResult;
  series: {
    positionId: string;
    label: string;
    serial: string;
    quantity: "temp" | "rh";
    times: number[];
    values: (number | null)[];
  }[];
  observation: string;
  conclusion: string;
  /** The outcome once excursions are assessed; the badge follows it, as the conclusion does. */
  assessed: Assessed;
  postCal: {
    label: string;
    serial: string;
    quantity: string;
    reference: string;
    reading: string;
    deviation: string;
    tolerance: string;
    result: string;
    /** An approved override: the result above is the one in force. */
    override?: {
      computed: string;
      reason: string;
      requestedBy: string;
      approvedBy: string;
      on: string;
    } | null;
  }[];
  deviations: {
    number: string;
    source: string;
    title: string;
    description: string;
    impact: string;
    assessment: string;
    assessedBy: string;
    decision: string;
    decidedBy: string;
    decidedOn: string;
    note: string;
  }[];
  /** Who signs for the client: the company name printed over its column. */
  signatures: { client: string };
  /** Pages of the certificates joined after, for the index ("-" when none). */
  certificatePages: number;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 28;
const BORDER = "#444444";
const SHADE = "#d9d9d9";
const HEAD = "#bfbfbf";
const HOT = "#e3000f";
/** Height of the spatial mapping key on the diagram page. */
const KEY_H = 104;
const COLD = "#ffd400";
const LINE_COLOURS = [
  "#1f4e9c",
  "#c00000",
  "#70ad47",
  "#7030a0",
  "#00b0f0",
  "#ed7d31",
  "#203864",
  "#7f6000",
  "#548235",
  "#ff66cc",
  "#2f5597",
  "#a5a5a5",
];

const ascii = (s: string) =>
  s
    .replace(/[−–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ]/g, "?");
const f1 = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : (Math.round(v * 10) / 10).toFixed(1);
const plain = (v: number | null) => (v === null ? "" : String(Math.round(v * 100) / 100));
/** "M/s. Name", without doubling a prefix the name already has. */
const ms = (name: string) => (/^m\/s\.?\s/i.test(name) ? name : `M/s. ${name}`);
const dmy = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join(".") : "");
const ist = (ms: number) => {
  const d = new Date(ms + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`,
    hm: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
};

type Kind = "body" | "raw" | "postcal" | "deviation";
type CellOpts = {
  bold?: boolean;
  size?: number;
  align?: "left" | "center" | "right";
  fill?: string;
  border?: boolean;
};

export type RenderedReport = {
  pdf: Buffer;
  bodyPages: number;
  rawPages: number;
  totalPages: number;
  layout: ReportLayout;
};

class Builder {
  doc: PDFKit.PDFDocument;
  y = 0;
  kinds: Kind[] = [];
  /** First page of each section, for the index. */
  marks = new Map<string, number>();
  /** The signature block's cells, for stamping signatures on the frozen PDF (phase 9). */
  signBoxes: ReportLayout["signBoxes"] = null;

  /** "Room", "Area" or "Equipment". */
  get noun() {
    return this.d.equipment.noun ?? "Equipment";
  }

  constructor(private d: ReportData) {
    this.doc = new PDFDocument({
      size: "A4",
      margin: M,
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title: `Mapping report ${d.reportNumber} ${d.revision}`,
        Author: d.organisation.legalName,
        Subject: FT09_FORM,
      },
    });
  }

  get width() {
    return this.kinds.at(-1) === "raw" ? A4.h : A4.w;
  }
  get height() {
    return this.kinds.at(-1) === "raw" ? A4.w : A4.h;
  }
  get content() {
    return this.width - M * 2;
  }
  /** Bottom of the writable area (above the footer). */
  get bottom() {
    return this.height - 62;
  }

  page(kind: Kind, mark?: string) {
    // No bottom margin: the footer is written below the content, and pdfkit would
    // otherwise start a new page for it.
    this.doc.addPage({
      size: "A4",
      layout: kind === "raw" ? "landscape" : "portrait",
      margins: { top: M, left: M, right: M, bottom: 0 },
    });
    this.kinds.push(kind);
    if (mark && !this.marks.has(mark)) this.marks.set(mark, this.kinds.length);
    this.y = this.letterhead();
    if (kind !== "raw") {
      // The frame QA Tech draws around the content of every page.
      this.doc
        .lineWidth(1.2)
        .strokeColor(BORDER)
        .rect(M - 4, this.y - 4, this.content + 8, this.bottom - this.y + 6)
        .stroke();
    }
    this.y += 6;
  }

  ensure(h: number, kind: Kind, mark?: string) {
    if (this.y + h > this.bottom) {
      this.page(kind, mark);
      if (kind !== "raw") this.headerBox();
    }
  }

  cell(x: number, y: number, w: number, h: number, text: string, o: CellOpts = {}) {
    const { doc } = this;
    if (o.fill) doc.rect(x, y, w, h).fill(o.fill);
    if (o.border !== false) doc.lineWidth(0.5).strokeColor(BORDER).rect(x, y, w, h).stroke();
    const size = o.size ?? 8;
    doc
      .font(o.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(size)
      .fillColor("#000000");
    const t = ascii(text);
    const th = doc.heightOfString(t, { width: w - 6 });
    doc.text(t, x + 3, y + Math.max(1.5, (h - th) / 2), {
      width: w - 6,
      height: h - 1,
      align: o.align ?? "left",
      ellipsis: true,
    });
  }

  row(h: number, cells: [string, number, CellOpts?][], x0 = M) {
    let x = x0;
    for (const [t, w, o] of cells) {
      this.cell(x, this.y, w, h, t, o);
      x += w;
    }
    this.y += h;
  }

  /** Letterhead image (or the organisation's details), returns the y below it. */
  letterhead(): number {
    const { doc, d } = this;
    let y = 18;
    if (d.letterhead) {
      try {
        doc.image(d.letterhead, M, y, { fit: [this.content, 62], align: "center" });
        return y + 70;
      } catch {
        // Unreadable image: fall back to text.
      }
    }
    const org = d.organisation;
    brandMark(doc, org, M, y, 46);
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#333333")
      .text(
        ascii(
          [
            org.legalName,
            org.address,
            org.phone && `Tel: ${org.phone}`,
            [org.email && `E-mail: ${org.email}`, org.website && `Website: ${org.website}`]
              .filter(Boolean)
              .join(" | "),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        M + this.content / 2,
        y,
        { width: this.content / 2, align: "right" },
      );
    y = Math.max(doc.y, y + 48) + 4;
    doc
      .lineWidth(1)
      .strokeColor("#1f3a68")
      .moveTo(M, y)
      .lineTo(M + this.content, y)
      .stroke();
    return y + 8;
  }

  /** Customer Name / Report No. / Validated By, at the top of every body page. */
  headerBox() {
    const { d } = this;
    const w = this.content;
    const a = 70;
    const b = w * 0.4;
    const c = 70;
    const top = this.y;
    this.cell(M, top, a, 16, "Customer Name  :", { bold: true, size: 7 });
    this.cell(M + a, top, b, 16, d.customer.name, { bold: true, size: 7, align: "center" });
    this.cell(M, top + 16, a, 24, "Report No.        :", { bold: true, size: 7 });
    this.cell(M + a, top + 16, b, 24, d.reportNumber, { bold: true, size: 7, align: "center" });
    this.cell(M + a + b, top, c, 40, "Validated By.", { bold: true, size: 7, align: "center" });
    this.cell(
      M + a + b + c,
      top,
      w - a - b - c,
      40,
      withShortName(d.organisation.shortName, d.organisation.legalName),
      {
        bold: true,
        size: 7,
        align: "center",
      },
    );
    this.y = top + 48;
  }

  title(text: string, size = 11) {
    this.doc.font("Helvetica-Bold").fontSize(size).fillColor("#000000");
    this.doc.text(ascii(text), M, this.y, { width: this.content, align: "center" });
    this.y = this.doc.y + 4;
  }

  bar(text: string) {
    this.cell(M, this.y, this.content, 16, text, {
      bold: true,
      size: 9,
      align: "center",
      fill: HEAD,
    });
    this.y += 20;
  }

  // ------------------------------------------------------------------ pages

  /**
   * The verdict over every cycle: qualified, qualified with its excursions
   * assessed (accepted, or deviations closed without a repeat), not qualified,
   * or no limits to judge by.
   */
  verdict() {
    const cycles = this.d.result.cycles;
    const judged = cycles.flatMap((c) => c.positions.filter((p) => p.pass !== null));
    const ok = judged.filter((p) => p.pass === true).length;
    const anyFail = cycles.some((c) => c.pass === false);
    const allPass = cycles.length > 0 && cycles.every((c) => c.pass === true);
    const assessed = anyFail && this.d.assessed === "qualified_with_deviations";
    return {
      ok,
      judged: judged.length,
      assessed,
      state:
        anyFail && !assessed
          ? ("fail" as const)
          : allPass || assessed
            ? ("pass" as const)
            : ("none" as const),
      label: assessed
        ? "RESULT: QUALIFIED WITH DEVIATIONS"
        : anyFail
          ? "RESULT: NOT QUALIFIED"
          : allPass
            ? `RESULT: QUALIFIED - ${ok}/${judged.length} LOCATIONS COMPLIANT`
            : "RESULT: NOT JUDGED (NO LIMITS SET)",
    };
  }

  /** The verdict as stored with the frozen report, for the client's stamp. */
  outcome(): NonNullable<ReportLayout["outcome"]> {
    const v = this.verdict();
    if (v.assessed) return "qualified_with_deviations";
    return v.state === "pass" ? "qualified" : v.state === "fail" ? "not_qualified" : "not_judged";
  }

  /** A small rounded badge, green for a pass and red for a fail; returns its width. */
  badge(
    text: string,
    x: number,
    y: number,
    state: "pass" | "fail" | "none",
    align: "left" | "right" = "left",
  ) {
    const { doc } = this;
    const t = ascii(text);
    doc.font("Helvetica-Bold").fontSize(7);
    const bw = doc.widthOfString(t) + 14;
    const bx = align === "right" ? x - bw : x;
    const [fill, ink] =
      state === "pass"
        ? ["#e6f4ea", "#0f7a3d"]
        : state === "fail"
          ? ["#fde8e8", "#b42318"]
          : ["#eeeeee", "#444444"];
    doc.roundedRect(bx, y, bw, 14, 3).fillAndStroke(fill, ink);
    doc.fillColor(ink).text(t, bx + 7, y + 4, { width: bw - 12, lineBreak: false });
    doc.fillColor("#000000");
    return bw;
  }

  /** A section heading in small spaced capitals with a rule under it. */
  caps(text: string, x: number, y: number, w: number) {
    const { doc } = this;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#1f3a68");
    doc.text(ascii(text.toUpperCase()), x, y, {
      width: w,
      characterSpacing: 0.6,
      lineBreak: false,
    });
    doc
      .lineWidth(0.5)
      .strokeColor("#c9d1dd")
      .moveTo(x, y + 12)
      .lineTo(x + w, y + 12)
      .stroke();
    doc.fillColor("#000000");
  }

  /** Acceptance range as "-15 °C To -25 °C", with %RH when set. */
  acceptance() {
    const l = this.d.study.limits;
    const t =
      l.tempMax !== null || l.tempMin !== null
        ? `${plain(l.tempMax)} °C To ${plain(l.tempMin)} °C`
        : "-";
    const rh =
      l.rhMax !== null || l.rhMin !== null ? ` / ${plain(l.rhMin)} to ${plain(l.rhMax)} %RH` : "";
    return t + rh;
  }

  cover() {
    const { d, doc } = this;
    this.page("body", "cover");
    const w = this.content;
    const x = M;
    // Document type and status, as on QA Tech's reference cover.
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#1f3a68");
    doc.text("DOCUMENT TYPE: THERMAL VALIDATION REPORT", x + 6, this.y + 2, {
      width: w / 2,
      characterSpacing: 0.4,
      lineBreak: false,
    });
    doc.text(
      `STATUS: ${d.watermark ? d.watermark.toUpperCase() : "FINAL"}  |  ${ascii(d.revision).toUpperCase()}`,
      x + w / 2,
      this.y + 2,
      { width: w / 2 - 6, align: "right", characterSpacing: 0.4, lineBreak: false },
    );
    doc
      .lineWidth(0.5)
      .strokeColor("#c9d1dd")
      .moveTo(x, this.y + 14)
      .lineTo(x + w, this.y + 14)
      .stroke();

    // Client and facility.
    const cx = x + 30;
    const cw = w - 60;
    let y = 240;
    doc.rect(cx, y, cw, 78).lineWidth(0.6).strokeColor("#c9d1dd").stroke();
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#555555");
    doc.text("CLIENT & FACILITY DETAILS", cx, y + 8, {
      width: cw,
      align: "center",
      characterSpacing: 0.8,
    });
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#000000");
    doc.text(ascii(ms(d.customer.name)), cx + 10, y + 24, {
      width: cw - 20,
      align: "center",
      lineBreak: false,
      ellipsis: true,
    });
    doc.font("Helvetica").fontSize(8.5).fillColor("#333333");
    doc.text(ascii(d.customer.address), cx + 20, y + 46, {
      width: cw - 40,
      align: "center",
      height: 26,
      ellipsis: true,
    });

    // The study's title.
    y += 96;
    doc.rect(cx, y, cw, 92).fill("#f3f5f9");
    doc.lineWidth(0.6).strokeColor("#c9d1dd").rect(cx, y, cw, 92).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1f3a68");
    doc.text(ascii(d.organisation.shortName.toUpperCase()), cx, y + 12, {
      width: cw,
      align: "center",
      characterSpacing: 1,
    });
    doc.font("Helvetica").fontSize(6.5).fillColor("#555555");
    doc.text(
      ascii(underShortName(d.organisation.shortName, d.organisation.legalName).toUpperCase()),
      cx,
      y + 25,
      {
        width: cw,
        align: "center",
        characterSpacing: 0.6,
      },
    );
    doc.font("Helvetica-Bold").fontSize(19).fillColor("#000000");
    doc.text(ascii(d.study.typeLabel.toUpperCase()), cx, y + 40, {
      width: cw,
      align: "center",
      lineBreak: false,
      ellipsis: true,
    });
    doc.font("Helvetica").fontSize(9).fillColor("#333333");
    doc.text(ascii(`${d.equipment.name}  ·  ${d.equipment.code}`), cx, y + 66, {
      width: cw,
      align: "center",
      lineBreak: false,
      ellipsis: true,
    });

    // Study execution and report identification.
    const s = d.study;
    const period =
      ist(s.start).date === ist(s.end).date
        ? ist(s.start).date
        : `${ist(s.start).date} - ${ist(s.end).date}`;
    const duration = [
      s.durationHours ? `${s.durationHours} hrs` : "",
      s.intervalMinutes ? `(${s.intervalMinutes} min logging)` : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.y = this.bottom - 150;
    this.caps("Study execution & report identification", x + 6, this.y, w - 12);
    this.y += 18;
    const k = w * 0.2;
    const v = w * 0.3;
    const rows: [string, string, string, string][] = [
      [`${this.noun} Name`, d.equipment.name, `${this.noun} ID`, d.equipment.code],
      [
        "Operating Set Point",
        s.setPoint === null ? "-" : `${plain(s.setPoint)} °C`,
        "Acceptance Range",
        this.acceptance(),
      ],
      ["Study Duration", duration || "-", "Mapping Period", period],
    ];
    for (const [a, b, c, e] of rows) {
      this.row(16, [
        [a, k, { bold: true, size: 7.5, fill: "#f3f5f9" }],
        [b, v, { size: 7.5 }],
        [c, k, { bold: true, size: 7.5, fill: "#f3f5f9" }],
        [e, v, { size: 7.5 }],
      ]);
    }
    this.row(16, [
      ["Official Report No.", k, { bold: true, size: 7.5, fill: "#f3f5f9" }],
      [d.reportNumber, w - k, { bold: true, size: 7.5 }],
    ]);
    this.y += 10;
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#1f3a68");
    doc.text(ascii(d.organisation.shortName.toUpperCase()), x + 6, this.y, { lineBreak: false });
    doc.text(`FORM: ${FT09_FORM}`, x + w / 2, this.y, {
      width: w / 2 - 6,
      align: "right",
      lineBreak: false,
    });
    doc.font("Helvetica").fontSize(6).fillColor("#555555");
    doc.text(
      "Executed in accordance with ISO 9001:2015 · 21 CFR Part 11 · WHO TRS 961",
      x + 6,
      this.y + 10,
      { width: w / 2, lineBreak: false },
    );
    doc.text("CONFIDENTIAL · PROPRIETARY", x + w / 2, this.y + 10, {
      width: w / 2 - 6,
      align: "right",
      characterSpacing: 0.4,
      lineBreak: false,
    });
    doc.fillColor("#000000");
  }

  index(entries: [string, string][]) {
    const { d, doc } = this;
    this.page("body", "index");
    this.headerBox();
    this.y += 6;
    const w = this.content;
    this.row(20, [
      ["TABLE OF CONTENTS / INDEX", w, { bold: true, size: 10, align: "center", fill: SHADE }],
    ]);
    this.row(16, [
      ["Sr. No.", 60, { bold: true, align: "center" }],
      ["Document Section / Content", w - 140, { bold: true }],
      ["Page Ref.", 80, { bold: true, align: "center" }],
    ]);
    entries.forEach(([content, page], i) =>
      this.row(16, [
        [String(i + 1), 60, { align: "center" }],
        [content, w - 140, { bold: true }],
        [page, 80, { align: "center" }],
      ]),
    );

    // Executive summary and objective, written from the study's own facts.
    const s = d.study;
    const hours = s.durationHours ? `${s.durationHours}-hour ` : "";
    const where = [d.equipment.location, d.equipment.department].filter(Boolean).join(", ");
    const traced =
      d.loggers.length > 0 &&
      d.loggers.every(
        (l) =>
          l.calibratedOn &&
          (!l.validUntil || l.validUntil >= ist(s.end).date.split(".").reverse().join("-")),
      );
    const para = (text: string) => {
      doc.font("Helvetica").fontSize(8.5).fillColor("#000000");
      const t = ascii(text);
      const h = doc.heightOfString(t, { width: w - 16 });
      this.ensure(h + 6, "body");
      doc.text(t, M + 8, this.y, { width: w - 16 });
      this.y = doc.y + 5;
    };
    this.y += 18;
    this.ensure(90, "body");
    this.caps("Executive summary & study objective", M + 8, this.y, w - 16);
    this.y += 20;
    para(
      `This report records the ${hours}${s.typeLabel.toLowerCase()} of ${d.equipment.name} (ID: ${d.equipment.code})${where ? `, ${where},` : ""} at ${ms(d.customer.name)}.`,
    );
    para(
      `The objective was to find how temperature is distributed across the ${this.noun.toLowerCase()}, how uniform it is, and where its hot and cold points are, against the acceptance range of ${this.acceptance()}.${traced ? " Every data logger used was calibrated, with traceability to national standards, before the study." : ""}`,
    );

    // The verdict, in a sentence and a badge.
    const v = this.verdict();
    const c = d.result.cycles;
    const temps = c.flatMap((x) =>
      x.positions.filter((p) => !p.ambient && !p.excluded && p.temp).map((p) => p.temp!),
    );
    const mean = temps.length ? temps.reduce((a, t) => a + t.avg, 0) / temps.length : null;
    const excursions = c.reduce((n, x) => n + x.excursions.length, 0);
    this.y += 14;
    this.ensure(100, "body");
    this.caps("Executive conclusion & qualification verdict", M + 8, this.y, w - 16);
    this.badge(v.label, M + w - 8, this.y - 3, v.state, "right");
    this.y += 20;
    const hot = c.find((x) => x.hot)?.hot;
    const cold = c.find((x) => x.cold)?.cold;
    para(
      [
        v.judged
          ? `${v.ok} of ${v.judged} logger locations stayed within the acceptance range of ${this.acceptance()}.`
          : "No acceptance limits were set, so no location is judged against them.",
        mean !== null ? `The mean temperature was ${f1(mean)} °C,` : "",
        excursions === 0
          ? "with no excursions outside the range."
          : `with ${excursions} excursion${excursions === 1 ? "" : "s"} outside the range (see the summary pages).`,
      ]
        .filter(Boolean)
        .join(" "),
    );
    if (hot || cold) {
      para(
        `${cold ? `The cold point is ${cold.label} (${f1(cold.avg)} °C)` : ""}${hot && cold ? " and the" : hot ? "The" : ""}${hot ? ` hot point is ${hot.label} (${f1(hot.avg)} °C)` : ""}. ${
          v.assessed
            ? `With its excursions assessed (see the deviations), ${d.equipment.name} (${d.equipment.code}) is qualified for its intended use.`
            : v.state === "pass"
              ? `${d.equipment.name} (${d.equipment.code}) meets the thermal uniformity requirement and is qualified for its intended use.`
              : v.state === "fail"
                ? `${d.equipment.name} (${d.equipment.code}) does not meet the acceptance criteria; see the observations and deviations.`
                : ""
        }`,
      );
    }
  }

  details() {
    const { d } = this;
    this.page("body", "details");
    this.headerBox();
    this.title(`${this.noun} & Mapping Details`);
    const w = this.content;
    const k = w * 0.2;
    const v = w * 0.3;
    const s = d.study;
    const pairs: [string, string, string, string][] = [
      [
        `${this.noun} Name`,
        d.equipment.name,
        "Set Point",
        s.setPoint === null ? "-" : `${plain(s.setPoint)} °C`,
      ],
      [`${this.noun} ID`, d.equipment.code, "Acceptance Range", this.acceptance()],
      ["Location", d.equipment.location || "-", "Mapping End Date", ist(s.end).date],
      ["Make", d.equipment.make || "NA", "Next Due Date", dmy(s.nextDue) || "-"],
      [
        "Model",
        d.equipment.model || "NA",
        "Frequency Of Reading",
        s.intervalMinutes ? `${s.intervalMinutes} Min.` : "-",
      ],
      ["Serial No.", d.equipment.serialNo || "NA", "No. of Channels", String(s.channels)],
      [
        "Department",
        d.equipment.department || "-",
        "Mapping Duration",
        s.durationHours ? `${s.durationHours} hrs` : "-",
      ],
    ];
    for (const [a, b, c2, d2] of pairs) {
      this.row(18, [
        [a, k, { bold: true }],
        [`:   ${b}`, v],
        [c2, k, { bold: true }],
        [`:   ${d2}`, v],
      ]);
    }
    this.row(16, [
      ["Cycle Type", k, { bold: true }],
      [`:   ${s.typeLabel}`, w - k, { bold: true }],
    ]);
    this.y += 8;
    this.doc.font("Helvetica-Bold").fontSize(10).text("Details of Data Logger Used :", M, this.y);
    this.y += 14;
    const cols: [string, number][] = [
      ["Name & Make", w * 0.2],
      ["Serial No", w * 0.14],
      ["Range", w * 0.2],
      ["Accuracy", w * 0.2],
      ["Calibration Date", w * 0.13],
      ["Next Due", w * 0.13],
    ];
    const head = () =>
      this.row(
        16,
        cols.map(
          ([t, cw]) => [t, cw, { bold: true, align: "center" }] as [string, number, CellOpts],
        ),
      );
    head();
    for (const lg of d.loggers) {
      if (this.y + 16 > this.bottom) {
        this.ensure(40, "body");
        head();
      }
      this.row(16, [
        [lg.name, cols[0]![1], { size: 7, align: "center" }],
        [lg.serial, cols[1]![1], { align: "center" }],
        [lg.range, cols[2]![1], { size: 7, align: "center" }],
        [lg.accuracy, cols[3]![1], { size: 6, align: "center" }],
        [dmy(lg.calibratedOn), cols[4]![1], { align: "center" }],
        [dmy(lg.validUntil) || "-", cols[5]![1], { align: "center" }],
      ]);
    }
    this.y += 8;
    this.ensure(60, "body");
    this.doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("Above Data Logger Was Calibrated by Using :", M, this.y);
    this.y += 14;
    const mc: [string, number][] = [
      ["Instrument", w * 0.32],
      ["Make", w * 0.18],
      ["Serial No", w * 0.27],
      ["Certificate No.", w * 0.23],
    ];
    this.row(
      16,
      mc.map(([t, cw]) => [t, cw, { bold: true, align: "center" }] as [string, number, CellOpts]),
    );
    if (d.masters.length === 0) {
      this.row(16, [["No master recorded on the loggers' certificates.", w, { align: "center" }]]);
    }
    for (const m of d.masters) {
      this.ensure(22, "body");
      this.row(22, [
        [m.name, mc[0]![1], { size: 7, align: "center" }],
        [m.make, mc[1]![1], { size: 7, align: "center" }],
        [m.serial, mc[2]![1], { size: 7, align: "center" }],
        [m.certificate, mc[3]![1], { size: 7, align: "center" }],
      ]);
    }
  }

  diagram() {
    const { d, doc } = this;
    this.page("body", "diagram");
    this.headerBox();
    this.title("Diagram Indicating Sensor Positions & Hot / Cold Points");
    const hot = new Set(d.result.cycles.map((c) => c.hot?.positionId).filter(Boolean));
    const cold = new Set(d.result.cycles.map((c) => c.cold?.positionId).filter(Boolean));
    const legendW = 0;
    // The drawing, then the spatial key and the placement table (QA Tech's reference
    // page 4).
    const area = d.equipment.plan === true;
    const inPlan = d.positions.filter((p) => !p.ambient);
    const tableH = 16 + Math.min(d.positions.length, 24) * 13;
    const box = {
      x: M,
      y: this.y + 4,
      w: this.content,
      // A room's plan takes what the table leaves; a box is drawn no taller than it needs.
      h: Math.max(
        220,
        Math.min(area ? Infinity : 330, this.bottom - this.y - 24 - tableH - KEY_H - 20),
      ),
    };
    const c0 = d.result.cycles[0];
    const avgOf = (id: string) => c0?.positions.find((p) => p.positionId === id)?.temp?.avg;
    const dims = d.equipment.dims;
    if (area) {
      drawPlan(
        doc,
        { x: box.x, y: box.y, w: box.w - legendW, h: box.h },
        dims,
        inPlan.map((p) => ({
          label: p.label,
          x: p.x,
          y: p.y,
          fill: hot.has(p.id) ? HOT : cold.has(p.id) ? COLD : "#ffffff",
          text: hot.has(p.id) ? "#ffffff" : "#000000",
        })),
        d.planFeatures ?? [],
      );
    } else {
      const project = projector(dims, { width: box.w - legendW, height: box.h, margin: 46 });
      const at = (p: Point) => {
        const q = project(p);
        return { x: box.x + q.x, y: box.y + q.y };
      };
      doc.lineWidth(1.1).strokeColor("#111111");
      for (const [a, b] of BOX_EDGES) {
        const hidden =
          (a.x === 0 && a.y === 1 && a.z === 0) || (b.x === 0 && b.y === 1 && b.z === 0);
        const pa = at(a);
        const pb = at(b);
        if (hidden) doc.dash(3, { space: 2 });
        doc.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke();
        doc.undash();
      }
      doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
      const sizeTag = (p: Point, text: string, dx: number, dy: number) => {
        const q = at(p);
        doc
          .lineWidth(0.5)
          .strokeColor(BORDER)
          .rect(q.x + dx, q.y + dy, 56, 12)
          .stroke();
        doc.text(ascii(text), q.x + dx, q.y + dy + 2.5, { width: 56, align: "center" });
      };
      // Sizes only when measured; a sketch gives the shape, not the size.
      if (dims.lengthM !== null) sizeTag({ x: 0.5, y: 1, z: 1 }, `L-${mm(dims.lengthM)}`, -28, -20);
      if (dims.heightM !== null) sizeTag({ x: 1, y: 1, z: 0.5 }, `H ${mm(dims.heightM)}`, 10, -6);
      if (dims.widthM !== null) sizeTag({ x: 0, y: 0.5, z: 1 }, `W-${mm(dims.widthM)}`, -62, -6);
      const inside = d.positions.filter((p) => !p.ambient);
      const labels = spreadLabels(
        inside.map((p) => ({ ...at(p), label: p.label, id: p.id })),
        { w: 30, h: 13 },
      );
      for (const q of labels) {
        const fill = hot.has(q.id) ? HOT : cold.has(q.id) ? COLD : "#ffffff";
        const avg = avgOf(q.id);
        if ((hot.has(q.id) || cold.has(q.id)) && avg !== undefined) {
          // The hot and cold points carry their average on the drawing, on white so
          // an edge behind it doesn't cross the text.
          doc.rect(q.x - 27, q.y + 7, 54, 9).fill("#ffffff");
          doc
            .font("Helvetica-Bold")
            .fontSize(6.5)
            .fillColor(hot.has(q.id) ? HOT : "#9a7b00")
            .text(ascii(`${hot.has(q.id) ? "HOT" : "COLD"} ${f1(avg)} °C`), q.x - 30, q.y + 8, {
              width: 60,
              align: "center",
              lineBreak: false,
            });
        }
        doc
          .lineWidth(0.6)
          .strokeColor("#222222")
          .fillColor(fill)
          .ellipse(q.x, q.y, 15, 6.5)
          .fillAndStroke();
        doc
          .font("Helvetica-Bold")
          .fontSize(6)
          .fillColor(hot.has(q.id) ? "#ffffff" : "#000000")
          .text(ascii(q.label), q.x - 15, q.y - 2.4, {
            width: 30,
            align: "center",
            lineBreak: false,
          });
      }
    }
    this.y = box.y + box.h + 8;
    this.spatialKey(hot, cold);
    this.placementTable(hot, cold);
  }

  /** Hot and cold points, where the loggers sit by level, and the equipment's figures. */
  spatialKey(hot: Set<string | undefined>, cold: Set<string | undefined>) {
    const { d, doc } = this;
    const w = this.content;
    this.ensure(KEY_H, "body");
    const top = this.y;
    this.row(14, [
      ["SPATIAL MAPPING KEY", w, { bold: true, size: 7.5, align: "center", fill: HEAD }],
    ]);
    const half = w / 2;
    const c0 = d.result.cycles[0];
    const pos = (id: string | undefined) => d.positions.find((p) => p.id === id);
    const point = (
      y: number,
      title: string,
      which: { positionId: string; label: string; avg: number } | null | undefined,
      ink: string,
      fill: string,
    ) => {
      doc.rect(M + 4, y, half - 8, 30).fillAndStroke(fill, ink);
      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(ink)
        .text(title, M + 10, y + 4);
      const p = pos(which?.positionId);
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor("#000000")
        .text(
          ascii(
            which
              ? `Logger ${which.label}${p?.serial ? ` (Sr. ${p.serial})` : ""}: ${f1(which.avg)} °C average${p ? `, ${this.plane(p.z)}` : ""}`
              : "-",
          ),
          M + 10,
          y + 16,
          { width: half - 20, lineBreak: false, ellipsis: true },
        );
    };
    point(this.y + 4, "HOT POINT (HIGHEST AVERAGE)", c0?.hot, "#b42318", "#fde8e8");
    point(this.y + 38, "COLD POINT (LOWEST AVERAGE)", c0?.cold, "#9a7b00", "#fff8d6");
    // Right half: loggers by level, and the equipment's figures.
    const inside = d.positions.filter((p) => !p.ambient);
    const levels = new Map<string, string[]>();
    for (const p of inside) {
      const k = this.plane(p.z).split(" (")[0]!;
      const tag = hot.has(p.id) ? " (hot)" : cold.has(p.id) ? " (cold)" : "";
      levels.set(k, [...(levels.get(k) ?? []), p.label + tag]);
    }
    const dims = d.equipment.dims;
    const v = this.verdict();
    const lines: [string, boolean][] = [
      ["ELEVATION DISTRIBUTION", true],
      ...["Top", "Mid", "Bottom"]
        .filter((k) => levels.has(k))
        .map((k) => [`${k}: ${levels.get(k)!.join(", ")}`, false] as [string, boolean]),
      [
        `Loggers placed: ${inside.length}${d.positions.length > inside.length ? ` (+${d.positions.length - inside.length} ambient)` : ""}`,
        false,
      ],
      ["EQUIPMENT PARAMETERS", true],
      [
        `${d.equipment.code}: ${[dims.lengthM, dims.widthM, dims.heightM].some((x) => x !== null) ? `${mm(dims.lengthM)} (L) x ${mm(dims.widthM)} (W) x ${mm(dims.heightM)} (H)` : "size not recorded"}`,
        false,
      ],
      [
        `Set point: ${d.study.setPoint === null ? "-" : `${plain(d.study.setPoint)} °C`}  |  Range: ${this.acceptance()}`,
        false,
      ],
      [v.judged ? `${v.ok}/${v.judged} locations compliant` : "No limits set", true],
    ];
    let ly = this.y + 4;
    for (const [t, b] of lines) {
      doc
        .font(b ? "Helvetica-Bold" : "Helvetica")
        .fontSize(6.8)
        .fillColor(b ? "#1f3a68" : "#000000")
        .text(ascii(t), M + half + 6, ly, { width: half - 12, lineBreak: false, ellipsis: true });
      ly += 9;
    }
    doc.fillColor("#000000");
    doc
      .lineWidth(0.5)
      .strokeColor(BORDER)
      .rect(M, top, w, KEY_H - 6)
      .stroke();
    this.y = top + KEY_H;
  }

  /** "Top (2.0 m)" from a point's height in the box (0 at the floor, 1 at the top). */
  plane(z: number) {
    const h = this.d.equipment.dims.heightM;
    const k = z >= 0.67 ? "Top" : z <= 0.33 ? "Bottom" : "Mid";
    return h ? `${k} (${(Math.round(z * h * 10) / 10).toFixed(1)} m)` : k;
  }

  /** Where each logger sits and what it showed: QA Tech's placement reference table. */
  placementTable(hot: Set<string | undefined>, cold: Set<string | undefined>) {
    const { d, doc } = this;
    const w = this.content;
    const c0 = d.result.cycles[0];
    const cols: [string, number][] = [
      ["Location", w * 0.09],
      ["Logger Sr. No.", w * 0.14],
      ["Elevation Plane", w * 0.14],
      ["Placement Description", w * 0.4],
      ["Status / Classification", w * 0.23],
    ];
    const head = () =>
      this.row(
        14,
        cols.map(
          ([t, cw]) => [t, cw, { bold: true, size: 7, fill: SHADE }] as [string, number, CellOpts],
        ),
      );
    this.ensure(30, "body");
    head();
    for (const p of d.positions) {
      if (this.y + 13 > this.bottom) {
        this.ensure(30, "body");
        head();
      }
      const r = c0?.positions.find((x) => x.positionId === p.id);
      const avg = r?.temp ? ` (${f1(r.temp.avg)} °C)` : "";
      const [status, ink] = hot.has(p.id)
        ? [`HOT POINT${avg}`, HOT]
        : cold.has(p.id)
          ? [`COLD POINT${avg}`, "#9a7b00"]
          : r?.excluded
            ? ["Excluded", "#555555"]
            : p.ambient
              ? [`Ambient${avg}`, "#555555"]
              : r?.pass === false
                ? [`Out of spec${avg}`, HOT]
                : r?.pass === true
                  ? [`Within spec${avg}`, "#0f7a3d"]
                  : [avg.trim() || "-", "#000000"];
      const where =
        p.note ||
        (p.ambient
          ? "Outside, ambient"
          : d.equipment.plan
            ? describeRoom(p, d.equipment.dims.heightM)
            : describe(p));
      const y = this.y;
      this.row(13, [
        [p.label, cols[0]![1], { bold: true, size: 7 }],
        [p.serial || "-", cols[1]![1], { size: 7 }],
        [p.ambient ? "-" : this.plane(p.z), cols[2]![1], { size: 7 }],
        [where, cols[3]![1], { size: 7 }],
        ["", cols[4]![1]],
      ]);
      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(ink)
        .text(ascii(status), M + w - cols[4]![1] + 3, y + 3.5, {
          width: cols[4]![1] - 6,
          lineBreak: false,
          ellipsis: true,
        });
      doc.fillColor("#000000");
    }
  }

  graph(c: CycleResult, cycleCount: number) {
    const { d } = this;
    this.page("body", "graph");
    this.headerBox();
    this.title(
      cycleCount > 1
        ? `${this.noun} & Mapping Details: ${c.label}`
        : `${this.noun} & Mapping Details`,
    );
    const w = this.content;
    const s = d.study;
    const l = s.limits;
    const hours = Math.round(((c.end - c.start) / 3_600_000) * 10) / 10;
    const k = w * 0.22;
    const v = w * 0.28;
    const crit =
      l.tempMax !== null || l.tempMin !== null
        ? `${plain(l.tempMax)} to ${plain(l.tempMin)} °C`
        : "-";
    for (const [a, b, c2, d2] of [
      [
        `${this.noun} Name`,
        d.equipment.name,
        "Set Point",
        s.setPoint === null ? "-" : `${plain(s.setPoint)} °C`,
      ],
      ["Mapping Duration", `${hours} Hrs`, "Acceptance Criteria", crit],
      ["Mapping Date (Start)", ist(c.start).date, "Start Time", ist(c.start).time],
      ["Mapping Date (End)", ist(c.end).date, "End Time", ist(c.end).time],
    ] as [string, string, string, string][]) {
      this.row(16, [
        [a, k, { bold: true, align: "center" }],
        [`:   ${b}`, v, { bold: true, align: "center" }],
        [c2, k, { bold: true, align: "center" }],
        [`:   ${d2}`, v, { bold: true, align: "center" }],
      ]);
    }
    this.row(16, [
      ["Cycle Type", k, { bold: true, align: "center" }],
      [`:   ${s.typeLabel}`, w - k, { bold: true }],
    ]);
    this.y += 4;
    this.doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(
        "Note : All the graphs of the Temperature V/S Time the Summary Report are based on attach raw data",
        M,
        this.y,
        { width: w, align: "center" },
      );
    this.y += 14;
    this.chart(c, "temp", 250);
    if (d.series.some((x) => x.quantity === "rh")) {
      this.ensure(220, "body", undefined);
      this.chart(c, "rh", 200);
    }
    this.summary(c);
  }

  chart(c: CycleResult, quantity: "temp" | "rh", h: number) {
    const { d, doc } = this;
    const w = this.content;
    const top = this.y;
    doc.lineWidth(0.5).strokeColor(BORDER).rect(M, top, w, h).stroke();
    doc.font("Helvetica").fontSize(10).fillColor("#333333");
    doc.text(
      quantity === "temp" ? "TEMPERATURE V/S TIME" : "RELATIVE HUMIDITY V/S TIME",
      M,
      top + 8,
      {
        width: w,
        align: "center",
      },
    );
    const series = d.series.filter((x) => x.quantity === quantity);
    const pts = series.map((x) => {
      const out: { t: number; v: number }[] = [];
      x.times.forEach((t, i) => {
        const v = x.values[i];
        if (v !== null && v !== undefined && t >= c.start && t <= c.end) out.push({ t, v });
      });
      return out;
    });
    const all = pts.flat().map((p) => p.v);
    const lim =
      quantity === "temp"
        ? [d.study.limits.tempMin, d.study.limits.tempMax]
        : [d.study.limits.rhMin, d.study.limits.rhMax];
    const lims = lim.filter((x): x is number => x !== null);
    const lo0 = Math.min(...all, ...lims);
    const hi0 = Math.max(...all, ...lims);
    const step = quantity === "temp" ? 5 : 10;
    const lo = Math.floor((lo0 - 1) / step) * step;
    const hi = Math.ceil((hi0 + 1) / step) * step;
    const plot = { x: M + 34, y: top + 30, w: w - 48, h: h - 92 };
    const X = (t: number) => plot.x + ((t - c.start) / Math.max(1, c.end - c.start)) * plot.w;
    const Y = (v: number) => plot.y + plot.h - ((v - lo) / Math.max(1e-9, hi - lo)) * plot.h;
    doc.font("Helvetica").fontSize(6.5).fillColor("#555555");
    for (let v = lo; v <= hi + 1e-9; v += step) {
      doc
        .lineWidth(0.3)
        .strokeColor("#e0e0e0")
        .moveTo(plot.x, Y(v))
        .lineTo(plot.x + plot.w, Y(v))
        .stroke();
      doc.text(v.toFixed(1), M + 2, Y(v) - 3, { width: 28, align: "right" });
    }
    // Time labels every 30 min, wider when the study is long.
    const spanMin = (c.end - c.start) / 60_000;
    const every = [30, 60, 120, 180, 240, 360, 720, 1440].find((m) => spanMin / m <= 52) ?? 1440;
    const first =
      Math.ceil((c.start + 330 * 60_000) / (every * 60_000)) * every * 60_000 - 330 * 60_000;
    for (let t = first; t <= c.end; t += every * 60_000) {
      const x = X(t);
      doc
        .lineWidth(0.3)
        .strokeColor("#c8c8c8")
        .moveTo(x, plot.y + plot.h)
        .lineTo(x, plot.y + plot.h + 3)
        .stroke();
      doc.save();
      doc.rotate(-90, { origin: [x, plot.y + plot.h + 30] });
      doc
        .fontSize(5.5)
        .fillColor("#555555")
        .text(`${ist(t).hm}:00`, x - 2, plot.y + plot.h + 27, { width: 30, lineBreak: false });
      doc.restore();
    }
    // Acceptance limits, dashed.
    for (const v of lims) {
      doc
        .dash(3, { space: 2 })
        .lineWidth(0.6)
        .strokeColor("#c00000")
        .moveTo(plot.x, Y(v))
        .lineTo(plot.x + plot.w, Y(v))
        .stroke()
        .undash();
    }
    series.forEach((sr, i) => {
      const p = pts[i]!;
      if (p.length < 2) return;
      doc.lineWidth(1).strokeColor(LINE_COLOURS[i % LINE_COLOURS.length]!);
      doc.moveTo(X(p[0]!.t), Y(p[0]!.v));
      for (let j = 1; j < p.length; j += 1) {
        // A gap in the readings breaks the line.
        if (p[j]!.t - p[j - 1]!.t > 3 * 60_000 * (d.study.intervalMinutes ?? 10))
          doc.moveTo(X(p[j]!.t), Y(p[j]!.v));
        else doc.lineTo(X(p[j]!.t), Y(p[j]!.v));
      }
      doc.stroke();
    });
    // Legend by serial.
    const per = Math.min(series.length, 9) || 1;
    const lw = (w - 20) / per;
    series.forEach((sr, i) => {
      const lx = M + 10 + (i % per) * lw;
      const ly = top + h - 18 + Math.floor(i / per) * 9 - (series.length > per ? 9 : 0);
      doc
        .lineWidth(1.6)
        .strokeColor(LINE_COLOURS[i % LINE_COLOURS.length]!)
        .moveTo(lx, ly + 3)
        .lineTo(lx + 12, ly + 3)
        .stroke();
      doc
        .font("Helvetica")
        .fontSize(5.5)
        .fillColor("#333333")
        .text(`${sr.serial || sr.label} ${quantity === "temp" ? "°C" : "%RH"}`, lx + 14, ly, {
          width: lw - 16,
          lineBreak: false,
        });
    });
    this.y = top + h + 6;
  }

  summary(c: CycleResult) {
    const w = this.content;
    const hasRh = c.positions.some((p) => p.rh);
    const judged = c.positions.filter((p) => p.temp);
    const cols: [string, number][] = hasRh
      ? [
          ["Sensor Positions", w * 0.16],
          ["Min Temp (°C)", w * 0.12],
          ["Max Temp.(°C)", w * 0.12],
          ["Average Temp.(°C)", w * 0.12],
          ["MKT (°C)", w * 0.12],
          ["Min RH (%)", w * 0.12],
          ["Max RH (%)", w * 0.12],
          ["Average RH (%)", w * 0.12],
        ]
      : [
          ["Sensor Positions", w * 0.2],
          ["Min Temp (°C)", w * 0.2],
          ["Max Temp.(°C)", w * 0.2],
          ["Average Temp.(°C)", w * 0.2],
          ["MKT (°C)", w * 0.2],
        ];
    // Two lines high, so "Average Temp.(°C)" fits beside the MKT column.
    const head = () =>
      this.row(
        20,
        cols.map(([t, cw]) => [t, cw, { align: "center" }] as [string, number, CellOpts]),
      );
    this.ensure(30, "body");
    head();
    const stat = (s: Stats | null, k: "min" | "max" | "avg") => (s ? f1(s[k]) : "-");
    for (const p of judged) {
      if (this.y + 12 > this.bottom) {
        this.ensure(40, "body");
        head();
      }
      const label = p.label + (p.ambient ? " (Ambient)" : "") + (p.excluded ? " (left out)" : "");
      const cells: [string, number, CellOpts?][] = [
        [label, cols[0]![1], { align: "center" }],
        [stat(p.temp, "min"), cols[1]![1], { align: "center" }],
        [stat(p.temp, "max"), cols[2]![1], { align: "center" }],
        [stat(p.temp, "avg"), cols[3]![1], { align: "center" }],
        // Mean kinetic temperature from every reading (USP <1079.2>), as on the Analysis tab.
        [p.temp?.mkt != null ? p.temp.mkt.toFixed(2) : "-", cols[4]![1], { align: "center" }],
      ];
      if (hasRh) {
        cells.push(
          [stat(p.rh, "min"), cols[5]![1], { align: "center" }],
          [stat(p.rh, "max"), cols[6]![1], { align: "center" }],
          [stat(p.rh, "avg"), cols[7]![1], { align: "center" }],
        );
      }
      const rowY = this.y;
      this.row(12, cells);
      // HOT SPOT / COLD SPOT tags, as on QA Tech's reference summary.
      const spot =
        c.hot?.positionId === p.positionId
          ? "hot"
          : c.cold?.positionId === p.positionId
            ? "cold"
            : null;
      if (spot) {
        const t = spot === "hot" ? "HOT SPOT" : "COLD SPOT";
        const tw = 40;
        const tx = M + cols[0]![1] - tw - 4;
        this.doc
          .roundedRect(tx, rowY + 1.8, tw, 8.4, 2)
          .fillAndStroke(
            spot === "hot" ? "#fde8e8" : "#fff8d6",
            spot === "hot" ? "#b42318" : "#9a7b00",
          );
        this.doc
          .font("Helvetica-Bold")
          .fontSize(5.5)
          .fillColor(spot === "hot" ? "#b42318" : "#9a7b00")
          .text(t, tx, rowY + 3.5, { width: tw, align: "center", lineBreak: false });
        this.doc.fillColor("#000000");
      }
    }
    this.y += 10;
    this.ensure(56, "body");
    const bw = w * 0.7;
    this.row(16, [
      [
        "Average Minimum & Average Maximum Temperature",
        bw,
        { bold: true, align: "center", fill: SHADE },
      ],
    ]);
    const r = (a: string, b: string, cc: string) =>
      this.row(14, [
        [a, bw * 0.5, { bold: true, align: "center", fill: SHADE }],
        [b, bw * 0.2, { bold: true, align: "center", fill: SHADE }],
        [cc, bw * 0.3, { bold: true, align: "center", fill: SHADE }],
      ]);
    if (c.cold) r("Average Minimum Temperature at", c.cold.label, f1(c.cold.avg));
    if (c.hot) r("Average Maximum Temperature at", c.hot.label, f1(c.hot.avg));
    this.y += 6;
    // Door, power and hold results, when the study had them.
    const extra: string[] = [];
    for (const dr of c.door)
      extra.push(
        `Door open ${ist(dr.openedAt).hm}-${ist(dr.closedAt).hm}: peak ${f1(dr.peak)} °C; ${dr.recoveryMinutes === null ? "not back within limits before the end" : `back within limits ${dr.recoveryMinutes} min after closing`}.`,
      );
    for (const pw of c.power)
      extra.push(
        `Power off ${ist(pw.offAt).hm}${pw.onAt ? `, restored ${ist(pw.onAt).hm}` : ""}: ${pw.heldThroughout ? "stayed within limits" : `held ${pw.holdoverMinutes} min`}${pw.recoveryMinutes !== null ? `; back within limits ${pw.recoveryMinutes} min after power returned` : ""}.`,
      );
    if (c.hold?.minF0)
      extra.push(
        `Hold ${ist(c.hold.start).hm}-${ist(c.hold.end).hm}: lowest F0 ${f1(c.hold.minF0.value)} min at ${c.hold.minF0.label}.`,
      );
    if (c.excursions.length)
      extra.push(
        ...c.excursions.map(
          (e) =>
            `${e.label} ${e.side === "high" ? "above" : "below"} ${plain(e.limit)} for ${e.minutes} min from ${ist(e.start).hm} (peak ${f1(e.peak)}).`,
        ),
      );
    if (extra.length) {
      this.doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
      for (const t of extra) {
        this.ensure(12, "body");
        this.doc.text(ascii(t), M + 4, this.y, { width: w - 8 });
        this.y = this.doc.y + 2;
      }
    }
    this.statConclusion(c);
  }

  /** The cycle's spread (hot minus cold average) and its verdict, in a box. */
  statConclusion(c: CycleResult) {
    const { doc } = this;
    const w = this.content;
    const inside = c.positions.filter((p) => !p.ambient && !p.excluded && p.temp);
    const judged = inside.filter((p) => p.pass !== null);
    const ok = judged.filter((p) => p.pass).length;
    const spread = c.hot && c.cold ? c.hot.avg - c.cold.avg : null;
    const range =
      c.highest && c.lowest ? `${f1(c.lowest.value)} to ${f1(c.highest.value)} °C` : null;
    const text = [
      `${inside.length} logger${inside.length === 1 ? "" : "s"} recorded through the ${c.label.toLowerCase()}${judged.length ? `; ${ok} of ${judged.length} stayed within the acceptance range of ${this.acceptance()}` : ""}.`,
      spread !== null
        ? `The spread between the cold point ${c.cold!.label} (${f1(c.cold!.avg)} °C) and the hot point ${c.hot!.label} (${f1(c.hot!.avg)} °C) is ${f1(spread)} °C.`
        : "",
      range ? `Single readings ranged ${range}.` : "",
      c.excursions.length === 0
        ? "There were no excursions outside the range."
        : `There ${c.excursions.length === 1 ? "was 1 excursion" : `were ${c.excursions.length} excursions`} outside the range (listed above).`,
    ]
      .filter(Boolean)
      .join(" ");
    doc.font("Helvetica").fontSize(8);
    const h = doc.heightOfString(ascii(text), { width: w - 20 }) + 30;
    this.y += 8;
    this.ensure(h + 4, "body");
    const top = this.y;
    doc.lineWidth(0.6).strokeColor("#c9d1dd").rect(M, top, w, h).stroke();
    this.caps("Statistical conclusion & compliance verdict", M + 8, top + 7, w - 16);
    this.badge(
      c.pass === true
        ? "CRITERIA MET"
        : c.pass === false
          ? "CRITERIA NOT MET"
          : "NOT JUDGED (NO LIMITS)",
      M + w - 8,
      top + 4,
      c.pass === true ? "pass" : c.pass === false ? "fail" : "none",
      "right",
    );
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#000000")
      .text(ascii(text), M + 10, top + 24, { width: w - 20 });
    this.y = top + h + 4;
  }

  conclusion() {
    const { d, doc } = this;
    this.page("body", "conclusion");
    this.headerBox();
    this.y += 20;
    const w = this.content;
    const para = (text: string) => {
      doc.font("Helvetica").fontSize(9).fillColor("#000000");
      for (const line of ascii(text).split("\n")) {
        const h = doc.heightOfString(line, { width: w - 8 });
        this.ensure(h + 4, "body");
        doc.text(line, M + 4, this.y, { width: w - 8 });
        this.y = doc.y + 2;
      }
      this.y += 8;
    };
    this.bar("OBSERVATION");
    para(d.observation);
    this.bar("CONCLUSION");
    const v = this.verdict();
    this.badge(v.label, M + w - 4, this.y - 19, v.state, "right");
    para(d.conclusion);
    this.y += 6;
    this.ensure(40, "body");
    this.row(16, [
      [
        "ANNEXURE: SENSOR LOCATION & LOGGER SERIAL NO.",
        w,
        { bold: true, align: "center", fill: SHADE },
      ],
    ]);
    // Three location / serial pairs per row, as on QA Tech's reference.
    const per = 3;
    const lw = (w / per) * 0.42;
    const sw = w / per - lw;
    for (let i = 0; i < d.positions.length; i += per) {
      this.ensure(14, "body");
      const cells: [string, number, CellOpts?][] = [];
      for (let k = 0; k < per; k += 1) {
        const p = d.positions[i + k];
        cells.push(
          [
            p ? p.label + (p.ambient ? " (Amb.)" : "") : "",
            lw,
            { bold: true, align: "center", fill: p ? "#f3f5f9" : undefined },
          ],
          [p?.serial ?? "", sw, { align: "center" }],
        );
      }
      this.row(14, cells);
    }
    this.y += 16;
    this.signatureBlock();
  }

  /**
   * Two columns, as on QA Tech's reference report: QA Tech (the service
   * provider) on the left and the client's authorised signatory on the right.
   * The cells stay empty here; names, roles and times are stamped on the
   * issued copy from the e-signatures (signed-copy.ts).
   */
  signatureBlock() {
    const { d } = this;
    const w = this.content;
    const half = w / 2;
    const lw = 62;
    const vw = half - lw;
    this.ensure(18 + 16 + 46 + 20 + 28 + 14, "body");
    this.row(18, [
      ["QA TECH (SERVICE PROVIDER)", half, { bold: true, align: "center", fill: SHADE }],
      ["CLIENT (AUTHORISED SIGNATORY)", half, { bold: true, align: "center", fill: SHADE }],
    ]);
    this.row(16, [
      [d.organisation.legalName, half, { size: 7, align: "center" }],
      [ms(d.signatures.client), half, { size: 7, align: "center" }],
    ]);
    // pdf-lib measures from the bottom left; pdfkit from the top left.
    const box = (side: 0 | 1, y: number, h: number): SignBox => ({
      page: this.kinds.length,
      x: M + side * half + lw,
      y: A4.h - y - h,
      w: vw,
      h,
    });
    const labelled = (h: number, label: string) => {
      const y = this.y;
      this.row(h, [
        [label, lw, { bold: true, size: 7.5 }],
        ["", vw],
        [label, lw, { bold: true, size: 7.5 }],
        ["", vw],
      ]);
      return y;
    };
    const sigY = labelled(46, "Signature\n& date");
    const nameY = labelled(20, "Name");
    const roleY = labelled(28, "Designation");
    const col = (side: 0 | 1) => ({
      signature: box(side, sigY, 46),
      name: box(side, nameY, 20),
      role: box(side, roleY, 28),
      footer: [] as SignBox[],
    });
    this.signBoxes = { ...this.signBoxes, checked_by: col(0), approved_by: col(1) };
    this.doc.font("Helvetica").fontSize(6.5).fillColor("#333333");
    this.doc.text(
      "Signed electronically under 21 CFR Part 11: the time and meaning of each signature are listed on the last page.",
      M,
      this.y + 3,
      { width: w, align: "center" },
    );
    this.y += 14;
  }

  raw() {
    const { d, doc } = this;
    const series = d.series;
    if (series.length === 0) return;
    // One table of times across all columns (files share the logger's own times).
    const times = [...new Set(series.flatMap((s) => s.times))]
      .filter((t) => t >= d.study.start - 1 && t <= d.study.end + 1)
      .sort((a, b) => a - b);
    const value = series.map((s) => new Map(s.times.map((t, i) => [t, s.values[i] ?? null])));
    const perPage = 14;
    const chunks: number[][] = [];
    for (let i = 0; i < series.length; i += perPage)
      chunks.push(series.slice(i, i + perPage).map((_, k) => i + k));
    for (const cols of chunks) {
      const rowsPer = 30;
      for (let r0 = 0; r0 < times.length; r0 += rowsPer) {
        this.page("raw", "raw");
        const w = this.content;
        // Study block, as written beside QA Tech's raw data.
        doc.font("Helvetica").fontSize(7).fillColor("#000000");
        doc.text(
          ascii(
            `${d.customer.name}  |  ${d.equipment.name}  |  ${d.equipment.code}  |  ${d.study.typeLabel}  |  Acceptance: ${plain(d.study.limits.tempMax)} to ${plain(d.study.limits.tempMin)} °C  |  ${d.reportNumber}`,
          ),
          M,
          this.y,
          { width: w, align: "center" },
        );
        this.y += 12;
        const dw = 52;
        const tw = 40;
        const cw = (w - dw - tw) / cols.length;
        this.row(18, [
          ["Date", dw, { bold: true, align: "center", size: 7 }],
          ["Time", tw, { bold: true, align: "center", size: 7 }],
          ...cols.map(
            (i) =>
              [
                `${series[i]!.serial || series[i]!.label}\n${series[i]!.quantity === "rh" ? "%RH" : "°C"}`,
                cw,
                { bold: true, align: "center", size: 6 },
              ] as [string, number, CellOpts],
          ),
        ]);
        for (const t of times.slice(r0, r0 + rowsPer)) {
          const at = ist(t);
          this.row(12, [
            [at.date, dw, { align: "center", size: 6.5 }],
            [at.time, tw, { align: "center", size: 6.5 }],
            ...cols.map((i) => {
              const v = value[i]!.get(t);
              return [
                v === null || v === undefined ? "-" : f1(v),
                cw,
                { align: "center", size: 6.5 },
              ] as [string, number, CellOpts];
            }),
          ]);
        }
        if (r0 + rowsPer >= times.length) {
          // MINIMUM / MAXIMUM / AVERAGE at the end, as on QA Tech's sheets.
          for (const k of ["min", "max", "avg"] as const) {
            this.row(12, [
              [
                k === "min" ? "MINIMUM" : k === "max" ? "MAXIMUM" : "AVERAGE",
                dw + tw,
                { bold: true, align: "center", size: 6.5 },
              ],
              ...cols.map((i) => {
                const v = series[i]!.values.filter(
                  (x, j): x is number =>
                    x !== null &&
                    series[i]!.times[j]! >= d.study.start &&
                    series[i]!.times[j]! <= d.study.end,
                );
                const n = v.length
                  ? k === "min"
                    ? Math.min(...v)
                    : k === "max"
                      ? Math.max(...v)
                      : v.reduce((a, b) => a + b, 0) / v.length
                  : null;
                return [
                  n === null ? "-" : f1(n),
                  cw,
                  { bold: true, align: "center", size: 6.5 },
                ] as [string, number, CellOpts];
              }),
            ]);
          }
        }
        this.rawFooter();
      }
    }
  }

  /**
   * "Verified by QA Tech" and "Reviewed by the client" at the foot of every raw
   * data page; the signers' names and times are stamped there on the issued copy.
   */
  rawFooter() {
    const bw = 190;
    const h = 30;
    const y = this.bottom - h;
    const labels: ["checked_by" | "approved_by", string][] = [
      ["checked_by", "VERIFIED BY QA TECH"],
      ["approved_by", "REVIEWED BY (CLIENT)"],
    ];
    labels.forEach(([meaning, label], i) => {
      const x = M + this.content - bw * (2 - i);
      this.cell(x, y, bw, 10, label, { bold: true, size: 6, align: "center", fill: SHADE });
      this.cell(x, y + 10, bw, h - 10, "");
      // Landscape page: pdf-lib's height is A4's width.
      this.signBoxes?.[meaning]?.footer?.push({
        page: this.kinds.length,
        x,
        y: A4.w - y - h,
        w: bw,
        h: h - 10,
      });
    });
  }

  postCal() {
    const { d } = this;
    if (d.postCal.length === 0) return;
    this.page("postcal", "postcal");
    this.headerBox();
    this.title("Post Calibration Of Data Loggers");
    const w = this.content;
    const cols: [string, number][] = [
      ["Position", w * 0.1],
      ["Serial No", w * 0.16],
      ["Parameter", w * 0.12],
      ["Master Reading", w * 0.14],
      ["Logger Reading", w * 0.14],
      ["Deviation", w * 0.12],
      ["Acceptance", w * 0.11],
      ["Result", w * 0.11],
    ];
    this.row(
      16,
      cols.map(
        ([t, cw]) =>
          [t, cw, { bold: true, align: "center", fill: SHADE }] as [string, number, CellOpts],
      ),
    );
    for (const p of d.postCal) {
      this.ensure(14, "postcal");
      this.row(14, [
        [p.label, cols[0]![1], { align: "center" }],
        [p.serial, cols[1]![1], { align: "center" }],
        [p.quantity === "humidity" ? "%RH" : "°C", cols[2]![1], { align: "center" }],
        [p.reference, cols[3]![1], { align: "center" }],
        [p.reading, cols[4]![1], { align: "center" }],
        [p.deviation, cols[5]![1], { align: "center" }],
        [`±${p.tolerance}`, cols[6]![1], { align: "center" }],
        [
          `${p.result === "pass" ? "Pass" : "Fail"}${p.override ? " *" : ""}`,
          cols[7]![1],
          { bold: true, align: "center" },
        ],
      ]);
    }
    // Overridden results: the readings' verdict, why it was changed and who approved it.
    const overridden = d.postCal.filter((p) => p.override);
    for (const p of overridden) {
      const o = p.override!;
      const text = ascii(
        `* ${p.label || p.serial}: ${o.computed === "pass" ? "Pass" : "Fail"} by the readings, taken as ${p.result === "pass" ? "Pass" : "Fail"}. ${o.reason} Asked by ${o.requestedBy}; approved by ${o.approvedBy} on ${o.on}.`,
      );
      this.doc.font("Helvetica").fontSize(7.5);
      const h = this.doc.heightOfString(text, { width: this.content }) + 4;
      this.ensure(h, "postcal");
      this.doc.fillColor("#000000").text(text, M, this.y + 2, { width: this.content });
      this.y += h;
    }
  }

  deviationPages() {
    const { d, doc } = this;
    for (const dv of d.deviations) {
      this.page("deviation", "deviations");
      this.headerBox();
      this.title(`Deviation Report ${dv.number}`);
      const w = this.content;
      const k = w * 0.22;
      const field = (label: string, text: string) => {
        const t = ascii(text || "-");
        doc.font("Helvetica").fontSize(8);
        const h = Math.max(16, doc.heightOfString(t, { width: w - k - 6 }) + 6);
        this.ensure(h, "deviation");
        this.cell(M, this.y, k, h, label, { bold: true, fill: SHADE });
        this.cell(M + k, this.y, w - k, h, t);
        this.y += h;
      };
      field("Source", dv.source);
      field("Title", dv.title);
      field("Description", dv.description);
      field("Impact", dv.impact);
      field("QA Tech assessment", `${dv.assessment}${dv.assessedBy ? `\n(${dv.assessedBy})` : ""}`);
      field("Client decision", dv.decision);
      field("Decided by", `${dv.decidedBy}${dv.decidedOn ? `, ${dmy(dv.decidedOn)}` : ""}`);
      if (dv.note) field("Note", dv.note);
    }
  }

  /** Header numbers and footers on every page, once the page counts are known. */
  finishPages() {
    const { doc, d } = this;
    const counts = new Map<Kind, number>();
    for (const k of this.kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
    const seen = new Map<Kind, number>();
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const kind = this.kinds[i - range.start]!;
      const n = (seen.get(kind) ?? 0) + 1;
      seen.set(kind, n);
      const landscape = kind === "raw";
      const W = landscape ? A4.h : A4.w;
      const H = landscape ? A4.w : A4.h;
      const y = H - 52;
      doc.font("Helvetica").fontSize(7).fillColor("#333333");
      doc.text(FT09_FORM, M, y, { width: 200, lineBreak: false });
      doc.text(`Page ${n} of ${counts.get(kind)}`, W - M - 120, y, {
        width: 120,
        align: "right",
        lineBreak: false,
      });
      doc
        .lineWidth(0.6)
        .strokeColor("#1f3a68")
        .moveTo(M, y + 11)
        .lineTo(W - M, y + 11)
        .stroke();
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
      doc.text(ascii(d.organisation.legalName), M, y + 15, { width: W - 2 * M, lineBreak: false });
      doc.font("Helvetica").fontSize(6).fillColor("#333333");
      doc.text(
        ascii(
          [
            d.organisation.address,
            d.organisation.phone && `Tel: ${d.organisation.phone}`,
            d.organisation.email && `Email: ${d.organisation.email}`,
          ]
            .filter(Boolean)
            .join("  |  "),
        ),
        M,
        y + 25,
        { width: W - 2 * M, lineBreak: false, ellipsis: true },
      );
      doc.text(
        ascii(
          `${d.reportNumber}  ${d.revision}${d.watermark ? `  ${d.watermark}: not for issue` : ""}`,
        ),
        W - M - 300,
        y + 15,
        {
          width: 300,
          align: "right",
          lineBreak: false,
        },
      );
      if (d.watermark) {
        doc.save();
        doc.rotate(-35, { origin: [W / 2, H / 2] });
        doc.font("Helvetica-Bold").fontSize(100).fillColor("#cc0000").opacity(0.1);
        doc.text(d.watermark, 0, H / 2 - 50, { width: W, align: "center", lineBreak: false });
        doc.restore();
        doc.opacity(1);
      }
    }
    return { counts };
  }

  async done(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    this.doc.on("data", (c: Buffer) => chunks.push(c));
    const end = new Promise<Buffer>((resolve, reject) => {
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
    });
    this.doc.end();
    return end;
  }
}

function layout(d: ReportData, index: [string, string][]) {
  const b = new Builder(d);
  b.cover();
  b.index(index);
  b.details();
  b.diagram();
  for (const c of d.result.cycles) b.graph(c, d.result.cycles.length);
  b.conclusion();
  b.raw();
  b.postCal();
  b.deviationPages();
  return b;
}

const range = (a: number | undefined, z: number) =>
  a === undefined ? "-" : a === z ? String(a) : `${a} to ${z}`;

/**
 * Lays the report out twice: the first pass finds where each section starts,
 * the second prints the index with those page numbers.
 */
export async function renderReport(d: ReportData): Promise<RenderedReport> {
  const indexOf = (b: Builder | null): [string, string][] => {
    const at = (k: string) => (b ? String(b.marks.get(k) ?? "-") : "0");
    const body = b ? b.kinds.filter((k) => k === "body").length : 0;
    const graphStart = b?.marks.get("graph");
    const conc = b?.marks.get("conclusion");
    const rawPages = b ? b.kinds.filter((k) => k === "raw").length : 0;
    const rows: [string, string][] = [
      ["Table of Contents & Executive Summary", at("index")],
      [`${d.equipment.noun ?? "Equipment"} & Mapping Details`, at("details")],
      ["Diagram Indicating Sensor Positions", at("diagram")],
      [
        "Graphical Representation of Temperature V/S Time & Summary Report",
        b && graphStart !== undefined && conc !== undefined ? range(graphStart, conc - 1) : "0",
      ],
      ["Conclusion & Annexure", b && conc !== undefined ? range(conc, body) : "0"],
      ["Attachment - Raw Data", rawPages ? `1 to ${rawPages}` : "-"],
    ];
    if (d.postCal.length) rows.push(["Attachment - Post Calibration", "1"]);
    if (d.deviations.length)
      rows.push(["Attachment - Deviation Reports", `1 to ${d.deviations.length}`]);
    rows.push([
      "Attachment Traceability Certificates",
      d.certificatePages ? `1 to ${d.certificatePages}` : "-",
    ]);
    return rows;
  };
  const first = layout(d, indexOf(null));
  const final = layout(d, indexOf(first));
  const { counts } = final.finishPages();
  const pdf = await final.done();
  // The first pass is only measured; end it so pdfkit frees it.
  first.doc.end();
  const sections: ReportLayout["sections"] = { general: 1, cover: 1 };
  const marked: [ReportSection, string][] = [
    ["details", "details"],
    ["diagram", "diagram"],
    ["graphs", "graph"],
    ["conclusion", "conclusion"],
    ["raw", "raw"],
    ["postcal", "postcal"],
    ["deviations", "deviations"],
  ];
  for (const [section, mark] of marked) {
    const page = final.marks.get(mark);
    if (page !== undefined) sections[section] = page;
  }
  if (d.certificatePages) sections.certificates = final.kinds.length + 1;
  return {
    pdf,
    bodyPages: counts.get("body") ?? 0,
    rawPages: counts.get("raw") ?? 0,
    totalPages: final.kinds.length,
    layout: { sections, signBoxes: final.signBoxes, outcome: final.outcome() },
  };
}
