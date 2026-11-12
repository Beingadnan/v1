import { expect, test, type Page } from "@playwright/test";

import { signIn, trackErrors } from "./support";

/** Unique per run, so the tests don't depend on what earlier runs left in the database. */
const run = String(Date.now() % 1_000_000).padStart(6, "0");

async function addFreezer(page: Page, code: string, lastStudy: string) {
  await page.getByRole("link", { name: "Add equipment" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^Add equipment/ })).toBeVisible();
  await page.getByLabel("Equipment ID").fill(code);
  await page.getByLabel("Equipment name").fill("Cold Storage (Walk In Freezer)");
  await page.getByLabel("Type").selectOption({ label: "Walk-in freezer" });
  await page.getByLabel("Lowest allowed").fill("-30");
  await page.getByLabel("Highest allowed").fill("-15");
  await page.getByLabel("Number of loggers").fill("1");
  await page.getByLabel("Study duration").fill("24");
  if (lastStudy) await page.getByLabel("Last study ended on").fill(lastStudy);
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${code}`) })).toBeVisible();
  // Back to the client from the breadcrumb (Clients › W… › Seawoods › …).
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link").nth(1).click();
}

async function certify(page: Page, code: string, number: string, due: string) {
  await page.goto(`/instruments?q=${encodeURIComponent(code)}`);
  await page.getByRole("link", { name: code, exact: true }).click();
  await page.getByRole("button", { name: "Record outside-lab certificate" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Laboratory").fill("QA Tech Lab");
  await dialog.getByLabel("Certificate No.").fill(number);
  await dialog.getByLabel("Calibrated on").fill("2026-09-09");
  await dialog.getByLabel("Due date").fill(due);
  await dialog.getByRole("button", { name: "Record certificate" }).click();
  await expect(dialog).toBeHidden();
}

test("phase 4 exit test: a Watson job with 2 freezers, found by PO, held back by an out-of-date logger", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Built once on desktop; the phone test below covers the phone layout.");
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  await signIn(page, "admin");

  // The client and its two freezers.
  await page.goto("/clients");
  await page.getByRole("button", { name: "Add client" }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company name").fill(`Watson ${run} Pharma`);
  await dialog.getByLabel("Short name").fill(`W${run}`);
  await dialog.getByLabel("Site name").fill("Seawoods");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Watson ${run} Pharma` })).toBeVisible();
  await addFreezer(page, `WF-${run}-A`, "2025-11-10");
  await addFreezer(page, `WF-${run}-B`, "");

  // Three loggers; the third runs out on 30.06.2030.
  await page.goto("/instruments");
  await page.getByRole("button", { name: "Add a batch" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Model")
    .selectOption({ label: "ebro EBI 20-TH1 — Temp. & RH Datalogger" });
  await dialog.getByLabel("ID prefix").fill(`J${run}-`);
  await dialog.getByLabel("Serial numbers").fill(`7${run}01\n7${run}02\n7${run}03`);
  await dialog.getByRole("button", { name: "Add 3 instruments" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await certify(page, `J${run}-0001`, `JC/${run}/1`, "2031-09-08");
  await certify(page, `J${run}-0002`, `JC/${run}/2`, "2031-09-08");
  await certify(page, `J${run}-0003`, `JC/${run}/3`, "2030-06-30");

  // A new job: both freezers, a PO, dates in June 2030.
  await page.goto("/jobs/new");
  await page
    .getByRole("combobox", { name: "Client", exact: true })
    .selectOption({ label: `Watson ${run} Pharma (W${run})` });
  // Freezer A is due on 09.11.2026, so it comes ticked.
  await expect(page.getByText("1 of 2 ticked · 1 due")).toBeVisible();
  await page.getByRole("button", { name: "Tick all" }).click();
  await page.getByLabel("First day on site").fill("2030-06-03");
  await page.getByLabel("Last day (loggers back)").fill("2030-06-05");
  await page.getByLabel("PO number").fill(`PO-${run}`);
  await page.getByRole("button", { name: "Create job with 2 items" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^QT\/\d{2}\/\d{4}\/\d{4}$/ }),
  ).toBeVisible();
  const jobUrl = page.url();
  await expect(
    page.getByRole("cell", {
      name: `W${run}/Seawoods/06/30/Cold Storage (Walk In Freezer)/WF-${run}-A`,
      exact: true,
    }),
  ).toBeVisible();

  // Book the three loggers by pasting their IDs, then tick the people's items.
  await page.getByRole("button", { name: "Add by ID or serial" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("IDs or serial numbers").fill(`J${run}-0001\nJ${run}-0002, J${run}-0003`);
  await dialog.getByRole("button", { name: "Book" }).click();
  await expect(dialog.getByText(`Booked: J${run}-0001, J${run}-0002, J${run}-0003`)).toBeVisible();
  await page.keyboard.press("Escape");
  for (const item of ["Approved protocol", "Site access / gate pass", "Previous report on hand"]) {
    await page.getByRole("group", { name: item }).getByRole("button", { name: "Ready" }).click();
    await expect(
      page.getByRole("group", { name: item }).getByRole("button", { name: "Ready" }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByText("Everything is in place.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start field work" })).toBeVisible();

  // Found by its PO number.
  await page.goto(`/jobs?q=PO-${run}`);
  await expect(page.getByRole("link", { name: /^QT\/\d{2}\// })).toHaveCount(1);
  await page.getByRole("link", { name: /^QT\/\d{2}\// }).click();
  await expect(page).toHaveURL(jobUrl);

  // The client moves the visit to July: J-0003 is out of date and field work can't start.
  await page.getByRole("button", { name: "Edit details" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("First day on site").fill("2030-07-01");
  await dialog.getByLabel("Last day (loggers back)").fill("2030-07-03");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("is valid only until 30.06.2030").first()).toBeVisible();
  await expect(page.getByText("1 item pending")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start field work" })).toHaveCount(0);

  // Releasing it and booking a spare fixes it.
  await page.getByRole("button", { name: `Release J${run}-0003` }).click();
  await expect(page.getByText("Everything is in place.")).toBeVisible();
  await page.getByRole("button", { name: "Start field work" }).click();
  await expect(page.locator("[data-tone]").first()).toHaveText("Field work");
  expect(errors).toEqual([]);
});

test("the job board fits a phone and hides money from field engineers", async ({ page }) => {
  await signIn(page, "engineer");
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New job" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Rate card" })).toHaveCount(0);
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
  await page.goto("/jobs/rates");
  await expect(page).toHaveURL(/no-access/);
});
