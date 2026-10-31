import { expect, test, type Page } from "@playwright/test";

import { signIn, trackErrors } from "./support";

async function openStudy(page: Page) {
  await page.goto("/studies");
  await page.getByRole("link", { name: /FE-WF-04/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /FE-WF-04/ })).toBeVisible();
}

test("phase 7 exit test: a logger failing post-cal opens a deviation that locks approval until the client QA head decides; L-05 is the hot spot; the team leader approves the rerun", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "One run per database: the desktop project does it.");
  test.setTimeout(180_000);
  const year = new Date().getFullYear();

  // ---- the field engineer does post-calibration when the loggers are back
  const errors = trackErrors(page);
  await signIn(page, "engineer");
  await openStudy(page);
  await page.getByRole("link", { name: /^Post-cal/ }).click();
  await expect(page.getByText("9 still to check (tap to fill in)")).toBeVisible();
  for (let i = 1; i <= 9; i += 1) {
    await page.getByRole("button", { name: `L-0${i} · G-TRH000${i}` }).click();
    await page.getByLabel("Master reads").fill("-20.0");
    await page.getByLabel("Logger reads").fill(i === 4 ? "-18.5" : "-20.1");
    await page.getByRole("button", { name: "Check" }).click();
    if (i === 4) {
      await expect(page.locator("p[role=alert]")).toContainText(
        `G-TRH0004: FAIL, deviation 1.5 (allowed ±`,
      );
      await expect(page.locator("p[role=alert]")).toContainText(
        `Deviation QT/DEV/${year}/0001 opened; see the Analysis tab.`,
      );
    } else {
      await expect(page.locator("p[role=status]")).toContainText(`G-TRH000${i}: PASS`);
    }
  }
  await expect(page.getByText(/still to check/)).toHaveCount(0);
  expect(errors).toEqual([]);

  // ---- the team leader analyses, works the deviation and approves
  const ctx = await browser.newContext();
  const lead = await ctx.newPage();
  const leadErrors = trackErrors(lead);
  await signIn(lead, "lead");
  await openStudy(lead);
  // Data is confirmed: the study opens on its Analysis tab.
  await expect(lead.getByText("Not analysed yet")).toBeVisible();
  await lead.getByRole("button", { name: "Run the analysis" }).click();
  await expect(lead.locator("p[role=status]")).toContainText(/Run \d+ done\./);
  await expect(lead.getByText(/Average maximum temperature at\s+L-05/)).toBeVisible();
  await expect(lead.getByText("Outside limits")).toBeVisible();

  const deviation = lead.getByRole("article", { name: `QT/DEV/${year}/0001` });
  await expect(deviation).toContainText("G-TRH0004 (L-04) failed post-calibration");
  await expect(deviation).toContainText("Impact (run");
  await expect(lead.getByText(`Deviation open: QT/DEV/${year}/0001.`)).toBeVisible();
  await expect(lead.getByText(/1 excursion not reviewed/)).toBeVisible();

  // The excursion: L-05 above −15 for 30 min.
  await expect(lead.getByText(/L-05\s+above\s+−15\.0\s+°C for 30 min/)).toBeVisible();
  await lead.getByRole("button", { name: "Accept with a reason" }).click();
  await lead
    .getByLabel("Why it is acceptable")
    .fill("Loading of 40 cartons, door log entry at the same time");
  await lead.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(lead.locator("p[role=status]")).toContainText("Excursion accepted.");

  // QA Tech's assessment, then the client's decision.
  await deviation.getByRole("button", { name: "Write assessment" }).click();
  await deviation
    .getByLabel("QA Tech's assessment")
    .fill("L-04 read 1.5 °C high after the study; the client prefers to leave it out.");
  await deviation.getByRole("button", { name: "Save assessment" }).click();
  await expect(lead.locator("p[role=status]")).toContainText("Assessment saved.");
  await deviation.getByRole("button", { name: "Record client decision" }).click();
  await deviation.getByLabel("Decision of the client's QA head").selectOption("exclude_probe");
  await deviation.getByLabel("Decided by").fill("Dr. R. Shah");
  await deviation.getByLabel("Title").fill("Head QA");
  await deviation.getByRole("button", { name: "Record and close" }).click();
  await expect(lead.locator("p[role=status]")).toContainText(`QT/DEV/${year}/0001 closed.`);
  await expect(deviation).toContainText("Exclude probe, Dr. R. Shah (Head QA)");

  // Leaving L-04 out makes the run out of date; rerun and approve.
  await expect(lead.getByText(/out of date/).first()).toBeVisible();
  await lead.getByRole("button", { name: "Run the analysis again" }).click();
  await expect(lead.locator("p[role=status]")).toContainText(/Run \d+ done\./);
  await expect(
    lead.getByText(/L-04 left out: QT\/DEV\/\d{4}\/0001, decided by Dr. R. Shah/),
  ).toBeVisible();
  await expect(lead.getByText("Everything is reviewed: ready to approve.")).toBeVisible();
  await lead.getByRole("button", { name: /^Approve run \d+$/ }).click();
  await expect(lead.locator("p[role=status]")).toContainText(/Run \d+ approved\./);
  await expect(lead.getByText(/approved by Tarun Lead/)).toBeVisible();
  expect(leadErrors).toEqual([]);
  await ctx.close();
});
