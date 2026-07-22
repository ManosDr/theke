import type { ReactNode } from "react";

import styles from "./AttentionCard.module.css";

export type AttentionTone = "success" | "warning" | "danger" | "info";

export function AttentionCard({
  label,
  value,
  icon,
  tone,
  cta,
  onCtaClick,
}: {
  label: ReactNode;
  value: ReactNode;
  icon: ReactNode;
  tone: AttentionTone;
  cta: string;
  onCtaClick: () => void;
}) {
  return (
    <div className={`card ${styles.card} ${styles[`tone-${tone}`]}`}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        <span className={styles.iconBadge}>{icon}</span>
      </div>
      <div className={styles.bottom}>
        <span className={styles.value}>{value}</span>
        <button type="button" className={styles.cta} onClick={onCtaClick}>
          {cta} →
        </button>
      </div>
    </div>
  );
}
