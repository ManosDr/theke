export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="var(--color-primary)" />
      <ellipse cx="50" cy="50" rx="24" ry="30" fill="none" stroke="var(--color-text-on-primary)" strokeWidth={8} />
      <line x1="26" y1="50" x2="74" y2="50" stroke="var(--color-text-on-primary)" strokeWidth={8} />
    </svg>
  );
}

export function Logo({ size = 40, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
      <LogoMark size={size} />
      {withWordmark && (
        <span style={{ fontSize: size * 0.55, fontWeight: 700, letterSpacing: "-0.02em" }}>theke</span>
      )}
    </div>
  );
}
