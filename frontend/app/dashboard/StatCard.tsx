import type { ReactNode } from "react";

import styles from "./StatCard.module.css";

export type StatTone = "primary" | "info" | "accent" | "purple" | "danger" | "success" | "warning";

export function StatCard({
  value,
  label,
  icon,
  tone = "primary",
  // Renders a thin fill bar under the label, colored to match `tone` - for
  // stats that are a ratio against some ceiling (e.g. messages used against
  // a plan's pool) rather than a flat count. Omit for plain counts.
  progressPercent,
}: {
  value: ReactNode;
  label: ReactNode;
  icon: ReactNode;
  tone?: StatTone;
  progressPercent?: number;
}) {
  return (
    <div className={`card ${styles.statCard} ${styles[`tone-${tone}`]}`}>
      <div className={styles.left}>
        <span className={styles.icon}>{icon}</span>
        <div className={styles.labelCol}>
          <span className={styles.label}>{label}</span>
          {progressPercent != null && (
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }} />
            </div>
          )}
        </div>
      </div>
      <span className={styles.value}>{value}</span>
    </div>
  );
}
