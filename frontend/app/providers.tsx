"use client";

import type { ReactNode } from "react";

import { SessionExpiryToast } from "./components/SessionExpiryToast";
import { AuthProvider } from "./lib/auth";
import { CompanyProvider } from "./lib/company";
import { FontScaleProvider } from "./lib/fontScale";
import { LocaleProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { VerticalProvider } from "./lib/vertical";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CompanyProvider>
        <ThemeProvider>
          <LocaleProvider>
            <VerticalProvider>
              <FontScaleProvider>
                {children}
                <SessionExpiryToast />
              </FontScaleProvider>
            </VerticalProvider>
          </LocaleProvider>
        </ThemeProvider>
      </CompanyProvider>
    </AuthProvider>
  );
}
