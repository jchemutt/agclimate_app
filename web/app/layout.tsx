import type { Metadata, Viewport } from "next";
// Self-hosted (no request to Google). Designed for legibility on small,
// low-quality screens: field use first.
import "@fontsource-variable/atkinson-hyperlegible-next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgClimate AF seasonal outlook",
  description: "Seasonal outlooks for rainfall, season timing, crops, drought, heat and livestock, with advisories for farmers and pastoralists.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#eef2ee" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
