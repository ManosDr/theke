import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import { CheckIcon, WarningIcon } from "./UiIcons";
import styles from "./ConfidenceBadge.module.css";

// A source candidate's AI-reported confidence ("high"/"medium"/"low", see
// gap_discovery.py) is a genuine success/risk signal, not neutral metadata -
// "high" means the search found the same answer corroborated across
// multiple independent authoritative sources, worth celebrating the way any
// other success state is (green, checkmark), not just printed as plain
// text next to a label. Shared between ChatGapRatePanel's review cards and
// GapResolutionModal so the same candidate reads identically in the list
// and inside the modal.
const TONE_CLASS: Record<string, string> = {
  high: styles.high,
  medium: styles.medium,
  low: styles.low,
};

export function ConfidenceBadge({ confidence, size = "md" }: { confidence: string; size?: "sm" | "md" }) {
  const { t } = useLocale();
  const tone = TONE_CLASS[confidence] ?? styles.medium;
  const label = t(`admin.chatGapRate.candidates.confidenceLevel.${confidence}` as TranslationKey);
  return (
    <span className={`${styles.badge} ${tone} ${size === "sm" ? styles.sm : ""}`}>
      {confidence === "high" ? <CheckIcon size={size === "sm" ? 11 : 13} /> : <WarningIcon size={size === "sm" ? 11 : 13} />}
      {label}
    </span>
  );
}
