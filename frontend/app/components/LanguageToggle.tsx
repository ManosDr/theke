"use client";

import { useLocale } from "../lib/i18n";
import type { Locale } from "../lib/translations";

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();

  return (
    <select
      className="input"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label="Language"
      style={{ width: "auto", padding: "var(--space-1) var(--space-2)" }}
    >
      <option value="en">EN</option>
      <option value="el">ΕΛ</option>
    </select>
  );
}
