import { expect, test } from "@playwright/test";

import { signIn, trackErrors, USERS } from "./support";

test("pages send visitors without a session to sign in, then back", async ({ page }) => {
  await page.goto("/users");
  await expect(page).toHaveURL(/\/login\?next=%2Fusers/);
  await page.getByLabel("Email").fill(USERS.admin.email);
  await page.getByLabel("Password").fill(USERS.admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
});

test("a wrong password gets the same message as an unknown email", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@e2e.test");
  await page.getByLabel("Password").fill("whatever it is");
  await page.getByRole("button", { name: "Sign in" }).click();
  const unknown = await page.locator("form [role=alert]").textContent();

  await page.getByLabel("Email").fill(USERS.engineer.email);
  await page.getByLabel("Password").fill("not the right one");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form [role=alert]")).toHaveText(unknown ?? "x");
  expect(unknown).toBe("Email or password is incorrect.");
});

test("the session cookie is httpOnly and SameSite=Lax", async ({ page, context }) => {
  await signIn(page, "engineer");
  const cookie = (await context.cookies()).find((c) => c.name.endsWith("qtech_session"));
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
});

test("a field engineer sees only their screens and is turned away from admin pages", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "engineer");
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  const nav = page.getByRole("navigation", { name: "Main" }).last();
  await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/no-access$/);
});

test("signing out ends the session", async ({ page, isMobile }) => {
  test.skip(isMobile, "Same flow as desktop; the account menu is identical.");
  const errors = trackErrors(page);
  await signIn(page, "admin");
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test.describe("upload endpoint", () => {
  test("requires a session and refuses cross-site requests", async ({ request, baseURL }) => {
    const noSession = await request.post("/api/files", {
      headers: { origin: baseURL! },
      multipart: { file: { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n") } },
    });
    expect(noSession.status()).toBe(401);

    const crossSite = await request.post("/api/files", {
      headers: { origin: "https://evil.example" },
      multipart: { file: { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n") } },
    });
    expect(crossSite.status()).toBe(403);
  });

  test("stores a file for a signed-in engineer and refuses fakes", async ({ page }) => {
    await signIn(page, "engineer");
    const results = await page.evaluate(async () => {
      const send = async (name: string, content: BlobPart) => {
        const form = new FormData();
        form.append("file", new File([content], name));
        const response = await fetch("/api/files", { method: "POST", body: form });
        return { status: response.status, body: await response.json() };
      };
      return {
        csv: await send("raw.csv", "Date,Time,62281257\n22.05.2026,22:30:00,-22.2\n"),
        fake: await send("invoice.pdf", new Uint8Array([0x4d, 0x5a, 0x90, 0])),
      };
    });
    expect([200, 201]).toContain(results.csv.status);
    expect(results.csv.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(results.fake.status).toBe(422);
  });
});

test("dialogs open under the strict CSP without blocked styles", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page, "admin");
  await page.goto("/users");
  await page.getByRole("button", { name: "Invite user" }).click();
  await expect(page.getByRole("dialog", { name: "Invite a team member" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
