import type { Metadata, Viewport } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";

import { ChunkErrorRecovery } from "./components/ChunkErrorRecovery";
import { RegisterServiceWorker } from "./components/RegisterServiceWorker";
import { Providers } from "./providers";
import "./globals.css";
import "leaflet/dist/leaflet.css";

// Source Sans 3 (body) + Source Serif 4 (headings) - the pairing from the
// Phase 4 landing-page design handoff, now the app-wide type system per
// explicit follow-up request rather than staying scoped to that one page.
// Both cover the Greek subset that most of this app's UI text needs.
// Replaces the earlier Inter-only stack (see globals.css's --font-sans/
// --font-serif for where each variable is actually applied).
const sourceSans = Source_Sans_3({
  subsets: ["latin", "greek"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});
const sourceSerif = Source_Serif_4({
  subsets: ["latin", "greek"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-heading",
});

// Shared across og:description/twitter:description/meta description below -
// the landing page's own hero subhead (see translations.ts's "landing.heroSub",
// English row), not a third rewrite of the same pitch. Trimmed to its first
// sentence to stay within the ~155-200 char range link previews actually
// render before truncating.
const SITE_DESCRIPTION =
  "You ask in plain Greek; theke answers with citations to the Government Gazette (ΦΕΚ), laws and AADE circulars.";
const SITE_TITLE = "theke — Regulations, answered: with the source, every time.";

export const metadata: Metadata = {
  metadataBase: new URL("https://theke.ai"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  manifest: "/manifest.json",
  // Single static default, deliberately not keyed to prefers-color-scheme -
  // the app's own theme (lib/theme.tsx) ignores the OS preference and
  // defaults to light too, so this must match rather than race it. Dark
  // theme is layered on top client-side by FaviconSync, which only ever
  // adds its own extra <link> and never touches this one (see that file
  // for why: removing a Next-rendered head tag out from under Next's own
  // reconciliation crashes the app on the next client-side navigation).
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "theke",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "https://theke.ai",
    siteName: "theke",
    // Absolute URL, not resolved via metadataBase - some social scrapers
    // (and next dev's own metadataBase resolution) are inconsistent about
    // relative image URLs, so this is spelled out explicitly. 1200x630 is
    // the standard safe size across platforms. Placeholder - the wordmark
    // on the brand navy background - until a properly designed share image
    // is commissioned (see KNOWN_DECISIONS.md).
    images: [{ url: "https://theke.ai/og-image.png", width: 1200, height: 630, alt: "theke" }],
    locale: "el_GR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["https://theke.ai/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1b2a4a",
};

// Runs before hydration so the correct theme applies on first paint - avoids
// a flash of the wrong theme when the stored preference differs from the OS.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theke-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sourceSans.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <RegisterServiceWorker />
        <ChunkErrorRecovery />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
