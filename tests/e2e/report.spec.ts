import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { signIn, trackErrors } from "./support";

test("phase 8: the team leader drafts FE-WF-05's report from the approved analysis, edits the conclusion, freezes Rev 00 and starts Rev 01", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "One run per database: the desktop project does it.");
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await signIn(page, "lead");

  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: /Analysis approved, report not started/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /FE-WF-05/ }).click();
  await expect(page.getByText("No report yet")).toBeVisible();
  await page.getByRole("button", { name: "Draft the report" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("Rev 00 drafted.");
  await expect(page.getByText("Rev 00 · Draft")).toBeVisible();

  // The preview is the PDF itself, marked DRAFT.
  const frame = page.locator("iframe[title='Report Rev 00']");
  await expect(frame).toBeVisible();
  const src = await frame.getAttribute("src");
  const draft = await page.request.get(src!);
  expect(draft.headers()["content-type"]).toBe("application/pdf");
  expect((await draft.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // The conclusion starts from the template and can be edited.
  const conclusion = page.getByLabel("Conclusion", { exact: true });
  await expect(conclusion).toHaveValue(/accepted: Door opened for loading, logged on site/);
  await expect(conclusion).toHaveValue(/qualified for its further use\.$/);
  await conclusion.fill(
    "The above mentioned equipment Cold Storage (Walk In Freezer 4) (FE-WF-05) is monitored for Temperature Mapping Study. L-05 went above -15°C for 30 min during loading (accepted). The equipment is in compliance with the defined criteria (-15°C To -25°C) & qualified for its further use.",
  );
  await page.getByRole("button", { name: "Save conclusion" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("Conclusion saved.");
  await expect(page.getByText("edited")).toBeVisible();

  await page.getByRole("button", { name: "Freeze Rev 00" }).click();
  await expect(page.locator("p[role=status]")).toContainText(
    /Rev 00 frozen: \d+ pages, SHA-256 [0-9a-f]{12}…/,
    {
      timeout: 60_000,
    },
  );
  await expect(page.getByText("Rev 00 · Frozen")).toBeVisible();

  // The frozen file comes back byte for byte, with its hash.
  const href = await page.getByRole("link", { name: /Download Rev 00/ }).getAttribute("href");
  const frozen = await page.request.get(href!);
  const body = await frozen.body();
  expect(createHash("sha256").update(body).digest("hex")).toBe(
    frozen.headers()["x-content-sha256"],
  );

  await page.getByRole("button", { name: "Start a new revision" }).click();
  await page.getByLabel("Why is it revised?").fill("Client asked to add the department name");
  await page.getByRole("button", { name: "Start revision" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("Rev 01 drafted.");
  await expect(page.getByText("Why: Client asked to add the department name")).toBeVisible();
  expect(errors).toEqual([]);
});
