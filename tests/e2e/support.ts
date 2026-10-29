import { expect, type Page } from "@playwright/test";

/** Same users as scripts/e2e-prepare.ts creates. */
export const USERS = {
  admin: { email: "admin@e2e.test", name: "Asha Admin", password: "calibrated sensor chain 1" },
  engineer: {
    email: "engineer@e2e.test",
    name: "Ravi Engineer",
    password: "logger placement walk 2",
  },
  lab: { email: "lab@e2e.test", name: "Lata Lab", password: "dry block at minus twenty 3" },
  lead: { email: "lead@e2e.test", name: "Tarun Lead", password: "checked twice at fifteen 4" },
  manager: {
    email: "manager@e2e.test",
    name: "Meera Manager",
    password: "approved and issued now 5",
  },
} as const;

export function e2eDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set (a database whose name ends in _test).");
  }
  return url;
}

export async function signIn(page: Page, who: keyof typeof USERS): Promise<void> {
  const user = USERS[who];
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Hello,/ })).toBeVisible();
}

/** Browser errors (including CSP violations), so a page with broken scripts fails. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}
