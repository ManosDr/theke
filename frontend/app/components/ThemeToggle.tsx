"use client";

import { useTheme } from "../lib/theme";
import { MoonIcon, SunIcon } from "./StatIcons";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      className="btn btn-secondary"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      style={{ padding: "var(--space-2)", display: "flex" }}
    >
      {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
}
