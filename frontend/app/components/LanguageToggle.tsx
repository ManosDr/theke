"use client";

import { useLocale } from "../lib/i18n";

export function LanguageToggle() {
  const { locale, locales, setLocale } = useLocale();

  return (
    <select
      className="input"
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
      aria-label="Language"
      style={{ width: "auto", padding: "var(--space-1) var(--space-2)" }}
    >
      {locales.map((l) => (
        <option key={l.code} value={l.code}>
          {l.code.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
