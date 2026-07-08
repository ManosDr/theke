import type { ReactNode } from "react";

import styles from "./StatCard.module.css";

export type StatTone = "primary" | "info" | "accent" | "purple" | "danger";

export function StatCard({
  value,
  label,
  icon,
  tone = "primary",
}: {
  value: ReactNode;
  label: string;
  icon: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className={`card ${styles.statCard} ${styles[`tone-${tone}`]}`}>
      <div className={styles.left}>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.label}>{label}</span>
      </div>
      <span className={styles.value}>{value}</span>
    </div>
  );
}
