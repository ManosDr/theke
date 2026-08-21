import type { ReactNode } from "react";

import { AlertIcon } from "../components/StatIcons";
import styles from "./GapRateHero.module.css";
import type { AttentionTone } from "./AttentionCard";

// Promoted out of the ordinary attention-card row into its own top-placed,
// larger treatment - Part D of the same-night batch: gap-rate is explicitly
// the primary actionable signal during beta, more than any other metric, so
// it gets a visual weight the other tiles don't (see KNOWN_DECISIONS.md).
export function GapRateHero({
  tone,
  gapRate,
  unresolvedGaps,
  label,
  unresolvedLabel,
  cta,
  onCtaClick,
}: {
  tone: AttentionTone;
  gapRate: number;
  unresolvedGaps: number;
  label: ReactNode;
  unresolvedLabel: ReactNode;
  cta: string;
  onCtaClick: () => void;
}) {
  return (
    <div className={`card ${styles.hero} ${styles[`tone-${tone}`]}`}>
      <div className={styles.iconBadge}>
        <AlertIcon size={22} />
      </div>
      <div className={styles.main}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{gapRate}%</span>
      </div>
      <div className={styles.side}>
        <span className={styles.unresolvedBadge}>
          <strong>{unresolvedGaps}</strong> {unresolvedLabel}
        </span>
        <button type="button" className={styles.cta} onClick={onCtaClick}>
          {cta} →
        </button>
      </div>
    </div>
  );
}
