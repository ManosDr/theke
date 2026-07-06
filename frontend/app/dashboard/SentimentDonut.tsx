const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SentimentDonut({
  positive,
  negative,
  size = 120,
}: {
  positive: number;
  negative: number;
  size?: number;
}) {
  const total = positive + negative;
  const ratio = total === 0 ? 0 : positive / total;
  const percent = Math.round(ratio * 100);
  const dash = `${(ratio * CIRCUMFERENCE).toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}`;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }} aria-hidden="true">
      <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--color-border)" strokeWidth="12" />
      {total > 0 && (
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="var(--color-warning)"
          strokeWidth="12"
          strokeDasharray={dash}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      )}
      <text x="50" y="58" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--color-text)">
        {percent}
      </text>
    </svg>
  );
}
