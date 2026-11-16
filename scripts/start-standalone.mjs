// Runs the production standalone server exactly as the Docker image will.
// Next's standalone output does not include public/ and .next/static/, so copy them in first.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";

// The standalone server runs from .next/standalone and doesn't see .env.local there.
// Values already set in the shell win.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (!existsSync(".next/standalone/server.js")) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}

cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });

const server = spawn(process.execPath, ["server.js"], {
  cwd: ".next/standalone",
  stdio: "inherit",
  env: { ...process.env, HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1" },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
