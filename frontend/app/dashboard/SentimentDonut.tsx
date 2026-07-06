const RADIUS = 28;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SentimentDonut({ positive, negative }: { positive: number; negative: number }) {
  const total = positive + negative;
  const ratio = total === 0 ? 0 : positive / total;
  const percent = Math.round(ratio * 100);
  const dash = `${(ratio * CIRCUMFERENCE).toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}`;

  return (
    <svg width="70" height="70" viewBox="0 0 70 70" aria-hidden="true">
      <circle cx="35" cy="35" r={RADIUS} fill="none" stroke="var(--color-border)" strokeWidth="9" />
      {total > 0 && (
        <circle
          cx="35"
          cy="35"
          r={RADIUS}
          fill="none"
          stroke="var(--color-warning)"
          strokeWidth="9"
          strokeDasharray={dash}
          strokeLinecap="round"
          transform="rotate(-90 35 35)"
        />
      )}
      <text x="35" y="40" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--color-text)">
        {percent}
      </text>
    </svg>
  );
}
