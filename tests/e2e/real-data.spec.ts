/**
 * QA Tech's real studies, end to end in the browser (Nov 2026): the real
 * client and equipment, the real loggers with their real calibration, the
 * logger export as it came from the site, and the PDF at the end, checked
 * against the issued report or the export's own summary rows.
 *
 * Needs the client files in fixtures/ (git-ignored): skipped without them.
 * Every run makes its own client, so it can run again and again on one database.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { signIn, trackErrors } from "./support";

const root = path.resolve(__dirname, "../../fixtures");
const file = (...p: string[]) => path.join(root, ...p);
const run = String(Date.now() % 1_000_000).padStart(6, "0");

type Row = {
  pos: string;
  serial: string;
  t: [string, string, string];
  rh?: [string, string, string];
};

type Dataset = {
  title: string;
  files: string[];
  client: { name: string; short: string; site: string; city: string };
  equipment: {
    code: string;
    name: string;
    type: string;
    room?: boolean;
    make?: string;
    setPoint?: string;
    low: string;
    high: string;
    rhHigh?: string;
    /** Positions inside; an ambient logger, when there is one, comes on top. */
    inside: number;
    ambient: boolean;
    interval: string;
    /** The cycles the study runs, when not the type's defaults. */
    cycles?: string[];
  };
  /** Registers the real loggers and their real calibration. */
  loggers: (page: Page) => Promise<void>;
  model: string;
  /** Serials in the export's column order: L-01, L-02…, then the ambient one. */
  serials: string[];
  job: { start: string; end: string };
  data: string;
  period: RegExp;
  rows: Row[];
  hot: string;
  cold: string;
  verdict: RegExp;
  /** The loggers' certificates name their masters (an imported FT-05 does; a date typed in doesn't). */
  masters: boolean;
};

// ---------------------------------------------------------------- the studies

const WATSON_CAL: [string, string, string][] = [
  // From page 3 of the issued report BE-WF-02 (serial, calibrated, due).
  ["62281257", "2025-08-11", "2026-08-10"],
  ["62230434", "2025-09-11", "2026-09-10"],
  ["62283621", "2025-08-11", "2026-08-10"],
  ["62220170", "2025-09-03", "2026-09-02"],
  ["62283645", "2025-08-07", "2026-08-06"],
  ["62273014", "2025-08-07", "2026-08-06"],
  ["62219287", "2025-09-03", "2026-09-02"],
  ["62283553", "2025-08-09", "2026-08-08"],
  ["62283563", "2025-08-07", "2026-08-06"],
];

/** The loggers' FT-05 certificates, scanned on pages 11-16 of the issued report. */
const WATSON_CERTS: { file: string; number: string; on: string; due: string; serials: string[] }[] =
  [
    {
      file: "QATECH-BHIWANDI-08-25-PDL-17",
      number: "QATECH/BHIWANDI/08/25/PDL-17",
      on: "2025-08-11",
      due: "2026-08-10",
      serials: ["62281257", "62283621"],
    },
    {
      file: "QATECH-BHIWANDI-09-25-PDL-26",
      number: "QATECH/BHIWANDI/09/25/PDL-26",
      on: "2025-09-11",
      due: "2026-09-10",
      serials: ["62230434"],
    },
    {
      file: "QATECH-BHIWANDI-09-25-PDL-08",
      number: "QATECH/BHIWANDI/09/25/PDL-08",
      on: "2025-09-03",
      due: "2026-09-02",
      serials: ["62220170", "62219287"],
    },
    {
      file: "QATECH-BHIWANDI-08-25-PDL-11",
      number: "QATECH/BHIWANDI/08/25/PDL-11",
      on: "2025-08-07",
      due: "2026-08-06",
      serials: ["62283645", "62273014"],
    },
    {
      file: "QATECH-BHIWANDI-08-25-PDL-16",
      number: "QATECH/BHIWANDI/08/25/PDL-16",
      on: "2025-08-09",
      due: "2026-08-08",
      serials: ["62283553"],
    },
    {
      file: "QATECH-BHIWANDI-08-25-PDL-12",
      number: "QATECH/BHIWANDI/08/25/PDL-12",
      on: "2025-08-07",
      due: "2026-08-06",
      serials: ["62283563"],
    },
  ];
const certFile = (name: string) => file("client", "BE-WF-02 certificates", `${name}.pdf`);

const DATASETS: Dataset[] = [
  {
    title: "Watson BE-WF-02 walk-in freezer (May 2026), against the issued report",
    files: [file("client", "BE-WF-02 raw data.xlsx"), ...WATSON_CERTS.map((c) => certFile(c.file))],
    client: {
      name: `Watson Pharma ${run} Pvt Limited`,
      short: `WAT${run}`,
      site: "Seawoods",
      city: "Navi Mumbai",
    },
    equipment: {
      code: "BE-WF-02",
      name: "Cold Storage (Walk In Freezer)",
      type: "Walk-in freezer",
      make: "Blue Star",
      setPoint: "-24",
      low: "-30",
      high: "-15",
      inside: 9,
      ambient: false,
      interval: "10",
      // The issued report is one 24-hour "Temperature Mapping Study".
      cycles: ["Loaded"],
    },
    loggers: async (page) => {
      await addBatch(
        page,
        "ebro EBI 20-TH1",
        `W${run}-`,
        WATSON_CAL.map((c) => c[0]),
      );
      // The real scans, one certificate covering one or two loggers, uploaded together.
      await uploadScans(page, WATSON_CERTS);
    },
    model: "ebro EBI 20-TH1",
    serials: WATSON_CAL.map((c) => c[0]),
    job: { start: "2026-05-22", end: "2026-05-23" },
    data: file("client", "BE-WF-02 raw data.xlsx"),
    period: /22-05-2026, 10:30 PM to 23-05-2026, 10:30 PM \(24 h\)/,
    // Page 5 of the issued report.
    rows: [
      { pos: "L-01", serial: "62281257", t: ["-22.9", "-17.9", "-21.0"] },
      { pos: "L-02", serial: "62230434", t: ["-23.4", "-18.7", "-21.8"] },
      { pos: "L-03", serial: "62283621", t: ["-22.8", "-18.5", "-21.7"] },
      { pos: "L-04", serial: "62220170", t: ["-23.0", "-20.0", "-21.9"] },
      { pos: "L-05", serial: "62283645", t: ["-17.6", "-15.0", "-16.7"] },
      { pos: "L-06", serial: "62273014", t: ["-21.9", "-19.0", "-21.1"] },
      { pos: "L-07", serial: "62219287", t: ["-23.0", "-17.8", "-21.1"] },
      { pos: "L-08", serial: "62283553", t: ["-23.3", "-15.0", "-19.7"] },
      { pos: "L-09", serial: "62283563", t: ["-22.9", "-18.7", "-21.3"] },
    ],
    hot: "L-05",
    cold: "L-04",
    verdict: /QUALIFIED/,
    masters: false,
  },
  {
    title:
      "Glenmark WH013 Dispensing-2, temperature and RH (Sep 2026), against the export's summary",
    files: [
      file("client", "Dispensing-2 WH013.xlsx"),
      file(
        "real",
        "fwtraceability_",
        "CALIBRATION CERTIFICATE 2026-2027",
        "Pre Post Calibration Certificate",
        "Yearly Traceability",
        "Indore",
        "23.07.2026 PDL-12.xlsx",
      ),
    ],
    client: {
      name: `Glenmark ${run} Pharmaceuticals Limited`,
      short: `GLN${run}`,
      site: "Indore",
      city: "Pithampur",
    },
    equipment: {
      code: "WH013",
      name: "Dispensing -2",
      type: "Room (dispensing, sampling, clean room)",
      room: true,
      low: "",
      high: "25",
      rhHigh: "40",
      inside: 5,
      ambient: true,
      interval: "10",
    },
    loggers: async (page) => {
      // The real yearly certificate of QA Tech's Indore loggers registers them and their calibration.
      await importWorkbook(
        page,
        file(
          "real",
          "fwtraceability_",
          "CALIBRATION CERTIFICATE 2026-2027",
          "Pre Post Calibration Certificate",
          "Yearly Traceability",
          "Indore",
          "23.07.2026 PDL-12.xlsx",
        ),
        `G${run}-`,
        "Testo 174H",
      );
    },
    model: "Testo 174H",
    serials: ["83561878", "83562086", "83563766", "83597943", "83623686", "84197505"],
    job: { start: "2026-09-13", end: "2026-09-14" },
    data: file("client", "Dispensing-2 WH013.xlsx"),
    period: /13-09-2026, 06:00 PM to 14-09-2026, 06:00 PM \(24 h\)/,
    // The export's own Minimum / Maximum / Average rows.
    rows: [
      {
        pos: "L-01",
        serial: "83561878",
        t: ["22.0", "22.4", "22.2"],
        rh: ["30.6", "34.6", "32.1"],
      },
      {
        pos: "L-02",
        serial: "83562086",
        t: ["22.1", "22.6", "22.4"],
        rh: ["34.0", "38.2", "35.6"],
      },
      {
        pos: "L-03",
        serial: "83563766",
        t: ["22.3", "22.7", "22.5"],
        rh: ["26.4", "30.4", "27.8"],
      },
      {
        pos: "L-04",
        serial: "83597943",
        t: ["21.9", "22.5", "22.2"],
        rh: ["29.8", "34.7", "31.5"],
      },
      {
        pos: "L-05",
        serial: "83623686",
        t: ["22.2", "22.6", "22.4"],
        rh: ["32.6", "36.6", "34.1"],
      },
      { pos: "AMB", serial: "84197505", t: ["23.8", "28.6", "24.9"], rh: ["74.4", "93.7", "88.4"] },
    ],
    hot: "L-03",
    cold: "L-01",
    verdict: /QUALIFIED/,
    masters: true,
  },
];

// ---------------------------------------------------------------- steps

async function addBatch(page: Page, model: string, prefix: string, serials: string[]) {
  await page.goto("/instruments");
  await page.getByRole("button", { name: "Add a batch" }).click();
  const dialog = page.getByRole("dialog");
  const option = dialog.getByLabel("Model").locator("option", { hasText: model }).first();
  await dialog.getByLabel("Model").selectOption((await option.getAttribute("value"))!);
  await dialog.getByLabel("ID prefix").fill(prefix);
  await dialog.getByLabel("Serial numbers").fill(serials.join("\n"));
  await dialog.getByRole("button", { name: `Add ${serials.length} instruments` }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
}

async function uploadScans(page: Page, certs: typeof WATSON_CERTS) {
  await page.goto("/instruments/certificates/upload");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles(certs.map((c) => certFile(c.file)));
  for (const c of certs) {
    const row = page.getByRole("listitem").filter({ hasText: `${c.file}.pdf` });
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Opened for editing when it needs typing; "Edit" opens it otherwise.
    const ids = row.getByRole("textbox", { name: /^Instrument IDs/ });
    const edit = row.getByRole("button", { name: "Edit" });
    await expect(ids.or(edit).first()).toBeVisible();
    if (await edit.isVisible()) await edit.click();
    const set = async (label: string, value: string) => {
      const field = row.getByLabel(new RegExp(`^${label}`));
      await field.fill(value);
      await field.blur();
    };
    await set("Instrument IDs", c.serials.join(", "));
    await set("Certificate no.", c.number);
    await set("Lab", "QA Tech");
    await set("Calibrated on", c.on);
    await set("Due", c.due);
  }
  await page.getByRole("button", { name: `Save ${certs.length} certificates` }).click();
  for (const c of certs) await expect(page.getByText(`Recorded ${c.number}.`)).toBeVisible();
}

async function importWorkbook(page: Page, workbook: string, prefix: string, model: string) {
  await page.goto("/instruments/import");
  await page.locator("input[type=file]").first().setInputFiles(workbook);
  await expect(page.getByText(path.basename(workbook))).toBeVisible();
  const ids = page.getByLabel("ID prefix");
  if (await ids.isVisible()) {
    await ids.fill(prefix);
    const option = page
      .getByLabel("Model, when the file doesn't say")
      .locator("option", { hasText: model })
      .first();
    await page
      .getByLabel("Model, when the file doesn't say")
      .selectOption((await option.getAttribute("value"))!);
    await page.getByRole("button", { name: "Check again" }).click();
  }
  await page
    .getByRole("button", { name: /^Import \d+ instruments? and \d+ certificates?/ })
    .click();
  await expect(page.getByText(/^Imported \d+ instruments? and \d+ certificates?/)).toBeVisible({
    timeout: 30_000,
  });
}

async function addClientAndEquipment(page: Page, d: Dataset) {
  await page.goto("/clients");
  await page.getByRole("button", { name: "Add client" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company name").fill(d.client.name);
  await dialog.getByLabel("Short name").fill(d.client.short);
  await dialog.getByLabel("Site name").fill(d.client.site);
  await dialog.getByLabel("City").fill(d.client.city);
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: d.client.name })).toBeVisible();

  const e = d.equipment;
  await page.getByRole("link", { name: "Add equipment" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^Add equipment/ })).toBeVisible();
  if (e.room) await page.getByRole("radio", { name: /Room or area/ }).check();
  await page.getByLabel("Type").selectOption({ label: e.type });
  await page.getByLabel(e.room ? "Room ID" : "Equipment ID").fill(e.code);
  await page.getByLabel(e.room ? "Room name" : "Equipment name").fill(e.name);
  if (e.make) await page.getByLabel("Make").fill(e.make);
  if (e.setPoint) await page.getByLabel("Set point").fill(e.setPoint);
  await page.getByLabel("Lowest allowed").fill(e.low);
  await page.getByLabel("Highest allowed").fill(e.high);
  if (e.rhHigh) {
    // One-sided, as on the client's sheet (NMT 40 %RH): the type's lower RH default is cleared.
    await page.getByLabel("Lowest RH").fill("");
    await page.getByLabel("Highest RH").fill(e.rhHigh);
  }
  await page.getByLabel("Number of loggers").fill(String(e.inside + (e.ambient ? 1 : 0)));
  await page.getByLabel("Reading every").fill(e.interval);
  await page.getByLabel("Study duration").fill("24");
  if (e.cycles) {
    for (const c of [
      "Empty",
      "Loaded",
      "Door open",
      "Power failure",
      "Minimum load",
      "Maximum load",
    ]) {
      await page.getByRole("checkbox", { name: c, exact: true }).setChecked(e.cycles.includes(c));
    }
  }
  await page.getByRole("button", { name: /^Add (equipment|room|area)/i }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`^${e.code}`) }),
  ).toBeVisible();
}

async function jobToStudy(page: Page, d: Dataset): Promise<string> {
  await page.goto("/jobs/new");
  await page
    .getByRole("combobox", { name: "Client", exact: true })
    .selectOption({ label: `${d.client.name} (${d.client.short})` });
  await page.getByRole("button", { name: "Tick all" }).click();
  await page.getByLabel("First day on site").fill(d.job.start);
  await page.getByLabel("Last day (loggers back)").fill(d.job.end);
  await page.getByLabel("PO number").fill(`PO/${d.client.short}/${run}`);
  await page.getByRole("button", { name: "Create job with 1 item" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^QT\/\d{2}\/\d{4}\/\d{4}$/ }),
  ).toBeVisible();

  await page.getByLabel("Gate pass number").fill(`GP/${run}`);
  await page.getByRole("button", { name: "Save gate pass" }).click();

  // Book the export's loggers by pasting their serials, as QA Tech does from the sheet.
  const model = page.getByLabel("Model", { exact: true });
  await expect(model).toBeVisible();
  const option = model.locator("option", { hasText: d.model }).first();
  await model.selectOption((await option.getAttribute("value"))!);
  await page.getByRole("button", { name: "Paste a list or a range instead" }).click();
  await page.getByLabel(/IDs or serials, or a range/).fill(d.serials.join(" "));
  const n = d.serials.length;
  await page.getByRole("button", { name: `Book ${n} logger${n === 1 ? "" : "s"}` }).click();
  await expect(
    page.getByRole("heading", { name: `Booked: ${n} logger${n === 1 ? "" : "s"}` }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready: start field work" })).toBeVisible();

  await page.getByRole("link", { name: d.equipment.code, exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(d.equipment.code) }),
  ).toBeVisible();
  return page.url().split("?")[0]!;
}

async function layOutAndPlace(page: Page, d: Dataset, study: string) {
  await page.goto(`${study}?tab=layout`);
  const total = d.equipment.inside + (d.equipment.ambient ? 1 : 0);
  await page.getByRole("button", { name: `Fill ${total} positions` }).click();
  if (d.equipment.ambient) {
    // The template fills every logger inside; the last one goes outside instead.
    await page.getByRole("button", { name: `Remove L-${String(total).padStart(2, "0")}` }).click();
    await page.getByRole("button", { name: "Ambient", exact: true }).click();
  }
  await page.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByText(`Saved ${total} positions.`)).toBeVisible();

  await page.goto(`${study}?tab=loggers`);
  const box = page.getByLabel("Logger ID or serial number");
  for (const [i, serial] of d.serials.entries()) {
    await box.fill(serial);
    await box.press("Enter");
    await expect(page.getByText(`${i + 1} of ${total} positions have a logger.`)).toBeVisible();
  }
  await expect(page.getByText(`${total} of ${total} positions have a logger.`)).toBeVisible();
}

async function dataPeriodAndConfirm(page: Page, d: Dataset, study: string) {
  // The data first: the job is Ready, nobody tapped Start on site.
  await page.goto(`${study}?tab=data`);
  await page.getByLabel("Logger export file").setInputFiles(d.data);
  const read = page.getByText(/Nothing wrong found\./);
  const refused = page.getByRole("alert").filter({ hasText: /\w/ });
  await expect(read.or(refused).first()).toBeVisible({ timeout: 30_000 });
  // A refused upload names its reason in the failure.
  expect(await refused.allInnerTexts()).toEqual([]);
  await expect(read).toBeVisible();
  await page.getByRole("link", { name: "Next: choose the report's start and end" }).click();

  // The period comes from the data; saving and confirming closes the step.
  await expect(page.getByText(d.period).first()).toBeVisible();
  await page.getByRole("button", { name: "Save the period" }).click();
  await expect(
    page.getByText("Report period saved; the data is checked again for it."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm the data is complete" }).click();
  await expect(page.getByText(/^Data confirmed/).first()).toBeVisible();
}

async function analyse(page: Page, d: Dataset, study: string) {
  await page.goto(`${study}?tab=analysis`);
  await page.getByRole("button", { name: "Run the analysis" }).click();
  await expect(page.getByText(/Run \d+ done\./)).toBeVisible({ timeout: 30_000 });
  for (const r of d.rows) {
    const row = page.getByRole("row").filter({ hasText: r.serial });
    // The page prints a true minus sign (−); the expected values use "-".
    const cells = (await row.first().innerText())
      .replace(/\u2212/g, "-")
      .split(/\t|\n/)
      .map((s) => s.trim());
    const nums = cells.filter((c) => /^-?\d+\.\d$/.test(c));
    expect(nums.slice(0, 3), `${r.pos} ${r.serial} °C min/max/avg`).toEqual(r.t);
    if (r.rh) expect(nums.slice(3, 6), `${r.pos} ${r.serial} %RH min/max/avg`).toEqual(r.rh);
  }
  await expect(page.getByText(new RegExp(`at ${d.hot}: .* hot spot`))).toBeVisible();
  await expect(page.getByText(new RegExp(`at ${d.cold}: .* cold spot`))).toBeVisible();
  await page.getByRole("button", { name: /^Approve run \d+$/ }).click();
  await expect(page.getByText(/^Run \d+ approved\.$/)).toBeVisible();
}

async function reportPdf(page: Page, d: Dataset, study: string, out: string) {
  await page.goto(`${study}?tab=report`);
  await page.getByRole("button", { name: "Draft the report" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("Rev 00 drafted.");
  await page.getByRole("button", { name: "Send Rev 00 for checking" }).click();
  await expect(page.getByText("Rev 00 · With the checker")).toBeVisible({ timeout: 60_000 });
  const href = await page.getByRole("link", { name: "Download Rev 00" }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  // The logo is drawn as an image in the letterhead.
  expect(bytes.toString("latin1")).toMatch(/\/Subtype \/Image/);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  checkPdfText(d, out);
}

/** The PDF's own text, read with poppler's pdftotext where it is installed. */
function checkPdfText(d: Dataset, pdf: string) {
  let text: string;
  try {
    text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
  } catch {
    return;
  }
  const flat = text.replace(/[ \t]+/g, " ");
  // Every logger on page 3 with its range and accuracy, not a bare "Data Logger".
  for (const r of d.rows) {
    expect(flat, `${r.serial} has its range on the logger table`).toMatch(
      new RegExp(`${r.serial} -?\\d+ to -?\\d+ °C`),
    );
  }
  expect(flat).not.toMatch(/^ ?Data Logger \d+ \d{2}\.\d{2}\.\d{4}/m);
  // The masters behind the loggers' certificates.
  if (d.masters) expect(flat).not.toMatch(/No master recorded on the loggers' certificates/);
  // The summary table: min, max, average and MKT of every position, as on the Analysis tab.
  expect(flat).toMatch(/MKT \(°C\)/);
  for (const r of d.rows) {
    // A HOT SPOT / COLD SPOT tag can push the numbers to the next text line.
    const nums = [...r.t, "-?\\d+\\.\\d\\d", ...(r.rh ?? [])]
      .map((n) => n.replace(/^(-?\d+)\.(\d)$/, "$1\\.$2"))
      .join("\\s+");
    expect(text, `${r.pos} on the summary table`).toMatch(
      new RegExp(`${r.pos}(?: \\(Ambient\\))?(?:\\s*(?:HOT|COLD) SPOT)?\\s+${nums}`),
    );
  }
  expect(flat).toMatch(d.verdict);
}

// ---------------------------------------------------------------- the runs

for (const d of DATASETS) {
  test(`real data: ${d.title}`, async ({ page, isMobile }, info) => {
    test.skip(isMobile, "One desktop run per study.");
    test.skip(!d.files.every((f) => existsSync(f)), "Client files are not in fixtures/.");
    test.setTimeout(240_000);
    const errors = trackErrors(page);
    await signIn(page, "admin");
    await d.loggers(page);
    await addClientAndEquipment(page, d);
    await page.context().clearCookies();
    await signIn(page, "lead");
    const study = await jobToStudy(page, d);
    await layOutAndPlace(page, d, study);
    await dataPeriodAndConfirm(page, d, study);
    await analyse(page, d, study);
    await reportPdf(page, d, study, info.outputPath(`${d.equipment.code}.pdf`));
    expect(errors).toEqual([]);
  });
}
