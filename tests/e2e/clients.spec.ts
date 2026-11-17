import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

import { signIn, trackErrors } from "./support";

test("phase 2 exit test: Watson Pharma → Seawoods → BA → BE-WF-02 with −30 to −15 °C and 9 loggers", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Built once on desktop; the phone test below covers the phone layout.");
  const errors = trackErrors(page);
  await signIn(page, "admin");
  await page.goto("/clients");

  await page.getByRole("button", { name: "Add client" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company name").fill("Watson Pharma Pvt Limited");
  await dialog.getByLabel("Short name").fill("Watson");
  await expect(
    dialog.getByText("Watson/Seawoods/05/26/Cold Storage (Walk In Freezer)/BE-WF-02"),
  ).toBeVisible();
  await dialog.getByLabel("Site name").fill("Seawoods");
  await dialog.getByLabel("City").fill("Navi Mumbai");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Watson Pharma Pvt Limited" }),
  ).toBeVisible();

  // The finder: pick the site, add its department, pick it.
  await page.getByLabel("Site", { exact: true }).selectOption({ label: "Seawoods" });
  await page.waitForURL(/site=/);
  await page.getByRole("button", { name: "Add department at Seawoods" }).click();
  await page.getByRole("dialog").getByLabel("Department name").fill("BA");
  await page.getByRole("dialog").getByRole("button", { name: "Add department" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Department", { exact: true }).selectOption({ label: "BA" });
  await page.waitForURL(/dept=/);
  await expect(page.getByRole("button", { name: "Edit department BA" })).toBeVisible();

  // Added at the chosen site: the department is picked in the form.
  await page.getByRole("link", { name: "Add equipment" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^Add equipment/ })).toBeVisible();
  await page.getByLabel("Department", { exact: true }).selectOption({ label: "BA" });
  await page.getByLabel("Equipment ID").fill("BE-WF-02");
  await page.getByLabel("Equipment name").fill("Cold Storage (Walk In Freezer)");
  await page.getByLabel("Type").selectOption({ label: "Walk-in freezer" });
  await page.getByLabel("Make").fill("Blue Star");
  await page.getByLabel("Set point").fill("-24");
  // Limits typed the wrong way round first: the form explains and keeps everything typed.
  await page.getByLabel("Lowest allowed").fill("-15");
  await page.getByLabel("Highest allowed").fill("-30");
  await page.getByLabel("Number of loggers").fill("9");
  await page.getByLabel("Reading every").fill("10");
  await page.getByLabel("Study duration").fill("24");
  await page.getByLabel("Last study ended on").fill("2026-05-23");
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(
    page.getByText("The highest temperature must be above the lowest.").first(),
  ).toBeVisible();
  await expect(page.getByLabel("Equipment ID")).toHaveValue("BE-WF-02");
  await page.getByLabel("Lowest allowed").fill("-30");
  await page.getByLabel("Highest allowed").fill("-15");
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "BE-WF-02 · Cold Storage (Walk In Freezer)" }),
  ).toBeVisible();
  await expect(page.getByText("22 May 2027")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "BA" })
    .click();
  // Back on the client, with Seawoods and BA picked: its equipment list.
  await expect(page.getByLabel("Department", { exact: true })).toHaveValue(/dept=/);
  await page.getByRole("link", { name: /^Equipment \(1\)/ }).click();
  const row = page
    .getByRole("list", { name: "Equipment list" })
    .getByRole("listitem")
    .filter({ hasText: "BE-WF-02" });
  await expect(row).toContainText("Walk-in freezer");
  await expect(row).toContainText("−30 to −15 °C");
  await expect(row).toContainText("22 May 2027");

  // Found from the list by equipment ID.
  await page.goto("/clients?q=be-wf-02");
  await expect(page.getByRole("link", { name: "Watson Pharma Pvt Limited" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a field engineer can look up clients but not change them", async ({ page }) => {
  await signIn(page, "engineer");
  await page.goto("/clients");
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add client" })).toHaveCount(0);
  await page.goto("/clients/import");
  await expect(page).toHaveURL(/\/no-access$/);
});

test("clients and equipment import from the Excel template", async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop task.");
  const errors = trackErrors(page);
  await signIn(page, "admin");
  await page.goto("/clients/import");

  // The template downloads for a signed-in manager…
  const template = await page.request.get("/clients/import/template");
  expect(template.status()).toBe(200);
  expect(template.headers()["content-type"]).toContain("spreadsheetml");
  // …and not for anyone else.
  expect((await request.get("/clients/import/template", { maxRedirects: 0 })).status()).not.toBe(
    200,
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await template.body()) as unknown as ExcelJS.Buffer);
  wb.getWorksheet("Clients")!.getRow(2).values = [
    "Lupin Limited",
    "Lupin",
    "",
    "",
    "Yes",
    12,
    "Pithampur",
    "PTM",
    "",
    "Indore",
    "Madhya Pradesh",
    "",
  ];
  wb.getWorksheet("Equipment")!.getRow(2).values = [
    "Lupin",
    "Pithampur",
    "Stores",
    "CR-01",
    "Cold Room 1",
    "Cold room",
    "",
    "",
    "",
    "",
    6,
    4,
    3,
    5,
    2,
    8,
    "",
    "",
    15,
    5,
    72,
    "",
    "01.02.2026",
    "",
  ];
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await page.locator("input[type=file]").setInputFiles({
    name: "lupin.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await expect(page.getByText("Lupin Limited (Lupin)")).toBeVisible();
  await expect(page.getByText("Lupin → CR-01 · Cold Room 1")).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ changes$/ }).click();
  await expect(
    page.getByText(/^Imported: 1 new clients, 1 new sites, 1 new departments, 1 new/),
  ).toBeVisible();

  await page.getByRole("link", { name: "Go to clients" }).click();
  await page.getByRole("link", { name: "Lupin Limited" }).click();
  await expect(page.getByText("Required by client SOP")).toBeVisible();
  // Filed under Lupin → Madhya Pradesh → Pithampur → Stores.
  await page.getByLabel("Region", { exact: true }).selectOption({ label: "Madhya Pradesh" });
  await page.waitForURL(/region=/);
  await page.getByLabel("Site", { exact: true }).selectOption({ label: "Pithampur" });
  await page.waitForURL(/site=/);
  await page.getByLabel("Department", { exact: true }).selectOption({ label: "Stores" });
  await page.waitForURL(/dept=/);
  await page.getByRole("link", { name: /^Equipment \(1\)/ }).click();
  await expect(
    page
      .getByRole("list", { name: "Equipment list" })
      .getByRole("listitem")
      .filter({ hasText: "CR-01" }),
  ).toContainText("2 to 8 °C");
  expect(errors).toEqual([]);
});

test("adding a client works on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  const errors = trackErrors(page);
  await signIn(page, "admin");
  await page.goto("/clients");
  await page.getByRole("button", { name: "Add client" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company name").fill("Cipla Limited");
  await dialog.getByLabel("Short name").fill("Cipla");
  await dialog.getByLabel("Site name").fill("Kurkumbh");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cipla Limited" })).toBeVisible();
  await expect(page.getByLabel("Site", { exact: true })).toContainText("Kurkumbh");
  expect(errors).toEqual([]);
});

test("a client QA user is invited from the client's page and only sees the client area", async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop task.");
  await signIn(page, "admin");
  await page.goto("/clients");
  await page.getByRole("button", { name: "Add client" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company name").fill("Sun Pharmaceutical Industries");
  await dialog.getByLabel("Short name").fill("SunPharma");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sun Pharmaceutical Industries" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Invite client user" }).click();
  const invite = page.getByRole("dialog");
  await invite.getByLabel("Full name").fill("Meera Client");
  await invite.getByLabel("Email").fill("meera@sunpharma.test");
  await invite.getByRole("button", { name: "Create invitation" }).click();
  const link = await invite.getByLabel("One-time link").inputValue();
  expect(link).toContain("/set-password?token=");

  const context = await browser.newContext();
  const client = await context.newPage();
  const errors = trackErrors(client);
  await client.goto(new URL(link).pathname + new URL(link).search);
  await client.getByLabel("New password", { exact: true }).fill("cold chain review 2026");
  await client.getByLabel("Type it again").fill("cold chain review 2026");
  await client.getByRole("button", { name: "Save password" }).click();
  await client.getByLabel("Email").fill("meera@sunpharma.test");
  await client.getByLabel("Password").fill("cold chain review 2026");
  await client.getByRole("button", { name: "Sign in" }).click();
  await expect(client).toHaveURL(/\/client$/);
  await expect(
    client.getByText("Reports from QA Tech for Sun Pharmaceutical Industries."),
  ).toBeVisible();

  // Staff screens send client users back to their own area.
  await client.goto("/clients");
  await expect(client).toHaveURL(/\/client$/);
  expect(errors).toEqual([]);
  await context.close();
});

test("choosing a type fills its usual values, and 'Add similar' copies an item", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop task.");
  const errors = trackErrors(page);
  await signIn(page, "admin");
  await page.goto("/clients");
  await page.getByRole("button", { name: "Add client" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Company name").fill("Glenmark Pharmaceuticals");
  await dialog.getByLabel("Short name").fill("Glenmark");
  await dialog.getByLabel("Site name").fill("Sinnar");
  await dialog.getByRole("button", { name: "Add client" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Glenmark Pharmaceuticals" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Add equipment" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^Add equipment/ })).toBeVisible();
  await page.getByLabel("Equipment ID").fill("RF-01");
  await page.getByLabel("Equipment name").fill("Vaccine refrigerator 1");
  await page.getByLabel("Type").selectOption({ label: "Refrigerator" });
  await expect(
    page.getByText(/^Filled \d+ empty fields from the refrigerator defaults/),
  ).toBeVisible();
  await expect(page.getByLabel("Lowest allowed")).toHaveValue("2");
  await expect(page.getByLabel("Highest allowed")).toHaveValue("8");
  await expect(page.getByRole("checkbox", { name: "Power failure" })).toBeChecked();
  // The logger count can come from the size.
  await page.getByLabel("Length").fill("0.7");
  await page.getByLabel("Width").fill("0.7");
  await page.getByLabel("Height").fill("1.8");
  await expect(page.getByText(/Suggested 9: 9 for up to 2 m³/)).toBeVisible();
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "RF-01 · Vaccine refrigerator 1" }),
  ).toBeVisible();
  await expect(page.getByText(/added RF-01 \(Vaccine refrigerator 1\)/)).toBeVisible();

  await page.getByRole("link", { name: "Add similar" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Add equipment like RF-01" }),
  ).toBeVisible();
  await expect(page.getByLabel("Equipment ID")).toHaveValue("");
  await expect(page.getByLabel("Highest allowed")).toHaveValue("8");
  await page.getByLabel("Equipment ID").fill("RF-02");
  await page.getByLabel("Equipment name").fill("Vaccine refrigerator 2");
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "RF-02 · Vaccine refrigerator 2" }),
  ).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Equipment defaults" })).toBeVisible();
  await page.goto("/clients/due?days=180&unknown=1");
  await expect(page.getByRole("link", { name: "RF-02" })).toBeVisible();
  expect(errors).toEqual([]);
});
