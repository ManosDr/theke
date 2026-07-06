"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "./lib/auth";
import { LocaleProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <LocaleProvider>{children}</LocaleProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
