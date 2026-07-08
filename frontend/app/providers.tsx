"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "./lib/auth";
import { LocaleProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { VerticalProvider } from "./lib/vertical";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <LocaleProvider>
          <VerticalProvider>{children}</VerticalProvider>
        </LocaleProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
