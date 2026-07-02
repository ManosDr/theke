"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theke-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme") as Theme | null;
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      className="btn btn-secondary"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      style={{ padding: "var(--space-2)" }}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
