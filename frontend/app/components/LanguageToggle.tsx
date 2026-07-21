"use client";

import { useLocale } from "../lib/i18n";
import styles from "./LanguageToggle.module.css";

export function LanguageToggle() {
  const { locale, locales, setLocale, t } = useLocale();

  return (
    <div className={styles.wrap}>
      <select
        className={styles.select}
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label={t("topbar.language")}
      >
        {locales.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      <svg
        className={styles.chevron}
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}
