import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { RegisterServiceWorker } from "./components/RegisterServiceWorker";
import { Providers } from "./providers";
import "./globals.css";

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
  themeColor: "#1d3557",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <RegisterServiceWorker />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
