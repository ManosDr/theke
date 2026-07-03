"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "./lib/auth";
import { LocaleProvider } from "./lib/i18n";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <LocaleProvider>{children}</LocaleProvider>
    </AuthProvider>
  );
}
