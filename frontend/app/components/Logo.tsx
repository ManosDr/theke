// Brand mark: a Greek Θ (theta) - ring crossed by a horizontal bar - on a
// rounded-square green field. Colors are fixed per the brand spec regardless
// of light/dark theme (unlike most of the UI, which themes via CSS vars).
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <rect x="4" y="4" width="112" height="112" rx="26" fill="#33BE6E" />
      <circle cx="60" cy="60" r="32" fill="none" stroke="#FFFFFF" strokeWidth={9} />
      <line x1="35" y1="60" x2="85" y2="60" stroke="#FFFFFF" strokeWidth={9} />
    </svg>
  );
}

export function Logo({ size = 40, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <LogoMark size={size} />
      {withWordmark && (
        <span style={{ fontSize: size * 0.55, fontWeight: 800, letterSpacing: "-0.02em" }}>theke</span>
      )}
    </div>
  );
}
