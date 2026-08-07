"use client";

import { useLocale } from "../lib/i18n";
import styles from "./LanguageToggle.module.css";

export function LanguageToggle() {
  const { locale, locales, setLocale, t } = useLocale();

  return (
    <div className={styles.wrap}>
      <select
        className={`${styles.select} ${styles.selectFull}`}
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
      {/* Same control, short codes instead of full locale names - swapped in
          under a breakpoint by CSS alone (see .selectFull/.selectCompact),
          not a media-query hook in JS. Exists so a narrow header (landing
          page nav) can fit this alongside the theme toggle, login link, and
          CTA on one row instead of wrapping - "Ελληνικά" alone is wider than
          the whole row has room for at phone widths. Same padding as the
          full select, so the tap target doesn't shrink, only the text does. */}
      <select
        className={`${styles.select} ${styles.selectCompact}`}
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label={t("topbar.language")}
      >
        {locales.map((l) => (
          <option key={l.code} value={l.code}>
            {l.code.toUpperCase()}
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
