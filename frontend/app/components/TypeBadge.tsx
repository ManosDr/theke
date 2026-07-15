import type { CSSProperties, ReactNode } from "react";

type BadgeTone = "success" | "warning" | "danger" | "info" | "purple" | "neutral";

// One distinct, WCAG-audited tone per type so a user scanning a table of
// mixed doc/provider types can tell them apart at a glance without reading
// every label - see item 14 of the batch-1 fix list.
const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  success: { background: "var(--color-success-bg)", color: "var(--color-success)" },
  warning: { background: "var(--color-warning-bg)", color: "var(--color-warning)" },
  danger: { background: "var(--color-danger-bg)", color: "var(--color-danger)" },
  info: { background: "var(--color-info-bg)", color: "var(--color-info)" },
  purple: { background: "var(--color-purple-bg)", color: "var(--color-purple)" },
  neutral: { background: "var(--admin-chip-bg)", color: "var(--admin-stone)" },
};

const DOC_TYPE_TONES: Record<string, BadgeTone> = {
  law: "purple",
  circular: "info",
  reference: "success",
  guide: "warning",
  upload: "neutral",
};

const PROVIDER_TYPE_TONES: Record<string, BadgeTone> = {
  water: "info",
  electric_grid: "warning",
};

export function TypeBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className="badge" style={TONE_STYLES[tone]}>
      {children}
    </span>
  );
}

export function DocTypeBadge({ docType, children }: { docType: string; children: ReactNode }) {
  return <TypeBadge tone={DOC_TYPE_TONES[docType] ?? "neutral"}>{children}</TypeBadge>;
}

export function ProviderTypeBadge({ providerType, children }: { providerType: string; children: ReactNode }) {
  return <TypeBadge tone={PROVIDER_TYPE_TONES[providerType] ?? "neutral"}>{children}</TypeBadge>;
}
