import { expect, test, type Page } from "@playwright/test";

/** Collect browser errors (including CSP violations) so a page with broken scripts fails. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("home page renders the QA Tech shell with no browser errors", async ({ page }) => {
  const errors = trackErrors(page);
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByText("Nothing assigned to you yet")).toBeVisible();
  // The component gallery is development-only, so production shows no link to it.
  await expect(page.getByRole("link", { name: "Open the component gallery" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("security headers and a per-request CSP nonce are sent", async ({ request }) => {
  const first = await request.get("/");
  const second = await request.get("/");
  const csp = first.headers()["content-security-policy"] ?? "";

  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).not.toContain("style-src 'self' 'unsafe-inline'");
  expect(second.headers()["content-security-policy"]).not.toBe(csp);

  const headers = first.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
  expect(headers["cache-control"]).toContain("no-store");
});

test("navigation marks modules that are not built yet as unavailable", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByText("Jobs")).toHaveAttribute("title", "Arrives in build phase 4");
  await expect(nav.getByRole("link", { name: "Jobs" })).toHaveCount(0);
});

test("unknown pages show the QA Tech 404 page", async ({ page }) => {
  const errors = trackErrors(page);
  const response = await page.goto("/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page doesn't exist" })).toBeVisible();
  expect(errors.filter((e) => !e.includes("404"))).toEqual([]);
});

test("the development component gallery is hidden in production", async ({ page }) => {
  const response = await page.goto("/dev/components");
  expect(response?.status()).toBe(404);
});
