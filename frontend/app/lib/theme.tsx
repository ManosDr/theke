"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "./auth";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "theke-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, updatePreferredTheme } = useAuth();
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    // A signed-in user's saved preference wins; otherwise fall back to
    // whatever was last picked on this device; otherwise light, the
    // universal default (deliberately ignores prefers-color-scheme - see
    // globals.css).
    if (user?.preferredTheme === "light" || user?.preferredTheme === "dark") {
      setThemeState(user.preferredTheme);
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    setThemeState(stored === "dark" ? "dark" : "light");
  }, [user?.preferredTheme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function setTheme(next: Theme) {
    setThemeState(next);
    if (user) updatePreferredTheme(next).catch(() => {});
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
