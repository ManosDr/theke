"use client";

import { useTheme } from "../lib/theme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      className="btn btn-secondary"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      style={{ padding: "var(--space-2)" }}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
