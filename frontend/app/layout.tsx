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

export const metadata: Metadata = {
  title: "theke",
  description: "AI copilot for Greek construction permits and compliance",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "theke",
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
