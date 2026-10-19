import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ServiceWorkerRegistration } from "@/components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZeroLapse CRM",
  description: "ZeroLapse CRM: the sales and relationship CRM for insurance agents. Private to The Bass Agency.",
  robots: { index: false, follow: false },
  applicationName: "ZeroLapse",
  manifest: "/manifest.webmanifest",
  // Add to Home Screen on iPhone: full-screen app with its own icon and name.
  appleWebApp: { capable: true, title: "ZeroLapse", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request headers makes every page render per request, so Next.js can apply
  // the CSP nonce set by the middleware to its scripts. No page is cached or prerendered.
  await headers();
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
