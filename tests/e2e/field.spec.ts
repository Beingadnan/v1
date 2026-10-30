import { expect, test } from "@playwright/test";

import { signIn, trackErrors } from "./support";

/**
 * Chromium's fake camera stands in for the phone camera, and a stand-in
 * BarcodeDetector "reads" the loggers' serial labels one after another, so
 * the real scanning loop runs end to end.
 */
test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["camera"],
});

const SERIALS = Array.from({ length: 9 }, (_, i) => `7710${String(i + 1).padStart(4, "0")}`);

test("phase 5 exit test: on a phone, an engineer places 9 loggers for the freezer by scanning, records start and end, and FT-12 prints", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Field work is done on a phone.");
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await page.addInitScript((serials: string[]) => {
    let calls = 0;
    // Each label stays in front of the camera for a few frames, like a real scan.
    class FakeDetector {
      async detect() {
        calls += 1;
        const i = Math.floor(calls / 3) - 1;
        return i < serials.length && calls % 3 === 0 ? [{ rawValue: serials[i]! }] : [];
      }
    }
    Object.defineProperty(window, "BarcodeDetector", { value: FakeDetector });
  }, SERIALS);

  await signIn(page, "engineer");
  await page.goto("/studies");
  await page.getByRole("link", { name: /FE-WF-02/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /FE-WF-02/ })).toBeVisible();

  // Layout: nine positions from the template, as on the report.
  await page.getByRole("button", { name: "Fill 9 positions" }).click();
  await page.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByText("Saved 9 positions.")).toBeVisible();

  // A scanner gun fires three labels back to back, one of them unreadable
  // junk: none is merged with the next or dropped, and the refusal stays on
  // screen.
  await page.getByRole("link", { name: /^Loggers/ }).click();
  // The server is slowed down, as it is on a site's mobile data.
  const slow = async (route: import("@playwright/test").Route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  };
  await page.route("**/studies/**", slow);
  const box = page.getByPlaceholder("Scan or type ID / serial");
  for (const scan of [SERIALS[0]!, "NOPE-1", SERIALS[1]!]) {
    await box.fill(scan);
    await box.press("Enter");
  }
  await expect(page.getByRole("button", { name: /Placing… \(3\)/ })).toBeVisible();
  await expect(page.getByText(/placed at L-01\..*NOPE-1: .*placed at L-02\./)).toBeVisible({
    timeout: 15_000,
  });
  await page.unroute("**/studies/**", slow);

  // Scan the rest with the camera.
  await page.getByRole("button", { name: "Scan with camera" }).click();
  await expect(page.getByText(/placed at L-09\. All positions done\./)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.getByText("9 of 9")).toBeVisible();

  // Times: start, then end (it asks first: the 24 h study has just begun).
  await page.getByRole("link", { name: /^Times/ }).click();
  await page.getByRole("button", { name: "Start study" }).click();
  await expect(page.getByText(/Started at .* recorded\./)).toBeVisible();
  await page.getByRole("button", { name: "End study" }).click();
  await expect(page.getByText(/has run .* of the planned 24 h/)).toBeVisible();
  await page.getByRole("button", { name: "End anyway" }).click();
  await expect(page.getByText(/Ended at .* recorded\./)).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-tone]").first()).toHaveText("Done");

  // FT-12 prints.
  const href = await page
    .getByRole("link", { name: "Sensor location sheet (FT-12)" })
    .getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // No sideways scrolling on the phone.
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
  expect(errors).toEqual([]);
});
