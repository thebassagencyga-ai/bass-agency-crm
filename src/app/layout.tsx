import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import { ServiceWorkerRegistration } from "@/components/service-worker";
import { parseTheme, THEME_COOKIE, themeClass } from "@/lib/theme";
import "./globals.css";

// Inter is downloaded at build time and served from this app (font-src 'self'); no font
// request goes to Google when the app is used.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Producr CRM",
  description: "Producr CRM: the sales and relationship CRM for insurance agents. Private to The Bass Agency.",
  robots: { index: false, follow: false },
  applicationName: "Producr",
  manifest: "/manifest.webmanifest",
  // Add to Home Screen on iPhone: full-screen app with its own icon and name.
  appleWebApp: { capable: true, title: "Producr", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Midnight Ink, matching the app's top bar.
  themeColor: "#111923",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request headers makes every page render per request, so Next.js can apply
  // the CSP nonce set by the middleware to its scripts. No page is cached or prerendered.
  await headers();
  // Light / dark / device, chosen in Settings and kept in a cookie on this device (ADR-038).
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={[inter.variable, themeClass(theme)].filter(Boolean).join(" ")}>
      <body className="min-h-dvh bg-canvas font-sans text-fg antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
