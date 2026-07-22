"use client";

import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type { VerticalStatsEntry, VerticalSummary } from "../lib/types";
import styles from "./dashboard.module.css";

const ACCENT_CLASS: Record<string, string> = {
  construction: styles.accentConstruction,
  tax_accounting: styles.accentTax,
};

// Real message counts already fetched for the vertical cards above (see
// GET /admin/stats' by_vertical) - reused here as a bar-per-vertical
// breakdown rather than a new endpoint, since it's the same underlying
// number just rendered as a proportional bar instead of a raw figure.
export function QueriesByVerticalBars({
  verticals,
  statsByVertical,
}: {
  verticals: VerticalSummary[];
  statsByVertical: Map<string, VerticalStatsEntry>;
}) {
  const { t, tUpper } = useLocale();
  const maxMessages = Math.max(1, ...verticals.map((v) => statsByVertical.get(v.slug)?.messages ?? 0));

  return (
    <div className={styles.queriesByVertical}>
      <div className={styles.sentimentLabel}>{tUpper("dash.super.queriesByVertical")}</div>
      {verticals.map((v) => {
        const messages = statsByVertical.get(v.slug)?.messages ?? 0;
        const widthPct = (messages / maxMessages) * 100;
        return (
          <div key={v.id} className={styles.queriesRow}>
            <div className={styles.queriesLabelRow}>
              <span>{t(`vertical.${v.slug}` as TranslationKey)}</span>
              <span className={styles.value}>{messages.toLocaleString()}</span>
            </div>
            <div className={styles.queriesBarTrack}>
              <div
                className={`${styles.queriesBarFill} ${ACCENT_CLASS[v.slug] ?? ""}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
