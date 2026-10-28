import type { Metadata, Viewport } from "next";
import { connection } from "next/server";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "QTech", template: "%s · QTech" },
  description: "Calibration and thermal validation management for QA Tech.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#002d8c",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request. The CSP in src/proxy.ts uses a fresh nonce on each
  // request, and a page prebuilt as static HTML cannot carry it, so its scripts would be
  // blocked. Every screen is behind login and shows live data anyway (ADR 0002).
  await connection();

  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
