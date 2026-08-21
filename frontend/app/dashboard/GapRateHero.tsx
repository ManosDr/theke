import type { ReactNode } from "react";
import Link from "next/link";

import { AlertIcon } from "../components/StatIcons";
import styles from "./GapRateHero.module.css";
import type { AttentionTone } from "./AttentionCard";

// Promoted out of the ordinary attention-card row into its own top-placed,
// larger treatment - Part D of the same-night batch: gap-rate is explicitly
// the primary actionable signal during beta, more than any other metric, so
// it gets a visual weight the other tiles don't (see KNOWN_DECISIONS.md).
//
// The big percentage is a cumulative, all-time figure (see admin.py's
// GET /admin/stats - gap_count/total_messages has no date filter) - it is
// NOT recomputed retroactively as old gaps get resolved tonight, it just
// keeps accreting going forward. historicalNote/trendHref make that explicit
// so the number isn't mistaken for a live, actionable count - that job
// belongs to unresolvedGaps, the side badge, which does drop in real time.
export function GapRateHero({
  tone,
  gapRate,
  unresolvedGaps,
  label,
  historicalNote,
  trendHref,
  trendLabel,
  unresolvedLabel,
  cta,
  onCtaClick,
}: {
  tone: AttentionTone;
  gapRate: number;
  unresolvedGaps: number;
  label: ReactNode;
  historicalNote?: ReactNode;
  trendHref?: string;
  trendLabel?: string;
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
        {historicalNote && <span className={styles.historicalNote}>{historicalNote}</span>}
        {trendHref && trendLabel && (
          <Link href={trendHref} className={styles.trendLink}>
            {trendLabel} →
          </Link>
        )}
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
