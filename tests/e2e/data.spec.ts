import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

import { signIn, trackErrors } from "./support";

const MIN = 60_000;
const SERIALS = Array.from({ length: 9 }, (_, i) => `7720${String(i + 1).padStart(4, "0")}`);

/**
 * The site's logger export for FE-WF-03, laid out like WH013's Rawdata
 * sheet. It runs from 30 h ago to now on the 10-minute grid, which covers
 * the fixture's 24 h study (ended 2 h ago). `gap` drops two readings of the
 * third logger 12 h ago.
 */
async function loggerExport(gap = false) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `e2e ${gap ? "rev1" : "first"}`;
  const ws = wb.addWorksheet("Rawdata");
  ws.addRow(["Customer Name", null, "M/s. Field E2E Pharma"]);
  ws.addRow([]);
  ws.addRow(["Date", "Time", ...SERIALS.map(Number)]);
  ws.addRow([null, null, ...SERIALS.map(() => "°C")]);
  const step = 10 * MIN;
  const end = Math.floor(Date.now() / step) * step;
  const holeAt = Math.floor((Date.now() - 12 * 3600_000) / step) * step;
  for (let t = end - 30 * 3600_000, k = 0; t <= end; t += step, k += 1) {
    const local = new Date(t + 330 * MIN);
    const date = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
    );
    const time = new Date(Date.UTC(1899, 11, 30, local.getUTCHours(), local.getUTCMinutes()));
    ws.addRow([
      date,
      time,
      ...SERIALS.map((_, i) =>
        gap && i === 2 && (t === holeAt || t === holeAt + step)
          ? null
          : Math.round((-22 + i * 0.3 + (k % 5) * 0.1) * 10) / 10,
      ),
    ]);
  }
  ws.addRow([]);
  ws.addRow(["Minimum", null, ...SERIALS.map(() => -22)]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("phase 6 exit test: the team leader uploads FE-WF-03's data, a 30-min gap sends the job to Data issue, accepting it with a reason clears it, the report period is chosen from the data, and confirming moves the job to Data received", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Data is checked in the office.");
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await signIn(page, "lead");
  await page.goto("/studies");
  await page.getByRole("link", { name: /FE-WF-03/ }).click();
  // A finished study opens on its Data tab.
  await expect(page.getByRole("heading", { name: "Logger data", exact: true })).toBeVisible();
  await expect(page.getByText("No data yet")).toBeVisible();

  const input = page.getByLabel("Logger export file");
  await input.setInputFiles({
    name: "FE-WF-03 raw data.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await loggerExport(),
  });
  await expect(
    page.getByText(/read from “Rawdata”; 9 matched to positions\. Nothing wrong found\./),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Checked: waiting to be confirmed")).toBeVisible();
  await expect(page.getByText(/by serial/).first()).toBeVisible();
  await expect(page.getByRole("img", { name: /^L-01 °C: \d+ readings/ })).toBeVisible();

  // The site resends with a hole in L-03: replace, with the reason.
  await page.getByRole("button", { name: "Replace" }).click();
  await page.getByLabel("Why is it being replaced?").fill("Site resent the export");
  await input.setInputFiles({
    name: "FE-WF-03 raw data rev1.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await loggerExport(true),
  });
  await expect(page.getByText(/1 problem to resolve below/)).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(
      /L-03 \(F-TRH\d+, 77200003\) °C: 2 readings missing between .* \(a 30-min gap\)\./,
    ),
  ).toBeVisible();
  await expect(page.getByText(/Replaced .*: Site resent the export/)).toBeVisible();

  // The job is now in Data issue.
  await page
    .getByRole("link", { name: /E2E|QT\/\d/ })
    .first()
    .click();
  await expect(page.getByText("Data issue").first()).toBeVisible();
  await page.getByRole("link", { name: "Data: problems" }).click();

  // Accept it with a reason, then confirm.
  await page.getByRole("button", { name: "Accept with a reason" }).click();
  await page
    .getByLabel("Why can the study go on?")
    .fill("Logger battery swap; 30 min excluded, see DEV-E2E-01");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Accepted, with the reason recorded.")).toBeVisible();

  // Then Start & end: the report's period is chosen from the data, then confirmed.
  await page.getByRole("link", { name: "Next: choose the report's start and end" }).click();
  await expect(page.getByRole("heading", { name: "Report period" })).toBeVisible();
  await expect(page.getByText(/^Uploaded data: .* \(30 h\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByRole("button", { name: "24 h" }).click();
  await expect(page.getByText(/: 24 h\.$/)).toBeVisible();
  await page.getByLabel("Why does it change?").fill("Report the 24 h the loggers ran");
  await page.getByRole("button", { name: "Save the period" }).click();
  await expect(
    page.getByText("Report period saved; the data is checked again for it."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm the data is complete" }).click();
  await expect(page.getByText(/the job is now Data received/)).toBeVisible();
  await expect(page.getByText("Data confirmed for this period by Tarun Lead.")).toBeVisible();
  await page.getByRole("link", { name: /^Data/ }).first().click();
  await expect(page.getByText(/^Confirmed by Tarun Lead/)).toBeVisible();

  // The original files can be downloaded as uploaded.
  const href = await page.getByRole("link", { name: "Original" }).first().getAttribute("href");
  const file = await page.request.get(href!);
  expect(file.status()).toBe(200);
  expect(file.headers()["x-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
  expect(errors).toEqual([]);
});
