import { expect, test, type Browser, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

import { signIn, trackErrors, USERS } from "./support";

/** A second signed-in person in their own browser context. */
async function asUser(browser: Browser, who: keyof typeof USERS): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, who);
  return page;
}

/** Unique per run, so the tests don't depend on what earlier runs left in the database. */
const run = String(Date.now() % 1_000_000).padStart(6, "0");
const serial = (i: number) => `6${run}${String(i).padStart(2, "0")}`;

async function sign(page: Page, button: string, who: keyof typeof USERS) {
  await page.getByRole("button", { name: button }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your password").fill(USERS[who].password);
  await dialog.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("phase 3 exit test: PDL batch with a valid master, signed by three people, issued as FT-05", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "Built once on desktop; the phone test below covers the phone layout.");
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await signIn(page, "admin");

  // The QA Tech models are there from the start.
  await page.goto("/instruments/models");
  await expect(page.getByText("ebro EBI 20-TH1")).toBeVisible();
  await expect(page.getByText("Testo 174H")).toBeVisible();

  // A master standard with its outside-lab certificate.
  await page.goto("/instruments");
  await page.getByRole("button", { name: "Add instrument" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type").selectOption("reference_thermometer");
  await dialog.getByLabel("QA Tech ID").fill(`QATM/CAL/SSPRT-${run}`);
  await dialog.getByLabel("Serial number").fill("311401/59");
  await dialog.getByLabel("Use").selectOption("master");
  await dialog.getByRole("button", { name: "Add instrument" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `QATM/CAL/SSPRT-${run}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record outside-lab certificate" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Laboratory").fill("ARAI");
  await dialog.getByLabel("Certificate No.").fill(`ARAI/CAL/2609/${run}`);
  await dialog.getByLabel("Calibrated on").fill("2026-09-09");
  await dialog.getByLabel("Due date").fill("2030-09-08");
  await dialog.getByRole("button", { name: "Record certificate" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByText(`ARAI/CAL/2609/${run}`).first()).toBeVisible();

  // Ten new loggers from pasted serials, with consecutive IDs.
  await page.goto("/instruments");
  await page.getByRole("button", { name: "Add a batch" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Model")
    .selectOption({ label: "ebro EBI 20-TH1 — Temp. & RH Datalogger" });
  await dialog.getByLabel("ID prefix").fill(`E${run}-`);
  await dialog
    .getByLabel("Serial numbers")
    .fill(Array.from({ length: 10 }, (_, i) => serial(i)).join("\n"));
  await dialog.getByRole("button", { name: "Add 10 instruments" }).click();
  await expect(
    dialog.getByText(`Added 10 instruments: E${run}-0001 to E${run}-0010.`),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  // The lab technician starts the certificate from a pasted list.
  const lab = await asUser(browser, "lab");
  await lab.goto("/instruments/certificates/new");
  await lab
    .getByLabel("Instruments to calibrate")
    .fill(Array.from({ length: 10 }, (_, i) => serial(i)).join("\n"));
  await lab.getByLabel(new RegExp(`QATM/CAL/SSPRT-${run}`)).check();
  await lab.getByRole("button", { name: "Start certificate" }).click();
  await expect(
    lab.getByRole("heading", { level: 1, name: /^QATECH\/BHIWANDI\/\d{2}\/\d{2}\/PDL-\d{2,}$/ }),
  ).toBeVisible();

  // PDL-17's master readings; logger 1 and 2 as on paper, the rest read exactly.
  const refs = ["-25.084", "15.041", "60.023", "20.44", "50.31", "90.27"];
  const l1 = ["-25", "15", "60.2", "21.1", "50.6", "90.2"];
  const l2 = ["-25.2", "15.2", "59.9", "20.5", "50.31", "90.27"];
  for (const [i, r] of refs.entries())
    await lab.getByLabel(`Point ${i + 1} master reading`).fill(r);
  const block = refs
    .map((r, p) =>
      Array.from({ length: 10 }, (_, c) => (c === 0 ? l1[p] : c === 1 ? l2[p] : r)).join("\t"),
    )
    .join("\n");
  await lab.getByLabel(`E${run}-0001, point 1 reading`).focus();
  await lab.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text", text);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, block);
  await expect(lab.getByText("60 of 60 entered")).toBeVisible();
  // Live deviations, exactly as on the paper certificate.
  for (const d of [
    "Δ 0.084",
    "Δ -0.116",
    "Δ -0.041",
    "Δ 0.159",
    "Δ 0.177",
    "Δ -0.123",
    "Δ 0.66",
    "Δ 0.06",
    "Δ 0.29",
    "Δ -0.07",
  ]) {
    await expect(lab.getByText(d, { exact: true }).first()).toBeVisible();
  }
  await lab.getByRole("button", { name: "Save" }).click();
  await expect(lab.getByText(/Saved\. All readings entered\./)).toBeVisible();

  // Signing needs the lab conditions.
  await lab.getByRole("button", { name: "Sign: calibration done by" }).click();
  dialog = lab.getByRole("dialog");
  await dialog.getByLabel("Your password").fill(USERS.lab.password);
  await dialog.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(
    dialog.getByText("Enter the lab temperature and humidity during calibration."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await lab.getByLabel("Temperature", { exact: true }).fill("23 °C");
  await lab.getByLabel("Humidity", { exact: true }).fill("57 %RH");
  await lab.getByRole("button", { name: "Save" }).click();
  await expect(lab.getByText(/Saved\./)).toBeVisible();
  await sign(lab, "Sign: calibration done by", "lab");
  await expect(lab.getByText("Waiting for check")).toBeVisible();
  const url = lab.url();
  const number = (await lab.getByRole("heading", { level: 1 }).textContent()) ?? "";

  const lead = await asUser(browser, "lead");
  await lead.goto(url);
  await sign(lead, "Sign: certificate checked by", "lead");
  await expect(lead.getByText("Waiting for approval")).toBeVisible();

  const manager = await asUser(browser, "manager");
  await manager.goto(url);
  await sign(manager, "Approve and issue", "manager");
  await expect(manager.getByText("Issued", { exact: true }).first()).toBeVisible();
  await expect(manager.getByText("Meera Manager — approved by")).toBeVisible();

  const pdf = await manager.request.get(`${url}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // The Calibration Index lists it; the logger's chain reaches the ARAI certificate.
  await manager.goto("/instruments/index");
  await expect(manager.getByRole("link", { name: number })).toBeVisible();
  const xlsx = await manager.request.get("/instruments/index/export?year=2026");
  expect(xlsx.status()).toBe(200);
  await manager.goto(`/instruments?q=E${run}-0001`);
  await manager.getByRole("link", { name: `E${run}-0001` }).click();
  await expect(manager.getByText(`ARAI/CAL/2609/${run}`)).toBeVisible();
  await expect(manager.getByText(/^Valid on/).first()).toBeVisible();

  expect(errors).toEqual([]);
});

test("imports a logger list and shows what was skipped", async ({ page, isMobile }) => {
  test.skip(isMobile, "Upload flow is covered on desktop.");
  await signIn(page, "admin");
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Testo Temp.RH(Nagpur)");
  sheet.addRow([
    "SR. No.",
    "Instrument Name",
    "Make ",
    "Model",
    "ID No.",
    "Serial No.",
    "Certificate No.",
    "Range ",
    "Calibration Date  ",
    "Due Date",
  ]);
  sheet.addRow([
    1,
    "Portable Datalogger",
    "Testo",
    "174H",
    `T${run}-1`,
    `9${run}1`,
    `QATECH/BHIWANDI/08/25/PDL-${run}`,
    "-20 to 70 °C",
    "28.08.2025",
    "27.08.2026",
  ]);
  sheet.addRow([
    2,
    "Portable Datalogger",
    "Testo",
    "174H",
    `T${run}-2`,
    `9${run}2`,
    null,
    "-20 to 70 °C",
    "28.08.2025",
    "27.08.2026",
  ]);
  sheet.addRow([
    3,
    "Portable Datalogger",
    "Testo",
    "174H",
    null,
    `9${run}3`,
    null,
    "-20 to 70 °C",
    "28.08.2025",
    "27.08.2026",
  ]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await page.goto("/instruments/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Nagpur site datalogger list.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await expect(page.getByText(`QATECH/BHIWANDI/08/25/PDL-${run}`)).toBeVisible();
  await expect(page.getByText(`Serial 9${run}3 has no ID No.`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Import 2 instruments" }).click();
  await expect(
    page.getByText("Imported 2 instruments and 1 certificate; 1 row skipped."),
  ).toBeVisible();
  await page.goto(`/instruments?q=T${run}-`);
  await expect(page.getByRole("link", { name: `T${run}-2` })).toBeVisible();
});

test("the register fits a phone screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  const errors = trackErrors(page);
  await signIn(page, "admin");
  await page.goto("/instruments");
  await expect(page.getByRole("heading", { level: 1, name: "Instruments" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  await page.goto("/instruments/certificates");
  await expect(
    page.getByRole("heading", { level: 1, name: "Calibration certificates" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
