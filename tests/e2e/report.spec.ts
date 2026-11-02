import { createHash } from "node:crypto";

import { devices, expect, test, type Page } from "@playwright/test";

import { USERS, signIn, trackErrors } from "./support";

/** Signs the open password dialog as `who`. */
async function sign(page: Page, button: string | RegExp, who: keyof typeof USERS) {
  await page.getByRole("button", { name: button }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your password").fill(USERS[who].password);
  await dialog.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

test("phase 8–10: FE-WF-05's report is drafted, signed four times (the client on a phone), then the WCR, invoice and payment close the job", async ({
  page,
  isMobile,
  browser,
}) => {
  test.skip(isMobile, "One run per database: the desktop project does it.");
  test.setTimeout(240_000);
  const errors = trackErrors(page);

  // ---- Team leader: drafts and signs Done By.
  await signIn(page, "lead");
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: /Analysis approved, report not started/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /FE-WF-05/ }).click();
  await expect(page).toHaveURL(/\/studies\/[0-9a-f-]{36}\?tab=report$/);
  const studyUrl = page.url();
  await expect(page.getByText("No report yet")).toBeVisible();
  await page.getByRole("button", { name: "Draft the report" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("Rev 00 drafted.");
  await expect(page.getByText("Rev 00 · Draft")).toBeVisible();

  // The preview is the PDF itself, marked DRAFT, and only our own page may frame it.
  const frame = page.locator("iframe[title='Report Rev 00']");
  await expect(frame).toBeVisible();
  const src = await frame.getAttribute("src");
  const draft = await page.request.get(src!);
  expect(draft.headers()["content-type"]).toBe("application/pdf");
  expect(draft.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(draft.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect((await draft.body()).subarray(0, 5).toString()).toBe("%PDF-");

  const conclusion = page.getByLabel("Conclusion", { exact: true });
  await expect(conclusion).toHaveValue(/accepted: Door opened for loading, logged on site/);
  await conclusion.fill(
    "The above mentioned equipment Cold Storage (Walk In Freezer 4) (FE-WF-05) is monitored for Temperature Mapping Study. L-05 went above -15°C for 30 min during loading (accepted). The equipment is in compliance with the defined criteria (-15°C To -25°C) & qualified for its further use.",
  );
  await page.getByRole("button", { name: "Save conclusion" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("Conclusion saved.");

  // A wrong password signs nothing.
  await page.getByRole("button", { name: "Sign Done By and send Rev 00 for checking" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your password").fill("not my password");
  await dialog.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "That password is incorrect. Nothing was signed.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await sign(page, "Sign Done By and send Rev 00 for checking", "lead");
  await expect(page.getByText("Rev 00 · With the checker")).toBeVisible();
  await expect(page.getByText("You signed Done By on Rev 00.")).toBeVisible();

  // ---- Manager: checks and releases.
  await page.context().clearCookies();
  await signIn(page, "manager");
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: /Waiting for a check/ })).toBeVisible();
  await page.goto(studyUrl);
  await sign(page, "Sign Checked By", "manager");
  await expect(page.getByText("Rev 00 · Checked")).toBeVisible();
  await expect(page.getByText(/Checked By: Meera Manager/)).toBeVisible();
  await expect(page.getByLabel(/Priya Client/)).toBeChecked();
  await page.getByRole("button", { name: "Release to the client" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("Rev 00 released to the client.");
  const mailto = await page.getByRole("link", { name: "Open in my email" }).getAttribute("href");
  expect(decodeURIComponent(mailto!)).toContain("qa@client.e2e.test");
  expect(decodeURIComponent(mailto!)).toMatch(/\/client\/reports\/[0-9a-f-]{36}/);
  const reportPath = decodeURIComponent(mailto!).match(/\/client\/reports\/[0-9a-f-]{36}/)![0];

  // ---- Client QA: reviews.
  await page.context().clearCookies();
  await signIn(page, "clientQa");
  await expect(page.getByRole("heading", { name: /For your signature \(1\)/ })).toBeVisible();
  await page.getByRole("link", { name: /FE-WF-05/ }).click();
  await expect(page).toHaveURL(new RegExp(`${reportPath}$`));
  const clientPdf = await page.request.get(`${reportPath}/pdf`);
  expect(clientPdf.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(clientPdf.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  await sign(page, "Sign Reviewed By", "clientQa");
  await expect(page.getByText("You signed Reviewed By.")).toBeVisible();
  // Client users never reach QA Tech's screens.
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/client$/);
  expect(errors).toEqual([]);

  // ---- Client QA head: approves, on a phone.
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  const mobile = await phone.newPage();
  const mobileErrors = trackErrors(mobile);
  await signIn(mobile, "clientHead");
  await mobile.getByRole("link", { name: /FE-WF-05/ }).click();
  await expect(mobile.getByRole("link", { name: "Open Rev 00 to read it" })).toBeVisible();
  await sign(mobile, "Sign Approved By", "clientHead");
  await expect(mobile.getByText(/Approved\. The signed report is issued/)).toBeVisible();
  await expect(mobile.getByText("Signed", { exact: true })).toBeVisible();

  // The issued copy comes back byte for byte, with its hash.
  const issued = await mobile.request.get(`${reportPath}/pdf`);
  expect(
    createHash("sha256")
      .update(await issued.body())
      .digest("hex"),
  ).toBe(issued.headers()["x-content-sha256"]);
  await mobile.goto("/client");
  await expect(mobile.getByRole("heading", { name: /Signed reports \(1\)/ })).toBeVisible();
  expect(mobileErrors).toEqual([]);
  await phone.close();

  // ---- QA Tech sees it signed.
  await page.context().clearCookies();
  await signIn(page, "lead");
  await page.goto(studyUrl);
  await expect(page.getByText("Rev 00 · Signed")).toBeVisible();
  await expect(page.getByText(/Approved By: Sunil Client/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a new revision" })).toBeVisible();

  // ---- Phase 10. Manager: issues the WCR from Billing.
  await page.context().clearCookies();
  await signIn(page, "manager");
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: /WCR to issue \(1\)/ })).toBeVisible();
  await page.getByRole("link", { name: /every report is with the client/ }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}#money$/);
  const jobUrl = page.url().replace(/#money$/, "");
  await page.getByRole("button", { name: "Issue the WCR" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("WCR issued. Send it to the client.");
  const wcrHref = await page.getByRole("link", { name: "Open the WCR" }).getAttribute("href");
  const wcr = await page.request.get(wcrHref!);
  expect(wcr.headers()["content-type"]).toBe("application/pdf");

  // ---- Client QA head: accepts it.
  await page.context().clearCookies();
  await signIn(page, "clientHead");
  await expect(
    page.getByRole("heading", { name: /Work completion reports to accept \(1\)/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /^WCR\// }).click();
  await sign(page, "Accept the work (sign)", "clientHead");
  await expect(page.getByText(/Accepted\. QA Tech has been told/)).toBeVisible();

  // ---- Manager: records the Tally invoice and the payment, then closes the job.
  await page.context().clearCookies();
  await signIn(page, "manager");
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: /Invoice due \(1\)/ })).toBeVisible();
  await page.goto(jobUrl);
  await expect(page.getByText(/Invoice due: the WCR was signed 0 days ago/)).toBeVisible();
  await page.getByLabel("Invoice No.").fill("QT/E2E/001");
  await page.getByLabel(/Taxable value/).fill("20000");
  await expect(page.getByLabel(/GST \(₹/)).toHaveValue("3600");
  await page.getByRole("button", { name: "Record invoice" }).click();
  await expect(page.locator("p[role=status]").first()).toHaveText("Invoice recorded.");
  await expect(page.getByText("Invoiced", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Invoice QT\/E2E\/001 isn't fully paid\./)).toBeVisible();
  await page.getByText("Record a payment").click();
  // Suggested: the balance less 2% TDS on the taxable value.
  await expect(page.getByLabel("Received (₹)")).toHaveValue("23200");
  await expect(page.getByLabel("TDS deducted (₹)")).toHaveValue("400");
  await page.getByLabel("UTR or cheque No.").fill("UTR0001E2E");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.locator("p[role=status]").first()).toHaveText(
    "Payment recorded. Invoice QT/E2E/001 cleared.",
  );
  await page.reload();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close the job" }).click();
  await expect(page.locator("p[role=status]")).toHaveText("Job closed. It is in the History now.");
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
