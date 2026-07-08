"use client";

import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { VerticalStatsEntry, VerticalSummary } from "../lib/types";
import styles from "./dashboard.module.css";

const ACCENT_CLASS: Record<string, string> = {
  construction: styles.accentConstruction,
  tax_accounting: styles.accentTax,
};

export function VerticalStatsCard({
  vertical,
  stats,
  full,
  onViewDetails,
}: {
  vertical: VerticalSummary;
  stats: VerticalStatsEntry | undefined;
  full: boolean;
  onViewDetails: () => void;
}) {
  const { t } = useLocale();
  const accentClass = ACCENT_CLASS[vertical.slug] ?? "";
  const gapRate = stats?.gap_rate ?? 0;
  const gapClass = gapRate >= 50 ? styles.gapDanger : gapRate >= 20 ? styles.gapWarning : styles.gapSuccess;

  return (
    <div className={`card ${styles.verticalCard} ${accentClass} ${full ? styles.verticalCardFull : ""}`}>
      <div className={styles.verticalCardHeader}>
        <div>
          <h3 className={styles.verticalCardName}>{vertical.display_name}</h3>
          {vertical.tagline && <p className={styles.verticalCardTagline}>{vertical.tagline}</p>}
        </div>
        <span className={`${styles.verticalPill} ${accentClass}`}>{t(`vertical.${vertical.slug}` as TranslationKey)}</span>
      </div>

      <div className={full ? styles.verticalStatsGridFull : styles.verticalStatsGrid}>
        <div className={styles.verticalStat}>
          <span className={styles.value}>{stats?.active_documents ?? 0}</span>
          <span className={styles.label}>{t("dash.super.activeDocuments")}</span>
        </div>
        <div className={styles.verticalStat}>
          <span className={styles.value}>{stats?.messages ?? 0}</span>
          <span className={styles.label}>{t("dash.vertical.queries")}</span>
        </div>
        <div className={styles.verticalStat}>
          <span className={`${styles.value} ${gapClass}`}>{gapRate}%</span>
          <span className={styles.label}>{t("dash.super.gapRate")}</span>
        </div>
      </div>

      <div className={styles.verticalCardFooter}>
        <span className="text-muted">{t("dash.vertical.activeCompanies", { count: stats?.active_companies ?? 0 })}</span>
        <button type="button" className={styles.verticalCardLink} onClick={onViewDetails}>
          {t("dash.vertical.viewDetails")}
        </button>
      </div>
    </div>
  );
}
